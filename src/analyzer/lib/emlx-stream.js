/* eslint no-bitwise: 0 */
'use strict';

const plist = require('plist');
const Transform = require('stream').Transform;

class EmlxStream extends Transform {
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

module.exports = EmlxStream;
