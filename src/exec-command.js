/* eslint no-constant-condition: 0 */

'use strict';

const fs = require('fs').promises;
const fsCreateReadStream = require('fs').createReadStream;
const fsCreateWriteStream = require('fs').createWriteStream;
const { app, dialog, shell, BrowserWindow } = require('electron');
const prompt = require('./prompt/prompt');
const postfixParser = require('./postfix/parser');
const detectFormat = require('./detect-format/detect-format');
const pathlib = require('path');
const { eachMessage } = require('mbox-reader');
const MaildirScan = require('maildir-scan');
const util = require('util');
const recursiveReaddir = require('recursive-readdir');
const zlib = require('zlib');

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
                            flags: messageData.flags && messageData.flags.size ? Array.from(messageData.flags) : null,
                            labels: messageData.labels && messageData.labels.size ? Array.from(messageData.labels) : null
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

async function processFolderImport(curWin, projects, analyzer, folderPaths) {
    let paths = [];
    for (let path of folderPaths) {
        try {
            let list = await recursiveReaddir(path, [
                (file, stats) => {
                    if (stats.isDirectory() || ['.eml', '.eml.gz'].includes(pathlib.extname(file).toLowerCase())) {
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
    return await analyzer.getContacts(params);
}

async function listAttachments(curWin, projects, analyzer, params) {
    return await analyzer.getAttachments(params);
}

async function listEmails(curWin, projects, analyzer, params) {
    return await analyzer.getEmails(params);
}

async function searchContacts(curWin, projects, analyzer, params) {
    let term = await prompt(
        {
            title: 'Contact search',
            label: 'Contact search',
            value: params.term || '',
            inputAttrs: {
                type: 'text'
            },
            type: 'input'
        },
        curWin
    );

    term = (term || '').toString().trim();
    return term;
}

async function searchAttachments(curWin, projects, analyzer, params) {
    let term = await prompt(
        {
            title: 'Attachment search',

            label: false,
            value: params.term || '',

            inputAttrs: {
                type: 'text'
            },
            type: 'input',

            pagename: 'attachments',

            width: 600,
            height: 400
        },
        curWin
    );

    term = (term || '').toString().trim();
    return term;
}

async function createProject(curWin, projects) {
    let name = await prompt(
        {
            title: 'Project name',
            label: 'Project name',
            value: 'My Gmail takout',
            inputAttrs: {
                type: 'text'
            },
            type: 'input'
        },
        curWin
    );

    name = (name || '').toString().trim();
    if (name) {
        let project = await projects.create(name);
        return project;
    }

    return false;
}

async function renameProject(curWin, projects, analyzer, params) {
    let name = await prompt(
        {
            title: 'Project name',
            label: 'Project name',
            value: params.name,
            inputAttrs: {
                type: 'text'
            },
            type: 'input'
        },
        curWin
    );

    name = (name || '').toString().trim();

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

        case 'saveAttachment':
            return await saveAttachment(curWin, projects, analyzer, data.params);

        case 'openAttachment':
            return await openAttachment(curWin, projects, analyzer, data.params);

        case 'getAttachment':
            return await getAttachment(curWin, projects, analyzer, data.params);

        case 'saveEmail':
            return await saveEmail(curWin, projects, analyzer, data.params);

        case 'createPdf':
            return await createPdf(curWin, projects, analyzer, data.params);

        case 'updateMenu':
            return await updateMenu(curWin, projects, analyzer, data.params, menu);

        default:
            throw new Error('Unknown command ' + JSON.stringify(data));
    }
};
