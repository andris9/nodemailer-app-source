'use strict';

const DEFAULT_SMTP_PORT = 1025;
const DEFAULT_POP3_PORT = 1110;

class Server {
    constructor(options) {
        this.options = options || {};

        this.sql = this.options.sql;
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
