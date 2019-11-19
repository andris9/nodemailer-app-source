'use strict';

const crypto = require('crypto');
const EventEmitter = require('events');
const DataStream = require('nodemailer/lib/smtp-connection/data-stream');
const base32 = require('base32.js');

const SOCKET_TIMEOUT = 60 * 1000;

class POP3Connection extends EventEmitter {
    constructor(server, socket, options) {
        super();

        options = options || {};

        this.ignore = options.ignore;

        this._server = server;
        this._socket = socket;

        this._closed = false;
        this._closing = false;

        // Store remote address for later usage
        this.remoteAddress = options.remoteAddress || this._socket.remoteAddress;
        this.id = options.id || base32.encode(crypto.randomBytes(10)).toLowerCase();

        this.processing = false;
        this.queue = [];
        this._remainder = '';

        this.logger = {};
        ['info', 'debug', 'error'].forEach(level => {
            this.logger[level] = (...args) => {
                if (!this.ignore) {
                    this._server.logger[level](...args);
                }
            };
        });
    }

    init() {
        this._setListeners();
        this._resetSession();
        this.logger.info(
            {
                tnx: 'connection',
                cid: this.id,
                host: this.remoteAddress
            },
            'Connection from %s',
            this.remoteAddress
        );
        this.send('+OK ' + this._server.options.id.name + ' ready for requests from ' + this.remoteAddress + ' ' + this.id);
    }

    write(payload) {
        if (!this._socket || !this._socket.writable) {
            return;
        }
        this._socket.write(payload);
    }

    send(payload) {
        if (!this._socket || !this._socket.writable) {
            return;
        }

        if (Array.isArray(payload)) {
            payload = payload.join('\r\n') + '\r\n.';
        }

        let truncated = payload.split(/\r?\n/);
        let lines = truncated.length;
        let isTruncated = false;
        if (truncated.length > 5) {
            isTruncated = true;
            truncated = truncated.slice(0, 5);
        }
        truncated = truncated.join('\n');
        if (truncated.length > 256) {
            isTruncated = true;
            truncated.substr(0, 256);
        }
        if (isTruncated) {
            truncated += `… <total ${payload.length}B, ${lines} lines>`;
        }

        this.logger.debug(
            {
                tnx: 'send',
                cid: this.id,
                host: this.remoteAddress,
                user: this.session.user
            },
            'S:',
            truncated
        );
        this.write(payload + '\r\n');
    }

    _setListeners() {
        this._socket.on('close', () => this._onClose());
        this._socket.on('error', err => this._onError(err));
        this._socket.setTimeout(this._server.options.socketTimeout || SOCKET_TIMEOUT, () => this._onTimeout());
        this._socket.on('readable', () => {
            if (this.processing) {
                return;
            }
            this.processing = true;

            this.read();
        });
    }

    /**
     * Fired when the socket is closed
     * @event
     */
    _onClose(/* hadError */) {
        if (this._closed) {
            return;
        }

        this.queue = [];
        this.processing = false;
        this._remainder = '';

        this._closed = true;
        this._closing = false;

        this.logger.info(
            {
                tnx: 'close',
                cid: this.id,
                host: this.remoteAddress,
                user: this.session.user
            },
            'Connection closed to %s',
            this.remoteAddress
        );

        this.emit('close');
    }

    /**
     * Fired when an error occurs with the socket
     *
     * @event
     * @param {Error} err Error object
     */
    _onError(err) {
        if (['ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'EHOSTUNREACH'].includes(err.code)) {
            this.close(); // mark connection as 'closing'
            return;
        }

        this.logger.error(
            {
                err,
                tnx: 'error',
                user: this.session.user
            },
            '%s',
            err.message
        );
        this.emit('error', err);
    }

    /**
     * Fired when socket timeouts. Closes connection
     *
     * @event
     */
    _onTimeout() {
        this.send('-ERR Disconnected for inactivity');
        this.close();
    }

    _resetSession() {
        this.session = {
            id: this.id,
            state: 'AUTHORIZATION',
            remoteAddress: this.remoteAddress
        };
    }

    close() {
        if (!this._socket.destroyed && this._socket.writable) {
            this._socket.end();
        }
        this._closing = true;
    }

    read() {
        let chunk;
        let data = this._remainder;
        while ((chunk = this._socket.read()) !== null) {
            data += chunk.toString('binary');
            if (data.indexOf('\n') >= 0) {
                let lines = data.split(/\r?\n/).map(line => Buffer.from(line, 'binary').toString());
                this._remainder = lines.pop();

                if (lines.length) {
                    if (this.queue.length) {
                        this.queue = this.queue.concat(lines);
                    } else {
                        this.queue = lines;
                    }
                }

                return this.processQueue();
            }
        }

        this.processing = false;
    }

    processQueue() {
        if (!this.queue.length) {
            this.read(); // see if there's anything left to read
            return;
        }
        let line = this.queue.shift().trim();

        if (typeof this._nextHandler === 'function') {
            let handler = this._nextHandler;
            this._nextHandler = null;
            this.logger.debug(
                {
                    tnx: 'receive',
                    cid: this.id,
                    user: this.session.user
                },
                'C: <%s bytes of continue data>',
                Buffer.byteLength(line)
            );
            return handler(line, err => {
                if (err) {
                    this.logger.info(
                        {
                            err,
                            tnx: '+',
                            cid: this.id,
                            host: this.remoteAddress
                        },
                        'Error processing continue data. %s',
                        err.message
                    );
                    this.send('-ERR ' + err.message);
                    this.close();
                } else {
                    this.processQueue();
                }
            });
        }

        let parts = line.split(' ');
        let command = parts.shift().toUpperCase();
        let args = parts.join(' ');

        let logLine = (line || '').toString();
        if (/^(PASS|AUTH PLAIN)\s+[^\s]+/i.test(line)) {
            logLine = logLine.replace(/[^\s]+$/, '*hidden*');
        }

        this.logger.debug(
            {
                tnx: 'receive',
                cid: this.id,
                user: this.session.user
            },
            'C:',
            logLine
        );

        if (typeof this['command_' + command] === 'function') {
            this['command_' + command](args, err => {
                if (err) {
                    this.logger.info(
                        {
                            err,
                            tnx: 'command',
                            command,
                            cid: this.id,
                            host: this.remoteAddress
                        },
                        'Error running %s. %s',
                        command,
                        err.message
                    );
                    this.send('-ERR ' + err.message);
                    this.close();
                } else {
                    this.processQueue();
                }
            });
        } else {
            this.send('-ERR bad command');
            this.close();
        }
    }

    // https://tools.ietf.org/html/rfc2449#section-5
    command_CAPA(args, next) {
        let version = this._server.options.id.version;
        let extensions = [
            'TOP',
            'UIDL',
            !this.session.user ? 'USER' : false,
            'RESP-CODES',
            // https://tools.ietf.org/html/rfc5034#section-6
            !this.session.user ? 'SASL PLAIN' : false,
            // https://tools.ietf.org/html/rfc2449#section-6.6
            'PIPELINING',
            this._server.options.disableVersionString ? false : 'IMPLEMENTATION Forensicat-v' + version
        ].filter(row => row);

        this.send(['+OK Capability list follows'].concat(extensions));

        next();
    }

    command_USER(args, next) {
        if (this.session.state !== 'AUTHORIZATION') {
            this.send('-ERR Command not accepted');
            return next();
        }

        if (!args) {
            this.send('-ERR USER who?');
            return next();
        }

        this.session.user = args;
        this.send('+OK send PASS');
        return next();
    }

    command_PASS(args, next) {
        if (this.session.state !== 'AUTHORIZATION') {
            this.send('-ERR Command not accepted');
            return next();
        }

        if (!this.session.user || !args) {
            return next(new Error('malformed command'));
        }

        let username = this.session.user;
        let password = args;
        this.session.user = false;

        this._server.onAuth(
            {
                method: 'USER',
                username,
                password
            },
            this.session,
            (err, response) => {
                if (err) {
                    this.logger.info(
                        {
                            err,
                            tnx: 'autherror',
                            cid: this.id,
                            method: 'USER',
                            user: username
                        },
                        'Authentication error for %s using %s. %s',
                        username,
                        'USER',
                        err.message
                    );
                    if (err.response === 'NO') {
                        this.send('-ERR [AUTH] ' + err.message);
                        return next();
                    }
                    return next(err);
                }

                if (!response || !response.user) {
                    this.logger.info(
                        {
                            tnx: 'authfail',
                            cid: this.id,
                            method: 'USER',
                            user: username
                        },
                        'Authentication failed for %s using %s',
                        username,
                        'USER'
                    );
                    this.send('-ERR [AUTH] ' + ((response && response.message) || 'Username and password not accepted'));
                    return next();
                }

                this.logger.info(
                    {
                        tnx: 'auth',
                        cid: this.id,
                        method: 'USER',
                        user: username
                    },
                    '%s authenticated using %s',
                    username,
                    'USER'
                );
                this.session.user = response.user;

                this.openMailbox(err => {
                    if (err) {
                        return next(err);
                    }
                    next();
                });
            }
        );
    }

    command_AUTH(args, next) {
        if (this.session.state !== 'AUTHORIZATION') {
            this.send('-ERR Command not accepted');
            return next();
        }

        if (!args) {
            this.send(['+OK', 'PLAIN']);
            return next();
        }

        let params = args.split(/\s+/);
        let mechanism = params.shift().toUpperCase();

        if (mechanism !== 'PLAIN') {
            this.send('-ERR unsupported SASL mechanism');
            return next();
        }

        if (!params.length) {
            this.send('+');
            this._nextHandler = (args, next) => this.authPlain(args, next);
            return next();
        }

        let plain = params.shift();

        if (params.length) {
            this.send('-ERR malformed command');
            return next();
        }

        this.authPlain(plain, next);
    }

    // https://tools.ietf.org/html/rfc1939#page-9
    command_NOOP(args, next) {
        if (this.session.state !== 'TRANSACTION') {
            this.send('-ERR Command not accepted');
        } else {
            this.send('+OK');
        }
        return next();
    }

    // https://tools.ietf.org/html/rfc1939#section-6
    command_QUIT() {
        let finish = () => {
            this.session = false;
            this.send('+OK Bye');
            this.close();
        };

        if (this.session.state !== 'TRANSACTION') {
            return finish();
        }
        this.session.state = 'UPDATE';

        let deleted = this.session.listing.messages.filter(message => message.popped);

        if (!deleted.length) {
            return finish();
        }

        this._server.onUpdate(
            {
                deleted
            },
            this.session,
            (err, stored) => {
                if (err) {
                    // ignore
                    return finish();
                }
                if (stored && stored.deleted) {
                    this.logger.info(
                        {
                            tnx: 'delete',
                            cid: this.id,
                            user: this.session.user
                        },
                        'Deleted %s messages',
                        stored.deleted
                    );
                }

                finish();
            }
        );
    }

    // https://tools.ietf.org/html/rfc1939#page-6
    command_STAT(args, next) {
        if (this.session.state !== 'TRANSACTION') {
            this.send('-ERR Command not accepted');
        } else {
            this.send('+OK ' + this.session.listing.count + ' ' + this.session.listing.size);
        }

        return next();
    }

    // https://tools.ietf.org/html/rfc1939#page-6
    command_LIST(args, next) {
        if (this.session.state !== 'TRANSACTION') {
            this.send('-ERR Command not accepted');
            return next();
        }

        let index = false;
        if (args) {
            index = Number(args);
        }

        if (args && (isNaN(index) || index <= 0)) {
            return next(new Error('malformed command'));
        }

        if (args && index > this.session.listing.messages.length) {
            this.send('-ERR no such message, only ' + this.session.listing.messages.length + ' messages in maildrop');
            return next();
        }

        if (index) {
            this.send('+OK ' + index + ' ' + this.session.listing.messages[index - 1].size);
        } else {
            this.send(
                ['+OK ' + this.session.listing.count + ' ' + this.session.listing.size].concat(
                    this.session.listing.messages.filter(message => !message.popped).map((message, i) => i + 1 + ' ' + message.size)
                )
            );
        }

        return next();
    }

    // https://tools.ietf.org/html/rfc1939#page-12
    command_UIDL(args, next) {
        if (this.session.state !== 'TRANSACTION') {
            this.send('-ERR Command not accepted');
            return next();
        }

        let index = false;
        if (args) {
            index = Number(args);
        }

        if (args && (isNaN(index) || index <= 0)) {
            return next(new Error('malformed command'));
        }

        if (args && index > this.session.listing.messages.length) {
            this.send('-ERR no such message, only ' + this.session.listing.messages.length + ' messages in maildrop');
            return next();
        }

        if (index) {
            this.send('+OK ' + index + ' ' + this.session.listing.messages[index - 1].id);
        } else {
            this.send(['+OK'].concat(this.session.listing.messages.filter(message => !message.popped).map((message, i) => i + 1 + ' ' + message.id)));
        }

        return next();
    }

    // https://tools.ietf.org/html/rfc1939#page-8
    command_DELE(args, next) {
        if (this.session.state !== 'TRANSACTION') {
            this.send('-ERR Command not accepted');
            return next();
        }

        let index = false;
        if (args) {
            index = Number(args);
        }

        if (!args || isNaN(index) || index <= 0) {
            return next(new Error('malformed command'));
        }

        if (args && index > this.session.listing.messages.length) {
            this.send('-ERR no such message, only ' + this.session.listing.messages.length + ' messages in maildrop');
            return next();
        }

        let message = this.session.listing.messages[index - 1];

        if (message.popped) {
            this.send('-ERR message ' + index + ' already deleted');
            return next();
        }

        message.popped = true;
        this.session.listing.count--;
        this.session.listing.size -= message.size;

        this.send('+OK message ' + index + ' deleted');
        return next();
    }

    // https://tools.ietf.org/html/rfc1939#page-9
    command_RSET(args, next) {
        if (this.session.state !== 'TRANSACTION') {
            this.send('-ERR Command not accepted');
            return next();
        }

        let count = 0;
        let size = 0;
        this.session.listing.messages.forEach(message => {
            if (message.popped) {
                message.popped = false;
                count++;
                size += message.size;
            }
        });

        this.session.listing.count += count;
        this.session.listing.size += size;

        this.send(
            '+OK maildrop has ' +
                this.session.listing.count +
                ' message' +
                (this.session.listing.count !== 1 ? 's' : '') +
                ' (' +
                this.session.listing.size +
                ' octets)'
        );

        return next();
    }

    // https://tools.ietf.org/html/rfc1939#page-8
    command_RETR(args, next) {
        if (this.session.state !== 'TRANSACTION') {
            this.send('-ERR Command not accepted');
            return next();
        }

        let index = false;
        if (args) {
            index = Number(args);
        }

        if (!args || isNaN(index) || index <= 0) {
            return next(new Error('malformed command'));
        }

        if (args && index > this.session.listing.messages.length) {
            this.send('-ERR no such message, only ' + this.session.listing.messages.length + ' messages in maildrop');
            return next();
        }

        let message = this.session.listing.messages[index - 1];

        if (message.popped) {
            this.send('-ERR message ' + index + ' already deleted');
            return next();
        }

        this._server.onFetchMessage(message, this.session, (err, stream) => {
            if (err) {
                return next(err);
            }

            if (!stream) {
                return next(new Error('Can not find message'));
            }

            stream.once('error', err => next(err));
            stream.once('end', () => {
                // this.send('.'); // final dot is sent by DataStream
                message.fetched = true;
                return next();
            });

            this.send('+OK ' + message.size + ' octets');
            stream.pipe(new DataStream()).pipe(this._socket, {
                end: false
            });
        });
    }

    // https://tools.ietf.org/html/rfc1939#page-11
    command_TOP(args, next) {
        if (this.session.state !== 'TRANSACTION') {
            this.send('-ERR Command not accepted');
            return next();
        }

        let parts = args.split(' ');
        let index = Number(parts[0]);
        let lines = Number(parts[1]);

        if (!args || parts.length !== 2 || isNaN(index) || index <= 0 || isNaN(lines) || lines < 0) {
            return next(new Error('malformed command'));
        }

        if (args && index > this.session.listing.messages.length) {
            this.send('-ERR no such message, only ' + this.session.listing.messages.length + ' messages in maildrop');
            return next();
        }

        let message = this.session.listing.messages[index - 1];

        if (message.popped) {
            this.send('-ERR message ' + index + ' already deleted');
            return next();
        }

        this._server.onFetchMessage(message, this.session, (err, stream) => {
            if (err) {
                return next(err);
            }

            if (!stream) {
                return next(new Error('Can not find message'));
            }

            let data = '';
            let headers = false;
            let finished = false;
            let linesSent = 0;
            stream.on('readable', () => {
                let chunk;
                while ((chunk = stream.read()) !== null) {
                    if (!finished) {
                        data += chunk.toString('binary');
                        if (!headers) {
                            let match;
                            if ((match = data.match(/\r?\n\r?\n/))) {
                                headers = data.substr(0, match.index + match[0].length);
                                if (data.length > headers.length) {
                                    data = data.substr(headers.length);
                                } else {
                                    data = '';
                                }
                                this.write(Buffer.from(headers.replace(/^\./gm, '..'), 'binary'));
                            }
                        }
                        if (headers) {
                            if (linesSent >= lines) {
                                finished = true;
                                if (typeof stream.abort === 'function') {
                                    stream.abort();
                                }
                                continue;
                            }
                            let match;
                            while (!finished && (match = data.match(/\r?\n/))) {
                                let line = data.substr(0, match.index + match[0].length);
                                linesSent++;
                                if (data.length > line.length) {
                                    data = data.substr(line.length);
                                } else {
                                    data = '';
                                }
                                this.write(Buffer.from(line.replace(/^\./gm, '..'), 'binary'));
                                if (linesSent >= lines) {
                                    finished = true;
                                    if (typeof stream.abort === 'function') {
                                        stream.abort();
                                    }
                                }
                            }
                        }
                    }
                }
            });

            stream.once('error', err => next(err));
            stream.once('end', () => {
                this.send('.');
                return next();
            });

            this.send('+OK message follows');
        });
    }

    authPlain(plain, next) {
        if (!/^[a-zA-Z0-9+/]+=+?$/.test(plain)) {
            this.send('-ERR malformed command');
            return next();
        }

        let credentials = Buffer.from(plain, 'base64')
            .toString()
            .split('\x00');
        if (credentials.length !== 3) {
            this.send('-ERR malformed command');
            return next();
        }

        let username = credentials[1] || credentials[0] || '';
        let password = credentials[2] || '';

        this._server.onAuth(
            {
                method: 'PLAIN',
                username,
                password
            },
            this.session,
            (err, response) => {
                if (err) {
                    this.logger.info(
                        {
                            err,
                            tnx: 'autherror',
                            cid: this.id,
                            method: 'PLAIN',
                            user: username
                        },
                        'Authentication error for %s using %s. %s',
                        username,
                        'PLAIN',
                        err.message
                    );

                    if (err.response === 'NO') {
                        this.send('-ERR [AUTH] ' + err.message);
                        return next();
                    }

                    return next(err);
                }

                if (!response || !response.user) {
                    this.logger.info(
                        {
                            tnx: 'authfail',
                            cid: this.id,
                            method: 'PLAIN',
                            user: username
                        },
                        'Authentication failed for %s using %s',
                        username,
                        'PLAIN'
                    );
                    this.send('-ERR [AUTH] ' + ((response && response.message) || 'Username and password not accepted'));
                    return next();
                }

                this.logger.info(
                    {
                        tnx: 'auth',
                        cid: this.id,
                        method: 'PLAIN',
                        user: response.user
                    },
                    '%s authenticated using %s',
                    username,
                    'PLAIN'
                );
                this.session.user = response.user;

                this.openMailbox(err => {
                    if (err) {
                        return next(err);
                    }
                    next();
                });
            }
        );
    }

    openMailbox(next) {
        this._server.onListMessages(this.session, (err, listing) => {
            if (err) {
                this.logger.info(
                    {
                        err,
                        tnx: 'listerr',
                        cid: this.id,
                        user: this.session.user
                    },
                    'Failed listing messages for %s. %s',
                    this.session.user.id,
                    err.message
                );
                return next(err);
            }

            this.session.listing = listing;

            this.session.state = 'TRANSACTION';
            this.send('+OK maildrop has ' + listing.count + ' message' + (listing.count !== 1 ? 's' : '') + ' (' + listing.size + ' octets)');

            return next();
        });
    }
}

module.exports = POP3Connection;
