// Forked from https://github.com/p-sam/electron-prompt
// Licensed under MIT by p-sam

'use strict';

const electron = require('electron');

const BrowserWindow = electron.BrowserWindow || electron.remote.BrowserWindow;
const ipcMain = electron.ipcMain || electron.remote.ipcMain;
const url = require('url');
const pathlib = require('path');

const DEFAULT_WIDTH = 370;
const DEFAULT_HEIGHT = 160;

function electronPrompt(options, parentWindow) {
    return new Promise((resolve, reject) => {
        const id = `${new Date().getTime()}-${Math.random()}`;

        const opts = Object.assign(
            {
                width: DEFAULT_WIDTH,
                height: DEFAULT_HEIGHT,
                minWidth: DEFAULT_WIDTH,
                minHeight: DEFAULT_HEIGHT,
                resizable: false,
                title: 'Prompt',
                label: 'Please input a value:',
                alwaysOnTop: false,
                value: null,
                type: 'input',
                selectOptions: null,
                icon: null,
                useHtmlLabel: false,
                customStylesheet: null,
                menuBarVisible: false
            },
            options || {}
        );

        if (opts.type === 'select' && (opts.selectOptions === null || typeof opts.selectOptions !== 'object')) {
            return reject(new Error('"selectOptions" must be an object'));
        }

        const pagename = opts.pagename || 'prompt';

        let promptWindow = new BrowserWindow({
            width: opts.width,
            height: opts.height,
            minWidth: opts.minWidth,
            minHeight: opts.minHeight,

            resizable: opts.resizable,
            parent: parentWindow,
            skipTaskbar: true,
            alwaysOnTop: opts.alwaysOnTop,
            useContentSize: opts.resizable,
            modal: Boolean(parentWindow),
            title: opts.title,

            webPreferences: {
                nodeIntegration: true
            }
        });

        promptWindow.removeMenu();
        promptWindow.setMenu(null);
        promptWindow.setMenuBarVisibility(false);

        const getOptionsListener = event => {
            event.returnValue = JSON.stringify(opts);
        };

        const cleanup = () => {
            if (promptWindow) {
                promptWindow.close();
                promptWindow = null;
            }
        };

        const postDataListener = (event, value) => {
            resolve(value);
            event.returnValue = null;
            cleanup();
        };

        const unresponsiveListener = () => {
            reject(new Error('Window was unresponsive'));
            cleanup();
        };

        const errorListener = (event, message) => {
            reject(new Error(message));
            event.returnValue = null;
            cleanup();
        };

        ipcMain.on('prompt-get-options:' + id, getOptionsListener);
        ipcMain.on('prompt-post-data:' + id, postDataListener);
        ipcMain.on('prompt-error:' + id, errorListener);

        promptWindow.on('unresponsive', unresponsiveListener);

        promptWindow.on('closed', () => {
            ipcMain.removeListener('prompt-get-options:' + id, getOptionsListener);
            ipcMain.removeListener('prompt-post-data:' + id, postDataListener);
            ipcMain.removeListener('prompt-error:' + id, postDataListener);
            resolve(null);
        });

        const promptUrl = url.format({
            protocol: 'file',
            slashes: true,
            pathname: pathlib.join(__dirname, 'page', pagename + '.html'),
            hash: id
        });

        promptWindow.loadURL(promptUrl);
    });
}

module.exports = electronPrompt;
