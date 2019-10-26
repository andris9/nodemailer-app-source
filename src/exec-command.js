'use strict';

const prompt = require('./prompt/prompt');

async function listProjects(curWin, projects) {
    let response = {
        data: await projects.list()
    };
    console.log(response.data);
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

        case 'openDevTools':
            curWin.webContents.openDevTools();
            return true;

        default:
            throw new Error('Unknown command');
    }
};
