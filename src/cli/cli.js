'use strict';

const isemail = require('isemail');
const addressparser = require('nodemailer/lib/addressparser');
const nodemailer = require('nodemailer');
const Newlines = require('../analyzer/lib/newlines');
const HeaderSplitter = require('../analyzer/lib/header-splitter');
const fs = require('fs');
const pathlib = require('path');
const libmime = require('libmime');
const punycode = require('punycode');
const uuidv4 = require('uuid/v4');
const os = require('os');
const PassThrough = require('stream').PassThrough;

const HOSTNAME = (os.hostname() || 'localhost').toString().toLowerCase();
const USERNAME = (os.userInfo().username || 'uid' + (typeof process.getuid === 'function' ? process.getuid() : '-local')).toString().toLowerCase();

const validateEmail = email => {
    try {
        return isemail.validate(email);
    } catch (err) {
        console.error(email, err);
        return false;
    }
};

function parseArgv(argv) {
    let opts = {};
    for (let i = 1; i < argv.length; i++) {
        let arg = argv[i].trim();
        if (arg.charAt(0) !== '-') {
            if (!opts.messageRecipients && validateEmail(arg)) {
                if (!opts.recipients) {
                    opts.recipients = [];
                }
                arg = formatAddress(arg);
                if (!opts.recipients.includes(arg)) {
                    opts.recipients.push(arg);
                }
            }
            continue;
        }
        switch (arg.charAt(1)) {
            case '-':
                {
                    // extended
                    let key = arg.slice(2).trim();
                    let value;
                    if (key.indexOf('=') >= 0) {
                        let parts = key.split('=');
                        key = parts.shift().trim();
                        value = parts.join('=').trim();
                    } else {
                        value = argv[++i] || '';
                    }
                    if (key) {
                        opts[key] = value;
                    }
                }
                break;

            case 'f': {
                let val = arg.slice(2).trim();
                if (val) {
                    let from = addressparser(val).shift();
                    if (from.address) {
                        opts.fromAddress = from.address;
                    }
                    if (from.name && !opts.fromName) {
                        opts.fromName = from.name;
                    }
                }
                break;
            }

            case 'F': {
                let val = arg.slice(2).trim();
                if (val) {
                    opts.fromName = val;
                }
                break;
            }

            case 't':
                opts.messageRecipients = true;
                delete opts.recipients;
                break;

            case 'i':
                opts.ignoreDots = true;
                break;

            case 'B': {
                let value = (argv[++i] || '').toString().toUpperCase();
                if (value) {
                    // 7BIT or 8BITMIME
                    opts.mimeType = value;
                }
                break;
            }
        }
    }
    if (opts.project) {
        opts.project = Number(opts.project.replace(/[^0-9]+/g, '')) || false;
    }
    return opts;
}

function formatAddress(address) {
    address = (address || '')
        .toString()
        .replace(/\s+/g, ' ')
        .trim();

    let atpos = address.lastIndexOf('@');
    let user = address.substr(0, atpos);
    let domain = address.substr(atpos + 1);

    if (/@xn--/.test(domain)) {
        domain = punycode.toUnicode(domain);
    }

    return `${user}@${domain.toLowerCase()}`;
}

function processAddresses(headers) {
    let addresses = [];

    ['from', 'to', 'cc', 'bcc', 'reply-to', 'delivered-to', 'return-path'].forEach(key => {
        let lines = headers ? headers.getDecoded(key) : [];
        let list = addressparser(
            lines
                .map(
                    line =>
                        line.value &&
                        Buffer.from(line.value, 'binary')
                            .toString()
                            .trim()
                )
                .filter(line => line)
                .join(', '),
            { flatten: true }
        );
        list.forEach(addr => {
            addr.type = key;

            addr.name = (addr.name || '').toString();
            if (addr.name) {
                try {
                    addr.name = libmime.decodeWords(addr.name);
                } catch (E) {
                    //ignore, keep as is
                }
                addr.name = addr.name.replace(/\s+/g, ' ').trim();
            }

            addr.address = formatAddress(addr.address);
            addresses.push(addr);
        });
    });

    return addresses;
}

function processStdin(app, opts) {
    let headerSplitter = new HeaderSplitter();
    let dataPath = pathlib.join(app.getPath('userData'), 'maildrop', 'data');
    let queuePath = pathlib.join(app.getPath('userData'), 'maildrop', 'queue');

    let envelope = {
        mailFrom: opts.fromAddress || `${USERNAME}@${HOSTNAME}`,
        rcptTo: !opts.messageRecipients ? opts.recipients || [] : [],
        date: new Date()
    };

    let fname = Date.now()
        .toString(36)
        .toUpperCase();

    let transport;
    let target;
    if (!opts.host) {
        target = fs.createWriteStream(pathlib.join(dataPath, fname));
    } else {
        target = new PassThrough();
        transport = nodemailer.createTransport({
            host: opts.host,
            port: opts.port,
            secure: opts.tls ? /true|1|yes|tls/i.test(opts.tls) : opts.port === 465, // true for 465, false for other ports
            auth: opts.user
                ? {
                      user: opts.user,
                      pass: opts.pass
                  }
                : false,
            logger: /true|1|yes|tls/i.test(opts.debug),
            debug: /true|1|yes|tls/i.test(opts.debug)
        });
    }

    let parsedAddresses = false;
    headerSplitter.on('headers', data => {
        parsedAddresses = processAddresses(data.headers);

        // format headers
        data.headers.remove('Bcc');

        if (!data.headers.get('Message-ID').length) {
            data.headers.add('Message-ID', `<${uuidv4()}@${HOSTNAME}>`, Infinity);
        }

        if (!data.headers.get('Date').length) {
            data.headers.add('Date', envelope.date.toUTCString().replace(/GMT/, '+0000'), Infinity);
        } else {
            data.headers.add('X-Invoked-Date', envelope.date.toUTCString().replace(/GMT/, '+0000'), Infinity);
        }
        data.headers.add('X-Invoked-User', USERNAME);

        if (!data.headers.get('From').length) {
            data.headers.add('From', (opts.fromName ? '"' + opts.fromName + '" ' : '') + `<${envelope.mailFrom}>`, Infinity);
        }

        let list = new Set();
        if (opts.messageRecipients) {
            parsedAddresses.forEach(address => {
                if (['to', 'cc', 'bcc'].includes(address.type) && address.address && validateEmail(address.address)) {
                    list.add(address.address);
                }
            });
            envelope.rcptTo = Array.from(list);
        }

        if (opts.host) {
            // set up smtp client
            transport.sendMail(
                {
                    envelope: {
                        from: envelope.mailFrom,
                        to: envelope.rcptTo
                    },
                    raw: target
                },
                (err, info) => {
                    if (err) {
                        console.error(err);
                    } else {
                        console.log((info && info.response) || 'Message processed');
                    }
                }
            );
        }

        data.done();
    });

    if (!opts.host) {
        // saving to message file, add metadata as well
        target.on('close', () => {
            fs.writeFile(pathlib.join(queuePath, fname), Buffer.from(JSON.stringify({ project: opts.project, argv: process.argv.slice(1), envelope })), err => {
                if (err) {
                    console.error(err);
                } else {
                    console.log(`Message queued as ${fname}`);
                }
                app.quit();
            });
        });
    }

    target.on('error', err => {
        console.error(err.stack);
        app.quit();
    });

    process.stdin.on('error', err => {
        console.error(err.stack);
        app.quit();
    });

    process.stdin
        .pipe(headerSplitter)
        .pipe(new Newlines())
        .pipe(target);
}

let cliChecked = 0;
module.exports = app => {
    if (cliChecked) {
        return cliChecked === 1;
    }
    let opts = parseArgv(process.argv);
    if (opts.project || opts.host) {
        cliChecked = 1;
        setImmediate(() => {
            processStdin(app, opts);
        });
        return true;
    } else {
        cliChecked = -1;
    }
    return false;
};
