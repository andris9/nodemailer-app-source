'use strict';

const Transform = require('stream').Transform;
const Headers = require('mailsplit').Headers;

class HeaderSplitter extends Transform {
    constructor(options) {
        super(options);
        this.lastBytes = Buffer.alloc(4);
        this.headersParsed = false;
        this.headerBytes = 0;
        this.headerChunks = [];
        this.rawHeaders = false;
        this.bodySize = 0;
    }

    /**
     * Keeps count of the last 4 bytes in order to detect line breaks on chunk boundaries
     *
     * @param {Buffer} data Next data chunk from the stream
     */
    _updateLastBytes(data) {
        let lblen = this.lastBytes.length;
        let nblen = Math.min(data.length, lblen);

        // shift existing bytes
        for (let i = 0, len = lblen - nblen; i < len; i++) {
            this.lastBytes[i] = this.lastBytes[i + nblen];
        }

        // add new bytes
        for (let i = 1; i <= nblen; i++) {
            this.lastBytes[lblen - i] = data[data.length - i];
        }
    }

    /**
     * Finds and removes message headers from the remaining body for processing.
     *
     * @param {Buffer} data Next chunk of data
     * @return {Boolean} Returns true if headers are already found or false otherwise
     */
    async _checkHeaders(data) {
        if (this.headersParsed) {
            return true;
        }

        let lblen = this.lastBytes.length;
        let headerPos = 0;
        this.curLinePos = 0;
        for (let i = 0, len = this.lastBytes.length + data.length; i < len; i++) {
            let chr;
            if (i < lblen) {
                chr = this.lastBytes[i];
            } else {
                chr = data[i - lblen];
            }
            if (chr === 0x0a && i) {
                let pr1 = i - 1 < lblen ? this.lastBytes[i - 1] : data[i - 1 - lblen];
                let pr2 = i > 1 ? (i - 2 < lblen ? this.lastBytes[i - 2] : data[i - 2 - lblen]) : false;
                if (pr1 === 0x0a) {
                    this.headersParsed = true;
                    headerPos = i - lblen + 1;
                    this.headerBytes += headerPos;
                    break;
                } else if (pr1 === 0x0d && pr2 === 0x0a) {
                    this.headersParsed = true;
                    headerPos = i - lblen + 1;
                    this.headerBytes += headerPos;
                    break;
                }
            }
        }

        if (this.headersParsed) {
            this.headerChunks.push(data.slice(0, headerPos));
            this.rawHeaders = Buffer.concat(this.headerChunks, this.headerBytes);
            this.headers = new Headers(this.rawHeaders);
            this.headerChunks = null;

            await new Promise(resolve => {
                this.emit('headers', {
                    headers: this.headers,
                    done: () => {
                        // emit the processed header
                        this.push(this.headers.build('\n'));

                        // emit remaining data chunk
                        if (data.length - 1 > headerPos) {
                            let chunk = data.slice(headerPos);
                            this.bodySize += chunk.length;
                            this.push(chunk);
                        }
                        resolve();
                    }
                });
            });

            // do not process current chunk yet
            return false;
        } else {
            this.headerBytes += data.length;
            this.headerChunks.push(data);
        }

        // store last 4 bytes to catch header break
        this._updateLastBytes(data);

        return false;
    }

    _transform(chunk, encoding, callback) {
        if (!chunk || !chunk.length) {
            return callback();
        }

        const processChunk = async () => {
            if (typeof chunk === 'string') {
                chunk = Buffer.from(chunk, encoding);
            }

            let headersFound;

            try {
                headersFound = await this._checkHeaders(chunk);
            } catch (E) {
                return callback(E);
            }

            if (headersFound) {
                this.bodySize += chunk.length;
                this.push(chunk);
            }
        };

        processChunk()
            .then(callback)
            .catch(callback);
    }

    _flush(callback) {
        if (this.headerChunks) {
            // all chunks are checked but we did not find where the body starts
            // so emit all we got as headers and push empty line as body
            this.headersParsed = true;
            // add header terminator
            this.headerChunks.push(Buffer.from('\n\n'));
            this.headerBytes += 2;
            // join all chunks into a header block
            this.rawHeaders = Buffer.concat(this.headerChunks, this.headerBytes);

            this.headers = new Headers(this.rawHeaders);
            this.headerChunks = null;

            return this.emit('headers', {
                headers: this.headers,
                done: () => {
                    // emit the processed header
                    this.push(this.headers.build('\n'));

                    // this is our body
                    this.push(Buffer.from('\n'));

                    callback();
                }
            });
        }
        callback();
    }
}

module.exports = HeaderSplitter;
