/* eslint no-bitwise: 0 */
'use strict';

const mailsplit = require('mailsplit');
const Rewriter = mailsplit.Rewriter;
const Splitter = mailsplit.Splitter;
const Joiner = mailsplit.Joiner;
const pathlib = require('path');
const fs = require('fs').promises;
const fsCreateReadStream = require('fs').createReadStream;

const plist = require('plist');
const Transform = require('stream').Transform;

class EmlxRawStream extends Transform {
    constructor(options) {
        super();
        this.options = options || {};

        this.state = 'first_line';

        this.firstLine = '';
        this.expecting = 0;
        this.bytesRead = 0;

        this.trailerChunks = [];
        this.trailerChunkLen = 0;

        this.lastByte = false;
    }

    // keep last newline
    pushBytes(chunk) {
        if (!chunk.length) {
            return;
        }

        if (this.lastByte) {
            this.push(Buffer.from([this.lastByte]));
            this.lastByte = false;
        }

        if (chunk[chunk.length - 1] === 0x0a) {
            if (chunk.length > 1) {
                this.push(chunk.slice(0, chunk.length - 1));
            }
            this.lastByte = 0x0a;
        } else {
            this.push(chunk);
        }
    }

    _transform(chunk, encoding, done) {
        if (typeof chunk === 'string') {
            chunk = Buffer.from(chunk, encoding);
        }

        let readBytes = () => {
            switch (this.state) {
                case 'first_line': {
                    for (let i = 0; i < chunk.length; i++) {
                        if (chunk[i] === 0x0a) {
                            this.firstLine += chunk.slice(0, i).toString();
                            this.expecting = Number(this.firstLine.trim());
                            this.state = 'body';

                            if (chunk.length >= i + 1) {
                                chunk = chunk.slice(i + 1);
                                // continue processing body
                                return readBytes();
                            } else {
                                return done();
                            }
                        }
                    }

                    // no line break found, add entire chunk
                    this.firstLine += chunk.toString();
                    return done();
                }

                case 'body': {
                    if (this.bytesRead + chunk.length <= this.expecting) {
                        this.pushBytes(chunk);
                        this.bytesRead += chunk.length;
                        if (this.bytesRead === this.expecting) {
                            this.state = 'trailer';
                        }
                        return done();
                    }

                    // partial chunk
                    let allowed = chunk.slice(0, this.expecting - this.bytesRead);
                    this.pushBytes(allowed);
                    this.bytesRead += allowed.length;
                    this.state = 'trailer';
                    chunk = chunk.slice(allowed.length);
                    // continue processing body
                    return readBytes();
                }

                case 'trailer':
                    this.trailerChunks.push(chunk);
                    this.trailerChunkLen += chunk.length;
                    return done();
            }
        };

        readBytes();
    }

    _flush(done) {
        this.trailer = Buffer.concat(this.trailerChunks, this.trailerChunkLen).toString();

        this.flags = {};
        try {
            this.plist = plist.parse(this.trailer);
            if (typeof this.plist.flags === 'number') {
                this.flags.read = this.plist.flags & (1 << 0) ? true : false;
                this.flags.deleted = this.plist.flags & (1 << 1) ? true : false;
                this.flags.answered = this.plist.flags & (1 << 2) ? true : false;
                this.flags.flagged = this.plist.flags & (1 << 4) ? true : false;
                this.flags.draft = this.plist.flags & (1 << 6) ? true : false;
                this.flags.forwarded = this.plist.flags & (1 << 8) ? true : false;
                this.flags.redirected = this.plist.flags & (1 << 9) ? true : false;
                this.flags.junk = this.plist.flags & (1 << 24) ? true : false;
            }
            this.uid = this.plist['remote-id'] || false;
            this.idate = this.plist['date-received'] ? new Date(Number(this.plist['date-received']) * 1000) : false;
        } catch (err) {
            this.plist = {
                error: err.message
            };
        }

        done();
    }
}

function parseEmlx(path, input) {
    let splitter = new Splitter();
    let joiner = new Joiner();

    // create a Rewriter for text/html
    let rewriter = new Rewriter(node => node.headers.getFirst('X-Apple-Content-Length'));

    rewriter.on('node', data => {
        let chunks = [];
        let chunklen = 0;
        data.decoder.on('data', chunk => {
            chunks.push(chunk);
            chunklen += chunk.length;
        });

        data.decoder.on('end', () => {
            let findAttachment = async () => {
                if (path) {
                    let pathParts = pathlib.parse(path);
                    let parentPathParts = pathParts.dir ? pathlib.parse(pathParts.dir) : false;
                    let baseName = false;

                    if (/\.partial/.test(pathParts.name)) {
                        baseName = pathParts.name.substr(0, pathParts.name.length - '.partial'.length);
                    } else {
                        return false;
                    }

                    if (!parentPathParts || parentPathParts.base !== 'Messages') {
                        return false;
                    }

                    // search for attachment folder
                    let attachmentsFolder = pathlib.join(parentPathParts.dir, 'Attachments', baseName, data.node.partNr.join('.'));
                    let stat;
                    try {
                        stat = await fs.stat(attachmentsFolder);
                        if (!stat || !stat.isDirectory()) {
                            return false;
                        }
                    } catch (err) {
                        console.error(err);
                        return false;
                    }

                    // we have found attachment folder, try to find atachment
                    let listing = await fs.readdir(attachmentsFolder);
                    let files = [];
                    for (let file of listing) {
                        let fileStat = await fs.stat(pathlib.join(attachmentsFolder, file));
                        if (fileStat && fileStat.isFile()) {
                            files.push(file);
                        }
                    }

                    if (files.length === 1) {
                        // found match for attachment!
                        return pathlib.join(attachmentsFolder, files[0]);
                    }
                }

                return false;
            };

            findAttachment()
                .then(path => {
                    if (!path) {
                        return data.encoder.end(Buffer.from(chunks, chunklen));
                    }
                    try {
                        let input = fsCreateReadStream(path);
                        input.on('error', err => {
                            data.encoder.end(Buffer.from(err.message));
                        });
                        input.pipe(data.encoder);
                    } catch (err) {
                        console.error(err);
                        return data.encoder.end(Buffer.from(chunks, chunklen));
                    }
                })
                .catch(err => {
                    console.error(err);
                    data.encoder.end(Buffer.from(chunks, chunklen));
                });
        });
    });

    let parser = new EmlxRawStream();
    parser
        .pipe(splitter)
        .pipe(rewriter)
        .pipe(joiner);

    parser.on('error', err => joiner.emit('error', err));

    input.pipe(parser);
    input.on('error', err => joiner.emit('error', err));

    return { content: joiner, parser };
}

module.exports = parseEmlx;
