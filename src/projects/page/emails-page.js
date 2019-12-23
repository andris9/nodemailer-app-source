/* eslint global-require: 0 */
/* global window, document, exec, showLoader, hideLoader, DOMPurify, Tabs, confirm, Tagify, alert */

'use strict';

(() => {
    const humanize = require('humanize');
    const moment = require('moment');
    const beautifyHtml = require('js-beautify').html;

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
            this.componentElms = Array.from(document.querySelectorAll('.emails-component'));
            this.pageElm = document.getElementById('page-emails');
            this.pageMenuElm = document.getElementById('page-menu-emails');

            this.pageNrElm = document.getElementById('emails-page-nr');
            this.pageTotalElm = document.getElementById('emails-page-total');

            this.pageNextElm = document.getElementById('emails-page-next');
            this.pagePrevElm = document.getElementById('emails-page-prev');

            this.actionButtonsElm = document.getElementById('email-action-buttons');
            this.actionExternalElm = document.getElementById('email-action-external');
            this.actionButtonsElm.removeChild(this.actionExternalElm);

            this.activeTag = false;
            this.emailsTagsRows = [];
            this.emailsTagsList = document.getElementById('email-tags-list');
            this.emailsTagsAll = document.getElementById('email-tags-all');

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

            let setupTags = () => {
                let currentList = [];

                let keyElm = document.createElement('dt');
                keyElm.classList.add('pdf-hide');
                keyElm.textContent = 'Labels';
                infoList.appendChild(keyElm);

                let valElm = document.createElement('dd');
                valElm.style.minHeight = '32px';
                valElm.classList.add('pdf-hide');

                let tagsElm = document.createElement('input');
                tagsElm.classList.add('tags-input');
                tagsElm.setAttribute('value', currentList.join(','));

                valElm.appendChild(tagsElm);

                infoList.appendChild(valElm);

                let initializing = true;
                let hasChanges = list => {
                    if (initializing) {
                        return false;
                    }
                    try {
                        if (list.length !== currentList.length) {
                            return true;
                        }

                        for (let i = 0; i < currentList.length; i++) {
                            if (currentList[i] !== list[i]) {
                                return true;
                            }
                        }

                        return false;
                    } finally {
                        currentList = list;
                    }
                };

                let tagify = new Tagify(tagsElm);

                let checkChanges = () => {
                    if (!hasChanges(tagify.value.map(tag => tag.value))) {
                        return;
                    }
                    exec({
                        command: 'updateTags',
                        params: {
                            email: data.id,
                            tags: currentList
                        }
                    });
                };

                let suggestions = e => {
                    exec({
                        command: 'getTags',
                        params: {
                            email: data.id
                        }
                    }).then(function(result) {
                        tagify.settings.whitelist.length = 0; // reset current whitelist
                        tagify.settings.whitelist.splice(0, result.length, ...result);
                        // render the suggestions dropdown. "newValue" is when "input" event is called while editing a tag
                        tagify.loading(false).dropdown.show.call(tagify, e.detail.value);
                    });
                };

                tagify
                    .on('input', suggestions)
                    .on('add', checkChanges)
                    .on('remove', checkChanges);

                exec({
                    command: 'getEmailTags',
                    params: {
                        email: data.id
                    }
                }).then(list => {
                    currentList = [].concat(list || []);
                    tagify.addTags([].concat(list || []));
                    initializing = false;
                });
            };

            setupTags();

            if (this.actionExternalElm.parentNode) {
                this.actionButtonsElm.removeChild(this.actionExternalElm);
            }

            let tabHtmlContentElm = document.getElementById('email-tab-html-content');
            let tabPlainContentElm = document.getElementById('email-tab-plain-content');
            let tabHeadersContentElm = document.getElementById('email-tab-headers-content');
            let tabFilesListElm = document.getElementById('email-file-list');
            let tabMetadataListElm = document.getElementById('email-metadata-list');
            let tabHtmlSourceContentElm = document.getElementById('email-tab-html-source-content');

            tabHtmlContentElm.innerHTML = '';
            tabPlainContentElm.innerHTML = '';
            tabHeadersContentElm.innerHTML = '';
            tabFilesListElm.innerHTML = '';
            tabMetadataListElm.innerHTML = '';
            tabHtmlSourceContentElm.innerHTML = '';

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

            let drawHtmlSource = text => {
                let escapeElm = document.createElement('span');

                try {
                    text = beautifyHtml(text, {});
                } catch (err) {
                    // might happen
                }

                escapeElm.textContent = text;
                let escaped = escapeElm.innerHTML.trim();

                let html = `<!doctype html><head><meta charset="utf-8">${plainStyleTag} <style>.text-content{font-family: monospace; white-space: pre;}</style></head><body><div class="text-content">${escaped}</div></body>`;

                let iframe = document.createElement('iframe');
                iframe.setAttribute('sandbox', 'allow-popups allow-same-origin');
                iframe.srcdoc = html;

                if (!this.currentHtml) {
                    this.currentHtml = html;
                }

                tabHtmlSourceContentElm.appendChild(iframe);
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

            let addMetadataRow = info => {
                info = info || {};
                let rowElm = document.createElement('tr');

                let cell01Elm = document.createElement('td');
                let cell02Elm = document.createElement('td');

                cell01Elm.style.width = '20%';

                cell01Elm.textContent = info.key;
                cell01Elm.title = info.key;

                if (info.action) {
                    let actionBtnElm = document.createElement('button');
                    actionBtnElm.classList.add('btn', 'btn-mini', 'btn-default');
                    actionBtnElm.style.float = 'right';

                    let iconElm = document.createElement('span');
                    iconElm.classList.add('icon', 'icon-' + info.action.icon);
                    actionBtnElm.appendChild(iconElm);

                    actionBtnElm.addEventListener('click', ev => {
                        ev.stopPropagation();
                        ev.preventDefault();

                        info.action.handler().catch(err => console.error(err));
                    });

                    let textElm = document.createElement('span');
                    textElm.textContent = info.value;
                    textElm.title = info.value;
                    textElm.classList.add('text-select');

                    cell02Elm.appendChild(actionBtnElm);
                    cell02Elm.appendChild(textElm);
                } else {
                    cell02Elm.textContent = info.value;
                    cell02Elm.title = info.value;
                    cell02Elm.classList.add('text-select');
                }

                rowElm.appendChild(cell01Elm);
                rowElm.appendChild(cell02Elm);

                document.getElementById('email-metadata-list').appendChild(rowElm);
            };

            let getPrefs = async () => {
                let preferences = await exec({
                    command: 'getPreferences'
                });
                return preferences.generalJson || {};
            };

            let activeTab = false;

            let currentActiveTab = this.viewTabs.getActive();
            switch (currentActiveTab) {
                case 'html':
                case 'plain':
                    // do nothing, use default
                    break;

                case 'html-source':
                    if (data.text.html) {
                        activeTab = 'html-source';
                    }
                    break;
                case 'headers':
                case 'files':
                    activeTab = currentActiveTab;
                    break;
                case 'metadata':
                    if (data.source) {
                        activeTab = 'metadata';
                    }
                    break;
            }

            if (data.text.html) {
                getPrefs()
                    .then(prefs => drawHtml(data.text.html, !prefs.disableRemote))
                    .catch(err => console.error(err));
                drawHtmlSource(data.text.html);

                this.viewTabs.show('html');
                this.viewTabs.show('html-source');
                if (!activeTab || activeTab === 'html') {
                    this.viewTabs.activate('html');
                    activeTab = 'html';
                }

                if (activeTab === 'html-source') {
                    this.viewTabs.activate('html-source');
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
                this.viewTabs.hide('html-source');
            }

            if (data.text.plain) {
                drawPlain(data.text.plain);

                this.viewTabs.show('plain');
                if (!activeTab || activeTab === 'plain') {
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

            for (let attachmentData of data.attachments) {
                addFileRow(attachmentData);
            }

            if (activeTab === 'files') {
                this.viewTabs.activate('files');
            }

            drawHeaders(data.headers);
            this.viewTabs.show('headers');
            if (!activeTab || activeTab === 'headers') {
                this.viewTabs.activate('headers');
                activeTab = 'headers';
            }

            if (data.source) {
                this.viewTabs.show('metadata');

                let getTextValue = address => {
                    return (address && address.address) || address || '';
                };

                if (data.source.format) {
                    addMetadataRow({ key: 'Source Format', value: data.source.format.replace(/^./, c => c.toUpperCase()) });
                }

                if (data.source.filename) {
                    addMetadataRow({
                        key: 'Source File',
                        value: data.source.filename,
                        action: {
                            icon: 'folder',
                            async handler() {
                                let opened = await exec({
                                    command: 'showItemInFolder',
                                    params: {
                                        filename: data.source.filename
                                    }
                                });
                                if (!opened) {
                                    alert('Source file not found');
                                }
                            }
                        }
                    });
                }

                if (data.idate) {
                    addMetadataRow({ key: 'Envelope Date', value: moment(data.idate).format('LLL') });
                }

                if (data.hdate) {
                    addMetadataRow({ key: 'Header Date', value: moment(data.hdate).format('LLL') });
                }

                if (data.labels) {
                    for (let label of [].concat(data.labels || [])) {
                        addMetadataRow({ key: 'Mailbox', value: label });
                    }
                }

                if (data.flags && data.flags.length) {
                    addMetadataRow({ key: 'Message Flags', value: data.flags.join(', ') });
                }

                if (data.source.envelope) {
                    if (data.source.envelope.mailFrom) {
                        addMetadataRow({ key: 'From', value: getTextValue(data.source.envelope.mailFrom) });
                    } else if (data.source.envelope.sender) {
                        addMetadataRow({ key: 'From', value: getTextValue(data.source.envelope.sender) });
                    } else if (data.returnPath) {
                        addMetadataRow({ key: 'From', value: getTextValue(data.returnPath) });
                    }

                    for (let addr of [].concat(data.source.envelope.rcptTo || [])) {
                        addMetadataRow({ key: 'Recipient', value: getTextValue(addr) });
                    }

                    for (let addr of [].concat(data.source.envelope.recipient || [])) {
                        addMetadataRow({ key: 'Recipient', value: getTextValue(addr) });
                    }

                    Object.keys(data.source.envelope.attributes || {}).forEach(key => {
                        let fKey = key.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase());
                        addMetadataRow({ key: fKey, value: data.source.envelope.attributes[key] });
                    });
                }

                if (!activeTab || activeTab === 'metadata') {
                    this.viewTabs.activate('metadata');
                    activeTab = 'metadata';
                }
            } else {
                this.viewTabs.hide('metadata');
            }

            // keep reference for button actions
            this.renderedData = data;
        }

        async actionPdf() {
            if (!this.currentHtml || !this.renderedData) {
                return;
            }

            let tempInfoElm = document.createElement('div');
            let infoHtmlElm = document.createElement('dl');
            infoHtmlElm.classList.add('info-dl');
            tempInfoElm.appendChild(infoHtmlElm);

            infoHtmlElm.innerHTML = document.getElementById('email-info-list').innerHTML;
            for (let removeElm of infoHtmlElm.querySelectorAll('.pdf-hide')) {
                removeElm.parentNode.removeChild(removeElm);
            }

            let infoHtml = tempInfoElm.innerHTML;

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

        async focus() {
            // overriden by main
        }

        async show() {
            this.componentElms.forEach(elm => elm.classList.remove('hidden'));
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
            this.componentElms.forEach(elm => elm.classList.add('hidden'));
            this.pageElm.classList.add('hidden');
            this.pageMenuElm.classList.remove('active');
            this.visible = false;

            this.viewTabs.clear();

            document.getElementById('middle-pane').classList.remove('fixed-pane');

            this.selectable.disable();
        }

        async reload() {
            this._reloading = true;
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

                if (this.activeTag) {
                    params.tags = [this.activeTag];
                }

                let list = await exec({
                    command: 'listEmails',
                    params
                });
                await this.render(list);
            } finally {
                await hideLoader();
                this._reloading = false;
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
                //'email-tags': (query.tags && query.tags.join(', ')) || '',
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

            /*
            if (terms['email-tags']) {
                let value = terms['email-tags']
                    .toString()
                    .split(',')
                    .map(val => val.trim())
                    .filter(val => val);
                if (value) {
                    query.tags = value;
                }
            }
            */

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
                if (this.searchPending) {
                    return;
                }
                this.searchPending = true;
                let terms;
                try {
                    terms = await exec({
                        command: 'searchEmails',
                        params: this.fromSearchQuery(this.query) || {}
                    });
                } finally {
                    this.searchPending = false;
                }

                search = this.toSearchQuery(terms);

                if (!search) {
                    if (this.query) {
                        return this.clearSearch();
                    } else {
                        // do nothing
                        return;
                    }
                }
            } else {
                // external search, clear label
                this.setActiveEmailTag();
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

        async actionUpload() {
            if (!this.renderedData) {
                return false;
            }
            await showLoader();
            try {
                let data = this.renderedData;
                await exec({
                    command: 'uploadEmail',
                    params: {
                        email: data.id
                    }
                });
            } finally {
                await hideLoader();
            }
        }

        async actionViewSource() {
            if (!this.renderedData) {
                return false;
            }
            await showLoader();
            try {
                let data = this.renderedData;
                await exec({
                    command: 'showViewSource',
                    params: {
                        email: data.id
                    }
                });
            } finally {
                await hideLoader();
            }
        }

        flushMessages() {
            if (!confirm(`Are you sure you want to flush all messages from this project?`)) {
                return;
            }
            showLoader()
                .then(() => this.focus())
                .then(() =>
                    exec({
                        command: 'flushMessages'
                    })
                )
                .then(() => this.reload())
                .catch(() => false)
                .finally(() => hideLoader());
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

        async flush() {
            await this.render({
                page: 1,
                pages: 0,
                data: []
            });
            this.selectable.select();
            await this.drawTagsList();
        }

        find() {
            this.search().catch(() => false);
        }

        setActiveEmailTag(tag, skipReload) {
            if (tag === this.activeTag || this._reloading) {
                return;
            }

            this.page = 1;

            if (this.activeTag) {
                let active = this.emailsTagsRows.find(row => row.tag === this.activeTag);
                if (active) {
                    active.row.classList.remove('active');
                }
            } else {
                this.emailsTagsAll.classList.remove('active');
            }

            this.activeTag = tag;
            if (this.activeTag) {
                let active = this.emailsTagsRows.find(row => row.tag === this.activeTag);
                if (active) {
                    active.row.classList.add('active');
                }
            } else {
                this.emailsTagsAll.classList.add('active');
            }

            if (skipReload) {
                return;
            }

            this.reload()
                .then(() => {
                    this.selectable.selectFirst(true);
                })
                .catch(() => false);
        }

        async drawTagsList() {
            let currentRows = this.emailsTagsList.querySelectorAll('.emails-tags-item');
            for (let row of currentRows) {
                this.emailsTagsList.removeChild(row);
            }
            this.emailsTagsRows = [];
            let hasActiveTag = false;
            try {
                let tags = await exec({
                    command: 'getTags'
                });
                for (let tag of tags) {
                    let linkElm = document.createElement('a');
                    linkElm.classList.add('nav-group-item', 'emails-tags-item');
                    let iconElm = document.createElement('span');
                    iconElm.classList.add('icon', 'icon-bookmark');
                    let textElm = document.createElement('span');
                    textElm.textContent = ' ' + tag;

                    linkElm.dataset.tag = tag;

                    linkElm.appendChild(iconElm);
                    linkElm.appendChild(textElm);
                    this.emailsTagsList.appendChild(linkElm);

                    if (this.activeTag === tag) {
                        linkElm.classList.add('active');
                        hasActiveTag = true;
                    }

                    linkElm.addEventListener('click', () => this.setActiveEmailTag(tag));
                    linkElm.addEventListener('touchstart', () => this.setActiveEmailTag(tag));
                    this.emailsTagsRows.push({
                        tag,
                        row: linkElm
                    });
                }
                if (!this.activeTag || !tags.length) {
                    this.emailsTagsAll.classList.add('active');
                }
                if (this.activeTag && !hasActiveTag) {
                    // no suitable tag element found, reset
                    this.setActiveEmailTag();
                }
            } catch (err) {
                console.error(err);
            }
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

            let actionUploadElm = document.getElementById('email-action-upload');
            actionUploadElm.addEventListener('click', () => {
                actionUploadElm.classList.add('active');
                this.actionUpload()
                    .catch(() => false)
                    .finally(() => {
                        actionUploadElm.classList.remove('active');
                    });
            });

            let actionViewSourceElm = document.getElementById('email-action-view-source');
            actionViewSourceElm.addEventListener('click', () => {
                actionViewSourceElm.classList.add('active');
                this.actionViewSource()
                    .catch(() => false)
                    .finally(() => {
                        actionViewSourceElm.classList.remove('active');
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

            await this.drawTagsList();
            this.emailsTagsAll.addEventListener('click', () => this.setActiveEmailTag());

            window.events.subscribe('menu-click', data => {
                switch (data.type) {
                    case 'export-mbox':
                        return this.createExportMbox();
                    case 'flush-messages':
                        return this.flushMessages();
                }
            });

            window.events.subscribe('message-received', data => {
                if (data && data.id && this.page === 1 && !this.query) {
                    if (this.visible) {
                        this.lastChanges = ++window.__hasChanges;
                        this.reload()
                            .then(() => {
                                this.selectable.select(data.id);
                            })
                            .catch(err => {
                                console.error(err);
                            });
                    } else {
                        window.__hasChanges++;
                    }
                }
            });

            window.events.subscribe('tagchange', () => {
                this.drawTagsList().catch(err => console.error(err));
            });
        }
    }

    window.EmailsPage = EmailsPage;
})();
