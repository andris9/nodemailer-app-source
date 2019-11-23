'use strict';

const { BrowserWindow } = require('electron');
const url = require('url');
const pathlib = require('path');

module.exports = async id => {
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

    const pageUrl = url.format({
        protocol: 'file',
        slashes: true,
        pathname: pathlib.join(__dirname, 'page', 'upload.html'),
        hash: id.toString()
    });

    uploadWindow.loadURL(pageUrl);
};
