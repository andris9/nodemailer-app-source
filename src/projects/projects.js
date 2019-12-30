'use strict';

const SQL = require('../sql/sql');
const urllib = require('url');
const pathlib = require('path');
const uuidv4 = require('uuid/v4');
const util = require('util');
const mkdirp = util.promisify(require('mkdirp'));
const rimraf = util.promisify(require('rimraf'));
const fs = require('fs').promises;
const fsCreateReadStream = require('fs').createReadStream;
const Analyzer = require('../analyzer/lib/analyzer.js');
const chokidar = require('chokidar');
const EventSource = require('eventsource');
const crypto = require('crypto');
const fetch = require('node-fetch');
const stringToColor = require('string-to-color');
const packageData = require('../meta.json');

const Server = require('../server/server.js');

const { BrowserWindow, Menu } = require('electron');

const MAIN_VERSION = 1;

const MAIN_UPDATES = [
    // update to 1
    ['ALTER TABLE [imports] ADD [updated] DATETIME']
];

class Projects {
    constructor(options) {
        this.options = options || {};
        this.appDataPath = this.options.appDataPath;

        this.opened = new Map();
        this.projectRef = new Map();

        this._imports = 0;

        this.prepareQueue = [];
        this.prepared = false;
        this.preparing = false;

        this.mainWindow = options.mainWindow;

        this.projectWindows = new Map();
        this.windows = new Set();

        this.sqlPath = pathlib.join(this.appDataPath, 'forensicat.db');

        this.sendmailPaths = {
            data: pathlib.join(this.appDataPath, 'maildrop', 'data'),
            queue: pathlib.join(this.appDataPath, 'maildrop', 'queue'),
            tmp: pathlib.join(this.appDataPath, 'maildrop', 'tmp')
        };

        this.thumbnailGenerator = options.thumbnailGenerator;

        this.importQueue = [];
        this.importing = false;

        this.server = false;
    }

    async applyUpdates(version) {
        version = Number(version) || 1;
        if (!MAIN_UPDATES[version - 1]) {
            return;
        }
        for (let update of MAIN_UPDATES[version - 1]) {
            if (!update) {
                continue;
            }
            try {
                console.log(`Running update (${version}): "${update}"`);
                await this.sql.run(update);
            } catch (err) {
                console.error(err);
            }
        }
        await this.sql.run(`INSERT INTO appmeta ([key], [value]) VALUES ($key, $value) ON CONFLICT([key]) DO UPDATE SET [value] = $value`, {
            $key: 'version',
            $value: version
        });
    }

    async prepare() {
        if (this.prepared) {
            return false;
        }

        if (this.preparing) {
            let resolver = new Promise((resolve, reject) => {
                this.prepareQueue.push({ resolve, reject });
            });
            return resolver;
        }
        this.preparing = true;

        try {
            await mkdirp(this.sendmailPaths.data);
            await mkdirp(this.sendmailPaths.queue);
            await mkdirp(this.sendmailPaths.tmp);
        } catch (err) {
            // ignore?
        }

        try {
            await mkdirp(this.appDataPath);
            this.sql = new SQL({ db: this.sqlPath });

            await this.sql.run(`PRAGMA journal_mode=WAL`);

            let tableEmailsExistsRow = await this.sql.findOne(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`, ['projects']);
            let isNew = !tableEmailsExistsRow;

            await this.sql.run(`CREATE TABLE IF NOT EXISTS appmeta (
                [key] TEXT PRIMARY KEY,
                [value] TEXT
            );`);

            await this.sql.run(`CREATE TABLE IF NOT EXISTS projects (
                [id] INTEGER PRIMARY KEY,
                [version] INTEGER,
                [created] DATETIME,
                [emails] INTEGER DEFAULT 0,
                [size] INTEGER DEFAULT 0,
                [name] TEXT,
                [folder_name] TEXT
            );`);

            await this.sql.run(`CREATE TABLE IF NOT EXISTS imports (
                [id] INTEGER PRIMARY KEY,
                [project] INTEGER,
                [created] DATETIME,
                [finished] DATETIME,
                [updated] DATETIME,
                [errored] TEXT,
                [source] TEXT,
                [emails] INTEGER DEFAULT 0,
                [size] INTEGER DEFAULT 0,
                [processed] INTEGER DEFAULT 0,
                [totalsize] INTEGER DEFAULT 0,

                FOREIGN KEY ([project])
                    REFERENCES projects ([id]) ON DELETE CASCADE
            );`);

            await this.sql.run(`CREATE INDEX IF NOT EXISTS [project_created] ON projects (
                [created]
            )`);

            await this.sql.run(`CREATE INDEX IF NOT EXISTS [project_name] ON projects (
                [name]
            )`);

            await this.sql.run(`CREATE INDEX IF NOT EXISTS [import_created] ON imports (
                [created]
            )`);

            await this.sql.run(`CREATE INDEX IF NOT EXISTS [import_finished] ON imports (
                [finished]
            )`);

            if (isNew) {
                // make sure we have correct version number setting set
                try {
                    await this.sql.run(`INSERT INTO appmeta ([key], [value]) VALUES ($key, $value)`, {
                        $key: 'version',
                        $value: MAIN_VERSION
                    });
                } catch (err) {
                    // ignore
                }
            } else {
                // handle migrations
                let row = await this.sql.findOne('SELECT [value] FROM [appmeta] WHERE [key] = ?', ['version']);
                let storedVersion = Number(row && row.value) || 0;

                for (let i = storedVersion + 1; i <= MAIN_VERSION; i++) {
                    await this.applyUpdates(i);
                }
            }

            await this.sql.run(`UPDATE [imports] SET finished=$finished, errored=$errored WHERE finished IS NULL`, {
                $errored: 'Unfinished import',
                $finished: formatDate(new Date())
            });

            // make sure we have a instance specific ID set
            let row = await this.sql.findOne('SELECT [value] FROM [appmeta] WHERE [key] = ?', ['fid']);
            this.fid = row && row.value;
            if (!this.fid) {
                this.fid = uuidv4();
                try {
                    await this.sql.run(`INSERT INTO appmeta ([key], [value]) VALUES ($key, $value)`, {
                        $key: 'fid',
                        $value: this.fid
                    });
                } catch (err) {
                    // ignore
                }
            }

            await this.sql.run(`PRAGMA foreign_keys=ON`);
            await this.sql.run(`PRAGMA case_sensitive_like=OFF`);
        } catch (err) {
            console.error(err);

            this.preparing = false;
            this.prepared = true;

            while (this.prepareQueue.length) {
                let promise = this.prepareQueue.shift();
                promise.reject(err);
            }

            throw err;
        } finally {
            this.preparing = false;
            this.prepared = true;

            this.server = new Server({
                sql: this.sql,
                projects: this
            });

            try {
                chokidar.watch(this.sendmailPaths.queue).on('add', path => this.pushToImportQueue(path));
            } catch (err) {
                console.error(err);
                // ignore?
            }

            while (this.prepareQueue.length) {
                let promise = this.prepareQueue.shift();
                promise.resolve();
            }

            setTimeout(() => {
                this.checkCatchall().catch(err => console.error(err));
            }, 5000);
        }
    }

    pushToImportQueue(path) {
        this.importQueue.push(path);
        this.processImport().catch(err => console.error(err));
    }

    async processImport() {
        if (this.importing) {
            return false;
        }
        this.importing = true;

        while (this.importQueue.length) {
            let path = this.importQueue.shift();
            try {
                await this.importNext(path);
            } catch (err) {
                console.error(`Failed to import ${path}`);
                console.error(err);
            }
        }

        this.importing = false;
    }

    async handleFile(event, path) {
        let dataPath = pathlib.join(this.sendmailPaths.data, pathlib.parse(path).base);
        let paths = [];

        try {
            let queueStats = await fs.stat(path);
            if (queueStats.isFile()) {
                paths.push(path);
            }

            let dataStats = await fs.stat(dataPath);
            if (dataStats.isFile()) {
                paths.push(dataPath);
            }
        } catch (err) {
            console.error(err);
        }

        try {
            if (paths.length !== 2) {
                return false;
            }
            let meta = JSON.parse(await fs.readFile(path, 'utf-8'));
            let basename = pathlib.parse(dataPath).base;
            let message = await this.importFromMaildrop(meta, dataPath);
            if (message) {
                console.log(`Imported ${basename} from maildrop to ${meta.project} as ${message}`);
            } else {
                console.log(`Failed to import ${basename}`);
            }
        } catch (err) {
            console.error(err);
        } finally {
            for (let uPath of paths) {
                // delete queue entry
                try {
                    await fs.unlink(uPath);
                } catch (err) {
                    // ignore
                    console.error(err);
                }
            }
        }
    }

    async importNext(path) {
        await this.handleFile('add', path);
    }

    async importFromMaildrop(meta, path) {
        let analyzer = await this.open(meta.project);

        if (!analyzer) {
            throw new Error('Project not found');
        }

        let res = await analyzer.import(
            {
                source: {
                    format: 'maildrop',
                    argv: meta.argv,
                    envelope: meta.envelope
                },
                idate: new Date(),
                returnPath: meta.envelope.mailFrom
            },
            fsCreateReadStream(path)
        );

        if (res && res.id) {
            await this.updateImport(analyzer.id, null, { emails: 1, processed: 0, size: res.size });
            this.sendToProjectWindows(analyzer.id, 'message-received', {
                id: res.id,
                size: res.size
            });
            return res.id;
        }
    }

    async list() {
        await this.prepare();
        let list = await this.sql.findMany(
            'SELECT [id], [name], [version], [emails], [size], folder_name AS folderName, created FROM [projects] ORDER BY name ASC'
        );
        if (!list) {
            return false;
        }

        return list.map(item => {
            return {
                id: item.id,
                name: item.name,
                color: stringToColor({ id: item.id, folder: item.folderName }),
                folderName: item.folderName,
                emails: item.emails,
                size: item.size,
                created: new Date(item.created + 'Z').toISOString()
            };
        });
    }

    async rename(id, name) {
        id = Number(id);
        if (!id || id < 0) {
            return false;
        }
        name = (name || '').toString().trim();
        if (!name) {
            return false;
        }
        let query = 'UPDATE projects SET name = $name WHERE id=$id';
        let queryParams = {
            $name: name,
            $id: id
        };

        return await this.sql.run(query, queryParams);
    }

    async create(name) {
        name = (name || '').toString().trim();

        let folderName =
            name
                // eslint-disable-next-line no-control-regex
                .replace(/[/\\_\-?%*:|"'<>.\x00-\x1F\x7F]+/g, '_')
                .replace(/^[\s_]+|[\s_]+$|_+\s|\s_+/g, ' ')
                .trim() || 'Project';
        let fc = 0;
        let match;

        while (fc < 10000) {
            let folderNameSuffix = !fc ? folderName : folderName + '-' + fc;
            fc++;
            let fullPath = pathlib.join(this.appDataPath, folderNameSuffix);
            try {
                await fs.stat(fullPath);
            } catch (err) {
                if (err.code === 'ENOENT') {
                    folderName = folderNameSuffix;
                    match = true;
                } else {
                    console.error(err);
                }
            }
            if (match) {
                break;
            }
        }
        if (!match) {
            throw new Error('Could not create folder');
        }

        let analyzer = new Analyzer({
            projectName: name, //'testikas_1571740887371'
            appDataPath: this.appDataPath,
            folderName,
            thumbnailGenerator: this.thumbnailGenerator,
            fid: this.fid
        });

        await analyzer.prepare();
        await analyzer.close();

        let query = 'INSERT INTO projects ([name], [created], [folder_name]) VALUES ($name, $created, $folder_name)';
        let queryParams = {
            $name: name,
            $folder_name: folderName,
            $created: formatDate(new Date())
        };

        let id = await this.sql.run(query, queryParams);

        this.mainWindow.webContents.send(
            'project-created',
            JSON.stringify({
                id
            })
        );

        return id;
    }

    async get(id) {
        let row = await this.sql.findOne('SELECT [id], [name], [version], folder_name AS folderName, created FROM [projects] WHERE id = ?', [id]);
        if (!row || !row.id) {
            return false;
        }
        return row;
    }

    async getPreferences() {
        let row;
        let preferences = {};

        row = await this.sql.findOne('SELECT [value] FROM [appmeta] WHERE [key] = ?', ['prefs_general_json']);
        try {
            preferences.generalJson = (row && row.value && JSON.parse(row.value)) || {};
        } catch (err) {
            preferences.generalJson = {};
        }
        preferences.generalJson.disableRemote = !!preferences.generalJson.disableRemote;
        preferences.generalJson.disableAmp = !!preferences.generalJson.disableAmp;

        row = await this.sql.findOne('SELECT [value] FROM [appmeta] WHERE [key] = ?', ['prefs_smtp_json']);
        try {
            preferences.smtpJson = (row && row.value && JSON.parse(row.value)) || {};
        } catch (err) {
            preferences.smtpJson = {};
        }
        preferences.smtpJson.hostname = preferences.smtpJson.hostname || 'localhost';
        preferences.smtpJson.port = preferences.smtpJson.port || (preferences.smtpJson.secure ? 465 : 587);
        preferences.smtpJson.security = preferences.smtpJson.security || 'starttls';
        preferences.smtpJson.user = preferences.smtpJson.user || '';
        preferences.smtpJson.pass = preferences.smtpJson.pass || '';

        row = await this.sql.findOne('SELECT [value] FROM [appmeta] WHERE [key] = ?', ['prefs_imap_json']);
        try {
            preferences.imapJson = (row && row.value && JSON.parse(row.value)) || {};
        } catch (err) {
            preferences.imapJson = {};
        }
        preferences.imapJson.hostname = preferences.imapJson.hostname || 'localhost';
        preferences.imapJson.port = preferences.imapJson.port || (preferences.imapJson.secure ? 993 : 143);
        preferences.imapJson.security = preferences.imapJson.security || 'starttls';
        preferences.imapJson.user = preferences.imapJson.user || '';
        preferences.imapJson.pass = preferences.imapJson.pass || '';

        preferences.server = await this.server.getConfig();
        preferences.catchall = await this.getCatchallConfig();

        return preferences;
    }

    async setPreferences(preferences) {
        preferences = preferences || {};
        for (let key of Object.keys(preferences)) {
            if (key === 'server') {
                await this.server.setConfig(preferences[key]);
                continue;
            }

            if (key === 'catchall') {
                await this.setCatchallConfig(preferences[key]);
                continue;
            }

            let lkey = 'prefs_' + key.replace(/[A-Z]/g, c => '_' + c.toLowerCase());

            let value = preferences[key];

            if (/Json$/.test(key)) {
                value = JSON.stringify(value);
            } else if (typeof value === 'boolean') {
                value = value ? '1' : null;
            }

            await this.sql.run(`INSERT INTO appmeta ([key], [value]) VALUES ($key, $value) ON CONFLICT([key]) DO UPDATE SET [value] = $value`, {
                $key: lkey,
                $value: value
            });
        }

        this.mainWindow.webContents.send(
            'preferences',
            JSON.stringify({
                id: 'preferences',
                config: preferences
            })
        );

        for (let id of this.projectWindows.keys()) {
            for (let win of this.projectWindows.get(id)) {
                try {
                    win.webContents.send(
                        'preferences',
                        JSON.stringify({
                            id: 'preferences',
                            config: preferences
                        })
                    );
                } catch (err) {
                    console.error(err);
                }
            }
        }
    }

    async getCatchallConfig() {
        let catchallConfig = {
            enabled: !!(await this.getPreference('catchall', 'enabled')),
            domain: ((await this.getPreference('catchall', 'domain')) || '').toString(),
            account: ((await this.getPreference('catchall', 'account')) || '').toString(),
            secret: ((await this.getPreference('catchall', 'secret')) || '').toString(),
            project: Number(await this.getPreference('catchall', 'project')) || 0,
            lastEventId: ((await this.getPreference('catchall', 'lastEventId')) || '').toString()
        };

        return catchallConfig;
    }

    async setCatchallConfig(catchallConfig, skipEnableCheck) {
        let oldCatchallEnabled = !!(await this.getPreference('catchall', 'enabled'));
        for (let key of Object.keys(catchallConfig)) {
            let lkey = 'catchall_' + key.replace(/[A-Z]/g, c => '_' + c.toLowerCase());

            let value = catchallConfig[key];
            if (typeof value === 'boolean') {
                value = value ? '1' : null;
            }

            await this.sql.run(`INSERT INTO appmeta ([key], [value]) VALUES ($key, $value) ON CONFLICT([key]) DO UPDATE SET [value] = $value`, {
                $key: lkey,
                $value: value
            });
        }

        if (!skipEnableCheck && !oldCatchallEnabled && catchallConfig.enabled) {
            await this.enableCatchall();
        } else if (!catchallConfig.enabled && this.es) {
            try {
                this.es.close();
                this.es = null;
            } catch (err) {
                console.error(err);
            }
        }
    }

    async setPreference(prefix, key, value) {
        if (typeof value === 'boolean') {
            value = value ? '1' : null;
        }
        let lkey = `${prefix}_` + key.replace(/[A-Z]/g, c => '_' + c.toLowerCase());
        await this.sql.run(`INSERT INTO appmeta ([key], [value]) VALUES ($key, $value) ON CONFLICT([key]) DO UPDATE SET [value] = $value`, {
            $key: lkey,
            $value: value
        });
    }

    async getPreference(prefix, key) {
        let lkey = `${prefix}_` + key.replace(/[A-Z]/g, c => '_' + c.toLowerCase());
        let row = await this.sql.findOne('SELECT [value] FROM [appmeta] WHERE [key] = ?', [lkey]);
        let value = row && row.value;
        return value;
    }

    async checkCatchall() {
        let catchallEnabled = !!(await this.getPreference('catchall', 'enabled'));
        if (!catchallEnabled) {
            return;
        }
        await this.enableCatchall();
    }

    async setupCatchall() {
        let catchallConfig = await this.getCatchallConfig();
        if (!catchallConfig.account || !catchallConfig.secret) {
            // try to get an account
            let secret = [0, 0].map(() => parseInt(crypto.randomBytes(7).toString('hex'), 16).toString(36)).join('');
            let body = {
                secret,
                client: {
                    name: packageData.name,
                    version: packageData.version,
                    platform: process.platform
                }
            };
            let info = await fetch('https://catchall.delivery/api/account', {
                method: 'post',
                body: JSON.stringify(body),
                headers: {
                    'Content-Type': 'application/json',
                    'X-Client': `${packageData.name} (${packageData.version} ${process.platform})`
                }
            }).then(res => res.json());
            if (!info.account || !info.domain) {
                throw new Error('Failed to acquire catchall address');
            }

            catchallConfig.account = info.account;
            catchallConfig.domain = info.domain;
            catchallConfig.secret = secret;

            await this.setCatchallConfig(catchallConfig, true);
        }
        return catchallConfig;
    }

    async enableCatchall() {
        let catchallConfig = await this.setupCatchall();

        if (!catchallConfig.enabled) {
            catchallConfig.enabled = true;
            await this.setCatchallConfig(catchallConfig, true);
        }

        let headers = {
            'X-Secret': catchallConfig.secret,
            'X-Client': `${packageData.name} (${packageData.version} ${process.platform})`
        };

        if (catchallConfig.lastEventId) {
            headers['Last-Event-ID'] = catchallConfig.lastEventId;
        }

        if (this.es) {
            try {
                this.es.close();
                this.es = null;
            } catch (err) {
                console.error(err);
            }
        }

        this.es = new EventSource(`https://catchall.delivery/api/account/${catchallConfig.account}/feed`, {
            headers
        });

        this.es.on('error', err => {
            console.error(err);
            if (err.status === 401) {
                this.clearEventSource().catch(err => console.error(err));
                return;
            }
        });

        this.es.on('email', ev => {
            this.receiveEmail(ev).catch(err => console.error(err));
        });
    }

    async clearEventSource() {
        // invalid or expired credentials, reset catchall config
        let catchallConfig = {
            enabled: false,
            account: '',
            secret: '',
            domain: '',
            lastEventId: ''
        };
        await this.setCatchallConfig(catchallConfig, true);
        if (this.es) {
            try {
                this.es.close();
            } catch (err) {
                // ignore
            }
            this.es = null;
        }
    }

    async receiveEmail(ev) {
        let catchallConfig = await this.setupCatchall();

        if (ev.lastEventId) {
            await this.setPreference('catchall', 'lastEventId', ev.lastEventId);
        }

        let data;
        try {
            data = JSON.parse(ev.data);
        } catch (err) {
            console.error(err);
            return;
        }

        if (!data.email || !catchallConfig.project) {
            return;
        }

        let res = await fetch(`https://catchall.delivery/api/account/${catchallConfig.account}/email/${data.email}`, {
            method: 'get',
            headers: {
                'X-Secret': catchallConfig.secret,
                'X-Client': `${packageData.name} (${packageData.version} ${process.platform})`
            }
        });

        if (res.status === 401) {
            this.clearEventSource().catch(err => console.error(err));
            return;
        }

        let target = 1;
        let analyzer = await this.open(catchallConfig.project);

        if (!analyzer) {
            console.error(new Error(`Project not found: ${target}`));
            await this.setCatchallConfig({ enabled: false });
            await this.clearEventSource();
            return;
        }

        let content = await res.buffer();

        let importResponse = await analyzer.import(
            {
                source: {
                    format: 'catchall',
                    envelope: {
                        mailFrom: data.from,
                        rcptTo: [data.to]
                    }
                },
                idate: new Date(data.created),
                returnPath: data.from
            },
            content,
            true
        );

        if (importResponse && importResponse.id) {
            await this.updateImport(analyzer.id, null, { emails: 1, processed: 0, size: importResponse.size });
            this.sendToProjectWindows(analyzer.id, 'message-received', {
                id: importResponse.id,
                size: importResponse.size
            });
            return importResponse.id;
        }
    }

    async open(id) {
        if (this.opened.has(id)) {
            let analyzer = this.opened.get(id);
            await analyzer.prepare();

            return analyzer;
        }

        let row = await this.sql.findOne('SELECT [id], [name], [version], folder_name AS folderName, created FROM [projects] WHERE id = ?', [id]);
        if (!row || !row.id) {
            return false;
        }

        let analyzer = new Analyzer({
            projectName: row.name, //'testikas_1571740887371'
            appDataPath: this.appDataPath,
            folderName: row.folderName,
            thumbnailGenerator: this.thumbnailGenerator,
            project: row.id,
            fid: this.fid
        });

        analyzer.id = id;

        this.opened.set(id, analyzer);
        await analyzer.prepare();

        return analyzer;
    }

    async delete(id) {
        let analyzer = this.opened.get(id);
        if (analyzer) {
            this.opened.delete(id);
            try {
                await analyzer.close();
            } catch (err) {
                // ignore
            }
        }
        let row = await this.sql.findOne('SELECT [id], [name], [version], folder_name AS folderName, created FROM [projects] WHERE id = ?', [id]);
        if (!row || !row.id) {
            return false;
        }

        // close all project windows
        if (this.projectWindows.has(id)) {
            for (let win of this.projectWindows.get(id)) {
                try {
                    this.windows.delete(win);
                    this.projectWindows.get(id).delete(win);
                    this.projectRef.delete(win.id);
                    win.close();
                } catch (err) {
                    // ignore
                }
            }
        }

        let path = pathlib.join(this.appDataPath, row.folderName);
        // delete all files form folder
        await rimraf(path, {});

        await this.sql.findOne('DELETE FROM [projects] WHERE id = ?', [id]);

        return true;
    }

    async flush(id) {
        let analyzer = this.opened.get(id);
        if (analyzer) {
            this.opened.delete(id);
            try {
                await analyzer.close();
            } catch (err) {
                // ignore
            }
        }
        let row = await this.sql.findOne('SELECT [id], [name], [version], folder_name AS folderName, created FROM [projects] WHERE id = ?', [id]);
        if (!row || !row.id) {
            return false;
        }

        let path = pathlib.join(this.appDataPath, row.folderName);
        // delete all files form folder
        await rimraf(path, {});

        await this.sql.findOne('UPDATE [projects] SET emails=0, size=0 WHERE id = ?', [id]);
        await this.sql.findOne('DELETE FROM imports WHERE project = ?', [id]);

        analyzer = new Analyzer({
            projectName: row.name,
            appDataPath: this.appDataPath,
            folderName: row.folderName,
            thumbnailGenerator: this.thumbnailGenerator,
            fid: this.fid
        });
        analyzer.id = id;

        await analyzer.prepare();
        await analyzer.close();
        await this.open(id);

        this.sendToProjectWindows(id, 'flush', {
            id
        });

        return true;
    }

    async close() {
        let promises = [];
        for (let entry of this.opened.entries()) {
            let analyzer = entry[1];
            if (analyzer) {
                promises.push(analyzer.close());
            }
            this.opened.delete(entry[0]);
        }
        await Promise.all(promises);
        await this.sql.close();
    }

    getProjectAnalyzer(windowId) {
        if (!this.projectRef.has(windowId)) {
            return false;
        }
        let id = this.projectRef.get(windowId);
        if (!id || !this.opened.has(id)) {
            return false;
        }
        return this.opened.get(id);
    }

    async openWindow(id) {
        let analyzer = await this.open(id);
        if (!analyzer) {
            return false;
        }

        let project = await this.get(id);
        if (!project) {
            return;
        }

        // Create the browser window.
        let projectWindow = new BrowserWindow({
            title: project.name,

            width: 1280,
            height: 800,
            'min-width': 500,
            'min-height': 200,
            'accept-first-mouse': true,

            webPreferences: {
                nodeIntegration: true
            },

            icon: pathlib.join(__dirname, '..', 'icons/png/256x256.png')
        });

        let windowId = projectWindow.id;
        this.projectRef.set(windowId, id);

        if (!this.projectWindows.has(id)) {
            this.projectWindows.set(id, new Set());
        }
        this.projectWindows.get(id).add(projectWindow);

        const windowUrl = urllib.format({
            protocol: 'file',
            slashes: true,
            pathname: pathlib.join(__dirname, 'page', 'index.html')
        });

        projectWindow.loadURL(windowUrl);
        projectWindow.setTouchBar(this.touchBar);
        this.windows.add(projectWindow);

        // Emitted when the window is closed.
        projectWindow.on('closed', () => {
            this.windows.delete(projectWindow);
            this.projectRef.delete(windowId);
            this.projectWindows.get(id).delete(projectWindow);

            let hasOpenWindow = !!this.projectWindows.get(id).size;
            if (!hasOpenWindow) {
                this.projectWindows.delete(id);
                /*
                let analyzer = this.opened.get(id);
                this.opened.delete(id);
                if (analyzer) {
                    analyzer
                        .close()
                        .catch(() => false)
                        .finally(() => false);
                }
                */
            }

            // Dereference the window object, usually you would store windows
            // in an array if your app supports multi windows, this is the time
            // when you should delete the corresponding element.
            projectWindow = null;
        });

        projectWindow.on('blur', () => {
            let menu = Menu.getApplicationMenu();
            if (menu) {
                ['import-files', 'import-maildir', 'import-folder', 'export-mbox', 'flush-messages'].forEach(key => {
                    let menuItem = menu.getMenuItemById(key);
                    if (menuItem) {
                        menuItem.enabled = false;
                    }
                });
            }
        });

        projectWindow.on('focus', () => {
            let menu = Menu.getApplicationMenu();
            if (menu) {
                ['import-files', 'import-maildir', 'import-folder', 'export-mbox', 'flush-messages'].forEach(key => {
                    let menuItem = menu.getMenuItemById(key);
                    if (menuItem) {
                        menuItem.enabled = true;
                    }
                });
            }
        });
    }

    async createImport(id, options) {
        options = options || {};
        let now = new Date();
        let query = 'INSERT INTO imports ([project], [created], [updated], [source], [totalsize]) VALUES ($project, $created, $updated, $source, $totalsize)';
        let queryParams = {
            $project: id,
            $created: formatDate(now),
            $updated: formatDate(now),
            $source: JSON.stringify(options.source || {}),
            $totalsize: options.totalsize || 0
        };

        let importId = await this.sql.run(query, queryParams);

        // push updated list info to project windows
        let list = await this.listImports(id);
        this.sendToProjectWindows(id, 'import-list', {
            id,
            data: list // keep compatible with command output
        });

        return importId;
    }

    async updateImport(id, importId, options) {
        let sets = [];
        let now = new Date();
        let queryParams = {
            $importId: importId
        };

        if (options.emails) {
            sets.push('[emails] = [emails] + $emails');
            queryParams.$emails = Number(options.emails) || 0;
        }

        if (options.size) {
            sets.push('[size] = [size] + $size');
            queryParams.$size = Number(options.size) || 0;
        }

        if (options.finished) {
            sets.push('[finished] = $finished');
            queryParams.$finished = formatDate(now);
        }

        if (options.errored) {
            sets.push('[errored] = $errored');
            queryParams.$errored = options.errored;
        }

        if (options.processed) {
            sets.push('[processed] = [processed] + $processed');
            queryParams.$processed = Number(options.processed) || 0;
        }

        if (options.emails || options.size) {
            let query = 'UPDATE projects SET [emails] = [emails] + $emails, [size] = [size] + $size WHERE [id] = $id';
            await this.sql.run(query, {
                $id: id,
                $emails: Number(options.emails) || 0,
                $size: Number(options.size) || 0
            });
        }

        if (sets.length) {
            if (!options.finished) {
                sets.push('[updated] = $updated');
                queryParams.$updated = formatDate(now);
            }

            let query = `UPDATE imports SET ${sets.join(',')} WHERE [id] = $importId`;
            await this.sql.run(query, queryParams);
        }

        if (sets.length) {
            let projectData = await this.sql.findOne('SELECT id, emails, size FROM projects WHERE id=?', [id]);
            // push info to main window
            this.mainWindow.webContents.send(
                'project-update',
                JSON.stringify({
                    id,
                    emails: projectData.emails,
                    size: projectData.size
                })
            );

            if (!importId) {
                return;
            }

            let item = await this.sql.findOne('SELECT id, emails, size, errored, finished, created, updated, processed, totalsize FROM imports WHERE id=?', [
                importId
            ]);
            let source;
            try {
                source = JSON.parse(item.source);
            } catch (err) {
                source = null;
            }

            // push info to project windows
            this.sendToProjectWindows(id, 'import-update', {
                id: item.id,
                source,
                emails: item.emails || 0,
                size: item.size || 0,
                processed: item.processed || 0,
                totalsize: item.totalsize || 0,
                errored: item.errored,
                finished: item.finished ? new Date(item.finished + 'Z').toISOString() : null,
                created: new Date(item.created + 'Z').toISOString(),
                updated: new Date(item.updated + 'Z').toISOString()
            });
        }
    }

    async sendToProjectWindows(id, channel, data) {
        // push info to project windows
        if (this.projectWindows.has(id)) {
            for (let win of this.projectWindows.get(id)) {
                try {
                    win.webContents.send(channel, JSON.stringify(data));
                } catch (err) {
                    console.error(err);
                }
            }
        }
    }

    async listImports(id) {
        await this.prepare();
        let list = await this.sql.findMany(
            'SELECT id, emails, source, errored, finished, created, updated, processed, size, totalsize FROM imports WHERE project=? ORDER BY created DESC',
            [id]
        );
        if (!list) {
            return false;
        }

        return list.map(item => {
            let source;
            try {
                source = JSON.parse(item.source);
            } catch (err) {
                source = null;
            }

            return {
                id: item.id,
                source,
                emails: item.emails || 0,
                size: item.size || 0,
                processed: item.processed || 0,
                totalsize: item.totalsize || 0,
                errored: item.errored,
                finished: item.finished ? new Date(item.finished + 'Z').toISOString() : null,
                created: new Date(item.created + 'Z').toISOString(),
                updated: new Date(item.updated + 'Z').toISOString()
            };
        });
    }
}

function formatDate(value) {
    if (!value) {
        return null;
    }

    let date;

    if (typeof value === 'string' || typeof value === 'number') {
        date = new Date(value);
    } else if (Object.prototype.toString.apply(value) === '[object Date]') {
        date = value;
    } else {
        return null;
    }

    if (date.toString() === 'Invalid Date') {
        return null;
    }

    if (date.getTime() === 0) {
        return null;
    }

    return date
        .toISOString()
        .replace(/T/, ' ')
        .substr(0, 19);
}

module.exports = Projects;
