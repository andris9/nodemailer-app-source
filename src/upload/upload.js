'use strict';

const { BrowserWindow } = require('electron');
const url = require('url');
const pathlib = require('path');

module.exports = async (id, curWin, projects, analyzer) => {
    let uploadWindow = new BrowserWindow({
        width: 840,
        height: 520,

        resizable: true,
        //parent: curWin,
        skipTaskbar: true,
        //modal: true,
        title: 'Upload',

        webPreferences: {
            nodeIntegration: true
        }
    });

    uploadWindow.removeMenu();
    uploadWindow.setMenu(null);
    uploadWindow.setMenuBarVisibility(false);

    // store window reference
    let windowId = uploadWindow.id;
    projects.projectRef.set(windowId, analyzer.id);

    // add to project windows list to receive project specific updates
    if (!projects.projectWindows.has(id)) {
        projects.projectWindows.set(id, new Set());
    }
    projects.projectWindows.get(id).add(uploadWindow);

    uploadWindow.on('closed', () => {
        projects.projectRef.delete(windowId);
        projects.projectWindows.get(id).delete(uploadWindow);
        uploadWindow = null;
    });

    const pageUrl = url.format({
        protocol: 'file',
        slashes: true,
        pathname: pathlib.join(__dirname, 'page', 'upload.html'),
        hash: id.toString()
    });

    uploadWindow.loadURL(pageUrl);
};
