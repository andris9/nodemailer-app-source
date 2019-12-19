'use strict';

const level = require('level');
const util = require('util');
const mkdirp = util.promisify(require('mkdirp'));
const mailsplit = require('mailsplit');
const FlowedDecoder = require('mailsplit/lib/flowed-decoder');
const libmime = require('libmime');
const pathlib = require('path');
const iconv = require('iconv-lite');
const htmlToText = require('html-to-text');
const SQL = require('../../sql/sql');
const uuidv4 = require('uuid/v4');
const tnef = require('node-tnef');
const crypto = require('crypto');
const addressparser = require('nodemailer/lib/addressparser');
const punycode = require('punycode');
const human = require('humanparser');
const isemail = require('isemail');
const fs = require('fs').promises;
const fsCreateWriteStream = require('fs').createWriteStream;

const Splitter = mailsplit.Splitter;
const Joiner = mailsplit.Joiner;
const Streamer = mailsplit.Streamer;
const HeaderSplitter = require('./header-splitter');
const Newlines = require('./newlines');
const MboxStream = require('./mbox-stream');
const PassThrough = require('stream').PassThrough;
const Headers = mailsplit.Headers;

const MAX_HTML_PARSE_LENGTH = 2 * 1024 * 1024; // do not parse HTML messages larger than 2MB to plaintext
const HASH_ALGO = 'sha1';

const PROJECT_VERSION = 2;
const PROJECT_UPDATES = [
    // update to 1
    [
        'ALTER TABLE [emails] ADD [import] INTEGER',
        `CREATE INDEX IF NOT EXISTS [email_import] ON emails (
            [import]
        )`
    ],
    // update to 2
    [
        'ALTER TABLE [emails] ADD [pop3_deleted] INTEGER DEFAULT 0 NOT NULL',
        `CREATE INDEX IF NOT EXISTS [pop3_deleted] ON emails (
            [pop3_deleted]
        )`
    ]
];

const validateEmail = email => {
    try {
        return isemail.validate(email);
    } catch (err) {
        console.error(email, err);
        return false;
    }
};

class Analyzer {
    constructor(options) {
        this.options = options || {};

        this.project = options.project;

        this.level = false;
        this.sql = false;

        this._importCounter = 0;

        this.appDataPath = this.options.appDataPath;
        this.projectName = this.options.projectName || 'Untitled';
        this.folderName = this.options.folderName || this.projectName;

        this.closing = false;
        this.closed = false;

        this.prepareQueue = [];
        this.prepared = false;
        this.preparing = false;

        this.dataPath = pathlib.join(this.appDataPath, this.folderName, 'data');
        this.sqlPath = pathlib.join(this.appDataPath, this.folderName, 'data.db');

        this.fid = options.fid || '';

        this.thumbnailGenerator = options.thumbnailGenerator;
    }

    async applyUpdates(version) {
        version = Number(version) || 1;
        if (!PROJECT_UPDATES[version - 1]) {
            return;
        }
        for (let update of PROJECT_UPDATES[version - 1]) {
            if (!update) {
                continue;
            }
            try {
                console.log(`Running update (${version}): "${update}"`);
                await this.sql.run(update);
            } catch (err) {
                console.error(err);
            }
        }
        await this.sql.run(`INSERT INTO appmeta ([key], [value]) VALUES ($key, $value) ON CONFLICT([key]) DO UPDATE SET [value] = $value`, {
            $key: 'version',
            $value: version
        });
    }

    async prepare() {
        if (this.prepared) {
            return false;
        }

        if (this.preparing) {
            let resolver = new Promise((resolve, reject) => {
                this.prepareQueue.push({ resolve, reject });
            });
            return resolver;
        }
        this.preparing = true;

        try {
            await mkdirp(this.dataPath);
            this.sql = new SQL({ db: this.sqlPath });

            await this.sql.run(`PRAGMA journal_mode=WAL`);

            let tableEmailsExistsRow = await this.sql.findOne(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`, ['emails']);
            let isNew = !tableEmailsExistsRow;

            await this.sql.run(`CREATE TABLE IF NOT EXISTS appmeta (
                [key] TEXT PRIMARY KEY,
                [value] TEXT
            );`);

            await this.sql.run(`CREATE TABLE IF NOT EXISTS emails (
                [id] INTEGER PRIMARY KEY,
                [import] INTEGER,

                [idate] DATETIME,
                [hdate] DATETIME,
                [source] TEXT,
                [return_path] TEXT,
                [message_id] TEXT,
                [flags] TEXT,
                [labels] TEXT,
                [from] TEXT,
                [to] TEXT,
                [cc] TEXT,
                [bcc] TEXT,
                [reply_to] TEXT,
                [subject] TEXT,
                [text] TEXT,

                [attachments] INTEGER,
                [size] INTEGER,
                [hash] TEXT,

                [pop3_deleted] INTEGER DEFAULT 0 NOT NULL,

                [key] TEXT
            );`);

            await this.sql.run(`CREATE TABLE IF NOT EXISTS headers (
                [id] INTEGER PRIMARY KEY,
                [email] INTEGER,
                [key] TEXT,
                [value] TEXT,

                FOREIGN KEY ([email])
                    REFERENCES emails ([id]) ON DELETE CASCADE
            );`);

            await this.sql.run(`CREATE TABLE IF NOT EXISTS graph (
                [id] INTEGER PRIMARY KEY,
                [email] INTEGER,

                [type] TEXT,
                [message_id] TEXT,

                FOREIGN KEY ([email])
                    REFERENCES emails ([id]) ON DELETE CASCADE
            );`);

            await this.sql.run(`CREATE TABLE IF NOT EXISTS addresses (
                [id] INTEGER PRIMARY KEY,
                [email] INTEGER,

                [type] TEXT,
                [name] TEXT,
                [address] TEXT,

                [first_name] TEXT,
                [last_name] TEXT,
                [middle_name] TEXT,

                [contact] INTEGER,

                FOREIGN KEY ([email])
                    REFERENCES emails ([id]) ON DELETE CASCADE
            );`);

            await this.sql.run(`CREATE TABLE IF NOT EXISTS contacts (
                [id] INTEGER PRIMARY KEY,

                [name] TEXT,
                [address] TEXT,
                [normalized_address] TEXT UNIQUE,

                [first_name] TEXT,
                [last_name] TEXT,
                [middle_name] TEXT
            );`);

            await this.sql.run(`CREATE TABLE IF NOT EXISTS attachments (
                [id] INTEGER PRIMARY KEY,
                [email] INTEGER,

                [content_type] TEXT,
                [disposition] TEXT,
                [content_id] TEXT,
                [filename] TEXT,
                [real_filename] TEXT,
                [size] INTEGER,
                [hash] TEXT,
                
                [thumb_key] TEXT,
                [key] TEXT,

                FOREIGN KEY ([email])
                    REFERENCES emails ([id]) ON DELETE CASCADE
            );`);

            await this.sql.run(`CREATE TABLE IF NOT EXISTS tags (
                [id] INTEGER PRIMARY KEY,
                [email] INTEGER,
                [tag] TEXT,
                [display] TEXT,

                FOREIGN KEY ([email])
                    REFERENCES emails ([id]) ON DELETE CASCADE
            );`);

            await this.sql.run(`CREATE TABLE IF NOT EXISTS project_tags (
                [id] INTEGER PRIMARY KEY,
                [tag] TEXT UNIQUE,
                [display] TEXT
            );`);

            try {
                // may fail on non-updated dbs
                await this.sql.run(`CREATE INDEX IF NOT EXISTS [email_import] ON emails (
                    [import]
                )`);
            } catch (err) {
                // ignore
            }

            await this.sql.run(`CREATE INDEX IF NOT EXISTS [email_tag] ON tags (
                [email],
                [tag]
            )`);

            await this.sql.run(`CREATE INDEX IF NOT EXISTS [tag_name] ON tags (
                [tag]
            )`);

            await this.sql.run(`CREATE INDEX IF NOT EXISTS [hdate] ON emails (
                [hdate]
            )`);

            await this.sql.run(`CREATE INDEX IF NOT EXISTS [idate] ON emails (
                [idate]
            )`);

            await this.sql.run(`CREATE INDEX IF NOT EXISTS [subject] ON emails (
                [subject]
            )`);

            await this.sql.run(`CREATE INDEX IF NOT EXISTS [attachment] ON emails (
                [attachments]
            )`);

            await this.sql.run(`CREATE INDEX IF NOT EXISTS [email_message_od] ON emails (
                [message_id]
            )`);

            try {
                // may fail on non-updated dbs
                await this.sql.run(`CREATE INDEX IF NOT EXISTS [pop3_deleted] ON emails (
                [pop3_deleted]
            )`);
            } catch (err) {
                // ignore
            }

            await this.sql.run(`CREATE INDEX IF NOT EXISTS [email] ON headers (
                [email]
            )`);

            await this.sql.run(`CREATE INDEX IF NOT EXISTS [header] ON headers (
                [key],
                [value]
            )`);

            await this.sql.run(`CREATE INDEX IF NOT EXISTS [email] ON addresses (
                [email]
            )`);

            await this.sql.run(`CREATE INDEX IF NOT EXISTS [contact] ON addresses (
                [contact]
            )`);

            await this.sql.run(`CREATE INDEX IF NOT EXISTS [type] ON addresses (
                [type]
            )`);

            await this.sql.run(`CREATE INDEX IF NOT EXISTS [addr_name] ON addresses (
                [name]
            )`);

            await this.sql.run(`CREATE INDEX IF NOT EXISTS [addr_address] ON addresses (
                [address]
            )`);

            await this.sql.run(`CREATE INDEX IF NOT EXISTS [name] ON contacts (
                [name]
            )`);

            await this.sql.run(`CREATE INDEX IF NOT EXISTS [last_name] ON contacts (
                [last_name]
            )`);

            await this.sql.run(`CREATE INDEX IF NOT EXISTS [first_name] ON contacts (
                [first_name]
            )`);

            await this.sql.run(`CREATE INDEX IF NOT EXISTS [email] ON graph (
                [email]
            )`);

            await this.sql.run(`CREATE INDEX IF NOT EXISTS [message_id] ON graph (
                [message_id],
                [type]
            )`);

            await this.sql.run(`CREATE INDEX IF NOT EXISTS [email] ON attachments (
                [email]
            )`);

            await this.sql.run(`CREATE INDEX IF NOT EXISTS [hash] ON attachments (
                [hash]
            )`);

            await this.sql.run(`CREATE INDEX IF NOT EXISTS [content_id] ON attachments (
                [content_id]
            )`);

            await this.sql.run(`CREATE INDEX IF NOT EXISTS [size] ON attachments (
                [size]
            )`);

            await this.sql.run(`CREATE INDEX IF NOT EXISTS [real_filename] ON attachments (
                [real_filename]
            )`);

            await this.sql.run(`CREATE VIRTUAL TABLE IF NOT EXISTS emails_fts USING fts5([subject], [text], content='emails')`);

            await this.sql.run(`CREATE TRIGGER IF NOT EXISTS emails_ai AFTER INSERT ON emails BEGIN
                INSERT INTO emails_fts([rowid], [subject], [text]) VALUES (new.rowid, new.subject, new.text);
            END`);

            await this.sql.run(`CREATE TRIGGER IF NOT EXISTS emails_ad AFTER DELETE ON emails BEGIN
                INSERT INTO emails_fts([emails_fts], [rowid], [subject], [text]) VALUES('delete', old.rowid, old.subject, old.text);
            END`);

            await this.sql.run(`CREATE TRIGGER IF NOT EXISTS emails_au AFTER UPDATE ON emails BEGIN
                INSERT INTO emails_fts([emails_fts], [rowid], [subject], [text]) VALUES('delete', old.rowid, old.subject, old.text);
                INSERT INTO emails_fts([rowid], [subject], [text]) VALUES (new.rowid, new.subject, new.text);
            END;`);

            if (isNew) {
                // make sure we have correct version number setting set
                try {
                    await this.sql.run(`INSERT INTO appmeta ([key], [value]) VALUES ($key, $value)`, {
                        $key: 'version',
                        $value: PROJECT_VERSION
                    });
                } catch (err) {
                    // ignore
                }
            } else {
                // handle migrations if needed
                let row = await this.sql.findOne('SELECT [value] FROM [appmeta] WHERE [key] = ?', ['version']);
                let storedVersion = Number(row && row.value) || 0;

                for (let i = storedVersion + 1; i <= PROJECT_VERSION; i++) {
                    await this.applyUpdates(i);
                }
            }

            await this.sql.run(`PRAGMA foreign_keys=ON`);
            await this.sql.run(`PRAGMA case_sensitive_like=OFF`);

            return await new Promise((resolve, reject) => {
                this.level = level(this.dataPath, {
                    writeBufferSize: 60 * 1024 * 1024,
                    maxFileSize: 24 * 1024 * 1024
                });
                this.level.on('open', resolve);
                this.level.once('error', reject);
            });
        } catch (err) {
            this.preparing = false;
            this.prepared = true;

            while (this.prepareQueue.length) {
                let promise = this.prepareQueue.shift();
                promise.reject(err);
            }

            throw err;
        } finally {
            this.preparing = false;
            this.prepared = true;
            while (this.prepareQueue.length) {
                let promise = this.prepareQueue.shift();
                promise.resolve();
            }
        }
    }

    async readBuffer(key) {
        return new Promise((resolve, reject) => {
            let stream = this.level.createValueStream({
                gt: key + ':',
                lt: key + ':~',
                valueEncoding: 'binary'
            });

            let chunks = [];
            let chunklen = 0;

            stream.on('readable', () => {
                let chunk;
                while ((chunk = stream.read()) !== null) {
                    if (typeof chunk === 'string') {
                        chunk = Buffer.from(chunk);
                    }
                    chunks.push(chunk);
                    chunklen += chunk.length;
                }
            });
            stream.once('end', () => {
                resolve(Buffer.concat(chunks, chunklen));
            });
            stream.once('error', reject);
        });
    }

    readStream(key) {
        return this.level.createValueStream({
            gt: key + ':',
            lt: key + ':~',
            valueEncoding: 'binary'
        });
    }

    async writeStream(key, stream) {
        let partNr = 0;
        let size = 0;
        let hash = crypto.createHash(HASH_ALGO);
        return await new Promise((resolve, reject) => {
            let reading = false;
            let finished = false;

            let finish = () => {
                resolve({ key, size, hash: hash.digest('hex') });
            };

            let formatNr = nr => {
                nr = nr.toString(16);
                nr = '0'.repeat(8 - nr.length) + nr;
                return nr;
            };

            let processChunk = (chunk, next) => {
                let chunkKey = [key, formatNr(++partNr)].join(':');
                hash.update(chunk);
                this.level.put(
                    chunkKey,
                    chunk,
                    {
                        valueEncoding: 'binary'
                    },
                    err => {
                        if (err) {
                            return reject(err);
                        }
                        size += chunk.length;
                        next();
                    }
                );
            };

            let read = () => {
                reading = true;
                let readNext = () => {
                    let chunk = stream.read();
                    if (chunk === null) {
                        reading = false;
                        if (finished) {
                            return finish();
                        }
                        return;
                    }
                    processChunk(chunk, readNext);
                };
                readNext();
            };

            stream.on('readable', () => {
                if (finished) {
                    return;
                }
                if (!reading) {
                    read();
                }
            });

            stream.on('end', () => {
                if (finished) {
                    return;
                }
                finished = true;
                if (!reading) {
                    return finish();
                }
            });

            stream.on('error', err => {
                if (finished) {
                    return;
                }
                finished = true;
                reject(err);
            });
        });
    }

    async import(metadata, sourceStream, skipTransaction) {
        await this.prepare();

        let key = 'email:' + uuidv4();

        let headers;
        let textParts = [];
        let attachments = [];

        if (typeof sourceStream === 'string') {
            sourceStream = Buffer.from(sourceStream);
        }

        if (Buffer.isBuffer(sourceStream)) {
            // check hash for duplicates
            let hash = crypto
                .createHash(HASH_ALGO)
                .update(sourceStream)
                .digest('hex');

            let row = await this.sql.findOne('SELECT id FROM emails WHERE hash=? LIMIT 1', [hash]);
            if (row && row.id) {
                // message alrwayd exists
                return { duplicate: true };
            }
        }

        let eml = await new Promise((resolve, reject) => {
            let streamer = new Streamer(() => true);
            let filenames = new Set();
            streamer.on('node', data => {
                if (data.node.root) {
                    headers = data.node.headers;
                }

                if (data.node.multipart) {
                    return data.done();
                }

                let isTextNode = ['text/html', 'text/plain'].includes(data.node.contentType) || (data.node.root && !data.node.contentType);
                if ((!data.node.disposition || data.node.disposition === 'inline') && isTextNode) {
                    // text
                    let decoder = data.decoder;

                    if (data.node.flowed) {
                        let contentDecoder = decoder;
                        let flowDecoder = new FlowedDecoder({
                            delSp: data.node.delSp
                        });
                        contentDecoder.on('error', err => {
                            flowDecoder.emit('error', err);
                        });
                        contentDecoder.pipe(flowDecoder);
                        decoder = flowDecoder;
                    }

                    if (data.node.charset && !['ascii', 'usascii', 'utf8'].includes(data.node.charset.toLowerCase().replace(/[^a-z0-9]+/g, ''))) {
                        try {
                            let contentStream = decoder;
                            decoder = iconv.decodeStream(data.node.charset);
                            contentStream.on('error', err => {
                                decoder.emit('error', err);
                            });
                            contentStream.pipe(decoder);
                        } catch (E) {
                            // do not decode charset
                        }
                    }

                    let chunks = [];
                    let chunklen = 0;
                    decoder.on('readable', () => {
                        let chunk;
                        while ((chunk = decoder.read()) !== null) {
                            if (typeof chunk === 'string') {
                                chunk = Buffer.from(chunk);
                            }
                            chunks.push(chunk);
                            chunklen += chunk.length;
                        }
                    });
                    decoder.once('error', err => reject(err));
                    decoder.once('end', () => {
                        let textContent = {
                            contentType: data.node.contentType || 'text/plain',
                            charset: data.node.charset,
                            text: Buffer.concat(chunks, chunklen)
                                .toString()
                                // newlines
                                .replace(/\r?\n/g, '\n')
                                // trailing whitespace
                                .replace(/\s+$/, ''),
                            key: `${key}:text:${textParts.length + 1}`
                        };

                        textParts.push(textContent);
                        return data.done();
                    });

                    return;
                } else {
                    // attachment

                    let getContentType = (contentType, realFilename) => {
                        contentType = (contentType || '')
                            .toString()
                            .trim()
                            .toLowerCase();
                        if (contentType) {
                            return contentType;
                        }

                        contentType = libmime.detectMimeType(realFilename);
                        return contentType;
                    };

                    let getFilename = (contentType, realFilename) => {
                        let extension = libmime.detectExtension(contentType || 'application/octet-stream');
                        let filename = pathlib.parse(realFilename || (contentType || 'attachment').split('/').shift() + '.' + extension);

                        let base = (filename.name || 'attachment')
                            .replace(/[/\\\x00-\x1F]/g, '_') // eslint-disable-line no-control-regex
                            .replace(/\.+/g, '.');

                        let fname;
                        let i = 0;

                        // eslint-disable-next-line no-constant-condition
                        while (1) {
                            fname = base + (i ? '-' + i : '') + filename.ext;
                            i++;
                            if (filenames.has(fname)) {
                                continue;
                            }
                            filenames.add(fname);
                            break;
                        }

                        return fname;
                    };

                    let contentType = getContentType(data.node.contentType, data.node.filename);
                    let fname = getFilename(contentType, data.node.filename);

                    let attachmentData = {
                        filename: fname,
                        realFilename: data.node.filename || null,
                        contentType,
                        disposition: data.node.disposition,
                        contentId: data.node.headers.getFirst('content-id').trim() || null,
                        key: `${key}:attachment:${filenames.size}:file`
                    };
                    attachments.push(attachmentData);

                    let setThumb = async attachmentData => {
                        let buf = await this.readBuffer(attachmentData.key);
                        const thumbnail = await this.generateThumbnail(contentType, buf);
                        if (!thumbnail) {
                            return;
                        }
                        let thumbKey = attachmentData.key.replace(/:file$/, ':thumb');
                        await this.level.put(thumbKey, thumbnail, {
                            valueEncoding: 'binary'
                        });
                        attachmentData.thumbKey = thumbKey;
                    };

                    let parseTnef = (key, callback) => {
                        this.readBuffer(key)
                            .then(buf => {
                                return new Promise((resolve, reject) => {
                                    tnef.parseBuffer(buf, (err, content) => {
                                        if (err) {
                                            return reject(err);
                                        }

                                        resolve(content);
                                    });
                                });
                            })
                            .then(content => {
                                if (!content || !content.Attachments || !content.Attachments.length) {
                                    return callback();
                                }

                                let pos = 0;
                                let processNext = () => {
                                    if (pos >= content.Attachments.length) {
                                        return callback();
                                    }
                                    let entry = content.Attachments[pos++];
                                    if (!entry.Data || !entry.Data.length) {
                                        return processNext();
                                    }

                                    let data = Buffer.from(entry.Data);

                                    let contentType = getContentType(false, entry.Title);
                                    let fname = getFilename(contentType, entry.Title);
                                    let tnefAttachmentData = {
                                        filename: fname,
                                        realFilename: entry.Title || null,
                                        contentType,
                                        disposition: 'attachment',
                                        key: `${key}:attachment:${filenames.size}:file`,
                                        hash: crypto
                                            .createHash(HASH_ALGO)
                                            .update(data)
                                            .digest('hex'),
                                        size: data.length
                                    };

                                    attachments.push(tnefAttachmentData);

                                    let passthrough = new PassThrough();
                                    this.writeStream(tnefAttachmentData.key, passthrough)
                                        .then(() => {
                                            if (/^image\//gi.test(attachmentData.contentType)) {
                                                // post-process thumbnails
                                                return setThumb(tnefAttachmentData)
                                                    .catch(err => console.error(err))
                                                    .finally(() => processNext());
                                            }
                                            processNext();
                                        })
                                        .catch(processNext);

                                    passthrough.end(data);
                                };

                                setImmediate(processNext);
                            })
                            .catch(err => callback(err));
                    };

                    this.writeStream(attachmentData.key, data.decoder)
                        .then(res => {
                            attachmentData.size = typeof res.size === 'number' ? res.size : null;
                            attachmentData.hash = res.hash;

                            if (attachmentData.contentType === 'application/ms-tnef') {
                                // post-process tnef
                                return new Promise(resolve => {
                                    parseTnef(attachmentData.key, () => {
                                        resolve(res);
                                    });
                                });
                            }

                            if (/^image\//gi.test(attachmentData.contentType) || /^image\//gi.test(libmime.detectMimeType(attachmentData.filename))) {
                                // post-process thumbnails
                                return setThumb(attachmentData);
                            }

                            //resolve(res);
                        })
                        .catch(reject)
                        .finally(() => {
                            data.done();
                        });

                    return;
                }
            });

            let source = sourceStream;
            if (Buffer.isBuffer(sourceStream)) {
                source = new PassThrough();
            }

            let file = source
                .pipe(new Splitter({ ignoreEmbedded: true, maxHeadSize: 2 * 1024 * 1024 }))
                .pipe(streamer)
                .pipe(new Joiner());

            this.writeStream(`${key}:source`, file)
                .then(resolve)
                .catch(reject);

            if (Buffer.isBuffer(sourceStream)) {
                source.end(sourceStream);
            }
        });

        let ftsText = [];
        textParts.forEach(part => {
            if (part.contentType === 'text/html' && part.text.length < MAX_HTML_PARSE_LENGTH) {
                let text = htmlToText
                    .fromString(part.text, {
                        noLinkBrackets: true,
                        ignoreImage: true,
                        ignoreHref: true,
                        singleNewLineParagraphs: true,
                        uppercaseHeadings: false,
                        wordwrap: false
                    })
                    .replace(/\n+/g, '\n');
                ftsText.push(text.trim());
            }
        });

        if (!ftsText.length) {
            textParts.forEach(part => {
                if (part.contentType === 'text/plain') {
                    ftsText.push(part.text.replace(/\n+/g, '\n').trim());
                }
            });
        }

        await this.level.put(`${key}:text`, textParts, {
            valueEncoding: 'json'
        });

        await this.level.put(`${key}:headers`, headers ? headers.getList() : [], {
            valueEncoding: 'json'
        });

        let returnPath = metadata.returnPath;
        if (!returnPath) {
            let addr = headers.getFirst('return-path');
            if (addr) {
                addr = addressparser(addr);
                if (addr && addr[0] && addr[0].address) {
                    returnPath = addr[0].address;
                }
            }
        }

        const queryParams = {
            $import: (metadata.source && metadata.source.importId) || null,
            $source: JSON.stringify(metadata.source || {}),
            $return_path: returnPath || null,
            $text: ftsText.join('\n'),
            $key: key,
            $size: eml.size,
            $hash: eml.hash,
            $hdate: formatDate(headers.getFirst('date')),
            $idate: formatDate(metadata.idate),
            $attachments: attachments.length,
            $flags: metadata.flags ? JSON.stringify(metadata.flags) : null,
            $labels: metadata.labels ? JSON.stringify(metadata.labels) : null
        };

        let addresses = [];
        ['from', 'to', 'cc', 'bcc', 'reply-to', 'delivered-to', 'return-path'].forEach(key => {
            let lines;

            if (key === 'return-path') {
                lines = [].concat(returnPath || []);
            } else {
                lines = headers ? headers.getDecoded(key) : [];
            }

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

                addr.address = (addr.address || '')
                    .toString()
                    .replace(/\s+/g, ' ')
                    .trim();

                if (/@xn--/.test(addr.address)) {
                    let atpos = addr.address.lastIndexOf('@');
                    addr.address = addr.address.substr(0, atpos + 1) + punycode.toUnicode(addr.address.substr(atpos + 1));
                }

                addresses.push(addr);
            });
        });

        ['subject', 'from', 'to', 'cc', 'bcc', 'message-id', 'reply-to'].forEach(key => {
            let lines = headers ? headers.getDecoded(key) : [];
            queryParams['$' + key.replace(/-/g, '_')] =
                libmime.decodeWords(
                    lines
                        .map(
                            line =>
                                line.value &&
                                Buffer.from(line.value, 'binary')
                                    .toString()
                                    .replace(/\s+/g, ' ')
                                    .trim()
                        )
                        .filter(line => line)
                        .join(', ')
                ) || null;
        });

        let graph = [];
        ['message-id', 'references', 'in-reply-to', 'thread-index', 'X-GM-THRID'.toLowerCase()].forEach(key => {
            let entries = (headers ? headers.getDecoded(key) : [])
                .map(line => {
                    let value =
                        line.value &&
                        Buffer.from(line.value, 'binary')
                            .toString()
                            .trim();
                    if (key === 'thread-index') {
                        value = value.substr(0, 22);
                    }
                    return value;
                })
                .filter(line => line)
                .join(' ')
                .split(/\s+/);
            entries
                .map(value => value.trim())
                .filter(value => value)
                .forEach(value => {
                    graph.push({
                        type: key,
                        messageId: value
                    });
                });
        });

        let emailId;
        if (!skipTransaction) {
            await this.sql.run('BEGIN TRANSACTION');
        }
        try {
            emailId = await this.sql.run(
                `INSERT INTO emails 
                ([import], [return_path], [source], [hdate], [idate], [from], [to], [cc], [bcc], [reply_to], [subject], [text], [message_id], [key], [attachments], [flags], [labels], [size], [hash]) 
                VALUES ($import, $return_path, $source, $hdate, $idate, $from, $to, $cc, $bcc, $reply_to, $subject, $text, $message_id, $key, $attachments, $flags, $labels, $size, $hash)`,
                queryParams
            );

            if (!emailId) {
                return false;
            }

            for (let headerData of headers.getList()) {
                let header = libmime.decodeHeader(headerData.line);
                if (!header || !header.value) {
                    continue;
                }

                await this.sql.run(
                    `INSERT INTO headers 
                        ([email], [key], [value]) 
                        VALUES ($email, $key, $value)`,
                    {
                        $email: emailId,
                        $key: headerData.key || null,
                        $value: header.value || null
                    }
                );
            }

            for (let attachmentData of attachments) {
                await this.sql.run(
                    `INSERT INTO attachments 
                    ([email], [content_type],[content_id], [disposition], [filename], [real_filename], [size], [thumb_key], [key], [hash]) 
                    VALUES ($email, $content_type, $content_id, $disposition, $filename, $real_filename, $size, $thumb_key, $key, $hash)`,
                    {
                        $email: emailId,
                        $content_type: attachmentData.contentType || null,
                        $content_id: attachmentData.contentId || null,
                        $disposition: attachmentData.disposition || null,
                        $filename: attachmentData.filename || null,
                        $real_filename: attachmentData.realFilename || null,
                        $size: 'size' in attachmentData ? attachmentData.size : null,
                        $thumb_key: attachmentData.thumbKey || null,
                        $key: attachmentData.key,
                        $hash: attachmentData.hash || null
                    }
                );
            }

            for (let addressData of addresses) {
                const attrs = human.parseName(addressData.name);

                let contact;

                if (addressData.address) {
                    let query = `INSERT INTO contacts 
                ([name], [address], [normalized_address], [first_name], [last_name], [middle_name]) 
                VALUES ($name, $address, $normalized_address, $first_name, $last_name, $middle_name)`;

                    if (addressData.name) {
                        // override name values if set
                        query = `${query} ON CONFLICT(normalized_address) DO UPDATE
                        SET name = $name, first_name = $first_name, last_name = $last_name, middle_name = $middle_name`;
                    }

                    let normalizedAddress = normalizeAddress(addressData.address);
                    try {
                        await this.sql.run(query, {
                            $name: addressData.name || null,
                            $address: addressData.address || null,
                            $normalized_address: normalizedAddress,
                            $first_name: attrs.firstName || null,
                            $last_name: attrs.lastName || null,
                            $middle_name: attrs.middleName || null
                        });
                    } catch (err) {
                        // ignore unique key conflicts
                        if (err.code !== 'SQLITE_CONSTRAINT') {
                            throw err;
                        }
                    }

                    // assuming we have INSERTed or UPSERTed normalized_address
                    let row = await this.sql.findOne('SELECT id, address FROM contacts WHERE normalized_address = ? LIMIT 1', [normalizedAddress]);
                    if (row && row.id) {
                        contact = row.id;
                    }
                }

                await this.sql.run(
                    `INSERT INTO addresses 
                    ([email], [type], [name], [address], [first_name], [last_name], [middle_name], [contact]) 
                    VALUES ($email, $type, $name, $address, $first_name, $last_name, $middle_name, $contact)`,
                    {
                        $email: emailId,
                        $type: addressData.type,
                        $name: addressData.name || null,
                        $address: addressData.address || null,

                        $first_name: attrs.firstName || null,
                        $last_name: attrs.lastName || null,
                        $middle_name: attrs.middleName || null,

                        $contact: contact || null
                    }
                );
            }

            for (let graphData of graph) {
                await this.sql.run(
                    `INSERT INTO graph 
                    ([email], [type], [message_id]) 
                    VALUES ($email, $type, $message_id)`,
                    {
                        $email: emailId,
                        $type: graphData.type,
                        $message_id: graphData.messageId
                    }
                );
            }
        } finally {
            if (!skipTransaction) {
                await this.sql.run('COMMIT TRANSACTION');
            }
        }

        return {
            id: emailId,
            size: eml.size
        };
    }

    async getTextContent(key) {
        return await this.level.get(`${key}:text`, {
            valueEncoding: 'json'
        });
    }

    async close() {
        if (!this.prepared) {
            return false;
        }
        if (this.closed || this.closing) {
            return;
        }
        this.closing = true;
        await this.sql.close();
        await this.level.close();
        this.closing = false;
        this.closed = true;
    }

    async getAttachmentBuffer(id, options) {
        options = options || {};
        let row = await this.sql.findOne(`SELECT key, content_type AS contentType FROM attachments WHERE id=?`, [id]);
        if (!row || !row.key) {
            return false;
        }
        let content = await this.readBuffer(row.key);
        if (!content) {
            return false;
        }

        if (options.dataUri) {
            return 'data:' + row.contentType + ';base64,' + content.toString('base64');
        }

        return content;
    }

    async getAttachmentBufferByCid(email, cid) {
        let row = await this.sql.findOne(`SELECT id FROM attachments WHERE email=? AND content_id=?`, [email, cid]);
        if (!row || !row.id) {
            return false;
        }
        return this.getAttachmentBuffer(row.id, { dataUri: true });
    }

    async getAttachmentStream(id) {
        let row = await this.sql.findOne(`SELECT key, content_type AS contentType FROM attachments WHERE id=?`, [id]);
        if (!row || !row.key) {
            return false;
        }

        return this.readStream(row.key);
    }

    async getMessageStream(id) {
        let row = await this.sql.findOne(`SELECT key FROM emails WHERE id=?`, [id]);
        if (!row || !row.key) {
            return false;
        }

        return this.readStream(`${row.key}:source`);
    }

    async getMessageBuffer(id) {
        let row = await this.sql.findOne(`SELECT key FROM emails WHERE id=?`, [id]);
        if (!row || !row.key) {
            return false;
        }

        let content = await this.readBuffer(`${row.key}:source`);
        if (!content) {
            return false;
        }

        return content;
    }

    async getContacts(options) {
        let now = Date.now();

        options = options || {};
        let page = Math.max(Number(options.page) || 0, 1);
        let pageSize = options.pageSize || 20;

        let queryParams = {};

        let query = [
            'SELECT contacts.[id] AS id, contacts.[name] AS [name], contacts.[address] AS [address], contacts.first_name AS firstName, contacts.middle_name AS middleName, contacts.last_name AS lastName, COUNT(addresses.id) AS [messages] FROM [contacts] LEFT JOIN addresses ON addresses.contact = contacts.id WHERE 1'
        ];
        let countQuery = ['SELECT COUNT([contacts].[id]) AS total FROM [contacts] WHERE 1'];

        if (options.term) {
            let terms = 'AND (contacts.name LIKE $term OR contacts.normalized_address LIKE $term)';
            query.push(terms);
            countQuery.push(terms);
            queryParams.$term = (options.term || '').toString().trim();
        }

        let countRes = await this.sql.findOne(countQuery.join(' '), queryParams);
        let total = (countRes && countRes.total) || 0;

        query.push('GROUP BY addresses.contact');

        query.push('ORDER BY contacts.last_name ASC, contacts.first_name ASC, contacts.normalized_address ASC');
        query.push('LIMIT $limit OFFSET $offset');
        queryParams.$limit = pageSize;
        queryParams.$offset = pageSize * (page - 1);

        return {
            page,
            pageSize,
            pages: total ? Math.ceil(total / pageSize) : 0,
            total,
            data: await this.sql.findMany(query.join(' '), queryParams),
            timer: Date.now() - now
        };
    }

    /*
        {
            term, // message text
            subject,
            headers: {
                key: value
            },
            graph: messageId,
            messageId,
            from,
            to,
            cc,
            bcc,
            returnPath,
            deliveredTo,

            hash, // attachment hash
            contentId,
            contentType,
            filename,

            size: { // attachment size
                start,
                end
            },

            date: {
                start,
                end
            }
        }
    */

    async getAttachments(options) {
        let now = Date.now();
        options = options || {};

        let page = Math.max(Number(options.page) || 0, 1);
        let pageSize = options.pageSize || 20;

        let queryParams = {};

        let joinTerms = []; // 'LEFT JOIN x
        let whereTerms = []; // 'LEFT JOIN x

        joinTerms.push('LEFT JOIN [emails] ON [emails].[id] = [attachments].[email]');

        let selectFields = [
            `[attachments].[id] AS id`,
            `[attachments].[content_type] AS contentType`,
            `[attachments].[disposition] AS disposition`,
            `[attachments].[content_id] AS contentId`,
            `[attachments].[filename] AS filename`,
            `[attachments].[size] AS size`,
            `[attachments].[thumb_key] AS thumbKey`,
            `[attachments].[hash] AS hash`,
            `[attachments].[key] AS key`,

            `[emails].[id] AS email`,
            `[emails].[subject] AS subject`,
            `[emails].[message_id] AS messageId`,
            `[emails].[idate] AS idate`,
            `[emails].[hdate] AS hdate`
        ];
        let countFields = ['COUNT([attachments].[id]) AS total'];

        if (options.term) {
            whereTerms.push(`[emails].[id] in (
                SELECT rowid FROM [emails_fts]
                WHERE [emails_fts] MATCH $term
            )`);
            queryParams.$term = (options.term || '').toString().trim();
        }

        if (options.subject) {
            whereTerms.push(`[emails].[subject] LIKE $subject`);
            queryParams.$subject = (options.subject || '').toString().trim();
        }

        if (options.headers && typeof options.headers === 'object') {
            Object.keys(options.headers).forEach((key, i) => {
                if (options.headers[key] === true) {
                    // special case, check if key has value
                    whereTerms.push(`[emails].[id] in (
                        SELECT [email] FROM [headers]
                        WHERE [key]=$header_${i}_key
                    )`);
                    queryParams[`$header_${i}_key`] = key.toLowerCase().trim();
                    return;
                }

                let value = (options.headers[key] || '').toString().trim();
                if (!value) {
                    return;
                }
                whereTerms.push(`[emails].[id] in (
                    SELECT [email] FROM [headers]
                    WHERE [key]=$header_${i}_key AND [value] LIKE $header_${i}_value
                )`);
                queryParams[`$header_${i}_key`] = key.toLowerCase().trim();
                queryParams[`$header_${i}_value`] = value;
            });
        }

        if (options.graph) {
            [].concat(options.graph || []).forEach((messageId, i) => {
                messageId = (messageId || '').toString().trim();
                whereTerms.push(`[emails].[id] in (
                    SELECT [email] FROM [graph]
                        WHERE [message_id]=$graph_${i}
                    )`);
                queryParams[`$graph_${i}`] = messageId;
            });
        }

        ['from', 'to', 'cc', 'bcc', 'returnPath', 'deliveredTo'].forEach(key => {
            let hkey = key.replace(/[A-Z]/g, c => '-' + c.toLowerCase());
            let lkey = hkey.replace(/-/g, '_');

            let addrWhere = [];

            [].concat(options[key] || []).forEach((addressTerm, i) => {
                if (typeof addressTerm === 'number') {
                    addrWhere.push(`[contact] = $addr_${lkey}_${i}`);
                    queryParams[`$addr_${lkey}_${i}`] = addressTerm;
                } else {
                    addrWhere.push(`[name] LIKE $addr_${lkey}_${i}`);
                    addrWhere.push(`[address] LIKE $addr_${lkey}_${i}`);
                    queryParams[`$addr_${lkey}_${i}`] = (addressTerm || '').toString().trim();
                }
            });

            if (addrWhere.length) {
                queryParams[`$addr_${lkey}_type`] = hkey;
                whereTerms.push(`[emails].[id] in (
                SELECT [email] FROM [addresses]
                    WHERE [type]=$addr_${lkey}_type AND (${addrWhere.join(' OR ')})
                )`);
            }
        });

        if (options.attachments && typeof options.attachments === 'object') {
            ['hash', 'contentId', 'contentType', 'filename', 'size'].forEach(key => {
                let hkey = key.replace(/[A-Z]/g, c => '-' + c.toLowerCase());
                let lkey = hkey.replace(/-/g, '_');

                let value = options.attachments[key];

                if (typeof value === 'string' || typeof value === 'number') {
                    whereTerms.push(`[attachments].[${lkey}] LIKE $att_${lkey}`);
                    queryParams[`$att_${lkey}`] = typeof value === 'string' ? value.trim() : value;
                } else if (value && typeof value === 'object') {
                    if (value.start && typeof value.start === 'number') {
                        whereTerms.push(`[attachments].[${lkey}] >= $att_${lkey}_start`);

                        let numvalue = value.start;
                        switch ((value.type || '').toString().toLowerCase()) {
                            case 'mb':
                                numvalue = numvalue * 1024 * 1024;
                                break;
                            case 'kb':
                                numvalue = numvalue * 1024;
                                break;
                            case 'b':
                            default:
                                break;
                        }
                        queryParams[`$att_${lkey}_start`] = numvalue;
                    }

                    if (value.end && typeof value.end === 'number') {
                        whereTerms.push(`[attachments].[${lkey}] <= $att_${lkey}_end`);

                        let numvalue = value.end;
                        switch ((value.type || '').toString().toLowerCase()) {
                            case 'mb':
                                numvalue = numvalue * 1024 * 1024;
                                break;
                            case 'kb':
                                numvalue = numvalue * 1024;
                                break;
                            case 'b':
                            default:
                                break;
                        }
                        queryParams[`$att_${lkey}_end`] = numvalue;
                    }
                }
            });
        }

        if (options.messageId && typeof options.messageId === 'string') {
            whereTerms.push(`[emails].[message_id] LIKE $message_id`);
            queryParams.$message_id = options.messageId.trim();
        }

        if (options.date && options.date.start) {
            let date = formatDate(options.date.start);
            if (date) {
                whereTerms.push(`[emails].[hdate] >= DATETIME($date_start)`);
                queryParams.$date_start = date;
            }
        }

        if (options.date && options.date.end) {
            let date = formatDate(options.date.end);
            if (date) {
                whereTerms.push(`[emails].[hdate] <= DATETIME($date_end)`);
                queryParams.$date_end = date;
            }
        }

        let countQuery = []
            .concat('SELECT')
            .concat(countFields.join(', '))
            .concat('FROM [attachments]')
            .concat(joinTerms)
            .concat(whereTerms.length ? 'WHERE' : [])
            .concat(whereTerms.join(' AND '))
            .join(' ');

        let countRes = await this.sql.findOne(countQuery, queryParams);
        let total = (countRes && countRes.total) || 0;

        let selectQuery = []
            .concat('SELECT')
            .concat(selectFields.join(', '))
            .concat('FROM [attachments]')
            .concat(joinTerms)
            .concat(whereTerms.length ? 'WHERE' : [])
            .concat(whereTerms.join(' AND '))
            .concat('ORDER BY [attachments].real_filename ASC')
            .concat('LIMIT $limit OFFSET $offset')
            .join(' ');

        queryParams.$limit = pageSize;
        queryParams.$offset = pageSize * (page - 1);

        let attachments = await this.sql.findMany(selectQuery, queryParams);

        for (let attachmentData of attachments) {
            if (attachmentData.idate) {
                attachmentData.idate = new Date(attachmentData.idate + 'Z').toISOString();
            }

            if (attachmentData.hdate) {
                attachmentData.hdate = new Date(attachmentData.hdate + 'Z').toISOString();
            }

            let list = await this.sql.findMany(
                'SELECT type, name, address, contact FROM addresses WHERE email=? ORDER BY type ASC, last_name ASC, first_name ASC LIMIT 1000',
                [attachmentData.email]
            );
            attachmentData.addresses = {};
            list.forEach(addressData => {
                let ckey = addressData.type.replace(/-([^-])/g, (o, c) => c.toUpperCase());
                if (!attachmentData.addresses[ckey]) {
                    attachmentData.addresses[ckey] = [];
                }
                attachmentData.addresses[ckey].push({
                    name: addressData.name || '',
                    address: addressData.address || '',
                    contact: addressData.contact
                });
            });

            let thumbKey = attachmentData.thumbKey;
            delete attachmentData.thumbKey;

            if (thumbKey) {
                try {
                    let thumbnail = await this.level.get(thumbKey, {
                        valueEncoding: 'binary'
                    });
                    if (thumbnail) {
                        attachmentData.thumbnail = 'data:image/webp;base64,' + thumbnail.toString('base64');
                    }
                } catch (err) {
                    // ignore
                }
            }
        }

        let response = {
            page,
            pageSize,
            pages: total ? Math.ceil(total / pageSize) : 0,
            total,
            data: attachments,
            timer: Date.now() - now
        };

        if (options.debug) {
            response.selectQuery = selectQuery.replace(/\s+/g, ' ').trim();
            response.queryParams = queryParams;
        }

        return response;
    }

    async getEmails(options) {
        let now = Date.now();
        options = options || {};

        let page = Math.max(Number(options.page) || 0, 1);
        let pageSize = options.pageSize || 20;

        let queryParams = {};

        let joinTerms = []; // 'LEFT JOIN x
        let whereTerms = []; // 'LEFT JOIN x

        let selectFields = [
            `[emails].[id] AS id`,
            `[emails].[return_path] AS returnPath`,
            `[emails].[subject] AS subject`,
            `[emails].[message_id] AS messageId`,
            `[emails].[idate] AS idate`,
            `[emails].[hdate] AS hdate`,
            `[emails].[attachments] AS attachments`,
            `[emails].[key] AS key`,
            `[emails].[source] AS source`
        ];
        let countFields = ['COUNT([emails].[id]) AS total'];

        if (options.term) {
            whereTerms.push(`[emails].[id] in (
                SELECT rowid FROM [emails_fts]
                WHERE [emails_fts] MATCH $term
            )`);
            queryParams.$term = (options.term || '').toString().trim();
        }

        if (options.id && Number(options.id)) {
            whereTerms.push(`[emails].[id] = $id`);
            queryParams.$id = Number(options.id);
        }

        if (options.import && Number(options.import)) {
            whereTerms.push(`[emails].[import] = $import`);
            queryParams.$import = Number(options.import);
        }

        if (options.subject) {
            whereTerms.push(`[emails].[subject] LIKE $subject`);
            queryParams.$subject = (options.subject || '').toString().trim();
        }

        if (options.headers && typeof options.headers === 'object') {
            Object.keys(options.headers).forEach((key, i) => {
                if (options.headers[key] === true) {
                    // special case, check if key has value
                    whereTerms.push(`[emails].[id] in (
                        SELECT [email] FROM [headers]
                        WHERE [key]=$header_${i}_key
                    )`);
                    queryParams[`$header_${i}_key`] = key.toLowerCase().trim();
                    return;
                }

                let value = (options.headers[key] || '').toString().trim();
                if (!value) {
                    return;
                }
                whereTerms.push(`[emails].[id] in (
                    SELECT [email] FROM [headers]
                    WHERE [key]=$header_${i}_key AND [value] LIKE $header_${i}_value
                )`);
                queryParams[`$header_${i}_key`] = key.toLowerCase().trim();
                queryParams[`$header_${i}_value`] = '%' + value.replace(/^%|%$/g, '') + '%';
            });
        }

        if (options.graph) {
            [].concat(options.graph || []).forEach((messageId, i) => {
                messageId = (messageId || '').toString().trim();
                whereTerms.push(`[emails].[id] in (
                    SELECT [email] FROM [graph]
                        WHERE [message_id]=$graph_${i}
                    )`);
                queryParams[`$graph_${i}`] = messageId;
            });
        }

        if (options.contact && Number(options.contact)) {
            queryParams.$contact = Number(options.contact);
            whereTerms.push(`[emails].[id] in (
                SELECT [email] FROM [addresses]
                    WHERE [contact]=$contact
                )`);
        }

        if (options.tags && options.tags.length) {
            options.tags.forEach((tag, i) => {
                tag = (tag || '').trim().toLowerCase();
                if (tag) {
                    whereTerms.push(`[emails].[id] in (
                        SELECT [email] FROM [tags]
                            WHERE tag = $tag_${i}
                        )`);
                    queryParams[`$tag_${i}`] = tag;
                }
            });
        }

        ['from', 'to', 'cc', 'bcc', 'returnPath', 'deliveredTo', 'any', 'anyTo'].forEach(key => {
            let hkey = key.replace(/[A-Z]/g, c => '-' + c.toLowerCase());
            let lkey = hkey.replace(/-/g, '_');

            let addrWhere = [];

            [].concat(options[key] || []).forEach((addressTerm, i) => {
                if (typeof addressTerm === 'number') {
                    addrWhere.push(`[contact] = $addr_${lkey}_${i}`);
                    queryParams[`$addr_${lkey}_${i}`] = addressTerm;
                } else {
                    addrWhere.push(`[name] LIKE $addr_${lkey}_${i}`);
                    addrWhere.push(`[address] LIKE $addr_${lkey}_${i}`);
                    queryParams[`$addr_${lkey}_${i}`] = (addressTerm || '').toString().trim();
                }
            });

            if (addrWhere.length) {
                if (key === 'any') {
                    queryParams[`$addr_${lkey}_type`] = hkey;
                    whereTerms.push(`[emails].[id] in (
                        SELECT [email] FROM [addresses]
                            WHERE [type]=$addr_${lkey}_type AND (${addrWhere.join(' OR ')})
                        )`);
                } else if (key === 'anyTo') {
                    whereTerms.push(`[emails].[id] in (
                        SELECT [email] FROM [addresses]
                            WHERE [type] IN ('to', 'cc', 'bcc') AND (${addrWhere.join(' OR ')})
                        )`);
                } else {
                    whereTerms.push(`[emails].[id] in (
                        SELECT [email] FROM [addresses]
                            WHERE ${addrWhere.join(' OR ')}
                        )`);
                }
            }
        });

        if (options.attachments === true) {
            whereTerms.push(`[emails].[attachments] > 0`);
        }

        if (options.attachments === false) {
            whereTerms.push(`[emails].[attachments] = 0`);
        }

        if (options.attachments && typeof options.attachments === 'object') {
            let attWhere = [];

            ['hash', 'contentId', 'contentType', 'filename', 'size'].forEach(key => {
                let hkey = key.replace(/[A-Z]/g, c => '-' + c.toLowerCase());
                let lkey = hkey.replace(/-/g, '_');

                let value = options.attachments[key];

                if (typeof value === 'string' || typeof value === 'number') {
                    attWhere.push(`[${lkey}] LIKE $att_${lkey}`);
                    queryParams[`$att_${lkey}`] = typeof value === 'string' ? value.trim() : value;
                } else if (value && typeof value === 'object') {
                    if (value.start && typeof value.start === 'number') {
                        attWhere.push(`[${lkey}] >= $att_${lkey}_start`);
                        queryParams[`$att_${lkey}_start`] = value.start;
                    }

                    if (value.end && typeof value.end === 'number') {
                        attWhere.push(`[${lkey}] <= $att_${lkey}_end`);
                        queryParams[`$att_${lkey}_end`] = value.end;
                    }
                }
            });

            if (attWhere.length) {
                whereTerms.push(`[emails].[id] in (
                SELECT [email] FROM [attachments]
                    WHERE ${attWhere.join(' AND ')}
                )`);
            }
        }

        if (options.hash && typeof options.hash === 'string') {
            whereTerms.push(`[emails].[hash] = $hash`);
            queryParams.$hash = options.hash;
        }

        if (options.messageId && typeof options.messageId === 'string') {
            whereTerms.push(`[emails].[message_id] LIKE $message_id`);
            queryParams.$message_id = options.messageId.trim();
        }

        if (options.date && options.date.start) {
            let date = formatDate(options.date.start);
            if (date) {
                whereTerms.push(`[emails].[hdate] >= DATETIME($date_start)`);
                queryParams.$date_start = date;
            }
        }

        if (options.date && options.date.end) {
            let date = formatDate(options.date.end);
            if (date) {
                whereTerms.push(`[emails].[hdate] <= DATETIME($date_end)`);
                queryParams.$date_end = date;
            }
        }

        let countQuery = []
            .concat('SELECT')
            .concat(countFields.join(', '))
            .concat('FROM [emails]')
            .concat(joinTerms)
            .concat(whereTerms.length ? 'WHERE' : [])
            .concat(whereTerms.join(' AND '))
            .join(' ');

        let countRes = await this.sql.findOne(countQuery, queryParams);
        let total = (countRes && countRes.total) || 0;

        let selectQuery = []
            .concat('SELECT')
            .concat(selectFields.join(', '))
            .concat('FROM [emails]')
            .concat(joinTerms)
            .concat(whereTerms.length ? 'WHERE' : [])
            .concat(whereTerms.join(' AND '))
            .concat('ORDER BY [emails].hdate DESC, [emails].[id] DESC')
            .concat('LIMIT $limit OFFSET $offset')
            .join(' ');

        queryParams.$limit = pageSize;
        queryParams.$offset = pageSize * (page - 1);

        let emails = await this.sql.findMany(selectQuery, queryParams);

        for (let emailData of emails) {
            if (emailData.idate) {
                emailData.idate = new Date(emailData.idate + 'Z').toISOString();
            }

            if (emailData.hdate) {
                emailData.hdate = new Date(emailData.hdate + 'Z').toISOString();
            }

            if (emailData.source) {
                try {
                    emailData.source = JSON.parse(emailData.source);
                } catch (err) {
                    console.log(emailData.source);
                    console.error(err);
                    emailData.source = null;
                }
            }

            if (emailData.attachments) {
                emailData.attachments = await this.sql.findMany(
                    'SELECT id, content_type AS contentType, filename, size FROM attachments WHERE email=? ORDER BY filename ASC LIMIT 1000',
                    [emailData.id]
                );
            } else {
                emailData.attachments = [];
            }

            let list = await this.sql.findMany(
                'SELECT type, name, address, contact FROM addresses WHERE email=? ORDER BY type ASC, last_name ASC, first_name ASC LIMIT 1000',
                [emailData.id]
            );
            emailData.addresses = {};
            list.forEach(addressData => {
                let ckey = addressData.type.replace(/-([^-])/g, (o, c) => c.toUpperCase());
                if (!emailData.addresses[ckey]) {
                    emailData.addresses[ckey] = [];
                }
                emailData.addresses[ckey].push({
                    name: addressData.name || '',
                    address: addressData.address || '',
                    contact: addressData.contact
                });
            });
        }

        let loadMailText = async emailData => {
            let headers = new Headers(
                await this.level.get(`${emailData.key}:headers`, {
                    valueEncoding: 'json'
                })
            );

            emailData.headers = {
                original: headers
                    .build()
                    .toString()
                    .replace(/\r\n/g, '\n')
                    .trim(),
                structured: headers.getList().map(header => {
                    let data = headers.libmime.decodeHeader(header.line);
                    data.value = Buffer.from(data.value, 'binary').toString();
                    return data;
                })
            };

            let textParts = await this.level.get(`${emailData.key}:text`, {
                valueEncoding: 'json'
            });

            let text = {};
            let attachmentReferences = new Set();
            textParts.forEach(textPart => {
                let contentType = (textPart.contentType || '').toLowerCase();
                let partKey = contentType.substr(contentType.indexOf('/') + 1);
                if (!text[partKey]) {
                    text[partKey] = [];
                }

                let content = textPart.text || '';
                content = content.replace(/\n{3,}/g, '\n\n\n').replace(/^\n+/, '');

                let cids = content.match(/\bcid:[^'"\s]+/g);
                if (cids) {
                    Array.from(cids).forEach(cid => {
                        attachmentReferences.add('<' + cid.substr(4).replace(/[<>\s]/g, '') + '>');
                    });
                }

                text[partKey].push(content);
            });

            Object.keys(text).forEach(key => {
                text[key] = text[key].join('\n');
            });

            emailData.text = text;
        };

        await Promise.all(
            emails.map(emailData => {
                return loadMailText(emailData);
            })
        );

        let response = {
            page,
            pageSize,
            pages: total ? Math.ceil(total / pageSize) : 0,
            total,
            data: emails,
            timer: Date.now() - now
        };

        if (options.debug) {
            response.selectQuery = selectQuery.replace(/\s+/g, ' ').trim();
            response.queryParams = queryParams;
        }

        return response;
    }

    async getEmail(id, noContent) {
        let now = Date.now();

        let selectFields = [
            `[emails].[id] AS id`,
            `[emails].[subject] AS subject`,
            `[emails].[message_id] AS messageId`,
            `[emails].[idate] AS idate`,
            `[emails].[hdate] AS hdate`,
            `[emails].[hash] AS hash`,
            `[emails].[size] AS size`,
            `[emails].[key] AS key`,
            `[emails].[return_path] AS returnPath`,
            `[emails].[source] AS source`,
            `[emails].[flags] AS [flags]`
        ];

        let emailData = await this.sql.findOne(`SELECT ${selectFields.join(', ')} FROM emails WHERE id=? LIMIT 1`, [id]);
        if (!emailData) {
            return false;
        }

        let key = emailData.key;
        delete emailData.key;

        if (emailData.idate) {
            emailData.idate = new Date(emailData.idate + 'Z').toISOString();
        }

        if (emailData.hdate) {
            emailData.hdate = new Date(emailData.hdate + 'Z').toISOString();
        }

        if (emailData.source) {
            try {
                emailData.source = JSON.parse(emailData.source);
            } catch (err) {
                emailData.source = {};
            }
        }

        if (emailData.flags) {
            try {
                emailData.flags = JSON.parse(emailData.source);
            } catch (err) {
                emailData.flags = [];
            }
        }

        let addresses = await this.sql.findMany(
            'SELECT [type], [name], [address], [contact] FROM addresses WHERE email=? ORDER BY type ASC, last_name ASC, first_name ASC LIMIT 1000',
            [id]
        );

        emailData.addresses = {};
        addresses.forEach(addressData => {
            let ckey = addressData.type.replace(/-([^-])/g, (o, c) => c.toUpperCase());
            if (!emailData.addresses[ckey]) {
                emailData.addresses[ckey] = [];
            }
            emailData.addresses[ckey].push({
                name: addressData.name || '',
                address: addressData.address || '',
                contact: addressData.contact
            });
        });

        emailData.envelope = this.getEnvelope(emailData);

        if (noContent) {
            emailData.timer = Date.now() - now;
            return emailData;
        }

        let headers = new Headers(
            await this.level.get(`${key}:headers`, {
                valueEncoding: 'json'
            })
        );

        emailData.headers = {
            original: headers
                .build()
                .toString()
                .replace(/\r\n/g, '\n')
                .trim(),
            structured: headers.getList().map(header => {
                let data = headers.libmime.decodeHeader(header.line);
                data.value = Buffer.from(data.value, 'binary').toString();
                return data;
            })
        };

        let textParts = await this.level.get(`${key}:text`, {
            valueEncoding: 'json'
        });

        let text = {};
        let attachmentReferences = new Set();
        textParts.forEach(textPart => {
            let contentType = (textPart.contentType || '').toLowerCase();
            let partKey = contentType.substr(contentType.indexOf('/') + 1);
            if (!text[partKey]) {
                text[partKey] = [];
            }

            let content = textPart.text || '';
            content = content.replace(/\n{3,}/g, '\n\n\n').replace(/^\n+/, '');

            let cids = content.match(/\bcid:[^'"\s]+/g);
            if (cids) {
                Array.from(cids).forEach(cid => {
                    attachmentReferences.add('<' + cid.substr(4).replace(/[<>\s]/g, '') + '>');
                });
            }

            text[partKey].push(content);
        });

        Object.keys(text).forEach(key => {
            text[key] = text[key].join('\n');
        });

        emailData.text = text;

        let attachments = await this.sql.findMany(
            'SELECT [id], [content_type] AS contentType, disposition, content_id AS contentId, filename, size, hash, key FROM attachments WHERE email=? ORDER BY filename ASC LIMIT 1000',
            [id]
        );
        for (let attachmentData of attachments) {
            let contentId = attachmentData.contentId ? '<' + attachmentData.contentId.replace(/[<>\s]/g, '') + '>' : false;
            if (contentId && attachmentReferences.has(contentId)) {
                try {
                    let attachmentContent = await this.readBuffer(attachmentData.key);
                    if (attachmentContent) {
                        attachmentData.dataUri = 'data:' + attachmentData.contentType + ';base64,' + attachmentContent.toString('base64');
                    }
                } catch (err) {
                    // ignore
                }
            } else if (attachmentData.thumbKey) {
                try {
                    let thumbnail = await this.level.get(attachmentData.thumbKey, {
                        valueEncoding: 'binary'
                    });
                    if (thumbnail) {
                        attachmentData.thumbnail = 'data:image/webp;base64,' + thumbnail.toString('base64');
                    }
                } catch (err) {
                    // ignore
                }
            }
        }

        emailData.attachments = (attachments || []).map(attachmentData => {
            let data = {
                id: attachmentData.id,
                contentType: attachmentData.contentType,
                disposition: attachmentData.disposition,
                contentId: attachmentData.contentId,
                filename: attachmentData.filename,
                size: attachmentData.size,
                hash: attachmentData.hash
            };
            if (attachmentData.thumbnail) {
                data.thumbnail = attachmentData.thumbnail;
            }
            if (attachmentData.dataUri) {
                data.dataUri = attachmentData.dataUri;
            }
            return data;
        });

        emailData.timer = Date.now() - now;
        return emailData;
    }

    async generateThumbnail(contentType, buffer) {
        if (!this.thumbnailGenerator) {
            return false;
        }

        let thumb = await this.thumbnailGenerator('data:' + contentType + ';base64,' + buffer.toString('base64'), 120, 120);
        if (!thumb || typeof thumb !== 'string') {
            return false;
        }

        let comma = thumb.indexOf(',');
        return Buffer.from(thumb.substr(comma + 1), 'base64');
    }

    async saveText(id, type, path) {
        let row = await this.sql.findOne(`SELECT key FROM emails WHERE id=?`, [id]);
        if (!row || !row.key) {
            return false;
        }
        let text = await this.getTextContent(row.key);

        let textContent = Buffer.from(
            text
                .filter(part => part.contentType === `text/${type}`)
                .map(part => part.text)
                .join('\n')
        );

        await fs.writeFile(path, textContent);
    }

    async saveFile(id, path) {
        let sourceStream = await this.getAttachmentStream(id);
        if (!sourceStream) {
            return false;
        }

        let fs;
        try {
            fs = fsCreateWriteStream(path);
        } catch (err) {
            // pump
            sourceStream.on('data', () => false);
            sourceStream.on('end', () => false);
            sourceStream.on('error', () => false);
            console.error(err);
            throw new Error('Failed to save file to selected location');
        }

        await new Promise((resolve, reject) => {
            sourceStream.once('error', err => {
                fs.end();
                reject(err);
            });
            sourceStream.once('end', () => resolve());
            fs.once('error', err => {
                console.error(err);
                sourceStream.unpipe(fs);
                // pump
                sourceStream.on('data', () => false);
                reject(err);
            });
            sourceStream.pipe(fs);
        });
    }

    async saveEmail(id, path) {
        let sourceStream = await this.getMessageStream(id);
        if (!sourceStream) {
            return false;
        }

        let fs;
        try {
            fs = fsCreateWriteStream(path);
        } catch (err) {
            // pump
            sourceStream.on('data', () => false);
            sourceStream.on('end', () => false);
            sourceStream.on('error', () => false);
            console.error(err);
            throw new Error('Failed to save file to selected location');
        }

        await new Promise((resolve, reject) => {
            let headerSplitter = new HeaderSplitter();

            sourceStream.once('error', err => {
                fs.end();
                reject(err);
            });

            fs.once('close', () => resolve());
            fs.once('error', err => {
                console.error(err);
                sourceStream.unpipe(headerSplitter);
                // pump
                sourceStream.on('readable', () => {
                    while (sourceStream.read() !== null) {
                        // ignore
                    }
                });
                reject(err);
            });

            headerSplitter.on('headers', data => {
                // update headers
                data.headers.remove('X-Nodemailer-App');
                data.headers.add('X-Nodemailer-App', [this.fid, this.project.toString(16), id.toString(16), Date.now().toString(16)].join(':'), Infinity);

                // remove MBOX headers
                data.headers.remove('Content-Length');
                data.headers.remove('X-Status');
                data.headers.remove('Status');
                data.headers.remove('X-GM-THRID');
                data.headers.remove('X-Gmail-Labels');

                return data.done();
            });

            sourceStream
                .pipe(headerSplitter)
                // remove 0x0D, keep 0x0A
                .pipe(new Newlines())
                .pipe(fs);
        });
    }

    async writeEmailToMboxStream(id, outputStream, mboxOptions) {
        let sourceStream = await this.getMessageStream(id);
        if (!sourceStream) {
            return false;
        }

        await new Promise((resolve, reject) => {
            let headerSplitter = new HeaderSplitter();

            let mboxStream = new MboxStream(mboxOptions || {});

            sourceStream.once('error', err => {
                sourceStream.unpipe(headerSplitter);
                mboxStream.unpipe(outputStream);
                reject(err);
            });

            mboxStream.once('end', () => resolve());

            headerSplitter.on('headers', data => {
                // update headers
                data.headers.remove('X-Nodemailer-App');
                data.headers.add('X-Nodemailer-App', [this.fid, this.project.toString(16), id.toString(16), Date.now().toString(16)].join(':'), Infinity);

                // remove MBOX headers
                data.headers.remove('Content-Length');
                data.headers.remove('X-Status');
                data.headers.remove('Status');
                data.headers.remove('X-GM-THRID');
                data.headers.remove('X-Gmail-Labels');

                return data.done();
            });

            sourceStream
                .pipe(headerSplitter)
                // remove 0x0D, keep 0x0A
                .pipe(new Newlines())
                .pipe(mboxStream)
                .pipe(outputStream, {
                    end: false
                });
        });
    }

    getEnvelope(emailData) {
        let envelope = {};

        let sourceEnvelope = {};
        if (emailData.source.envelope) {
            if (emailData.source.envelope.mailFrom) {
                sourceEnvelope.mailFrom =
                    (emailData.source.envelope.mailFrom && emailData.source.envelope.mailFrom.address) || emailData.source.envelope.mailFrom;
            }
            if (emailData.source.envelope.rcptTo) {
                sourceEnvelope.rcptTo = emailData.source.envelope.rcptTo.map(addr => (addr && addr.address) || addr);
            }
        }

        // MAIL FROM
        if (sourceEnvelope.mailFrom && validateEmail(sourceEnvelope.mailFrom)) {
            envelope.mailFrom = sourceEnvelope.mailFrom;
        } else if (emailData.returnPath && validateEmail(emailData.returnPath)) {
            envelope.mailFrom = emailData.returnPath;
        } else {
            let address = (emailData.addresses.from || []).find(addr => validateEmail(addr.address));
            if (address) {
                envelope.mailFrom = address.address;
            } else {
                envelope.mailFrom = '';
            }
        }

        // RCPT TO
        if (sourceEnvelope.rcptTo && emailData.source.envelope.rcptTo.length) {
            let list = sourceEnvelope.rcptTo.filter(address => validateEmail(address));
            list = new Set(list);
            envelope.rcptTo = Array.from(list);
        } else {
            let list = [];
            for (let type of ['to', 'cc', 'bcc']) {
                if (!emailData.addresses[type]) {
                    continue;
                }
                emailData.addresses[type].forEach(addr => {
                    if (validateEmail(addr.address)) {
                        list.push(addr.address);
                    }
                });
            }
            list = new Set(list);
            envelope.rcptTo = Array.from(list);
        }

        envelope.date = emailData.idate || emailData.hdate;
        envelope.flags = emailData.flags || [];

        return envelope;
    }

    async getProjectTags() {
        let rows = await this.sql.findMany('SELECT display, tag FROM project_tags WHERE tag IS NOT NULL ORDER BY tag');
        return (rows || []).map(row => row.display);
    }

    async getEmailTags(email) {
        let rows = await this.sql.findMany('SELECT display, tag FROM tags WHERE email=? AND tag IS NOT NULL ORDER BY tag', [email]);
        return (rows || []).map(row => row.display);
    }

    async setEmailTags(email, tags) {
        tags = (tags || []).map(entry => ({
            display: entry.trim(),
            tag: (entry || '').toLowerCase().trim()
        }));

        let tagChanges = 0;

        let rows = await this.sql.findMany('SELECT id, display, tag FROM tags WHERE email=?', [email]);

        let missing = [];
        let extra = [];

        let currentTags = rows || [];

        for (let tagData of currentTags) {
            if (!tags.find(tag => tag.tag === tagData.tag)) {
                extra.push(tagData);
            }
        }

        for (let tagData of tags) {
            if (!currentTags.find(tag => tag.tag === tagData.tag)) {
                missing.push(tagData);
            }
        }

        if (missing.length || extra.length) {
            for (let tagData of missing) {
                await this.sql.run(`INSERT INTO tags (email, tag, display) VALUES ($email, $tag, $display)`, {
                    $email: email,
                    $tag: tagData.tag,
                    $display: tagData.display
                });
            }
            for (let tagData of extra) {
                await this.sql.run(`DELETE FROM tags WHERE id=$id`, {
                    $id: tagData.id
                });
                let countRes = await this.sql.findOne(`SELECT COUNT(id) AS tags FROM tags WHERE tag=?`, [tagData.tag]);
                if (countRes && !countRes.tags) {
                    // delete from list
                }
            }

            for (let tagData of missing) {
                let countRes = await this.sql.findOne(`SELECT COUNT(id) AS tags FROM tags WHERE tag=?`, [tagData.tag]);
                if (countRes && countRes.tags) {
                    // add to list
                    await this.sql.run(
                        `INSERT INTO project_tags (tag, display) VALUES ($tag, $display) ON CONFLICT([tag]) DO UPDATE SET [display] = $display`,
                        {
                            $tag: tagData.tag,
                            $display: tagData.display
                        }
                    );
                    tagChanges++;
                }
            }

            for (let tagData of extra) {
                let countRes = await this.sql.findOne(`SELECT COUNT(id) AS tags FROM tags WHERE tag=?`, [tagData.tag]);
                if (countRes && !countRes.tags) {
                    // delete from list
                    await this.sql.run(`DELETE FROM project_tags WHERE tag=$tag`, {
                        $tag: tagData.tag
                    });
                    tagChanges++;
                }
            }
        }

        return { tagChanges };
    }
}

function formatDate(value) {
    if (!value) {
        return null;
    }

    let date;

    if (typeof value === 'string' || typeof value === 'number') {
        date = new Date(value);
    } else if (Object.prototype.toString.apply(value) === '[object Date]') {
        date = value;
    } else {
        return null;
    }

    if (date.toString() === 'Invalid Date') {
        return null;
    }

    if (date.getTime() === 0) {
        return null;
    }

    return date
        .toISOString()
        .replace(/T/, ' ')
        .substr(0, 19);
}

function normalizeAddress(address) {
    address = (address || '').toString();

    let atpos = address.indexOf('@');

    if (atpos < 0) {
        return address.toLowerCase();
    }

    let user = address.substr(0, atpos);
    let domain = address.substr(atpos + 1);

    return user.replace(/\+.*$/, '').toLowerCase() + '@' + domain.toLowerCase();
}

module.exports = Analyzer;
