'use strict';

const { Menu } = require('electron');
const SMTPServer = require('smtp-server').SMTPServer;

const DEFAULT_SMTP_PORT = 1025;
const DEFAULT_POP3_PORT = 1110;

class Server {
    constructor(options) {
        this.options = options || {};

        this.running = false;
        this._stopping = false;
        this._starting = false;

        this.sql = this.options.sql;
        this.projects = this.options.projects;

        this.smtpServer = false;
        this.pop3Server = false;
    }

    async init() {
        let serverConfig = await this.getConfig();
        if (serverConfig.autostart) {
            await this.start();
        } else {
            this.setStopped();
        }
    }

    async setStarted() {
        let menu = Menu.getApplicationMenu();
        if (menu) {
            let menuStartItem = menu.getMenuItemById('server-start');
            if (menuStartItem) {
                menuStartItem.enabled = false;
            }

            let menuStopItem = menu.getMenuItemById('server-stop');
            if (menuStopItem) {
                menuStopItem.enabled = true;
            }
        }

        this.projects.mainWindow.webContents.send(
            'server-start',
            JSON.stringify({
                id: 'server-start'
            })
        );

        for (let id of this.projects.projectWindows.keys()) {
            for (let win of this.projects.projectWindows.get(id)) {
                try {
                    win.webContents.send(
                        'server-start',
                        JSON.stringify({
                            id: 'server-start'
                        })
                    );
                } catch (err) {
                    console.error(err);
                }
            }
        }

        this._starting = false;
        this.running = true;
    }

    async setStopped() {
        let menu = Menu.getApplicationMenu();
        if (menu) {
            let menuStartItem = menu.getMenuItemById('server-start');
            if (menuStartItem) {
                menuStartItem.enabled = true;
            }

            let menuStopItem = menu.getMenuItemById('server-stop');
            if (menuStopItem) {
                menuStopItem.enabled = false;
            }
        }

        this.projects.mainWindow.webContents.send(
            'server-stop',
            JSON.stringify({
                id: 'server-stop'
            })
        );

        for (let id of this.projects.projectWindows.keys()) {
            for (let win of this.projects.projectWindows.get(id)) {
                try {
                    win.webContents.send(
                        'server-stop',
                        JSON.stringify({
                            id: 'server-stop'
                        })
                    );
                } catch (err) {
                    console.error(err);
                }
            }
        }

        this._stopping = false;
        this.running = false;
    }

    async start() {
        if (this._stopping) {
            return false;
        }

        if (this._starting || this.running) {
            return true;
        }

        this._starting = true;

        let serverConfig = await this.getConfig();
        try {
            await this.startSmtp(serverConfig);
        } catch (err) {
            this.setStopped();
            return false;
        }

        try {
            await this.startPop3(serverConfig);
        } catch (err) {
            await this.stopSmtp();
            this.setStopped();
            return false;
        }

        this.setStarted();
    }

    async stop() {
        if (this._starting) {
            return false;
        }

        if (this._stopping || !this.running) {
            return true;
        }

        this._stopping = true;

        await this.stopSmtp();
        await this.stopPop3();

        this.setStopped();
    }

    async startSmtp(serverConfig) {
        if (this.smtpServer) {
            return false;
        }

        this.smtpServer = new SMTPServer({
            secure: false,
            disabledCommands: ['STARTTLS'],
            allowInsecureAuth: true,
            banner: 'Forensicat SMTP',
            logger: true
        });

        return new Promise((resolve, reject) => {
            this.smtpServer.on('error', err => {
                console.error(err);
                reject(err);
            });

            this.smtpServer.listen(serverConfig.smtpPort, '127.0.0.1', () => {
                resolve();
            });
        });
    }

    async startPop3(serverConfig) {
        if (this.pop3Server) {
            return false;
        }

        // TODO: start actual POP3 server
        return false;
    }

    async stopSmtp() {
        if (!this.smtpServer) {
            return;
        }

        return new Promise(resolve => {
            this.smtpServer.close(() => {
                this.smtpServer = false;
                resolve();
            });
        });
    }

    async stopPop3() {
        if (!this.pop3Server) {
            return;
        }

        return new Promise(resolve => {
            this.pop3Server.close(() => {
                this.pop3Server = false;
                resolve();
            });
        });
    }

    async getConfig() {
        let row;
        let serverConfig = {};

        row = await this.sql.findOne('SELECT [value] FROM [appmeta] WHERE [key] = ?', ['server_smtp_port']);
        serverConfig.smtpPort = Number(row && row.value) || DEFAULT_SMTP_PORT;

        row = await this.sql.findOne('SELECT [value] FROM [appmeta] WHERE [key] = ?', ['server_pop3_port']);
        serverConfig.pop3Port = Number(row && row.value) || DEFAULT_POP3_PORT;

        row = await this.sql.findOne('SELECT [value] FROM [appmeta] WHERE [key] = ?', ['server_autostart']);
        serverConfig.autostart = Number(row && row.value) ? true : false;

        return serverConfig;
    }

    async setConfig(serverConfig) {
        serverConfig = serverConfig || {};
        for (let key of Object.keys(serverConfig)) {
            let lkey = 'server_' + key.replace(/[A-Z]/g, c => '_' + c.toLowerCase());

            let value = serverConfig[key];
            if (typeof value === 'boolean') {
                value = value ? '1' : null;
            }

            await this.sql.run(`INSERT INTO appmeta ([key], [value]) VALUES ($key, $value) ON CONFLICT([key]) DO UPDATE SET [value] = $value`, {
                $key: lkey,
                $value: value
            });
        }
    }
}

module.exports = Server;
