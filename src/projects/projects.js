'use strict';

const SQL = require('../sql/sql');
const urllib = require('url');
const pathlib = require('path');
const util = require('util');
const mkdirp = util.promisify(require('mkdirp'));
const rimraf = util.promisify(require('rimraf'));
const fs = require('fs').promises;
const Analyzer = require('../analyzer/lib/analyzer.js');
const { BrowserWindow } = require('electron');

const VERSION = 1;

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
            await mkdirp(this.appDataPath);
            this.sql = new SQL({ db: this.sqlPath });

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

            await this.sql.run(`UPDATE [imports] SET finished=$finished, errored=$errored WHERE finished IS NULL`, {
                $errored: 'Unfinished import',
                $finished: formatDate(new Date())
            });

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
            while (this.prepareQueue.length) {
                let promise = this.prepareQueue.shift();
                promise.resolve();
            }
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
            folderName
        });

        await analyzer.prepare();
        await analyzer.close();

        let query = 'INSERT INTO projects ([name], [version], [created], [folder_name]) VALUES ($name, $version, $created, $folder_name)';
        let queryParams = {
            $name: name,
            $folder_name: folderName,
            $version: VERSION,
            $created: formatDate(new Date())
        };

        let id = await this.sql.run(query, queryParams);
        return id;
    }

    async get(id) {
        let row = await this.sql.findOne('SELECT [id], [name], [version], folder_name AS folderName, created FROM [projects] WHERE id = ?', [id]);
        if (!row || !row.id) {
            return false;
        }
        return row;
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
            folderName: row.folderName
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

        let path = pathlib.join(this.appDataPath, row.folderName);
        // delete all files form folder
        await rimraf(path, {});

        await this.sql.findOne('DELETE FROM [projects] WHERE id = ?', [id]);

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

            width: 800,
            height: 600,
            'min-width': 500,
            'min-height': 200,
            'accept-first-mouse': true,

            webPreferences: {
                nodeIntegration: true
            }
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
    }

    async createImport(id, options) {
        options = options || {};

        let query = 'INSERT INTO imports ([project], [created], [source], [totalsize]) VALUES ($project, $created, $source, $totalsize)';
        let queryParams = {
            $project: id,
            $created: formatDate(new Date()),
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

    async updateImport(analyzer, importId, options) {
        let id = analyzer.id;
        let sets = [];
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
            queryParams.$finished = formatDate(new Date());
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
            let query = `UPDATE imports SET ${sets.join(',')} WHERE [id] = $importId`;
            await this.sql.run(query, queryParams);

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

            let item = await this.sql.findOne('SELECT id, emails, size, errored, finished, created, processed, totalsize FROM imports WHERE id=?', [importId]);
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
                created: new Date(item.created + 'Z').toISOString()
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
            'SELECT id, emails, source, errored, finished, created, processed, size, totalsize FROM imports WHERE project=? ORDER BY created DESC',
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
                created: new Date(item.created + 'Z').toISOString()
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
