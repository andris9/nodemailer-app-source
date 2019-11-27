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

function showHelp() {
    console.log('NodemailerApp sendmail replacement. https://nodemailer.com/app');
    console.log('');
    console.log('Usage:');
    console.log(`  ${process.argv[0]} <opts> recipientN@example.com < message.eml`);
    console.log('');
    console.log('Where <opts> is a list of command line argument options:');
    console.log('  -t              Extract recipients from message headers. These are added to any recipients specified on the command line.');
    console.log('  -f sender       Set the  envelope sender address. This is the address where delivery problems are sent to.');
    console.log('  -F full_name    Set the sender full name. This is used only with messages that have no From: message header.');
    console.log('  (any other standard sendmail option is silently ignored)');
    console.log('  --help          Show this message.');
    console.log('  --project=N     Project number to target for maildrop, this is the project in NodemailerApp where the messages end up.');
    console.log('  --host=hostname SMTP target hostname, using it switches from maildrop to SMTP relay mode.');
    console.log('  --port=port_nr  SMTP port number.');
    console.log('  --user=username SMTP authentication username.');
    console.log('  --pass=password SMTP authentication password.');
    console.log('                  NB! sendmail_path in php.ini exposes the entire command line, including this password, in the phpinfo() output.');
    console.log('                      So most probably you do not want to use a real online account here but some internal relay that is not');
    console.log('                      accessible outside the firewall.');
    console.log('  --tls=true      If true or yes then use TLS on SMTP connection. Usually set for port 465.');
}

function parseArgv(argv) {
    let opts = {};
    for (let i = 1; i < argv.length; i++) {
        let arg = argv[i].trim();
        if (arg.charAt(0) !== '-') {
            if (validateEmail(arg)) {
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
                let from;
                if (val) {
                    from = addressparser(val).shift();
                } else if (argv[i + 1] && argv[i + 1].charAt(0) !== '-') {
                    from = addressparser(argv[++i].trim()).shift();
                }

                if (from) {
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
                } else if (argv[i + 1] && argv[i + 1].charAt(0) !== '-') {
                    opts.fromName = argv[++i].trim();
                }
                break;
            }

            case 't':
                opts.messageRecipients = true;
                break;

            case 'i':
                opts.ignoreDots = true;
                break;

            // keys with an argument
            case 'B':
            case 'h':
            case 'L':
            case 'r':
            case 'R':
            case 'N':
            case 'O':
            case 'C': {
                i++;
                break;
            }

            // keys with 2 arguments
            case 'o': {
                // there are multiple keys that start with 'o', we need just'-o'
                if (arg.slice(1) === 'o') {
                    i += 2;
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
        rcptTo: opts.recipients || [],
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

        let list = new Set(envelope.rcptTo);
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
    if ('help' in opts) {
        return showHelp();
    }
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
