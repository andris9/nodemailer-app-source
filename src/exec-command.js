'use strict';

const fs = require('fs').promises;
const fsCreateReadStream = require('fs').createReadStream;
const { app, dialog, shell, BrowserWindow } = require('electron');
const prompt = require('./prompt/prompt');
const postfixParser = require('./postfix/parser');
const pathlib = require('path');
const { eachMessage } = require('mbox-reader');
const MaildirScan = require('maildir-scan');
const util = require('util');
const recursiveReaddir = require('recursive-readdir');
const zlib = require('zlib');

async function createImportFromMbox(curWin, projects, analyzer, params) {
    let res;
    if (params && params.filePaths) {
        res = {
            filePaths: params.filePaths,
            canceled: false
        };
    } else {
        res = await dialog.showOpenDialog(curWin, {
            title: 'Select Mail Source',
            properties: ['openFile', 'multiSelections']
        });
    }
    if (res.canceled) {
        return false;
    }
    if (!res.filePaths || !res.filePaths.length) {
        return false;
    }

    for (let path of res.filePaths) {
        if (pathlib.parse(path).ext.toLowerCase() === '.gz') {
            // skip format validation
            continue;
        }
        let buffer = Buffer.alloc(5);
        try {
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
        } catch (err) {
            console.error(err);
            throw new Error(`Failed to process file "${pathlib.basename(path)}"`);
        }
        if (buffer.toString() !== 'From ') {
            throw new Error(`"${pathlib.basename(path)}" does not seem to be a MBOX file`);
        }
    }

    let totalsize = 0;
    for (let filename of res.filePaths) {
        totalsize += (await fs.stat(filename)).size;
    }

    let importId = await projects.createImport(analyzer.id, {
        totalsize,
        source: {
            format: 'mbox',
            filePaths: res.filePaths
        }
    });

    let processImport = async () => {
        let errored = false;
        try {
            for (let path of res.filePaths) {
                let input = fsCreateReadStream(path);

                if (pathlib.parse(path).ext.toLowerCase() === '.gz') {
                    // process as gz stream
                    let gz = zlib.createGunzip();
                    input.pipe(gz);
                    input.on('error', err => {
                        gz.emit('error', err);
                    });
                    input = gz;
                }

                let lastSize = 0;
                for await (let messageData of eachMessage(input)) {
                    let { size } = await analyzer.import(
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

    let scanner = new MaildirScan();
    let scan = util.promisify(scanner.scan.bind(scanner));

    let paths = [];
    let messages = [];
    for (let path of res.filePaths) {
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
            filePaths: res.filePaths
        }
    });

    let processImport = async () => {
        let errored = false;
        try {
            for (let messageData of messages) {
                let input = fsCreateReadStream(messageData.fullpath);

                if (pathlib.parse(messageData.fullpath).ext.toLowerCase() === '.gz') {
                    // process as gz stream
                    let gz = zlib.createGunzip();
                    input.pipe(gz);
                    input.on('error', err => {
                        gz.emit('error', err);
                    });
                    input = gz;
                }

                let { size } = await analyzer.import(
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

    let paths = [];
    for (let path of res.filePaths) {
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
            filePaths: res.filePaths
        }
    });

    let processImport = async () => {
        let errored = false;
        try {
            for (let path of paths) {
                let input = fsCreateReadStream(path);

                if (pathlib.parse(path).ext.toLowerCase() === '.gz') {
                    // process as gz stream
                    let gz = zlib.createGunzip();
                    input.pipe(gz);
                    input.on('error', err => {
                        gz.emit('error', err);
                    });
                    input = gz;
                }

                let { size } = await analyzer.import(
                    {
                        source: {
                            format: 'eml',
                            filename: path,
                            importId
                        }
                    },
                    input
                );

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

async function createImportFromEml(curWin, projects, analyzer) {
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

    let paths = res.filePaths;
    let totalsize = paths.length;

    let importId = await projects.createImport(analyzer.id, {
        totalsize,
        source: {
            format: 'eml',
            filePaths: res.filePaths
        }
    });

    let processImport = async () => {
        let errored = false;
        try {
            for (let path of paths) {
                let input = fsCreateReadStream(path);

                if (pathlib.parse(path).ext.toLowerCase() === '.gz') {
                    // process as gz stream
                    let gz = zlib.createGunzip();
                    input.pipe(gz);
                    input.on('error', err => {
                        gz.emit('error', err);
                    });
                    input = gz;
                }

                let { size } = await analyzer.import(
                    {
                        source: {
                            format: 'eml',
                            filename: path,
                            importId
                        }
                    },
                    input
                );

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

async function createImportFromPostfix(curWin, projects, analyzer) {
    let res = await dialog.showOpenDialog(curWin, {
        title: 'Select Postfix queue files',
        properties: ['openFile', 'multiSelections']
    });
    if (res.canceled) {
        return false;
    }
    if (!res.filePaths || !res.filePaths.length) {
        return false;
    }

    let paths = res.filePaths;
    let totalsize = paths.length;

    let importId = await projects.createImport(analyzer.id, {
        totalsize,
        source: {
            format: 'postfix',
            filePaths: res.filePaths
        }
    });

    let processImport = async () => {
        for (let path of paths) {
            try {
                let messageData = await postfixParser(await fs.readFile(path));

                let { size } = await analyzer.import(
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

    await analyzer.saveEmail(params.attachment, res.filePath);
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

        case 'createImportFromMbox':
            return await createImportFromMbox(curWin, projects, analyzer, data.params);

        case 'createImportFromMaildir':
            return await createImportFromMaildir(curWin, projects, analyzer, data.params);

        case 'createImportFromFolder':
            return await createImportFromFolder(curWin, projects, analyzer, data.params);

        case 'createImportFromEml':
            return await createImportFromEml(curWin, projects, analyzer, data.params);

        case 'createImportFromPostfix':
            return await createImportFromPostfix(curWin, projects, analyzer, data.params);

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
