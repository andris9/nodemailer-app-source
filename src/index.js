'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
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
        width: 300,
        height: 400,
        'min-width': 300,
        'min-height': 200,
        'accept-first-mouse': true,

        webPreferences: {
            nodeIntegration: true
        }
    });

    const windowUrl = urllib.format({
        protocol: 'file',
        slashes: true,
        pathname: pathlib.join(__dirname, 'page', 'index.html')
    });

    // and load the index.html of the app.
    mainWindow.loadURL(windowUrl);

    // Open the DevTools.
    //mainWindow.webContents.openDevTools();

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
        projects.close().finally(() => false);
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
