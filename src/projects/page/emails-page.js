/* eslint global-require: 0 */
/* global window, document, exec, showLoader, hideLoader, DOMPurify, Tabs */

'use strict';

(() => {
    const humanize = require('humanize');
    const moment = require('moment');

    const htmlStyleTag = `<style>
        body, td, th, p {
            font-size: 13px;
            font-family: Sans-Serif;
            color: #0f0f0f;
        }
        body {
            max-width: 600px; /* body_max_width */
        }

        dl.info-dl {
            text-align: left;
            font-size: 13px;
            font-family: Sans-Serif;
            color: #0f0f0f;
            display: flex;
            flex-flow: row wrap;
            align-items: center;
        }
        dl.info-dl dt {
            text-align: left;
            font-size: 13px;
            font-family: Sans-Serif;
            color: #0f0f0f;
            flex-basis: 20%;
            padding: 2px 4px;
            text-align: left;
            font-weight: bold;
            line-height: 1.1rem;
        }

        dl.info-dl dt::after {
            content: ':';
        }

        dl.info-dl dd {
            flex-basis: 70%;
            flex-grow: 1;
            margin: 0;
            padding: 2px 4px;
            line-height: 1.1rem;
        }

        blockquote {
            border-left: 1px navy solid;
            padding-left: 5px;
        }
    </style>`;

    const plainStyleTag = `<style>
        body, td, th, p {
            font-size: 13px;
            font-family: Sans-Serif;
            color: #0f0f0f;
        }

        .text-content {
            font-family: sans-serif;
            white-space: pre-wrap;
        }
        
        body {
            max-width: 600px; /* body_max_width */
        }
        

        dl.info-dl {
            display: flex;
            flex-flow: row wrap;
            align-items: center;
        }
        
        dl.info-dl dt {
            flex-basis: 20%;
            padding: 2px 4px;
            text-align: left;
            font-weight: bold;
            line-height: 1.1rem;
        }

        dl.info-dl dt::after {
            content: ':';
        }

        dl.info-dl dd {
            flex-basis: 70%;
            flex-grow: 1;
            margin: 0;
            padding: 2px 4px;
            line-height: 1.1rem;
        }

        blockquote {
            border-left: 1px navy solid;
            padding-left: 5px;
        }
    </style>`;

    let proxyImage =
        'data:image/png;base64,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';

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

            this.viewTabs = new Tabs('email-tab');

            this.currentHtml = false;

            this.renderedData = false;

            this.lastChanges = 0;

            this.query = false;
            this.queryTerm = false;

            this.page = 1;
            this.pages = 1;
            this.visible = false;

            // overriden by main
            this.pageViews = false;
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

            if (this.actionExternalElm.parentNode) {
                this.actionButtonsElm.removeChild(this.actionExternalElm);
            }

            let tabHtmlContentElm = document.getElementById('email-tab-html-content');
            let tabPlainContentElm = document.getElementById('email-tab-plain-content');
            let tabHeadersContentElm = document.getElementById('email-tab-headers-content');
            let tabFilesListElm = document.getElementById('email-file-list');

            tabHtmlContentElm.innerHTML = '';
            tabPlainContentElm.innerHTML = '';
            tabHeadersContentElm.innerHTML = '';
            tabFilesListElm.innerHTML = '';

            this.currentHtml = '';

            this.redrawWithExternal = false;
            let drawHtml = async (html, keepExternalResources) => {
                tabHtmlContentElm.innerHTML = '';

                let purifyConfig = {
                    WHOLE_DOCUMENT: true,
                    keepExternalResources: !!keepExternalResources,
                    externalResourcesRef: {},
                    emailId: data.id
                };

                let clean = DOMPurify.sanitize(data.text.html, purifyConfig);

                let hasExternalResources = !keepExternalResources && window.__purifyRef.has(purifyConfig.externalResourcesRef);

                let cidMatches = Array.from(new Set(clean.match(/\[\[CID\/cid:(.*?)\/CID\]\]/g)));
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
                    clean = clean.replace(/\[\[CID\/cid:(.*?)\/CID\]\]/g, match => {
                        if (cidAttachments.has(match)) {
                            return cidAttachments.get(match);
                        } else {
                            return proxyImage;
                        }
                    });
                }

                if (hasExternalResources) {
                    if (!this.actionExternalElm.parentNode) {
                        this.actionButtonsElm.appendChild(this.actionExternalElm);
                    }
                    this.redrawWithExternal = () => drawHtml(html, true);
                } else {
                    if (this.actionExternalElm.parentNode) {
                        this.actionButtonsElm.removeChild(this.actionExternalElm);
                    }
                    this.redrawWithExternal = false;
                }

                if (clean.match(/<\/head\b[^>]*>/i)) {
                    clean = clean.replace(/<\/head\b[^>]*>/i, m => htmlStyleTag + m);
                } else {
                    clean = htmlStyleTag + clean;
                }
                clean = clean.replace();

                let iframe = document.createElement('iframe');
                iframe.setAttribute('sandbox', 'allow-popups allow-same-origin');
                iframe.srcdoc = clean;

                this.currentHtml = clean;

                tabHtmlContentElm.appendChild(iframe);
            };

            let drawPlain = text => {
                let escapeElm = document.createElement('span');
                escapeElm.textContent = text;
                let escaped = escapeElm.innerHTML.trim();

                let html = `<!doctype html><head><meta charset="utf-8">${plainStyleTag}</head><body><div class="text-content">${escaped}</div></body>`;

                let iframe = document.createElement('iframe');
                iframe.setAttribute('sandbox', 'allow-popups allow-same-origin');
                iframe.srcdoc = html;

                if (!this.currentHtml) {
                    this.currentHtml = html;
                }

                tabPlainContentElm.appendChild(iframe);
            };

            let drawHeaders = headers => {
                let escapeElm = document.createElement('span');
                escapeElm.textContent = headers.original.replace(/\t/g, '  ');
                let escaped = escapeElm.innerHTML.trim();

                let html = `<!doctype html><head><meta charset="utf-8">${plainStyleTag} <style>.text-content{font-family: monospace; white-space: pre;}</style></head><body><div class="text-content">${escaped}</div></body>`;

                let iframe = document.createElement('iframe');
                iframe.setAttribute('sandbox', 'allow-popups allow-same-origin');
                iframe.srcdoc = html;
                tabHeadersContentElm.appendChild(iframe);
            };

            let addFileRow = fileInfo => {
                fileInfo = fileInfo || {};
                let rowElm = document.createElement('tr');

                let cell01Elm = document.createElement('td');
                let cell02Elm = document.createElement('td');
                let cell03Elm = document.createElement('td');

                cell02Elm.classList.add('text-right');
                cell03Elm.classList.add('text-right');

                cell02Elm.style.width = '20%';
                cell03Elm.style.width = '20%';

                cell01Elm.textContent = fileInfo.title || fileInfo.filename;
                cell01Elm.title = fileInfo.filename;

                cell02Elm.textContent = humanize.filesize(Number(fileInfo.size) || 0, 1024, 0, '.', ' ');
                cell02Elm.title = Number(fileInfo.size) || 0;

                let fileSaveBtnElm = document.createElement('button');
                fileSaveBtnElm.classList.add('btn', 'btn-default');
                let fileSaveIconElm = document.createElement('span');
                fileSaveIconElm.classList.add('icon', 'icon-download');

                fileSaveBtnElm.appendChild(fileSaveIconElm);
                cell03Elm.appendChild(fileSaveBtnElm);

                rowElm.appendChild(cell01Elm);
                rowElm.appendChild(cell02Elm);
                rowElm.appendChild(cell03Elm);

                fileSaveBtnElm.addEventListener('click', ev => {
                    ev.stopPropagation();
                    ev.preventDefault();

                    let save = async () => {
                        if (!this.renderedData) {
                            return false;
                        }
                        await showLoader();
                        try {
                            let data = this.renderedData;
                            await exec({
                                command: 'saveAttachment',
                                params: {
                                    email: data.id,
                                    attachment: fileInfo.id,
                                    filename: fileInfo.filename
                                }
                            });
                        } finally {
                            await hideLoader();
                        }
                    };

                    save().catch(() => false);
                });

                document.getElementById('email-file-list').appendChild(rowElm);
            };

            let activeTab = false;
            if (data.text.html) {
                drawHtml(data.text.html, false).catch(() => false);

                this.viewTabs.show('html');
                if (!activeTab) {
                    this.viewTabs.activate('html');
                    activeTab = 'html';
                }

                addFileRow({
                    title: 'HTML message',
                    filename: 'message_' + data.id + '.html',
                    id: 'html',
                    contentType: 'application/octet-stream',
                    size: data.text.html.length
                });
            } else {
                this.viewTabs.hide('html');
            }

            if (data.text.plain) {
                drawPlain(data.text.plain);

                this.viewTabs.show('plain');
                if (!activeTab) {
                    this.viewTabs.activate('plain');
                    activeTab = 'plain';
                }

                addFileRow({
                    title: 'Plain text message',
                    filename: 'message_' + data.id + '.txt',
                    id: 'plain',
                    contentType: 'application/octet-stream',
                    size: data.text.plain.length
                });
            } else {
                this.viewTabs.hide('plain');
            }

            drawHeaders(data.headers);

            for (let attachmentData of data.attachments) {
                addFileRow(attachmentData);
            }

            this.viewTabs.show('headers');
            if (!activeTab) {
                this.viewTabs.activate('headers');
                activeTab = 'headers';
            }

            // keep reference for button actions
            this.renderedData = data;
        }

        async actionPdf() {
            if (!this.currentHtml || !this.renderedData) {
                return;
            }

            let infoHtml = '<dl class="info-dl">' + document.getElementById('email-info-list').innerHTML + '</dl>';

            let html = this.currentHtml;

            if (/<body\b[^>]*>/.test(html)) {
                html = html.replace(/<body\b[^>]*>/, m => m + infoHtml + '<hr />');
            } else {
                html = infoHtml + '<hr />' + html;
            }

            // remove max body width definition for PDF
            html = html.replace(/^.*body_max_width.*$/gm, '');

            await showLoader();
            try {
                await exec({
                    command: 'createPdf',
                    params: {
                        page: this.page,
                        html,
                        filename: 'message_' + this.renderedData.id + '.pdf'
                    }
                });
            } finally {
                await hideLoader();
            }
        }

        async actionOpen() {
            // no idea what to do here?
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

                    if (params.anyTo) {
                        params.anyTo = '%' + params.anyTo.replace(/^%|%$/g, '') + '%';
                    }
                }

                let list = await exec({
                    command: 'listEmails',
                    params
                });
                await this.render(list);
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
                'email-any-to': query.anyTo || '',
                'email-subject': query.subject || '',
                filename: (query.attachments && query.filename) || '',
                headers: query.headers
                    ? Object.keys(query.headers)
                          .map(key => {
                              return `${key}:${query.headers[key] === true ? '' : ' ' + query.headers[key]}`;
                          })
                          .join('\n')
                    : ''
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

            if (terms['email-any-to']) {
                let value = terms['email-any-to'].toString().trim();
                if (value) {
                    query.anyTo = value;
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

            if (terms.headers) {
                let value = terms.headers.toString().trim();
                if (value) {
                    let keys = {};
                    value
                        .split(/[\r\n]+/)
                        .map(l => l.trim())
                        .filter(l => l)
                        .map(l => {
                            let parts = l.split(':');
                            let key = parts.shift().trim();
                            let value = parts.join(':').trim();
                            keys[key] = value || true;
                        });
                    query.headers = keys;
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
                    command: 'searchEmails',
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

            let searchBlockElm = document.getElementById('emails-search-block');
            searchBlockElm.classList.remove('hidden');
            let searchClearElm = document.getElementById('emails-search-clear');
            searchClearElm.classList.remove('hidden');
            let searchTermElm = document.getElementById('emails-search-term');
            searchTermElm.innerText = this.queryTerm || 'user query';

            await this.reload();
        }

        clearSearch() {
            this.page = 1;
            this.query = false;
            this.queryTerm = false;

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
                        email: data.id,
                        filename: 'message_' + data.id + '.eml'
                    }
                });
            } finally {
                await hideLoader();
            }
        }

        createExportMbox() {
            showLoader()
                .then(() => this.focus())
                .then(() =>
                    exec({
                        command: 'createExportMbox',
                        params: {
                            query: this.query,
                            filename: 'export.mbox'
                        }
                    })
                )
                .catch(() => false)
                .finally(() => hideLoader());
        }

        async init() {
            await this.reload();

            let refreshBtnElm = document.querySelector('#emails-reload');
            refreshBtnElm.addEventListener('click', () => {
                refreshBtnElm.classList.add('active');
                this.reload()
                    .catch(() => false)
                    .finally(() => {
                        refreshBtnElm.classList.remove('active');
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

            let actionPdfElm = document.getElementById('email-action-pdf');
            actionPdfElm.addEventListener('click', () => {
                actionPdfElm.classList.add('active');
                this.actionPdf()
                    .catch(() => false)
                    .finally(() => {
                        actionPdfElm.classList.remove('active');
                    });
            });

            let actionSaveElm = document.getElementById('email-action-save');
            actionSaveElm.addEventListener('click', () => {
                actionSaveElm.classList.add('active');
                this.actionSave()
                    .catch(() => false)
                    .finally(() => {
                        actionSaveElm.classList.remove('active');
                    });
            });

            this.actionExternalElm.addEventListener('click', () => {
                if (typeof this.redrawWithExternal === 'function') {
                    showLoader()
                        .then(this.redrawWithExternal)
                        .catch(err => console.error(err))
                        .finally(hideLoader);
                }
            });

            let searchBtnElm = document.querySelector('#emails-search');
            searchBtnElm.addEventListener('click', () => {
                searchBtnElm.classList.add('active');
                this.search()
                    .catch(() => false)
                    .finally(() => {
                        searchBtnElm.classList.remove('active');
                    });
            });

            let searchClearElm = document.getElementById('emails-search-clear');
            searchClearElm.addEventListener('click', () => {
                this.clearSearch();

                this.reload().catch(() => false);
            });

            window.events.subscribe('menu-click', data => {
                switch (data.type) {
                    case 'export-mbox':
                        return this.createExportMbox();
                }
            });
        }
    }

    window.EmailsPage = EmailsPage;
})();
