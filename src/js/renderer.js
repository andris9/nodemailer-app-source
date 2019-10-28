'use strict';
/* eslint global-require: 0 */
/* global window */

window.events = {
    subscribers: new Map(),

    subscribe(channel, listener) {
        if (!this.subscribers.has(channel)) {
            this.subscribers.set(channel, []);
        }
        this.subscribers.get(channel).push(listener);
    },

    publish(channel, data) {
        if (!this.subscribers.has(channel)) {
            return;
        }
        this.subscribers.get(channel).forEach(listener => {
            try {
                listener(data);
            } catch (err) {
                // ignore
            }
        });
    }
};
(() => {
    const { ipcRenderer } = require('electron');
    const crypto = require('crypto');

    let cs = crypto.randomBytes(8).toString('hex');
    let ci = 0;
    let execQueue = new Map();

    ['project-update', 'import-update'].forEach(channel => {
        ipcRenderer.on(channel, (event, arg) => {
            let payload;
            try {
                payload = JSON.parse(arg);
            } catch (err) {
                console.error(err);
                return;
            }
            if (!payload || !payload.id) {
                return;
            }

            console.log(payload);
            window.events.publish(channel, payload);
        });
    });

    ipcRenderer.on('cmdres', (event, arg) => {
        let payload;
        try {
            payload = JSON.parse(arg);
        } catch (err) {
            console.error(err);
            return;
        }
        if (!payload || !payload.cid || !execQueue.has(payload.cid)) {
            return;
        }
        let handler = execQueue.get(payload.cid);
        execQueue.delete(payload.cid);
        if (payload.error) {
            return handler.reject(new Error(payload.error));
        }
        handler.resolve(payload.data);
    });

    window.exec = async data => {
        return new Promise((resolve, reject) => {
            let cid = `${cs}:${++ci}`;
            let time = Date.now();
            execQueue.set(cid, { resolve, reject, time });
            ipcRenderer.send(
                'cmdreq',
                JSON.stringify({
                    cid,
                    data
                })
            );
        });
    };
})();
