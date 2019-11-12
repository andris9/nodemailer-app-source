'use strict';
const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const execCommand = require('./exec-command');
const Projects = require('./projects/projects');
const urllib = require('url');
const pathlib = require('path');
const crypto = require('crypto');

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
// eslint-disable-next-line global-require
if (require('electron-squirrel-startup')) {
    app.quit();
}

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let mainWindow;
let projects;

const createWindow = () => {
    // Create the browser window.
    mainWindow = new BrowserWindow({
        width: 400,
        height: 500,
        'min-width': 300,
        'min-height': 200,
        'accept-first-mouse': true,

        webPreferences: {
            nodeIntegration: true
        },

        icon: pathlib.join(__dirname, 'icons/png/64x64.png')
    });
    projects.mainWindow = mainWindow;

    const windowUrl = urllib.format({
        protocol: 'file',
        slashes: true,
        pathname: pathlib.join(__dirname, 'page', 'index.html')
    });

    // and load the index.html of the app.
    mainWindow.loadURL(windowUrl);

    mainWindow.on('close', e => {
        if (projects._imports) {
            let choice = dialog.showMessageBoxSync(mainWindow, {
                type: 'question',
                buttons: ['Yes', 'No'],
                title: 'Confirm',
                message: 'You have active imports. Are you sure you want to quit?'
            });
            if (choice === 1) {
                e.preventDefault();
            }
        }
    });

    // Emitted when the window is closed.
    mainWindow.on('closed', () => {
        // Dereference the window object, usually you would store windows
        // in an array if your app supports multi windows, this is the time
        // when you should delete the corresponding element.
        mainWindow = null;
        app.quit();
    });

    mainWindow.on('blur', () => {
        mainWindow.webContents.send(
            'focus-change',
            JSON.stringify({
                id: 'static',
                type: 'blur'
            })
        );
    });

    mainWindow.on('focus', () => {
        mainWindow.webContents.send(
            'focus-change',
            JSON.stringify({
                id: 'static',
                type: 'focus'
            })
        );
    });
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', () => prepare(createWindow));

// Quit when all windows are closed.
app.on('window-all-closed', () => {
    app.quit();
});

app.on('activate', () => {
    // On OS X it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (mainWindow === null) {
        prepare(createWindow);
    }
});

app.on('will-quit', () => {
    if (projects) {
        projects
            .close()
            .catch(() => false)
            .finally(() => false);
    }
});

const newProjectMenuItem = {
    id: 'new-project',
    label: 'New Project…',
    click: async () => {
        mainWindow.webContents.focus();
        try {
            let project = await execCommand(mainWindow, projects, false, {
                command: 'createProject',
                params: {
                    name: ''
                }
            });

            if (project) {
                await execCommand(mainWindow, projects, false, {
                    command: 'openProject',
                    params: {
                        id: project
                    }
                });
            }
        } catch (err) {
            dialog.showMessageBox(mainWindow, {
                title: 'Error',
                buttons: ['Dismiss'],
                type: 'warning',
                message: 'Failed to process command\n' + err.message
            });
        }
    }
};

const renameProjectMenuItem = {
    id: 'rename-project',
    label: 'Rename Project',
    enabled: false,
    click: () => {
        let focused = BrowserWindow.getFocusedWindow();
        focused &&
            focused.webContents.send(
                'menu-click',
                JSON.stringify({
                    id: 'static',
                    type: 'rename-project'
                })
            );
    }
};

const deleteProjectMenuItem = {
    id: 'delete-project',
    label: 'Delete Project',
    enabled: false,
    click: () => {
        let focused = BrowserWindow.getFocusedWindow();
        focused &&
            focused.webContents.send(
                'menu-click',
                JSON.stringify({
                    id: 'static',
                    type: 'delete-project'
                })
            );
    }
};

const importMenuItem = {
    id: 'import-files',
    label: 'From email files…',
    enabled: false,
    click: () => {
        let focused = BrowserWindow.getFocusedWindow();
        focused &&
            focused.webContents.send(
                'menu-click',
                JSON.stringify({
                    id: 'static',
                    type: 'import-create'
                })
            );
    }
};

const importFromMaildirMenuItem = {
    id: 'import-maildir',
    label: 'From Maildir…',
    enabled: false,
    click: () => {
        let focused = BrowserWindow.getFocusedWindow();
        focused &&
            focused.webContents.send(
                'menu-click',
                JSON.stringify({
                    id: 'static',
                    type: 'import-maildir'
                })
            );
    }
};

const importFromFolderMenuItem = {
    id: 'import-folder',
    label: 'Scan folder recursively for *.eml files…',
    enabled: false,
    click: () => {
        let focused = BrowserWindow.getFocusedWindow();
        focused &&
            focused.webContents.send(
                'menu-click',
                JSON.stringify({
                    id: 'static',
                    type: 'import-folder'
                })
            );
    }
};

const exportMenuItem = {
    id: 'export-mbox',
    label: 'Export active listing as Mbox…',
    enabled: false,
    click: () => {
        let focused = BrowserWindow.getFocusedWindow();
        focused &&
            focused.webContents.send(
                'menu-click',
                JSON.stringify({
                    id: 'static',
                    type: 'export-mbox'
                })
            );
    }
};

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.

const isMac = process.platform === 'darwin';
const template = [
    // { role: 'appMenu' }
    ...(isMac
        ? [
              {
                  label: app.name,
                  submenu: [
                      { role: 'about' },
                      { type: 'separator' },
                      { role: 'services' },
                      { type: 'separator' },
                      { role: 'hide' },
                      { role: 'hideothers' },
                      { role: 'unhide' },
                      { type: 'separator' },
                      { role: 'quit' }
                  ]
              }
          ]
        : []),
    // { role: 'fileMenu' }
    {
        label: 'File',
        submenu: [newProjectMenuItem, renameProjectMenuItem, deleteProjectMenuItem, isMac ? { role: 'close' } : { role: 'quit' }]
    },
    // { role: 'editMenu' }
    {
        label: 'Edit',
        submenu: [
            { role: 'undo' },
            { role: 'redo' },
            { type: 'separator' },
            { role: 'cut' },
            { role: 'copy' },
            { role: 'paste' },
            ...(isMac
                ? [
                      { role: 'pasteAndMatchStyle' },
                      { role: 'delete' },
                      { role: 'selectAll' },
                      { type: 'separator' },
                      {
                          label: 'Speech',
                          submenu: [{ role: 'startspeaking' }, { role: 'stopspeaking' }]
                      }
                  ]
                : [{ role: 'delete' }, { type: 'separator' }, { role: 'selectAll' }])
        ]
    },
    {
        label: 'Import',
        submenu: [importMenuItem, importFromMaildirMenuItem, importFromFolderMenuItem]
    },
    {
        label: 'Export',
        submenu: [exportMenuItem]
    },
    // { role: 'viewMenu' }
    {
        label: 'View',
        submenu: [{ role: 'toggledevtools' }, { type: 'separator' }, { type: 'separator' }, { role: 'togglefullscreen' }]
    },
    // { role: 'windowMenu' }
    {
        label: 'Window',
        submenu: [
            { role: 'minimize' },
            { role: 'zoom' },
            ...(isMac ? [{ type: 'separator' }, { role: 'front' }, { type: 'separator' }, { role: 'window' }] : [{ role: 'close' }])
        ]
    },
    {
        role: 'help',
        submenu: [
            {
                label: 'Learn More',
                click: async () => {
                    await shell.openExternal('https://forensicat.com');
                }
            }
        ]
    }
];

const menu = Menu.buildFromTemplate(template);
Menu.setApplicationMenu(menu);

ipcMain.on('cmdreq', (event, arg) => {
    let payload;
    try {
        payload = JSON.parse(arg);
    } catch (err) {
        console.error(err);
        return;
    }
    if (!payload || !payload.cid) {
        return;
    }

    let curWin = event.sender.getOwnerBrowserWindow();
    let analyzer = projects.getProjectAnalyzer(curWin.id);

    execCommand(curWin, projects, analyzer, payload.data, menu)
        .then(data => {
            let responsePayload = {
                cid: payload.cid,
                data
            };
            event.reply('cmdres', JSON.stringify(responsePayload));
        })
        .catch(err => {
            let responsePayload = {
                cid: payload.cid,
                error: err.message
            };

            dialog.showMessageBox(curWin, {
                title: 'Error',
                buttons: ['Dismiss'],
                type: 'error',
                message: 'Failed to process request.\n' + err.message
            });

            event.reply('cmdres', JSON.stringify(responsePayload));
        });
});

let cs = crypto.randomBytes(8).toString('hex');
let tbci = 0;
let thumbnailQueue = new Map();
async function thumbnailGenerator(src, width, height) {
    return new Promise((resolve, reject) => {
        let cid = `${cs}:${++tbci}`;
        let time = Date.now();
        thumbnailQueue.set(cid, { resolve, reject, time });

        mainWindow.webContents.send(
            'resize',
            JSON.stringify({
                cid,
                src,
                width,
                height
            })
        );
    });
}

ipcMain.on('resizeres', (event, arg) => {
    let payload;
    try {
        payload = JSON.parse(arg);
    } catch (err) {
        console.error(err);
        return;
    }
    if (!payload || !payload.cid) {
        console.error('no cid for image resize response');
        return;
    }

    let handler = thumbnailQueue.get(payload.cid);
    thumbnailQueue.delete(payload.cid);
    if (payload.error) {
        console.error('Failed to resize image', payload.cid);
        return handler.reject(new Error(payload.error));
    }
    handler.resolve(payload.src);
});

ipcMain.on('navigate', (event, url) => {
    let curWin = event.sender.getOwnerBrowserWindow();
    curWin.close();
    shell.openExternal(url).catch(err => console.error(err));
});

function prepare(next) {
    if (projects) {
        return next();
    }

    projects = new Projects({
        appDataPath: app.getPath('userData'),
        thumbnailGenerator
    });

    projects
        .prepare()
        .then(next)
        .catch(err => {
            console.error(err);
            app.quit();
        });
}
