'use strict';

const { Menu, dialog } = require('electron');
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
            'server-status',
            JSON.stringify({
                id: 'server-start',
                running: true,
                config: await this.getConfig()
            })
        );

        for (let id of this.projects.projectWindows.keys()) {
            for (let win of this.projects.projectWindows.get(id)) {
                try {
                    win.webContents.send(
                        'server-status',
                        JSON.stringify({
                            id: 'server-start',
                            running: true,
                            config: await this.getConfig()
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
            'server-status',
            JSON.stringify({
                id: 'server-stop',
                running: false,
                config: await this.getConfig()
            })
        );

        for (let id of this.projects.projectWindows.keys()) {
            for (let win of this.projects.projectWindows.get(id)) {
                try {
                    win.webContents.send(
                        'server-status',
                        JSON.stringify({
                            id: 'server-stop',
                            running: false,
                            config: await this.getConfig()
                        })
                    );
                } catch (err) {
                    console.error(err);
                }
            }
        }

        this._starting = false;
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
        try {
            await this.startSmtpWrapped(serverConfig);
        } catch (err) {
            dialog.showMessageBox(this.projects.mainWindow, {
                title: 'Error',
                buttons: ['Dismiss'],
                type: 'error',
                message: 'Failed to start SMTP server\n' + err.message
            });
            throw err;
        }
    }

    async startSmtpWrapped(serverConfig) {
        if (this.smtpServer) {
            return false;
        }

        this.smtpServer = new SMTPServer({
            secure: false,
            disabledCommands: ['STARTTLS'],
            allowInsecureAuth: true,
            banner: 'Forensicat SMTP',
            logger: true,

            onAuth: (auth, session, callback) => {
                let projectId = Number(auth.username.replace(/[^0-9]/g, ''));
                if (!projectId) {
                    return callback(new Error('Invalid username or password'));
                }

                this.projects
                    .open(projectId)
                    .then(analyzer => {
                        if (!analyzer) {
                            return callback(new Error('Invalid username or password'));
                        }
                        callback(null, { user: projectId });
                    })
                    .catch(err => callback(err));
            },
            onData: (stream, session, callback) => {
                let chunks = [];
                let chunklen = 0;
                stream.on('readable', () => {
                    let chunk;
                    while ((chunk = stream.read()) !== null) {
                        chunks.push(chunk);
                        chunklen += chunk.length;
                    }
                });
                stream.on('end', () => {
                    let message = Buffer.concat(chunks, chunklen);

                    let handler = async () => {
                        let analyzer = await this.projects.open(session.user);

                        if (!analyzer) {
                            throw new Error('Project not found');
                        }

                        let res = await analyzer.import(
                            {
                                source: {
                                    format: 'smtp',
                                    envelope: session.envelope
                                },
                                idate: new Date(),
                                returnPath: session.envelope.mailFrom
                            },
                            message
                        );

                        if (res && res.id) {
                            await this.projects.updateImport(analyzer.id, null, { emails: 1, processed: 0, size: res.size });

                            if (this.projects.projectWindows.has(session.user)) {
                                for (let win of this.projects.projectWindows.get(session.user)) {
                                    try {
                                        win.webContents.send(
                                            'message-received',
                                            JSON.stringify({
                                                id: res.id,
                                                size: res.size
                                            })
                                        );
                                    } catch (err) {
                                        console.error(err);
                                    }
                                }
                            }

                            return res.id;
                        }

                        return false;
                    };

                    handler()
                        .then(id => {
                            callback(null, 'Message imported as ' + id);
                        })
                        .catch(callback);
                });
            }
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
        try {
            await this.startPop3Wrapped(serverConfig);
        } catch (err) {
            dialog.showMessageBox(this.projects.mainWindow, {
                title: 'Error',
                buttons: ['Dismiss'],
                type: 'error',
                message: 'Failed to start POP3 server\n' + err.message
            });
            throw err;
        }
    }

    async startPop3Wrapped(serverConfig) {
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
        let oldConfig = await this.getConfig();

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

        this.projects.mainWindow.webContents.send(
            'server-status',
            JSON.stringify({
                id: 'server-config',
                running: this.running,
                config: serverConfig
            })
        );

        for (let id of this.projects.projectWindows.keys()) {
            for (let win of this.projects.projectWindows.get(id)) {
                try {
                    win.webContents.send(
                        'server-status',
                        JSON.stringify({
                            id: 'server-config',
                            running: this.running,
                            config: serverConfig
                        })
                    );
                } catch (err) {
                    console.error(err);
                }
            }
        }

        if (!this.running) {
            return;
        }

        if (oldConfig.smtpPort !== serverConfig.smtpPort) {
            // restart server
            try {
                await this.stopSmtp();
                await this.startSmtp(serverConfig);
            } catch (err) {
                console.error(err);
                try {
                    await this.stopSmtp();
                } catch (err) {
                    // ignore
                }
                try {
                    await this.stopPop3();
                } catch (err) {
                    // ignore
                }
                this.setStopped();
            }
        }

        if (oldConfig.pop3Port !== serverConfig.pop3Port) {
            // restart server
            try {
                await this.stopPop3();
                await this.startPop3(serverConfig);
            } catch (err) {
                console.error(err);
                try {
                    await this.stopSmtp();
                } catch (err) {
                    // ignore
                }
                try {
                    await this.stopPop3();
                } catch (err) {
                    // ignore
                }
                this.setStopped();
            }
        }
    }
}

module.exports = Server;
