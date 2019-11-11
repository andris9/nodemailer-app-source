'use strict';

const sqlite3 = require('sqlite3');

class SQL {
    constructor(options) {
        this.options = options || {};

        this._prepared = false;
        this._preparing = false;

        this._locked = false;
        this._lockQueue = [];
    }

    async prepare() {
        if (this._prepared || this._preparing) {
            return;
        }
        let now = Date.now();
        this._preparing = true;
        await new Promise((resolve, reject) => {
            // eslint-disable-next-line no-bitwise
            let mode = this.options.mode || sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE;
            this.db = new sqlite3.Database(this.options.db || ':memory:', mode, err => {
                console.log('SQL PREPARE', Date.now() - now);
                this._preparing = false;
                if (err) {
                    return reject(err);
                }
                this._prepared = true;
                resolve();
            });
        });
    }

    async lock() {
        await this.prepare();

        if (!this._locked) {
            this._locked = true;
            return;
        }

        let wait = new Promise((resolve, reject) => {
            this._lockQueue.push({ resolve, reject });
        });

        return wait;
    }

    release() {
        if (this._lockQueue.length) {
            let { resolve } = this._lockQueue.shift();
            resolve();
        } else {
            this._locked = false;
        }
    }

    async run(sql, params) {
        let now = Date.now();
        if (!this.qid) {
            this.qid = 0;
        }
        let rid = ++this.qid;
        await this.lock();
        console.log('SQLRUN: LOCK ACQUIRED', rid, Date.now() - now, sql);
        try {
            return await new Promise((resolve, reject) => {
                // can not use lambda function as we need bound `this`
                this.db.run(sql, params || [], function(err) {
                    console.log('SQLRUN: REQ DONE', rid, Date.now() - now);
                    if (err) {
                        return reject(err);
                    }

                    if (/^\s*insert\b/i.test(sql)) {
                        // eslint-disable-next-line no-invalid-this
                        return resolve(this.lastID);
                    }

                    if (/^\s*(update|delete)\b/i.test(sql)) {
                        // eslint-disable-next-line no-invalid-this
                        return resolve(this.changes);
                    }

                    resolve();
                });
            });
        } finally {
            this.release();
            console.log('SQLRUN: LOCK RELEASED', rid, Date.now() - now);
        }
    }

    async findOne(sql, params) {
        let now = Date.now();
        return new Promise((resolve, reject) => {
            this.db.get(sql, params || [], (err, row) => {
                console.log('SQLFO: REQ DONE', Date.now() - now, sql);
                if (err) {
                    reject(err);
                } else {
                    resolve(row);
                }
            });
        });
    }

    async findMany(sql, params) {
        let now = Date.now();
        return new Promise((resolve, reject) => {
            this.db.all(sql, params || [], (err, rows) => {
                console.log('SQLFM: REQ DONE', Date.now() - now, sql);
                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }

    async *each(sql, params) {
        await this.prepare();
        await this.lock();

        let rowQueue = [];
        let finished = false;

        let errored = false;
        let waitNext = false;

        let getNext = () => {
            return new Promise((resolve, reject) => {
                if (rowQueue.length) {
                    let { err, row } = rowQueue.shift();
                    if (err) {
                        return reject(err);
                    }
                    return resolve(row);
                }

                if (finished) {
                    return resolve(null);
                }

                waitNext = (err, row) => {
                    if (err) {
                        return reject(err);
                    }
                    return resolve(row);
                };
            });
        };

        let push = (err, row) => {
            if (errored) {
                return;
            }
            if (waitNext) {
                let w = waitNext;
                waitNext = false;
                w(err, row);
            } else {
                rowQueue.push({ err, row });
            }
        };

        let finish = err => {
            if (err) {
                push(err);
            }
            finished = true;
            push(null, null);
        };

        try {
            this.db.each(sql, params || [], push, finish);

            while (true) {
                let res = await getNext();
                if (res !== null || !finished) {
                    yield res;
                } else {
                    break;
                }
            }
        } catch (err) {
            errored = err;
            rowQueue = [];
            throw err;
        } finally {
            this.release();
        }
    }

    async close() {
        if (!this._prepared) {
            return;
        }
        return new Promise((resolve, reject) => {
            this.db.close(err => {
                if (err) {
                    return reject(err);
                }
                resolve();
            });
        });
    }
}

module.exports = SQL;
