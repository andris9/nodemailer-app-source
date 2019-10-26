'use strict';

const fs = require('fs').promises;
const fsCreateReadStream = require('fs').createReadStream;
const { dialog } = require('electron');
const prompt = require('./prompt/prompt');
const pathlib = require('path');
const { eachMessage } = require('mbox-reader');

async function createImportFromFile(curWin, projects, analyzer) {
    let res = await dialog.showOpenDialog(curWin, {
        title: 'Select Mail Source',
        properties: ['openFile']
    });
    if (res.canceled) {
        return false;
    }
    if (!res.filePaths || !res.filePaths.length) {
        return false;
    }

    for (let path of res.filePaths) {
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
            for (let filename of res.filePaths) {
                let input = fsCreateReadStream(filename);
                let lastSize = 0;
                for await (let message of eachMessage(input)) {
                    await analyzer.import(
                        {
                            source: {
                                filename,
                                importId
                            },
                            idate: message.time,
                            returnPath: message.returnPath
                        },
                        message.content
                    );

                    // increment counters
                    let sizeDiff = message.readSize - lastSize;
                    lastSize = message.readSize;
                    await projects.updateImport(analyzer, importId, { emails: 1, processed: sizeDiff });
                }
            }
        } catch (err) {
            errored = err.message;
            throw err;
        } finally {
            await projects.updateImport(analyzer, importId, { finished: true, errored });
            projects.windowRef.delete(analyzer);
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

async function listImports(curWin, projects) {
    let response = {
        data: await projects.listImports()
    };
    return response;
}

async function createProject(curWin, projects, analyzer, params) {
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
        if (params && params.open) {
            await projects.openWindow(project);
        }
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

module.exports = async (curWin, projects, analyzer, data) => {
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

        case 'createImportFromFile':
            return await createImportFromFile(curWin, projects, analyzer, data.params);

        case 'listImports':
            return await listImports(curWin, projects, analyzer, data.params);

        case 'openDevTools':
            curWin.webContents.openDevTools();
            return true;

        default:
            throw new Error('Unknown command');
    }
};
