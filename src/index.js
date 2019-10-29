'use strict';
const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const execCommand = require('./exec-command');
const Projects = require('./projects/projects');
const urllib = require('url');
const pathlib = require('path');

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
        }
    });
    projects.mainWindow = mainWindow;

    const windowUrl = urllib.format({
        protocol: 'file',
        slashes: true,
        pathname: pathlib.join(__dirname, 'page', 'index.html')
    });

    // and load the index.html of the app.
    mainWindow.loadURL(windowUrl);

    // Open the DevTools.
    //mainWindow.webContents.openDevTools();

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

    execCommand(curWin, projects, analyzer, payload.data)
        .then(data => {
            let responsePayload = {
                cid: payload.cid,
                data
            };
            event.reply('cmdres', JSON.stringify(responsePayload));
        })
        .catch(err => {
            console.error(err);
            let responsePayload = {
                cid: payload.cid,
                error: err.message
            };
            event.reply('cmdres', JSON.stringify(responsePayload));
        });
});

function prepare(next) {
    if (projects) {
        return next();
    }
    projects = new Projects({
        appDataPath: app.getPath('userData')
    });

    projects
        .prepare()
        .then(next)
        .catch(err => {
            console.error(err);
            app.quit();
        });
}

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
        submenu: [
            {
                label: 'New Project...',
                click: async () => {
                    mainWindow.webContents.focus();
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
                }
            },
            isMac ? { role: 'close' } : { role: 'quit' }
        ]
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
    // { role: 'viewMenu' }
    {
        label: 'View',
        submenu: [
            { role: 'reload' },
            { role: 'forcereload' },
            { role: 'toggledevtools' },
            { type: 'separator' },
            { role: 'resetzoom' },
            { role: 'zoomin' },
            { role: 'zoomout' },
            { type: 'separator' },
            { role: 'togglefullscreen' }
        ]
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
                    await shell.openExternal('https://electronjs.org');
                }
            }
        ]
    }
];

const menu = Menu.buildFromTemplate(template);
Menu.setApplicationMenu(menu);
