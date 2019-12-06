'use strict';

const humanize = require('humanize');
const packageData = require('../meta.json');
const BrowserBox = require('browserbox2');
const nodemailer = require('nodemailer');
const util = require('util');

async function uploadSmtp(opts) {
    let { curWin, analyzer, params, targetSettings, emailData } = opts;

    let log = message => {
        try {
            curWin.webContents.send(
                'log',
                JSON.stringify({
                    id: 'log',
                    proto: params.proto,
                    message,
                    time: new Date()
                })
            );
        } catch (err) {
            console.error(err);
        }
    };

    let transporter = nodemailer.createTransport({
        host: targetSettings.hostname,
        port: targetSettings.port,
        secure: targetSettings.security === 'tls', // true for 465, false for other ports
        auth: targetSettings.user
            ? {
                  user: targetSettings.user,
                  pass: targetSettings.pass || ''
              }
            : false,
        debug: true,
        logger: {
            info: (...args) => {
                args.shift();
                log(util.format(...args));
            },
            debug: (...args) => {
                args.shift();
                log(util.format(...args));
            },
            error: (...args) => {
                args.shift();
                log(util.format(...args));
            }
        },
        tls: {
            rejectUnauthorized: false
        }
    });

    let raw = await analyzer.getMessageStream(emailData.id);
    if (!raw) {
        log('Failed to read message file from disk');
        return false;
    }

    try {
        let info = await transporter.sendMail({
            envelope: {
                from: params.mailFrom,
                to: params.rcptTo
            },
            raw
        });
        if (info && info.accepted) {
            log(`Message delivered for ${info.accepted.length} recipients`);
        }
        return true;
    } catch (err) {
        log(`Upload failed (${err.message})`);
        return false;
    }
}

async function uploadImap(opts) {
    let { curWin, analyzer, params, targetSettings } = opts;

    let log = message => {
        try {
            curWin.webContents.send(
                'log',
                JSON.stringify({
                    id: 'log',
                    proto: params.proto,
                    message,
                    time: new Date()
                })
            );
        } catch (err) {
            console.error(err);
        }
    };

    let client = new BrowserBox(targetSettings.hostname, targetSettings.port, {
        useSecureTransport: targetSettings.security === 'tls',
        auth: {
            user: targetSettings.user || '',
            pass: targetSettings.pass || ''
        },
        id: {
            name: 'NodemailerApp',
            version: packageData.version
        },
        tls: {
            rejectUnauthorized: false
        },
        logger: {
            info: (...args) => {
                args.shift();
                log(util.format(...args));
            },
            debug: (...args) => {
                args.shift();
                log(util.format(...args));
            },
            error: (...args) => {
                args.shift();
                log(util.format(...args));
            }
        }
    });

    client.onerror = err => {
        log(`IMAP error. ${(err && err.message) || err}`);
        try {
            client.close();
        } catch (err) {
            // ignore
        }
    };

    client.onauth = function() {
        analyzer
            .getMessageBuffer(params.id)
            .then(raw => {
                if (!raw) {
                    log(`Failed to read message file from disk`);
                    return client.close();
                }

                log(`Uploading ${humanize.filesize(raw.length || 0, 1024, 0, '.', ' ')} to "${params.path || 'INBOX'}"`);

                client.upload(params.path || 'INBOX', raw, { flags: params.flags, idate: params.idate }, (err, result) => {
                    if (err) {
                        log(`Upload failed (${(err && err.message) || err})`);
                        return client.close();
                    }

                    if (result) {
                        log(`Message uploaded to server as ${result.uidvalidity}:${result.uid}`);
                    }
                    return client.close();
                });
            })
            .catch(err => {
                log(`Failed to read message file from disk. ${err.message}`);
                client.close();
            });
    };

    client.connect();
}

module.exports = async (curWin, projects, analyzer, params) => {
    let preferences = await projects.getPreferences();
    let targetSettings = preferences[params.proto + 'Json'];

    if (!targetSettings) {
        curWin.webContents.send(
            'log',
            JSON.stringify({
                id: 'log',
                proto: params.proto,
                message: `Server settings not found`,
                time: new Date()
            })
        );
        return false;
    }

    let emailData = await analyzer.getEmail(params.id, true);
    if (!emailData) {
        curWin.webContents.send(
            'log',
            JSON.stringify({
                id: 'log',
                proto: params.proto,
                message: `Email data not found`,
                time: new Date()
            })
        );
        return false;
    }

    curWin.webContents.send(
        'log',
        JSON.stringify({
            id: 'log',
            proto: params.proto,
            message: `Uploading ${emailData.messageId} to ${targetSettings.hostname}:${targetSettings.port} using ${params.proto.toUpperCase()}`,
            time: new Date()
        })
    );

    switch (params.proto) {
        case 'smtp':
            return await uploadSmtp({
                curWin,
                projects,
                analyzer,
                params,
                targetSettings,
                emailData
            });
        case 'imap':
            return await uploadImap({
                curWin,
                projects,
                analyzer,
                params,
                targetSettings,
                emailData
            });
    }

    return false;
};
