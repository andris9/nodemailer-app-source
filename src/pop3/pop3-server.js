'use strict';

const EventEmitter = require('events');
const net = require('net');
const crypto = require('crypto');
const shared = require('nodemailer/lib/shared');
const POP3Connection = require('./connection');
const punycode = require('punycode');
const packageData = require('../../package.json');

const CLOSE_TIMEOUT = 1 * 1000; // how much to wait until pending connections are terminated

class POP3Server extends EventEmitter {
    constructor(options) {
        super();

        this.options = options || {};
        this.options.id = this.options.id || {};
        this.options.id.name = this.options.id.name || packageData.name;
        this.options.id.version = this.options.id.version || packageData.version;

        // apply shorthand handlers
        ['onAuth', 'onListMessages', 'onFetchMessage', 'onUpdate'].forEach(handler => {
            if (typeof this.options[handler] === 'function') {
                this[handler] = this.options[handler];
            }
        });

        /**
         * Timeout after close has been called until pending connections are forcibly closed
         */
        this._closeTimeout = false;

        /**
         * A set of all currently open connections
         */
        this.connections = new Set();

        this.logger = shared.getLogger(this.options, {
            component: this.options.component || 'pop3-server'
        });

        this.server = net.createServer(this.options, socket => {
            let socketOptions = {
                id: crypto.randomBytes(10).toString('hex')
            };
            this.connect(socket, socketOptions);
        });

        this._setListeners();
    }

    _normalizeHostname(hostname) {
        return punycode.toUnicode((hostname || '').toString().trim()).toLowerCase();
    }

    _setListeners() {
        this.server.on('listening', () => this._onListening());
        this.server.on('close', () => this._onClose());
        this.server.on('error', err => this._onError(err));
    }

    /**
     * Called when server started listening
     *
     * @event
     */
    _onListening() {
        let address = this.server.address();
        this.logger.info(
            //
            {
                tnx: 'listen',
                host: address.address,
                port: address.port,
                protocol: 'POP3'
            },
            '%s Server listening on %s:%s',
            'POP3',
            address.family === 'IPv4' ? address.address : '[' + address.address + ']',
            address.port
        );
    }

    /**
     * Called when server is closed
     *
     * @event
     */
    _onClose() {
        this.logger.info(
            {
                tnx: 'closed'
            },
            'POP3 Server closed'
        );
        this.emit('close');
    }

    /**
     * Called when an error occurs with the server
     *
     * @event
     */
    _onError(err) {
        this.emit('error', err);
    }

    connect(socket, socketOptions) {
        let connection = new POP3Connection(this, socket, socketOptions);
        this.connections.add(connection);
        connection.once('error', err => {
            this.connections.delete(connection);
            this._onError(err);
        });
        connection.once('close', () => {
            this.connections.delete(connection);
        });
        connection.init();
    }

    close(callback) {
        let connections = this.connections.size;
        let timeout = this.options.closeTimeout || CLOSE_TIMEOUT;

        // stop accepting new connections
        this.server.close(() => {
            clearTimeout(this._closeTimeout);
            if (typeof callback === 'function') {
                return callback();
            }
        });

        // close active connections
        if (connections) {
            this.logger.info(
                {
                    tnx: 'close'
                },
                'Server closing with %s pending connection%s, waiting %s seconds before terminating',
                connections,
                connections !== 1 ? 's' : '',
                timeout / 1000
            );
        }

        this._closeTimeout = setTimeout(() => {
            connections = this.connections.size;
            if (connections) {
                this.logger.info(
                    {
                        tnx: 'close'
                    },
                    'Closing %s pending connection%s to close the server',
                    connections,
                    connections !== 1 ? 's' : ''
                );

                this.connections.forEach(connection => {
                    connection.close();
                });
            }
        }, timeout);
    }

    /**
     * Authentication handler. Override this
     *
     * @param {Object} auth Authentication options
     * @param {Object} session Session object
     * @param {Function} callback Callback to run once the user is authenticated
     */
    onAuth(auth, session, callback) {
        return callback(null, {
            message: 'Authentication not implemented'
        });
    }

    // called when a message body needs to be fetched
    onFetchMessage(message, session, callback) {
        // should return a stream object
        return callback(null, false);
    }

    // called when session is finished and messages need to be updated/deleted
    onUpdate(update, session, callback) {
        return callback(null, false);
    }

    /**
     * Message listing handler. Override this
     *
     * @param {Object} session Session object
     * @param {Function} callback Callback to run with message listing
     */
    onListMessages(session, callback) {
        // messages are objects {id: 'abc', size: 123}
        return callback(null, {
            messages: [],
            count: 0,
            size: 0
        });
    }

    listen(...args) {
        this.server.listen(...args);
    }
}

module.exports.POP3Server = POP3Server;
