/* eslint global-require: 0 */
/* global window, document, alert, exec, showLoader, hideLoader, DOMPurify */

'use strict';

(() => {
    const humanize = require('humanize');
    const moment = require('moment');

    class EmailsPage {
        constructor() {
            this.buttonGroupElms = Array.from(document.querySelectorAll('.emails-component'));
            this.pageElm = document.getElementById('page-emails');
            this.pageMenuElm = document.getElementById('page-menu-emails');

            this.pageNrElm = document.getElementById('emails-page-nr');
            this.pageTotalElm = document.getElementById('emails-page-total');

            this.pageNextElm = document.getElementById('emails-page-next');
            this.pagePrevElm = document.getElementById('emails-page-prev');

            this.actionButtonsElm = document.getElementById('email-action-buttons');
            this.actionExternalElm = document.getElementById('email-action-external');
            this.actionButtonsElm.removeChild(this.actionExternalElm);

            this.rowListElm = document.getElementById('emails-list');
            this.rows = [];

            this.selectable = new window.Selectable(this.rows, (...args) => this.listAction(...args));

            this.renderedData = false;

            this.term = '';
            this.page = 1;
            this.pages = 1;
            this.visible = false;
        }

        listAction(action) {
            switch (action) {
                case 'active':
                case 'deactivate':
                    return this.paintInfoWindow();
                case 'open':
                    this.actionOpen().catch(err => alert(err.message));
                    return;
            }
        }

        paintInfoWindow() {
            let active = this.selectable.getSelected();

            if (!active) {
                document.getElementById('email-info').classList.add('hidden');
                document.getElementById('email-missing').classList.remove('hidden');
                return;
            } else {
                document.getElementById('email-info').classList.remove('hidden');
                document.getElementById('email-missing').classList.add('hidden');
            }

            let data = active.data;
            let infoList = document.getElementById('email-info-list');
            let dataList = [];

            const formatAddressEntries = addr => {
                let list = addr.map(a => {
                    let baseElm = document.createElement('span');
                    baseElm.classList.add('address-link');
                    baseElm.title = a.address || a.name;
                    baseElm.textContent = a.name || `<${a.address}>`;
                    return baseElm;
                });
                let main = document.createDocumentFragment();
                main.appendChild(list.shift());

                while (list.length) {
                    let sep = document.createElement('span');
                    sep.textContent = ', ';
                    main.appendChild(sep);
                    main.appendChild(list.shift());
                }
                return main;
            };

            const formatTextEntry = (str, entry) => {
                let main = document.createDocumentFragment();
                let textElm = document.createElement('span');
                let value = (str || '').toString().trim();
                if (entry && entry.filesize) {
                    value = humanize.filesize(Number(value) || 0, 1024, 0, '.', ' ');
                }
                textElm.textContent = value;
                if (entry.contained) {
                    textElm.title = value;
                }
                main.appendChild(textElm);
                return main;
            };

            const formatDateEntry = str => {
                let main = document.createDocumentFragment();
                let dateElm = document.createElement('span');

                let dateStr = (str || '').toString().trim();

                dateElm.textContent = moment(dateStr).format('LLL');
                main.appendChild(dateElm);
                return main;
            };

            [
                { key: 'subject', name: 'Subject', type: 'text', contained: true },
                { key: 'hdate', name: 'Date', type: 'date' },
                { key: 'from', name: 'From', type: 'address' },
                { key: 'to', name: 'To', type: 'address' },
                { key: 'cc', name: 'Cc', type: 'address' },
                { key: 'bcc', name: 'Bcc', type: 'address' },
                { key: 'messageId', name: 'Message-ID', type: 'text', contained: true }
            ].forEach(entry => {
                switch (entry.type) {
                    case 'address':
                        if (data.addresses && data.addresses[entry.key] && data.addresses[entry.key].length) {
                            let addr = data.addresses[entry.key];
                            dataList.push([entry.name, formatAddressEntries(addr)]);
                        }
                        break;
                    case 'text':
                        if (data[entry.key]) {
                            dataList.push([entry.name, formatTextEntry(data[entry.key], entry), entry]);
                        }
                        break;
                    case 'date':
                        if (data[entry.key]) {
                            dataList.push([entry.name, formatDateEntry(data[entry.key])]);
                        }
                        break;
                }
            });

            infoList.innerHTML = '';
            dataList.forEach(entry => {
                let keyElm = document.createElement('dt');
                keyElm.textContent = entry[0];
                infoList.appendChild(keyElm);

                let valElm = document.createElement('dd');
                valElm.appendChild(entry[1]);
                if (entry[2] && entry[2].contained) {
                    valElm.classList.add('contain-text');
                }
                infoList.appendChild(valElm);
            });

            let tabContentElm = document.getElementById('email-tab-content');
            if (this.actionExternalElm.parentNode) {
                this.actionButtonsElm.removeChild(this.actionExternalElm);
            }

            this.redrawWithExternal = false;
            tabContentElm.innerHTML = '';

            let drawHtml = async (html, keepExternalResources) => {
                tabContentElm.innerHTML = '';

                let purifyConfig = {
                    WHOLE_DOCUMENT: true,
                    keepExternalResources: !!keepExternalResources,
                    externalResourcesRef: {},
                    emailId: data.id
                };

                let clean = DOMPurify.sanitize(data.text.html, purifyConfig);

                let hasExternalResources = !keepExternalResources && window.__purifyRef.has(purifyConfig.externalResourcesRef);

                let cidMatches = Array.from(new Set(clean.match(/\[\[CID\/cid:(.*)\/CID\]\]/g)));
                let cidAttachments = new Map();

                let fetchCidImage = async match => {
                    let cid = match.substr('[[CID/cid:'.length, match.length - ('[[CID/cid:'.length + '/CID]]'.length));
                    cid = '<' + cid + '>';

                    try {
                        let attachment = await exec({
                            command: 'getAttachment',
                            params: {
                                email: data.id,
                                cid
                            }
                        });
                        cidAttachments.set(match, attachment);
                    } catch (err) {
                        console.error(err);
                    }
                };

                // fetch embedded images
                await Promise.all(cidMatches.map(cid => fetchCidImage(cid)));

                if (cidAttachments.size) {
                    clean = clean.replace(/\[\[CID\/cid:(.*)\/CID\]\]/g, match => {
                        if (cidAttachments.has(match)) {
                            return cidAttachments.get(match);
                        } else {
                            return 'proxy.png';
                        }
                    });
                }

                if (hasExternalResources) {
                    if (!this.actionExternalElm.parentNode) {
                        this.actionButtonsElm.appendChild(this.actionExternalElm);
                    }
                    this.redrawWithExternal = () => drawHtml(html, true).catch(err => alert(err.message));
                } else {
                    if (this.actionExternalElm.parentNode) {
                        this.actionButtonsElm.removeChild(this.actionExternalElm);
                    }
                    this.redrawWithExternal = false;
                }

                let styleTag = `<style>
                body, td, th, p {
                    font-size: 13px;
                    font-family: Sans-Serif;
                    color: #0a244d;
                }
                </style>`;
                if (clean.match(/<\/head\b[^>]*>/i)) {
                    clean = clean.replace(/<\/head\b[^>]*>/i, m => styleTag + m);
                } else {
                    clean = styleTag + clean;
                }
                clean = clean.replace();
                let iframe = document.createElement('iframe');
                iframe.setAttribute('sandbox', 'allow-popups allow-same-origin');
                iframe.srcdoc = clean;
                tabContentElm.appendChild(iframe);
            };

            if (data.text.html) {
                drawHtml(data.text.html, false).catch(err => alert(err.message));
            }

            // keep reference for button actions
            this.renderedData = data;
        }

        async actionOpen() {
            console.log('OPEN');
        }

        renderListItem(data, nr) {
            let rowElm = document.createElement('tr');

            let cell01Elm = document.createElement('td');
            let cell02Elm = document.createElement('td');
            let cell03Elm = document.createElement('td');

            cell01Elm.classList.add('cell-01', 'text-right');
            cell02Elm.classList.add('cell-02');
            cell03Elm.classList.add('cell-03');

            cell01Elm.textContent = humanize.numberFormat(nr, 0, '.', ' ');

            let from = data.addresses && data.addresses.from && data.addresses.from[0];
            from = from ? from.name || from.address : '';
            cell02Elm.textContent = from;

            cell03Elm.textContent = data.subject;

            rowElm.appendChild(cell01Elm);
            rowElm.appendChild(cell02Elm);
            rowElm.appendChild(cell03Elm);

            this.rows.push({ data, elm: rowElm });
            this.rowListElm.appendChild(rowElm);
        }

        async render(list) {
            if (!list || !list.data) {
                return;
            }

            this.page = list.page || 1;
            this.pages = list.pages || this.page;

            this.pageNrElm.textContent = humanize.numberFormat(list.page, 0, '.', ' ');
            this.pageTotalElm.textContent = humanize.numberFormat(list.pages, 0, '.', ' ');

            this.rows.forEach(data => {
                if (data.elm.parentNode === this.rowListElm) {
                    this.rowListElm.removeChild(data.elm);
                }
            });
            this.rows = [];

            let startNr = (list.page - 1) * list.pageSize;
            for (let data of list.data) {
                this.renderListItem(data, ++startNr);
            }

            this.selectable.update(this.rows);
        }

        async show() {
            this.buttonGroupElms.forEach(elm => elm.classList.remove('hidden'));
            this.pageElm.classList.remove('hidden');
            this.pageMenuElm.classList.add('active');
            this.visible = true;

            if (this.page !== 1) {
                this.page = 1;
                this.term = '';
                this.clearSearch();
                await this.reload();
            }

            this.selectable.activate();
            this.paintInfoWindow();
        }

        async hide() {
            this.buttonGroupElms.forEach(elm => elm.classList.add('hidden'));
            this.pageElm.classList.add('hidden');
            this.pageMenuElm.classList.remove('active');
            this.visible = false;

            this.selectable.disable();
        }

        async reload() {
            await showLoader();
            try {
                let list = await exec({
                    command: 'listEmails',
                    params: {
                        page: this.page
                    }
                });
                this.render(list);
            } finally {
                await hideLoader();
            }
        }

        async search() {
            let term = await exec({
                command: 'searchEmails',
                params: {
                    term: this.term || ''
                }
            });
            term = (term || '').trim();
            if (term) {
                this.term = term;
                this.page = 1;

                let searchBlockElm = document.getElementById('emails-search-block');
                searchBlockElm.classList.remove('hidden');
                let searchClearElm = document.getElementById('emails-search-clear');
                searchClearElm.classList.remove('hidden');
                let searchTermElm = document.getElementById('emails-search-term');
                searchTermElm.innerText = term;

                await this.reload();
            }
        }

        clearSearch() {
            this.page = 1;
            this.term = '';

            let searchBlockElm = document.getElementById('emails-search-block');
            searchBlockElm.classList.add('hidden');
            let searchClearElm = document.getElementById('emails-search-clear');
            searchClearElm.classList.add('hidden');
        }

        async actionSave() {
            if (!this.renderedData) {
                return false;
            }
            await showLoader();
            try {
                let data = this.renderedData;
                await exec({
                    command: 'saveEmail',
                    params: {
                        attachment: data.id,
                        filename: 'message_' + data.id + '.eml'
                    }
                });
            } finally {
                await hideLoader();
            }
        }

        async init() {
            await this.reload();

            let refreshBtnElm = document.querySelector('#emails-reload');
            refreshBtnElm.addEventListener('click', () => {
                refreshBtnElm.classList.add('active');
                this.reload()
                    .catch(err => {
                        alert(err.message);
                    })
                    .finally(() => {
                        refreshBtnElm.classList.remove('active');
                    });
            });

            this.pageNextElm.addEventListener('click', () => {
                if (this.page < this.pages) {
                    this.page++;
                    this.pageNextElm.classList.add('active');
                    this.reload()
                        .catch(err => {
                            alert(err.message);
                        })
                        .finally(() => {
                            this.pageNextElm.classList.remove('active');
                        });
                }
            });

            this.pagePrevElm.addEventListener('click', () => {
                if (this.page > 1) {
                    this.page--;
                    this.pagePrevElm.classList.add('active');
                    this.reload()
                        .catch(err => {
                            alert(err.message);
                        })
                        .finally(() => {
                            this.pagePrevElm.classList.remove('active');
                        });
                }
            });

            let actionSaveElm = document.getElementById('email-action-save');
            actionSaveElm.addEventListener('click', () => {
                actionSaveElm.classList.add('active');
                this.actionSave()
                    .catch(err => {
                        alert(err.message);
                    })
                    .finally(() => {
                        actionSaveElm.classList.remove('active');
                    });
            });

            this.actionExternalElm.addEventListener('click', () => {
                if (typeof this.redrawWithExternal === 'function') {
                    this.redrawWithExternal();
                }
            });

            let searchBtnElm = document.querySelector('#emails-search');
            searchBtnElm.addEventListener('click', () => {
                searchBtnElm.classList.add('active');
                this.search()
                    .catch(err => {
                        alert(err.message);
                    })
                    .finally(() => {
                        searchBtnElm.classList.remove('active');
                    });
            });

            let searchClearElm = document.getElementById('emails-search-clear');
            searchClearElm.addEventListener('click', () => {
                this.clearSearch();

                this.reload().catch(err => {
                    alert(err.message);
                });
            });
        }
    }

    window.EmailsPage = EmailsPage;
})();
