'use strict';
/* eslint global-require: 0 */
/* global window, Image, document */

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

    ['project-update', 'import-update', 'import-list', 'project-created'].forEach(channel => {
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

    // resize images on behalf of the main process with no DOM access
    const resizer = {
        canvas: document.createElement('canvas'),
        resize(dataURL, width, height) {
            this.canvas.width = width;
            this.canvas.height = height;

            return new Promise(resolve => {
                const img = new Image();
                img.onload = () => {
                    const ctx = this.canvas.getContext('2d');
                    ctx.clearRect(0, 0, width, height);

                    let scale;
                    if (img.width <= width && img.height <= height) {
                        scale = 1;
                    } else {
                        // get the scale
                        scale = Math.min(width / img.width, height / img.height);
                    }

                    // get the top left position of the image
                    const x = width / 2 - (img.width / 2) * scale;
                    const y = height / 2 - (img.height / 2) * scale;
                    ctx.drawImage(img, x, y, img.width * scale, img.height * scale);
                    return resolve(this.canvas.toDataURL('image/webp'));
                };

                img.src = dataURL;
            });
        }
    };

    ipcRenderer.on('resize', (event, arg) => {
        let run = async () => {
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

            let response = {
                cid: payload.cid
            };

            try {
                if (!payload.src) {
                    throw new Error('Image URI not provided');
                }
                response.src = await resizer.resize(payload.src, payload.width || 120, payload.height || 120);
            } catch (err) {
                response.error = err.message;
            } finally {
                ipcRenderer.send('resizeres', JSON.stringify(response));
            }
        };

        run().catch(err => console.error(err));
    });
})();
