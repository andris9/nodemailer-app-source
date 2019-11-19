'use strict';

class ServerLogs {
    constructor(options) {
        this.options = options || {};
        this.projects = options.projects;
        this.pendingMessages = new Map();
        this.linecount = 0;
    }

    async log(data) {
        let { user, proto, sess, message } = data;
        user = Number(user);

        if (!user && !sess) {
            console.log([new Date().toISOString(), user, proto, sess, message].filter(val => val).join(', '));
            return;
        }

        if (!user && sess) {
            if (!this.pendingMessages.has(sess)) {
                this.pendingMessages.set(sess, []);
            }
            this.pendingMessages.get(sess).push({ user, proto, sess, message, time: new Date() });
            return;
        }

        if (this.pendingMessages.has(sess)) {
            let pending = this.pendingMessages.get(sess);
            this.pendingMessages.delete(sess);
            for (let message of pending) {
                message.user = user;
                await this.writeLog(message);
            }
        }

        return this.writeLog({ user, proto, sess, message, time: new Date() });
    }

    async writeLog(data) {
        let { user, proto, sess, message, time } = data;
        time = time ? time.toISOString() : new Date().toISOString();

        let analyzer = await this.projects.open(user);

        if (!analyzer) {
            return console.log([user, proto, sess, message, time].filter(val => val).join(' : '));
        }

        let count = (++this.linecount).toString(16);
        count = '0'.repeat(3 - count.length) + count;

        let loguser = user.toString(16);
        loguser = '0'.repeat(5 - loguser.length) + loguser;

        let logkey = `logs:${loguser}:${proto}:${new Date(time).getTime().toString(16)}:${count}`;
        let payload = {
            user,
            proto,
            sess,
            message,
            time
        };

        await analyzer.prepare();
        await analyzer.level.put(logkey, payload, {
            valueEncoding: 'json'
        });

        if (this.projects.projectWindows.has(user)) {
            for (let win of this.projects.projectWindows.get(user)) {
                try {
                    win.webContents.send(
                        'log',
                        JSON.stringify({
                            id: 'log',
                            user,
                            proto,
                            sess,
                            message,
                            time
                        })
                    );
                } catch (err) {
                    console.error(err);
                }
            }
        }
    }

    async read(user, proto, maxLines) {
        let analyzer = await this.projects.open(user);
        if (!analyzer) {
            return false;
        }

        let loguser = user.toString(16);
        loguser = '0'.repeat(5 - loguser.length) + loguser;
        let key = `logs:${loguser}:${proto}`;

        let list = [];
        maxLines = maxLines || Number(1000);
        return new Promise((resolve, reject) => {
            let stream = analyzer.level.createValueStream({
                reverse: true,
                gt: key + ':',
                lt: key + ':~',
                limit: maxLines,
                valueEncoding: 'json'
            });

            stream.on('error', err => reject(err));
            stream.on('readable', () => {
                let row;
                while ((row = stream.read()) !== null) {
                    list.push(row);
                }
            });
            stream.on('end', () => resolve(list.reverse()));
        });
    }
}

module.exports.ServerLogs = ServerLogs;
