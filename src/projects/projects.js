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

        this.prepareQueue = [];
        this.prepared = false;
        this.preparing = false;

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
                [name] TEXT,
                [folder_name] TEXT
            );`);

            await this.sql.run(`CREATE INDEX IF NOT EXISTS [project_created] ON projects (
                [created]
            )`);

            await this.sql.run(`CREATE INDEX IF NOT EXISTS [project_name] ON projects (
                [name]
            )`);

            await this.sql.run(`PRAGMA foreign_keys=ON`);
            await this.sql.run(`PRAGMA case_sensitive_like=OFF`);
        } catch (err) {
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
        let list = await this.sql.findMany('SELECT [id], [name], [version], folder_name AS folderName, created FROM [projects] ORDER BY name ASC');
        if (!list) {
            return false;
        }

        return list.map(item => {
            return {
                id: item.id,
                name: item.name,
                folderName: item.folderName,
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
        console.log(project);

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
            let hasOpenWindow = false;
            for (let projectId of this.projectRef.values()) {
                if (projectId === id) {
                    hasOpenWindow = true;
                    break;
                }
            }

            if (!hasOpenWindow) {
                let analyzer = this.opened.get(id);
                this.opened.delete(id);
                if (analyzer) {
                    analyzer.close().finally(() => false);
                }
            }

            // Dereference the window object, usually you would store windows
            // in an array if your app supports multi windows, this is the time
            // when you should delete the corresponding element.
            projectWindow = null;
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
