/* eslint no-constant-condition: 0 */

'use strict';

const fs = require('fs').promises;
const fsCreateReadStream = require('fs').createReadStream;
const fsCreateWriteStream = require('fs').createWriteStream;
const { app, dialog, shell, BrowserWindow } = require('electron');
const prompt = require('./prompt/prompt');
const postfixParser = require('./postfix/parser');
const detectFormat = require('./detect-format/detect-format');
const emlxStream = require('./analyzer/lib/emlx-stream');
const pathlib = require('path');
const { eachMessage } = require('mbox-reader');
const MaildirScan = require('maildir-scan');
const util = require('util');
const recursiveReaddir = require('recursive-readdir');
const zlib = require('zlib');
const upload = require('./upload/upload.js');
const uploader = require('./upload/uploader.js');
const viewSource = require('./view-source/view-source.js');

const PAGE_SIZE = 30;

async function isGz(path) {
    let buffer = Buffer.alloc(2);
    let fd = await fs.open(path, 'r');
    try {
        await fd.read(buffer, 0, buffer.length, 0);
    } finally {
        try {
            await fd.close();
        } catch (err) {
            console.error(err);
            // ignore
        }
    }
    if (buffer[0] === 0x1f && buffer[1] === 0x8b) {
        return true;
    }
    return false;
}

async function processMboxImport(curWin, projects, analyzer, paths) {
    let totalsize = 0;
    for (let filename of paths) {
        totalsize += (await fs.stat(filename)).size;
    }

    let importId = await projects.createImport(analyzer.id, {
        totalsize,
        source: {
            format: 'mbox',
            filePaths: paths
        }
    });

    let processImport = async () => {
        let errored = false;
        try {
            for (let path of paths) {
                let gz = await isGz(path);

                let input = fsCreateReadStream(path);
                if (gz) {
                    // process as gz stream
                    let gunzip = zlib.createGunzip();
                    input.pipe(gunzip);
                    input.on('error', err => {
                        gunzip.emit('error', err);
                    });
                    input = gunzip;
                }

                let lastSize = 0;
                for await (let messageData of eachMessage(input)) {
                    let { size, duplicate } = await analyzer.import(
                        {
                            source: {
                                format: 'mbox',
                                filename: path,
                                importId
                            },
                            idate: messageData.time,
                            returnPath: messageData.returnPath,
                            flags: messageData.flags,
                            labels: messageData.labels
                        },
                        messageData.content
                    );

                    if (duplicate) {
                        continue;
                    }

                    // increment counters
                    let sizeDiff = messageData.readSize - lastSize;
                    lastSize = messageData.readSize;
                    await projects.updateImport(analyzer.id, importId, { emails: 1, processed: sizeDiff, size });
                }
            }
        } catch (err) {
            errored = err.message;
            throw err;
        } finally {
            await projects.updateImport(analyzer.id, importId, { finished: true, errored });
        }
    };

    setImmediate(() => {
        projects._imports++;
        processImport()
            .catch(err => console.error(err))
            .finally(() => {
                projects._imports--;
            });
    });

    return importId;
}

async function processMaildirImport(curWin, projects, analyzer, folderPaths) {
    let scanner = new MaildirScan();
    let scan = util.promisify(scanner.scan.bind(scanner));

    let paths = [];
    let messages = [];
    for (let path of folderPaths) {
        try {
            let list = await scan(path);
            paths.push({
                path,
                list
            });

            list.forEach(folder => {
                folder.messages.forEach(messageData => {
                    messageData.folder = folder.folder.join('/');
                    messageData.fullpath = pathlib.join(path, messageData.path);
                    messages.push(messageData);
                });
            });
        } catch (err) {
            console.error(err);
            throw new Error(`Failed to process folder "${pathlib.basename(path)}"`);
        }
    }

    let totalsize = messages.length;

    let importId = await projects.createImport(analyzer.id, {
        totalsize,
        source: {
            format: 'maildir',
            filePaths: folderPaths
        }
    });

    let processImport = async () => {
        let errored = false;
        try {
            for (let messageData of messages) {
                let gz = await isGz(messageData.fullpath);

                let input = fsCreateReadStream(messageData.fullpath);
                if (gz) {
                    // process as gz stream
                    let gunzip = zlib.createGunzip();
                    input.pipe(gunzip);
                    input.on('error', err => {
                        gunzip.emit('error', err);
                    });
                    input = gunzip;
                }

                let { size, duplicate } = await analyzer.import(
                    {
                        source: {
                            format: 'maildir',
                            filename: messageData.path,
                            importId
                        },
                        idate: new Date(messageData.time * 1000),
                        flags: messageData.flags && messageData.flags.length ? messageData.flags : null,
                        labels: messageData.folder ? [messageData.folder] : null
                    },
                    input
                );

                if (duplicate) {
                    continue;
                }

                // increment counters
                await projects.updateImport(analyzer.id, importId, { emails: 1, processed: 1, size });
            }
        } catch (err) {
            errored = err.message;
            throw err;
        } finally {
            await projects.updateImport(analyzer.id, importId, { finished: true, errored });
        }
    };

    setImmediate(() => {
        projects._imports++;
        processImport()
            .catch(err => console.error(err))
            .finally(() => {
                projects._imports--;
            });
    });

    return importId;
}

function bufferStream(stream) {
    return new Promise((resolve, reject) => {
        let chunks = [];
        let chunklen = 0;
        stream.on('readable', () => {
            let chunk;
            while ((chunk = stream.read()) !== null) {
                chunks.push(chunk);
                chunklen += chunk.length;
            }
        });
        stream.once('end', () => resolve(Buffer.concat(chunks, chunklen)));
        stream.on('error', reject);
    });
}

async function processFolderImport(curWin, projects, analyzer, folderPaths) {
    let paths = [];
    for (let path of folderPaths) {
        try {
            let list = await recursiveReaddir(path, [
                (file, stats) => {
                    if (stats.isDirectory() || ['.eml', '.eml.gz', '.emlx'].includes(pathlib.extname(file).toLowerCase())) {
                        return false;
                    }
                    return true;
                }
            ]);
            paths = paths.concat(list || []);
        } catch (err) {
            console.error(err);
            throw new Error(`Failed to process folder "${pathlib.basename(path)}"`);
        }
    }

    let totalsize = paths.length;

    let importId = await projects.createImport(analyzer.id, {
        totalsize,
        source: {
            format: 'folder',
            filePaths: folderPaths
        }
    });

    let processImport = async () => {
        let errored = false;
        try {
            for (let path of paths) {
                let gz = await isGz(path);

                let input = fsCreateReadStream(path);
                if (gz) {
                    // process as gz stream
                    let gunzip = zlib.createGunzip();
                    input.pipe(gunzip);
                    input.on('error', err => {
                        gunzip.emit('error', err);
                    });
                    input = gunzip;
                }

                let sourceMeta = {
                    source: {
                        format: 'eml',
                        filename: path,
                        importId
                    }
                };

                if (pathlib.extname(path).toLowerCase() === '.emlx') {
                    let { content, parser } = emlxStream(path, input);

                    content = await bufferStream(content);
                    sourceMeta.source.format = 'emlx';
                    if (parser.idate) {
                        sourceMeta.idate = parser.idate;
                    }
                    if (parser.uid) {
                        sourceMeta.source.uid = parser.uid;
                    }
                    if (parser.flags) {
                        let flags = [];
                        if (parser.flags.read) {
                            flags.push('\\Seen');
                        }
                        if (parser.flags.deleted) {
                            flags.push('\\Deleted');
                        }
                        if (parser.flags.answered) {
                            flags.push('\\Answered');
                        }
                        if (parser.flags.flagged) {
                            flags.push('\\Flagged');
                        }
                        if (parser.flags.draft) {
                            flags.push('\\Draft');
                        }
                        if (parser.flags.forwarded) {
                            flags.push('\\Forwarded');
                        }
                        if (parser.flags.junk) {
                            flags.push('$Junk');
                        }
                        if (flags.length) {
                            sourceMeta.flags = flags;
                        }
                    }

                    input = content;
                }

                let { size, duplicate } = await analyzer.import(sourceMeta, input);

                if (duplicate) {
                    continue;
                }

                // increment counters
                await projects.updateImport(analyzer.id, importId, { emails: 1, processed: 1, size });
            }
        } catch (err) {
            errored = err.message;
            throw err;
        } finally {
            await projects.updateImport(analyzer.id, importId, { finished: true, errored });
        }
    };

    setImmediate(() => {
        projects._imports++;
        processImport()
            .catch(err => console.error(err))
            .finally(() => {
                projects._imports--;
            });
    });

    return importId;
}

// try to detect automatically
async function createImport(curWin, projects, analyzer, params) {
    let filePaths = params.filePaths;

    if (!params || !params.filePaths || !params.filePaths.length) {
        let res = await dialog.showOpenDialog(curWin, {
            title: 'Select Mail Source',
            properties: ['openFile', 'multiSelections']
        });
        if (res.canceled) {
            return false;
        }
        if (!res.filePaths || !res.filePaths.length) {
            return false;
        }
        filePaths = res.filePaths;
    }

    let importGroups = {};

    for (let path of filePaths) {
        let format = await detectFormat(path);
        if (!format) {
            continue;
        }

        if (!importGroups[format]) {
            importGroups[format] = [];
        }

        importGroups[format].push(path);
    }

    let ids = [];
    for (let format of Object.keys(importGroups)) {
        switch (format) {
            case 'eml':
                {
                    let id = await processEmlImport(curWin, projects, analyzer, importGroups[format]);
                    if (id) {
                        ids.push(id);
                    }
                }
                break;
            case 'emlx':
                {
                    let id = await processEmlxImport(curWin, projects, analyzer, importGroups[format]);
                    if (id) {
                        ids.push(id);
                    }
                }
                break;
            case 'folder':
                {
                    let id = await processFolderImport(curWin, projects, analyzer, importGroups[format]);
                    if (id) {
                        ids.push(id);
                    }
                }
                break;
            case 'postfix':
                {
                    let id = await processPostfixImport(curWin, projects, analyzer, importGroups[format]);
                    if (id) {
                        ids.push(id);
                    }
                }
                break;
            case 'maildir':
                {
                    let id = await processMaildirImport(curWin, projects, analyzer, importGroups[format]);
                    if (id) {
                        ids.push(id);
                    }
                }
                break;
            case 'mbox':
                {
                    let id = await processMboxImport(curWin, projects, analyzer, importGroups[format]);
                    if (id) {
                        ids.push(id);
                    }
                }
                break;
        }
    }
    return ids;
}

async function processEmlImport(curWin, projects, analyzer, paths) {
    let totalsize = paths.length;

    let importId = await projects.createImport(analyzer.id, {
        totalsize,
        source: {
            format: 'eml',
            filePaths: paths
        }
    });

    let processImport = async () => {
        let errored = false;
        try {
            for (let path of paths) {
                let gz = await isGz(path);

                let input = fsCreateReadStream(path);
                if (gz) {
                    // process as gz stream
                    let gunzip = zlib.createGunzip();
                    input.pipe(gunzip);
                    input.on('error', err => {
                        gunzip.emit('error', err);
                    });
                    input = gunzip;
                }

                let { size, duplicate } = await analyzer.import(
                    {
                        source: {
                            format: 'eml',
                            filename: path,
                            importId
                        }
                    },
                    input
                );

                if (duplicate) {
                    continue;
                }

                // increment counters
                await projects.updateImport(analyzer.id, importId, { emails: 1, processed: 1, size });
            }
        } catch (err) {
            errored = err.message;
            throw err;
        } finally {
            await projects.updateImport(analyzer.id, importId, { finished: true, errored });
        }
    };

    setImmediate(() => {
        projects._imports++;
        processImport()
            .catch(err => console.error(err))
            .finally(() => {
                projects._imports--;
            });
    });

    return importId;
}

async function processEmlxImport(curWin, projects, analyzer, paths) {
    let totalsize = paths.length;

    let importId = await projects.createImport(analyzer.id, {
        totalsize,
        source: {
            format: 'eml',
            filePaths: paths
        }
    });

    let processImport = async () => {
        let errored = false;
        try {
            for (let path of paths) {
                let gz = await isGz(path);

                let input = fsCreateReadStream(path);
                if (gz) {
                    // process as gz stream
                    let gunzip = zlib.createGunzip();
                    input.pipe(gunzip);
                    input.on('error', err => {
                        gunzip.emit('error', err);
                    });
                    input = gunzip;
                }

                let sourceMeta = {
                    source: {
                        format: 'eml',
                        filename: path,
                        importId
                    }
                };

                if (pathlib.extname(path).toLowerCase() === '.emlx') {
                    let { content, parser } = emlxStream(path, input);

                    content = await bufferStream(content);
                    sourceMeta.source.format = 'emlx';
                    if (parser.idate) {
                        sourceMeta.idate = parser.idate;
                    }
                    if (parser.uid) {
                        sourceMeta.source.uid = parser.uid;
                    }
                    if (parser.flags) {
                        let flags = [];
                        if (parser.flags.read) {
                            flags.push('\\Seen');
                        }
                        if (parser.flags.deleted) {
                            flags.push('\\Deleted');
                        }
                        if (parser.flags.answered) {
                            flags.push('\\Answered');
                        }
                        if (parser.flags.flagged) {
                            flags.push('\\Flagged');
                        }
                        if (parser.flags.draft) {
                            flags.push('\\Draft');
                        }
                        if (parser.flags.forwarded) {
                            flags.push('\\Forwarded');
                        }
                        if (parser.flags.junk) {
                            flags.push('$Junk');
                        }
                        if (flags.length) {
                            sourceMeta.flags = flags;
                        }
                    }
                    input = content;
                }

                let { size, duplicate } = await analyzer.import(sourceMeta, input);

                if (duplicate) {
                    continue;
                }

                // increment counters
                await projects.updateImport(analyzer.id, importId, { emails: 1, processed: 1, size });
            }
        } catch (err) {
            errored = err.message;
            throw err;
        } finally {
            await projects.updateImport(analyzer.id, importId, { finished: true, errored });
        }
    };

    setImmediate(() => {
        projects._imports++;
        processImport()
            .catch(err => console.error(err))
            .finally(() => {
                projects._imports--;
            });
    });

    return importId;
}

async function processPostfixImport(curWin, projects, analyzer, paths) {
    let totalsize = paths.length;

    let importId = await projects.createImport(analyzer.id, {
        totalsize,
        source: {
            format: 'postfix',
            filePaths: paths
        }
    });

    let processImport = async () => {
        for (let path of paths) {
            try {
                let messageData = await postfixParser(await fs.readFile(path));

                let { size, duplicate } = await analyzer.import(
                    {
                        source: {
                            format: 'postfix',
                            filename: path,
                            importId,
                            envelope: messageData.envelope
                        },
                        idate: messageData.envelope.arrivalTime,
                        returnPath: messageData.envelope.sender
                    },
                    messageData.content
                );

                if (duplicate) {
                    continue;
                }

                // increment counters
                await projects.updateImport(analyzer.id, importId, { emails: 1, processed: 1, size });
            } catch (err) {
                // ignore for a single file
                console.error(err);
            }
        }
    };

    setImmediate(() => {
        projects._imports++;
        processImport()
            .catch(err => console.error(err))
            .finally(() => {
                projects._imports--;
            });
    });

    return importId;
}

async function createImportFromMaildir(curWin, projects, analyzer) {
    let res = await dialog.showOpenDialog(curWin, {
        title: 'Select Mail Source',
        properties: ['openDirectory', 'multiSelections']
    });
    if (res.canceled) {
        return false;
    }
    if (!res.filePaths || !res.filePaths.length) {
        return false;
    }

    let folderPaths = [];
    for (let path of res.filePaths) {
        let format = await detectFormat(path);
        if (format === 'maildir') {
            folderPaths.push(path);
        }
    }

    return await processMaildirImport(curWin, projects, analyzer, folderPaths);
}

async function createImportFromFolder(curWin, projects, analyzer) {
    let res = await dialog.showOpenDialog(curWin, {
        title: 'Select Mail Source',
        properties: ['openDirectory', 'multiSelections']
    });
    if (res.canceled) {
        return false;
    }
    if (!res.filePaths || !res.filePaths.length) {
        return false;
    }

    return await processFolderImport(curWin, projects, analyzer, res.filePaths);
}

async function flushMessages(curWin, projects, analyzer) {
    return {
        flushed: await projects.flush(analyzer.id)
    };
}

async function createExportMbox(curWin, projects, analyzer, params) {
    let fileName = params.filename
        // eslint-disable-next-line no-control-regex
        .replace(/[/\\_\-?%*:|"'<>\x00-\x1F\x7F]+/g, '_')
        .replace(/\.+/, '.')
        .replace(/^[\s_.]+|[\s_.]+$|_+\s|\s_+/g, ' ');

    let res = await dialog.showSaveDialog(curWin, {
        title: 'Export emails',
        defaultPath: fileName
    });
    if (res.canceled) {
        return false;
    }

    if (res.canceled || !res.filePath) {
        return false;
    }

    let output = fsCreateWriteStream(res.filePath);

    try {
        let page = 1;
        let pageSize = 100;

        while (true) {
            let query = Object.assign(
                {
                    page,
                    pageSize
                },
                params.query || {}
            );

            let data = await analyzer.getEmails(query);
            for (let messageData of data.data) {
                let returnPath = messageData.returnPath;
                if (!returnPath && messageData.addresses.from && messageData.addresses.from.length) {
                    returnPath = messageData.addresses.from[0].address;
                }

                try {
                    await analyzer.writeEmailToMboxStream(messageData.id, output, {
                        from: returnPath,
                        date: messageData.idate || messageData.hdate
                    });
                } catch (err) {
                    console.error(err);
                    throw err;
                }
            }
            if (data.pages <= page) {
                // no more results
                break;
            } else {
                page++;
            }
        }
    } finally {
        output.end();
    }

    return false;
}

async function listProjects(curWin, projects) {
    let response = {
        data: await projects.list()
    };
    return response;
}

async function listImports(curWin, projects, analyzer) {
    let response = {
        data: await projects.listImports(analyzer.id)
    };
    return response;
}

async function listContacts(curWin, projects, analyzer, params) {
    params.pageSize = params.pageSize || PAGE_SIZE;
    return await analyzer.getContacts(params);
}

async function listAttachments(curWin, projects, analyzer, params) {
    params.pageSize = params.pageSize || PAGE_SIZE;
    return await analyzer.getAttachments(params);
}

async function listEmails(curWin, projects, analyzer, params) {
    params.pageSize = params.pageSize || PAGE_SIZE;
    return await analyzer.getEmails(params);
}

async function searchContacts(curWin, projects, analyzer, params) {
    let result = await prompt(
        {
            title: 'Contact search',
            label: 'Contact name or address',
            query: {
                value: params.term || ''
            }
        },
        curWin
    );

    let term = ((result && result.value) || '').toString().trim();
    return term;
}

async function serverConfig(curWin, projects, analyzer) {
    return preferences(curWin, projects, analyzer, { tab: 'server' });
}

async function getPreferences(curWin, projects) {
    return await projects.getPreferences();
}

async function preferences(curWin, projects, analyzer, params) {
    let prefs = await projects.getPreferences();
    let query = {};
    Object.keys(prefs).forEach(key => {
        if (prefs[key] && typeof prefs[key] === 'object') {
            Object.keys(prefs[key]).forEach(subKey => {
                query[key.replace(/[A-Z]/g, c => '-' + c.toLowerCase()) + ':' + subKey.replace(/[A-Z]/g, c => '-' + c.toLowerCase())] = prefs[key][subKey];
            });
        } else {
            query[key.replace(/[A-Z]/g, c => '-' + c.toLowerCase())] = prefs[key];
        }
    });

    let response = await prompt(
        {
            title: 'Preferences',

            label: false,
            query,

            selectOptions: {
                'server:default-project': [{ value: 0, title: '–– Not set ––' }].concat(
                    (await projects.list()).map(pr => ({ value: pr.id, title: pr.name, group: 'Existing Projects:' }))
                ),
                'catchall:project': [{ value: 0, title: '–– Not set ––' }].concat(
                    (await projects.list()).map(pr => ({ value: pr.id, title: pr.name, group: 'Existing Projects:' }))
                )
            },

            values: {
                'active-tab': (params && params.tab) || 'general'
            },

            pagename: 'preferences',

            width: 450,
            height: 360
        },
        curWin
    );

    if (!response) {
        return;
    }

    let updates = {};
    Object.keys(response || {}).forEach(key => {
        let ckey = key.replace(/-([a-z])/g, (o, c) => c.toUpperCase());
        let value = response[key];
        if (ckey.includes(':')) {
            let keyParts = ckey.split(':');
            ckey = keyParts.shift();
            let subKey = keyParts.join(':');
            if (!updates[ckey]) {
                updates[ckey] = {};
            }

            switch (typeof prefs[ckey][subKey]) {
                case 'number':
                    value = Number(value) || 0;
                    break;
                case 'boolean':
                    value = !!value;
                    break;
            }
            updates[ckey][subKey] = value;
        } else {
            switch (typeof prefs[ckey]) {
                case 'number':
                    value = Number(value) || 0;
                    break;
                case 'boolean':
                    value = !!value;
                    break;
            }

            updates[ckey] = value;
        }
    });

    await projects.setPreferences(updates);
}

async function serverLogs(curWin, projects, analyzer, params) {
    return await projects.server.logger.read(analyzer.id, params.proto, params.maxLines);
}

async function serverStart(curWin, projects) {
    await projects.server.start();
}

async function serverStop(curWin, projects) {
    await projects.server.stop();
}

async function serverStatus(curWin, projects) {
    return {
        running: projects.server.running,
        config: await projects.server.getConfig()
    };
}

async function progress(curWin, projects, analyzer, params) {
    if (typeof params.progress === 'number') {
        curWin.setProgressBar(params.progress);
    } else {
        curWin.setProgressBar(-1);
    }
}

async function searchAttachments(curWin, projects, analyzer, params) {
    return await prompt(
        {
            title: 'Attachment search',

            label: false,
            query: params || {},

            pagename: 'attachments',

            width: 600,
            height: 400
        },
        curWin
    );
}

async function searchEmails(curWin, projects, analyzer, params) {
    return await prompt(
        {
            title: 'Email search',

            label: false,
            query: params || {},

            pagename: 'emails',

            width: 600,
            height: 400
        },
        curWin
    );
}

async function createProject(curWin, projects) {
    let result = await prompt(
        {
            title: 'Project name',
            label: 'Project name',
            query: {
                value: 'Mailbox Takeout'
            }
        },
        curWin
    );

    let name = ((result && result.value) || '').toString().trim();
    if (name) {
        let project = await projects.create(name);
        return project;
    }

    return false;
}

async function renameProject(curWin, projects, analyzer, params) {
    let result = await prompt(
        {
            title: 'Project name',
            label: 'Project name',
            query: {
                value: params.name
            }
        },
        curWin
    );

    let name = ((result && result.value) || '').toString().trim();
    if (name) {
        return await projects.rename(params.id, name);
    }

    return false;
}

async function deleteProject(curWin, projects, analyzer, params) {
    params = params || {};
    return {
        deleted: await projects.delete(params.id)
    };
}

async function openProject(curWin, projects, analyzer, params) {
    await projects.openWindow(Number(params.id));
    return true;
}

async function saveAttachment(curWin, projects, analyzer, params) {
    let fileName = params.filename
        // eslint-disable-next-line no-control-regex
        .replace(/[/\\_\-?%*:|"'<>\x00-\x1F\x7F]+/g, '_')
        .replace(/\.+/, '.')
        .replace(/^[\s_.]+|[\s_.]+$|_+\s|\s_+/g, ' ');

    let res = await dialog.showSaveDialog(curWin, {
        title: 'Save attachment',
        defaultPath: fileName
    });
    if (res.canceled) {
        return false;
    }
    if (res.canceled || !res.filePath) {
        return false;
    }

    if (['html', 'plain', 'x-amp-html'].includes(params.attachment)) {
        return await analyzer.saveText(params.email, params.attachment, res.filePath);
    }

    await analyzer.saveFile(params.attachment, res.filePath);
}

async function openAttachment(curWin, projects, analyzer, params) {
    let fileName = params.filename
        // eslint-disable-next-line no-control-regex
        .replace(/[/\\_\-?%*:|"'<>\x00-\x1F\x7F]+/g, '_')
        .replace(/\.+/, '.')
        .replace(/^[\s_.]+|[\s_.]+$|_+\s|\s_+/g, ' ');
    let filePath = pathlib.join(app.getPath('temp'), fileName);

    await analyzer.saveFile(params.attachment, filePath);
    await shell.openExternal('file://' + filePath);
}

async function getAttachment(curWin, projects, analyzer, params) {
    return await analyzer.getAttachmentBufferByCid(params.email, params.cid);
}

async function emailSource(curWin, projects, analyzer, params) {
    return ((await analyzer.getMessageBuffer(params.id)) || false).toString();
}

async function saveEmail(curWin, projects, analyzer, params) {
    let fileName = params.filename
        // eslint-disable-next-line no-control-regex
        .replace(/[/\\_\-?%*:|"'<>\x00-\x1F\x7F]+/g, '_')
        .replace(/\.+/, '.')
        .replace(/^[\s_.]+|[\s_.]+$|_+\s|\s_+/g, ' ');

    let res = await dialog.showSaveDialog(curWin, {
        title: 'Save email',
        defaultPath: fileName
    });
    if (res.canceled) {
        return false;
    }
    if (res.canceled || !res.filePath) {
        return false;
    }

    await analyzer.saveEmail(params.email, res.filePath);
}

async function showViewSource(curWin, projects, analyzer, params) {
    return viewSource(params.email, curWin, projects, analyzer);
}

async function uploadEmail(curWin, projects, analyzer, params) {
    return upload(params.email, curWin, projects, analyzer);
}

async function createPdf(curWin, projects, analyzer, params) {
    let fileName = params.filename
        // eslint-disable-next-line no-control-regex
        .replace(/[/\\_\-?%*:|"'<>\x00-\x1F\x7F]+/g, '_')
        .replace(/\.+/, '.')
        .replace(/^[\s_.]+|[\s_.]+$|_+\s|\s_+/g, ' ');

    let res = await dialog.showSaveDialog(curWin, {
        title: 'Export pdf',
        defaultPath: fileName
    });
    if (res.canceled) {
        return false;
    }
    if (res.canceled || !res.filePath) {
        return false;
    }

    const windowToPDF = new BrowserWindow({
        show: false,
        webPreferences: {
            javascript: false
        }
    });
    let html = params.html;

    await windowToPDF.loadURL('data:text/html;charset=UTF-8;base64,' + Buffer.from(html).toString('base64'), {});

    const data = await windowToPDF.webContents.printToPDF({
        landscape: false,
        marginsType: 0,
        printBackground: false,
        printSelectionOnly: false,
        pageSize: 'A4'
    });

    await fs.writeFile(res.filePath, data);
}

async function updateMenu(curWin, projects, analyzer, params, menu) {
    [].concat(params.id || []).forEach(id => {
        let item = menu.getMenuItemById(id);
        if (item) {
            item.enabled = params.enabled;
        }
    });
}

async function selfInfo(curWin, projects, analyzer) {
    let sendmail = process.argv[0].replace(/\\NodemailerApp.exe$/i, '\\resources\\sendmail.exe'); /*.replace(/MacOS\/NodemailerApp$/i, 'Resources/sendmail') */

    return {
        id: analyzer.id,
        cmdPath: process.argv[0],
        sendmail
    };
}

async function uploadOpts(curWin, projects, analyzer, params) {
    if (!analyzer) {
        return false;
    }
    let emailData = await analyzer.getEmail(params.id, true);
    return emailData;
}

async function runUploadEmail(curWin, projects, analyzer, params) {
    return uploader(curWin, projects, analyzer, params);
}

async function setupCatchall(curWin, projects) {
    return await projects.setupCatchall();
}

async function getTags(curWin, projects, analyzer) {
    let list = await analyzer.getProjectTags();
    return list;
}

async function updateTags(curWin, projects, analyzer, params) {
    let { tagChanges } = await analyzer.setEmailTags(params.email, params.tags);
    if (tagChanges) {
        projects.sendToProjectWindows(analyzer.id, 'tagchange', {
            id: analyzer.id,
            tagChanges
        });
    }
    return true;
}

async function getEmailTags(curWin, projects, analyzer, params) {
    let list = await analyzer.getEmailTags(params.email);
    return list;
}

async function showItemInFolder(curWin, projects, analyzer, params) {
    try {
        await fs.stat(params.filename);
    } catch (err) {
        if (err.code === 'ENOENT') {
            return false;
        }
        throw err;
    }
    shell.showItemInFolder(params.filename);
    return true;
}

module.exports = async (curWin, projects, analyzer, data, menu) => {
    switch (data.command) {
        case 'listProjects':
            return await listProjects(curWin, projects, analyzer, data.params);

        case 'createProject':
            return await createProject(curWin, projects, analyzer, data.params);

        case 'deleteProject':
            return await deleteProject(curWin, projects, analyzer, data.params);

        case 'renameProject':
            return await renameProject(curWin, projects, analyzer, data.params);

        case 'openProject':
            return await openProject(curWin, projects, analyzer, data.params);

        case 'createImportFromMaildir':
            return await createImportFromMaildir(curWin, projects, analyzer, data.params);

        case 'createImportFromFolder':
            return await createImportFromFolder(curWin, projects, analyzer, data.params);

        case 'createImport':
            return await createImport(curWin, projects, analyzer, data.params);

        case 'createExportMbox':
            return await createExportMbox(curWin, projects, analyzer, data.params);

        case 'flushMessages':
            return await flushMessages(curWin, projects, analyzer, data.params);

        case 'listImports':
            return await listImports(curWin, projects, analyzer, data.params);

        case 'listContacts':
            return await listContacts(curWin, projects, analyzer, data.params);

        case 'listAttachments':
            return await listAttachments(curWin, projects, analyzer, data.params);

        case 'listEmails':
            return await listEmails(curWin, projects, analyzer, data.params);

        case 'searchContacts':
            return await searchContacts(curWin, projects, analyzer, data.params);

        case 'searchAttachments':
            return await searchAttachments(curWin, projects, analyzer, data.params);

        case 'searchEmails':
            return await searchEmails(curWin, projects, analyzer, data.params);

        case 'saveAttachment':
            return await saveAttachment(curWin, projects, analyzer, data.params);

        case 'openAttachment':
            return await openAttachment(curWin, projects, analyzer, data.params);

        case 'getAttachment':
            return await getAttachment(curWin, projects, analyzer, data.params);

        case 'saveEmail':
            return await saveEmail(curWin, projects, analyzer, data.params);

        case 'uploadEmail':
            return await uploadEmail(curWin, projects, analyzer, data.params);

        case 'createPdf':
            return await createPdf(curWin, projects, analyzer, data.params);

        case 'updateMenu':
            return await updateMenu(curWin, projects, analyzer, data.params, menu);

        case 'serverConfig':
            return await serverConfig(curWin, projects, analyzer, data.params);

        case 'preferences':
            return await preferences(curWin, projects, analyzer, data.params);

        case 'getPreferences':
            return await getPreferences(curWin, projects, analyzer, data.params);

        case 'serverStart':
            return await serverStart(curWin, projects, analyzer, data.params);

        case 'serverStop':
            return await serverStop(curWin, projects, analyzer, data.params);

        case 'serverStatus':
            return await serverStatus(curWin, projects, analyzer, data.params);

        case 'serverLogs':
            return await serverLogs(curWin, projects, analyzer, data.params);

        case 'selfInfo':
            return await selfInfo(curWin, projects, analyzer, data.params);

        case 'uploadOpts':
            return await uploadOpts(curWin, projects, analyzer, data.params);

        case 'closeWindow':
            if (curWin) {
                curWin.close();
            }
            return;

        case 'runUploadEmail':
            return await runUploadEmail(curWin, projects, analyzer, data.params);

        case 'emailSource':
            return await emailSource(curWin, projects, analyzer, data.params);

        case 'showViewSource':
            return await showViewSource(curWin, projects, analyzer, data.params);

        case 'progress':
            return await progress(curWin, projects, analyzer, data.params);

        case 'setupCatchall':
            return await setupCatchall(curWin, projects, analyzer, data.params);

        case 'getTags':
            return await getTags(curWin, projects, analyzer, data.params);

        case 'updateTags':
            return await updateTags(curWin, projects, analyzer, data.params);

        case 'getEmailTags':
            return await getEmailTags(curWin, projects, analyzer, data.params);

        case 'showItemInFolder':
            return await showItemInFolder(curWin, projects, analyzer, data.params);

        default:
            throw new Error('Unknown command ' + JSON.stringify(data));
    }
};
