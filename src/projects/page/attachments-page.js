/* eslint global-require: 0 */
/* global window, document, exec, showLoader, hideLoader */

'use strict';

(() => {
    const humanize = require('humanize');
    const moment = require('moment');

    class AttachmentsPage {
        constructor() {
            this.buttonGroupElms = Array.from(document.querySelectorAll('.attachments-component'));
            this.pageElm = document.getElementById('page-attachments');
            this.pageMenuElm = document.getElementById('page-menu-attachments');

            this.pageNrElm = document.getElementById('attachments-page-nr');
            this.pageTotalElm = document.getElementById('attachments-page-total');

            this.pageNextElm = document.getElementById('attachments-page-next');
            this.pagePrevElm = document.getElementById('attachments-page-prev');

            this.rowListElm = document.getElementById('attachments-list');
            this.rows = [];

            this.selectable = new window.Selectable(this.rows, (...args) => this.listAction(...args));

            this.lastChanges = 0;

            this.renderedData = false;

            this.query = false;
            this.queryTerm = false;
            this.page = 1;
            this.pages = 1;
            this.visible = false;

            // overriden by main
            this.pageViews = false;
        }

        async focus() {
            // overriden by main
        }

        async show() {
            this.buttonGroupElms.forEach(elm => elm.classList.remove('hidden'));
            this.pageElm.classList.remove('hidden');
            this.pageMenuElm.classList.add('active');

            document.getElementById('middle-pane').classList.add('fixed-pane');

            this.visible = true;

            if (this.page !== 1 || this.query) {
                this.clearSearch();
                this.lastChanges = window.__hasChanges;
                await this.reload();
            } else if (window.__hasChanges !== this.lastChanges) {
                this.lastChanges = window.__hasChanges;
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

            document.getElementById('middle-pane').classList.remove('fixed-pane');

            this.selectable.disable();
        }

        renderEmptyInfo() {
            let rowElm = document.createElement('tr');

            let cell01Elm = document.createElement('td');
            cell01Elm.setAttribute('colspan', '3');

            cell01Elm.innerHTML = 'Nothing to show here.<br/>Drop some email files here or use the Import menu.';
            cell01Elm.classList.add('empty-ad');

            rowElm.appendChild(cell01Elm);
            this.rowListElm.appendChild(rowElm);
        }

        renderListItem(data, nr) {
            let rowElm = document.createElement('tr');

            let cell01Elm = document.createElement('td');
            let cell02Elm = document.createElement('td');
            let cell03Elm = document.createElement('td');

            cell01Elm.classList.add('cell-01', 'text-right');
            cell02Elm.classList.add('cell-02');
            cell03Elm.classList.add('cell-07', 'text-right');

            cell01Elm.textContent = humanize.numberFormat(nr, 0, '.', ' ');

            let fileNameElm = document.createElement('div');
            fileNameElm.classList.add('contain-text');
            fileNameElm.textContent = data.filename;
            cell02Elm.appendChild(fileNameElm);
            cell03Elm.textContent = humanize.filesize(data.size || 0, 1024, 0, '.', ' ');

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

            this.rowListElm.innerHTML = '';
            this.rows = [];

            let startNr = (list.page - 1) * list.pageSize;
            for (let data of list.data) {
                this.renderListItem(data, ++startNr);
            }

            if (!list.data.length && this.page === 1 && !this.query) {
                this.renderEmptyInfo();
            }

            this.selectable.update(this.rows);
        }

        listAction(action) {
            switch (action) {
                case 'active':
                case 'deactivate':
                    return this.paintInfoWindow();
                case 'open':
                    this.actionOpen().catch(() => false);
                    return;
            }
        }

        paintInfoWindow() {
            let active = this.selectable.getSelected();

            if (!active) {
                document.getElementById('attachment-info').classList.add('hidden');
                document.getElementById('attachment-missing').classList.remove('hidden');
                return;
            } else {
                document.getElementById('attachment-info').classList.remove('hidden');
                document.getElementById('attachment-missing').classList.add('hidden');
            }

            let data = active.data;

            let previewElm = document.getElementById('attachment-preview');
            let iconElm = document.getElementById('attachment-icon');
            let infoList = document.getElementById('attachment-info-list');

            if (data.thumbnail) {
                let thumbnail = document.createElement('img');
                thumbnail.src = data.thumbnail;

                previewElm.innerHTML = '';
                previewElm.appendChild(thumbnail);
                previewElm.classList.remove('hidden');
                iconElm.classList.add('hidden');
            } else {
                iconElm.innerHTML = '';
                let attachmentIconElm = document.createElement('div');
                attachmentIconElm.classList.add('file-icon', 'file-icon--medium');
                attachmentIconElm.setAttribute(
                    'data-file',
                    data.filename
                        .split('.')
                        .pop()
                        .substr(0, 4) || 'bin'
                );
                iconElm.appendChild(attachmentIconElm);
                previewElm.classList.add('hidden');
                iconElm.classList.remove('hidden');
            }

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
                { key: 'filename', name: 'File name', type: 'text', contained: true },
                { key: 'size', name: 'Size', type: 'text', filesize: true },
                { key: 'contentType', name: 'Mime type', type: 'text' },
                { key: 'subject', name: 'Subject', type: 'text', contained: true },
                { key: 'hdate', name: 'Date', type: 'date' },
                { key: 'from', name: 'From', type: 'address' },
                { key: 'replyTo', name: 'Reply-To', type: 'address' },
                { key: 'to', name: 'To', type: 'address' },
                { key: 'cc', name: 'Cc', type: 'address' },
                { key: 'bcc', name: 'Bcc', type: 'address' }
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

            // keep reference for button actions
            this.renderedData = data;
        }

        async reload() {
            await showLoader();
            try {
                let params = {
                    page: this.page
                };

                if (this.query) {
                    params = Object.assign(params, this.query);

                    if (params.attachments && params.attachments.filename) {
                        params.attachments.filename = '%' + params.attachments.filename.replace(/^%|%$/g, '') + '%';
                    }

                    if (params.subject) {
                        params.subject = '%' + params.subject.replace(/^%|%$/g, '') + '%';
                    }

                    if (params.from) {
                        params.from = '%' + params.from.replace(/^%|%$/g, '') + '%';
                    }
                }

                let list = await exec({
                    command: 'listAttachments',
                    params
                });

                this.render(list);
            } finally {
                await hideLoader();
            }
        }

        fromLocaleDate(str) {
            if (!str) {
                return false;
            }
            let date = new Date(str);
            if (date.toString() === 'Invalid Date') {
                return false;
            }
            return date;
        }

        // 2019-11-14T03:04
        toLocaleDate(date) {
            if (!date) {
                return '';
            }

            if (typeof date === 'string') {
                date = new Date(date);
            }

            let year = date.getFullYear();
            let month = date.getMonth() + 1;
            let day = date.getDate();

            return `${year}-${(month < 10 ? '0' : '') + month}-${(day < 10 ? '0' : '') + day}`;
        }

        fromSearchQuery(query) {
            return {
                'email-content': query.term || '',
                'email-date-end': this.toLocaleDate(query.date && query.date.end),
                'email-date-start': this.toLocaleDate(query.date && query.date.start),
                'email-from': query.from || '',
                'email-subject': query.subject || '',
                filename: (query.attachments && query.attachments.filename) || '',
                'size-end': (query.attachments && query.attachments.size && query.attachments.size.end && query.attachments.size.end.toString()) || '',
                'size-start': (query.attachments && query.attachments.size && query.attachments.size.start && query.attachments.size.start.toString()) || '',
                'size-type': (query.attachments && query.attachments.size && query.attachments.size.type) || 'b'
            };
        }

        toSearchQuery(terms) {
            if (!terms || typeof terms !== 'object') {
                return false;
            }

            let query = {};

            if (terms.filename) {
                let value = terms.filename.toString().trim();
                if (value) {
                    if (!query.attachments) {
                        query.attachments = {};
                    }
                    query.attachments.filename = value;
                }
            }

            if (terms['email-content']) {
                let value = terms['email-content'].toString().trim();
                if (value) {
                    query.term = value;
                }
            }

            if (terms['email-from']) {
                let value = terms['email-from'].toString().trim();
                if (value) {
                    query.from = value;
                }
            }

            if (terms['email-subject']) {
                let value = terms['email-subject'].toString().trim();
                if (value) {
                    query.subject = value;
                }
            }

            if (terms['email-date-start']) {
                let value = this.fromLocaleDate(terms['email-date-start'] + 'T00:00:00');
                if (value) {
                    if (!query.date) {
                        query.date = {};
                    }
                    query.date.start = value;
                }
            }

            if (terms['email-date-end']) {
                let value = this.fromLocaleDate(terms['email-date-end'] + 'T23:59:59');
                if (value) {
                    if (!query.date) {
                        query.date = {};
                    }
                    query.date.end = value;
                }
            }

            if (terms['size-start']) {
                let value = Number(terms['size-start']);
                if (value) {
                    if (!query.attachments) {
                        query.attachments = {};
                    }
                    if (!query.attachments.size) {
                        query.attachments.size = {};
                    }
                    query.attachments.size.start = value;
                }
            }

            if (terms['size-end']) {
                let value = Number(terms['size-end']);
                if (value) {
                    if (!query.attachments) {
                        query.attachments = {};
                    }
                    if (!query.attachments.size) {
                        query.attachments.size = {};
                    }
                    query.attachments.size.end = value;
                }
            }

            if (terms['size-type']) {
                let value = terms['size-type']
                    .toString()
                    .trim()
                    .toLowerCase();
                if (value && query.attachments && query.attachments.size) {
                    query.attachments.size.type = value;
                }
            }

            if (!Object.keys(query).length) {
                return false;
            }

            return query;
        }

        async search(search, term) {
            if (!search) {
                let terms = await exec({
                    command: 'searchAttachments',
                    params: this.fromSearchQuery(this.query) || {}
                });

                search = this.toSearchQuery(terms);

                if (!search) {
                    if (this.query) {
                        return this.clearSearch();
                    } else {
                        // do nothing
                        return;
                    }
                }
            }

            this.query = search || false;
            this.queryTerm = term || false;

            this.page = 1;

            let searchBlockElm = document.getElementById('attachments-search-block');
            searchBlockElm.classList.remove('hidden');
            let searchClearElm = document.getElementById('attachments-search-clear');
            searchClearElm.classList.remove('hidden');
            let searchTermElm = document.getElementById('attachments-search-term');
            searchTermElm.innerText = this.queryTerm || 'user query';

            await this.reload();
        }

        clearSearch() {
            this.page = 1;
            this.query = false;
            this.queryTerm = false;

            let searchBlockElm = document.getElementById('attachments-search-block');
            searchBlockElm.classList.add('hidden');
            let searchClearElm = document.getElementById('attachments-search-clear');
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
                    command: 'saveAttachment',
                    params: {
                        attachment: data.id,
                        filename: data.filename
                    }
                });
            } finally {
                await hideLoader();
            }
        }

        async actionShow() {
            if (!this.renderedData) {
                return false;
            }
            let data = this.renderedData;

            await this.pageViews.emails.focus();
            try {
                await this.pageViews.emails.search({ id: data.email }, `"message:${data.email}"`);
                this.pageViews.emails.selectable.focus();
            } catch (err) {
                console.error(err);
            }
        }

        async actionOpen() {
            if (!this.renderedData) {
                return false;
            }
            await showLoader();
            try {
                let data = this.renderedData;
                await exec({
                    command: 'openAttachment',
                    params: {
                        attachment: data.id,
                        filename: data.filename
                    }
                });
            } finally {
                await hideLoader();
            }
        }

        async init() {
            await this.reload();

            let refreshBtnElm = document.querySelector('#attachments-reload');
            refreshBtnElm.addEventListener('click', () => {
                refreshBtnElm.classList.add('active');
                this.reload()
                    .catch(() => false)
                    .finally(() => {
                        refreshBtnElm.classList.remove('active');
                    });
            });

            let actionSaveElm = document.getElementById('attachment-action-save');
            actionSaveElm.addEventListener('click', () => {
                actionSaveElm.classList.add('active');
                this.actionSave()
                    .catch(() => false)
                    .finally(() => {
                        actionSaveElm.classList.remove('active');
                    });
            });

            let actionShowElm = document.getElementById('attachment-action-show');
            actionShowElm.addEventListener('click', () => {
                actionShowElm.classList.add('active');
                this.actionShow()
                    .catch(() => false)
                    .finally(() => {
                        actionShowElm.classList.remove('active');
                    });
            });

            let actionOpenElm = document.getElementById('attachment-action-open');
            actionOpenElm.addEventListener('click', () => {
                actionOpenElm.classList.add('active');
                this.actionOpen()
                    .catch(() => false)
                    .finally(() => {
                        actionOpenElm.classList.remove('active');
                    });
            });

            this.pageNextElm.addEventListener('click', () => {
                if (this.page < this.pages) {
                    this.page++;
                    this.pageNextElm.classList.add('active');
                    this.reload()
                        .catch(() => false)
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
                        .catch(() => false)
                        .finally(() => {
                            this.pagePrevElm.classList.remove('active');
                        });
                }
            });

            let searchBtnElm = document.querySelector('#attachments-search');
            searchBtnElm.addEventListener('click', () => {
                searchBtnElm.classList.add('active');
                this.search()
                    .catch(() => false)
                    .finally(() => {
                        searchBtnElm.classList.remove('active');
                    });
            });

            let searchClearElm = document.getElementById('attachments-search-clear');
            searchClearElm.addEventListener('click', () => {
                this.clearSearch();

                this.reload().catch(() => false);
            });
        }
    }

    window.AttachmentsPage = AttachmentsPage;
})();
