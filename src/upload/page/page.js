/* eslint global-require:0 */
/* global Tabs, exec, alert, document, window */
'use strict';

(() => {
    const addressparser = require('nodemailer/lib/addressparser');

    // 2019-11-14T03:04
    function toLocaleDateTime(date) {
        if (!date) {
            return '';
        }

        if (typeof date === 'string') {
            date = new Date(date);
        }

        let year = date.getFullYear();
        let month = date.getMonth() + 1;
        let day = date.getDate();

        let hours = date.getHours();
        let minutes = date.getMinutes();

        return `${year}-${(month < 10 ? '0' : '') + month}-${(day < 10 ? '0' : '') + day}T${(hours < 10 ? '0' : '') + hours}:${(minutes < 10 ? '0' : '') +
            minutes}`;
    }

    function formatDate(date) {
        date = new Date(date);
        if (date.toString() === 'Invalid Date') {
            date = new Date();
        }

        let year = date.getFullYear();
        let month = date.getMonth() + 1;
        let day = date.getDate();

        let hours = date.getHours();
        let minutes = date.getMinutes();
        let seconds = date.getSeconds();
        let ms = date.getMilliseconds();

        return `${year}-${(month < 10 ? '0' : '') + month}-${(day < 10 ? '0' : '') + day} ${(hours < 10 ? '0' : '') + hours}:${(minutes < 10 ? '0' : '') +
            minutes}:${(seconds < 10 ? '0' : '') + seconds}${ms ? '.' + ms : ''}`;
    }

    function getLogRow(log) {
        let rowElm = document.createElement('tr');
        let cell01Elm = document.createElement('td');
        let cell02Elm = document.createElement('td');

        cell01Elm.classList.add('pre-text');
        cell02Elm.classList.add('pre-text', 'text-select');

        cell01Elm.textContent = formatDate(log.time);
        cell02Elm.textContent = log.message;

        rowElm.appendChild(cell01Elm);
        rowElm.appendChild(cell02Elm);
        return rowElm;
    }

    function addLogRow(log) {
        let logListElm = document.getElementById('upload-logs-list');
        logListElm.appendChild(getLogRow(log));
    }

    const main = async () => {
        let uploadTabs = new Tabs('tabs');

        let id = Number(document.location.hash.replace('#', ''));
        if (!id) {
            return await exec({
                command: 'closeWindow'
            });
        }

        let uploadOpts = await exec({
            command: 'uploadOpts',
            params: {
                id
            }
        });

        if (!uploadOpts) {
            await exec({
                command: 'closeWindow'
            });
        }

        document.getElementById('configure').addEventListener('click', () => {
            exec({
                command: 'preferences',
                params: {
                    tab: uploadTabs.getActive()
                }
            }).catch(err => console.error(err));
        });

        document.getElementById('cancel').addEventListener('click', () => {
            exec({
                command: 'closeWindow'
            }).catch(err => console.error(err));
        });

        document.getElementById('upload').addEventListener('click', () => {
            let active = uploadTabs.getActive();
            let uploadReq = { id, proto: active };

            document.getElementById('upload-logs-list').innerHTML = '';

            switch (active) {
                case 'smtp':
                    uploadReq.mailFrom =
                        addressparser(document.getElementById('data-smtp-mail-from').value.trim())
                            .map(addr => addr.address)
                            .filter(addr => addr)
                            .shift() || '';
                    uploadReq.rcptTo = addressparser(document.getElementById('data-smtp-rcpt-to').value.trim())
                        .map(addr => addr.address)
                        .filter(addr => addr);
                    break;

                case 'imap':
                    uploadReq.path = document.getElementById('data-imap-path').value.trim();
                    uploadReq.flags = document
                        .getElementById('data-imap-flags')
                        .value.trim()
                        .split(',')
                        .map(flag => flag.trim())
                        .filter(flag => flag);
                    uploadReq.idate = new Date(document.getElementById('data-imap-idate').value);
                    if (uploadReq.idate.toString() === 'Invalid Date') {
                        uploadReq.idate = new Date();
                    }
                    uploadReq.idate = uploadReq.idate.toISOString();
                    break;
                default:
                    return;
            }

            exec({
                command: 'runUploadEmail',
                params: uploadReq
            });
        });

        document.getElementById('data-smtp-mail-from').value = uploadOpts.envelope.mailFrom;
        document.getElementById('data-smtp-rcpt-to').value = uploadOpts.envelope.rcptTo.join(', ');
        document.getElementById('data-imap-path').value = 'INBOX';
        document.getElementById('data-imap-idate').value = toLocaleDateTime(uploadOpts.envelope.date);
        document.getElementById('data-imap-flags').value = uploadOpts.envelope.flags.join(', ');

        uploadTabs.show('smtp');
        uploadTabs.activate('smtp');

        window.events.subscribe('log', addLogRow);
    };

    main().catch(err => alert(err.stack));
})();
