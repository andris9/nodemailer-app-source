'use strict';
/* eslint global-require: 0 */
/* globals window, document, alert, ImportPage, ContactsPage, AttachmentsPage, EmailsPage, Tabs, exec, showLoader, hideLoader */

(() => {
    class ServerPage {
        constructor() {
            this.componentElms = Array.from(document.querySelectorAll('.server-component'));
            this.pageElm = document.getElementById('page-server');
            this.pageMenuElm = document.getElementById('page-menu-server');

            // overriden by main
            this.pageViews = false;
            this.smtpLogListElm = document.getElementById('server-smtp-logs-list');
            this.pop3LogListElm = document.getElementById('server-pop3-logs-list');

            this.viewTabs = new Tabs('server-tab');
        }

        async focus() {
            // overriden by main
        }

        async show() {
            this.componentElms.forEach(elm => elm.classList.remove('hidden'));
            this.pageElm.classList.remove('hidden');
            this.pageMenuElm.classList.add('active');
            this.visible = true;

            this.viewTabs.show('overview');
            this.viewTabs.activate('overview');
        }

        async hide() {
            this.componentElms.forEach(elm => elm.classList.add('hidden'));
            this.pageElm.classList.add('hidden');
            this.pageMenuElm.classList.remove('active');
            this.visible = false;
        }

        updateServerStatus() {
            let serverStatusRecordElm = document.getElementById('server-status-record');
            let serverStatusTextElm = document.getElementById('server-status-text');

            if (!this.serverStatus || !this.serverStatus.running) {
                serverStatusRecordElm.classList.add('status-red');
                serverStatusRecordElm.classList.remove('status-green');
                serverStatusTextElm.textContent = 'stopped';
            } else {
                serverStatusRecordElm.classList.remove('status-red');
                serverStatusRecordElm.classList.add('status-green');
                serverStatusTextElm.textContent = 'running';
            }

            if (this.serverStatus) {
                Array.from(document.querySelectorAll('.server-smtp-port-value')).forEach(elm => {
                    elm.textContent = this.serverStatus.config.smtpPort;
                });

                Array.from(document.querySelectorAll('.server-pop3-port-value')).forEach(elm => {
                    elm.textContent = this.serverStatus.config.pop3Port;
                });
            }

            Array.from(document.querySelectorAll('.server-user-value')).forEach(elm => {
                elm.textContent = 'project.' + this.selfInfo.id;
            });

            Array.from(document.querySelectorAll('.project-value')).forEach(elm => {
                elm.textContent = this.selfInfo.id;
            });

            Array.from(document.querySelectorAll('.server-password-value')).forEach(elm => {
                elm.textContent = 'secret.' + this.selfInfo.id;
            });

            Array.from(document.querySelectorAll('.sendmail-value')).forEach(elm => {
                elm.textContent = this.selfInfo.sendmail;
            });
        }

        formatDate(date) {
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

        getLogRow(log) {
            let rowElm = document.createElement('tr');
            let cell01Elm = document.createElement('td');
            let cell02Elm = document.createElement('td');
            let cell03Elm = document.createElement('td');

            cell01Elm.classList.add('pre-text');
            cell02Elm.classList.add('pre-text');
            cell03Elm.classList.add('pre-text', 'text-select');

            cell01Elm.textContent = this.formatDate(log.time);
            cell02Elm.textContent = log.sess;
            cell03Elm.textContent = log.message;

            rowElm.appendChild(cell01Elm);
            rowElm.appendChild(cell02Elm);
            rowElm.appendChild(cell03Elm);
            return rowElm;
        }

        updateLogs() {
            this.smtpLogListElm.innerHTML = '';

            if (this.smtpLogs && this.smtpLogs.length) {
                for (let log of this.smtpLogs) {
                    this.smtpLogListElm.appendChild(this.getLogRow(log));
                }
            }

            this.pop3LogListElm.innerHTML = '';

            if (this.pop3Logs && this.pop3Logs.length) {
                for (let log of this.pop3Logs) {
                    this.pop3LogListElm.appendChild(this.getLogRow(log));
                }
            }
        }

        addLogRow(log) {
            let logListElm;
            switch (log && log.proto) {
                case 'smtp':
                    logListElm = this.smtpLogListElm;
                    break;
                case 'pop3':
                    logListElm = this.pop3LogListElm;
                    break;
                default:
                    return;
            }
            logListElm.appendChild(this.getLogRow(log));
        }

        async init() {
            window.events.subscribe('server-status', data => {
                this.serverStatus = data;
                this.updateServerStatus();
            });

            this.serverStatus = await exec({
                command: 'serverStatus'
            });

            this.selfInfo = await exec({
                command: 'selfInfo'
            });

            this.updateServerStatus();

            this.smtpLogs = await exec({
                command: 'serverLogs',
                params: {
                    proto: 'smtp'
                }
            });

            this.pop3Logs = await exec({
                command: 'serverLogs',
                params: {
                    proto: 'pop3'
                }
            });

            this.updateLogs();

            window.events.subscribe('log', log => this.addLogRow(log));
        }
    }

    async function main() {
        let pageViews = {
            imports: new ImportPage(),
            contacts: new ContactsPage(),
            attachments: new AttachmentsPage(),
            emails: new EmailsPage(),
            server: new ServerPage()
        };

        await showLoader();

        await Promise.all([
            pageViews.imports.init(),
            pageViews.contacts.init(),
            pageViews.attachments.init(),
            pageViews.emails.init(),
            pageViews.server.init()
        ]);

        // show emails page by default
        let selected = 'emails';
        await pageViews[selected].show();

        let activateView = async target => {
            if (!pageViews[target] || target === selected) {
                // nothing to do here
                return;
            }

            try {
                await pageViews[selected].hide();
            } catch (err) {
                console.error(err);
            }

            try {
                await pageViews[target].show();
                selected = target;
            } catch (err) {
                console.error(err);
            }
        };

        Object.keys(pageViews).forEach(target => {
            pageViews[target].pageViews = pageViews;
            pageViews[target].focus = async () => await activateView(target);
        });

        let menuItems = Array.from(document.querySelectorAll('.page-menu'));
        for (let menuItem of menuItems) {
            let target = menuItem.dataset.target;

            menuItem.addEventListener('click', () => {
                activateView(target).catch(err => console.error(err));
            });
        }

        window.events.subscribe('find', () => {
            if (typeof pageViews[selected].find === 'function') {
                pageViews[selected].find();
            }
        });

        let flushViews = async () => {
            // clear all
            await showLoader();

            await Promise.all([pageViews.imports.flush(), pageViews.contacts.flush(), pageViews.attachments.flush(), pageViews.emails.flush()]);
            await hideLoader();
        };

        window.events.subscribe('flush', () => {
            flushViews().catch(err => alert(err.message));
        });

        await hideLoader();
    }

    main().catch(err => alert(err.message));
})();
