/* eslint global-require: 0 */
/* global window, document, exec, showLoader, hideLoader */

'use strict';

(() => {
    const fs = require('fs').promises;
    const humanize = require('humanize');
    const { getCurrentWindow, Menu, MenuItem } = require('electron').remote;

    window.__hasChanges = 0;

    class ImportPage {
        constructor() {
            this.importListElm = document.getElementById('import-list');
            this.rows = [];

            this.buttonGroupElms = Array.from(document.querySelectorAll('.import-button-group'));
            this.pageElm = document.getElementById('page-imports');
            this.pageMenuElm = document.getElementById('page-menu-imports');

            this.selectable = new window.Selectable(this.rows, (...args) => this.listAction(...args));

            this.visible = false;
        }

        listAction(action, row) {
            console.log(action, row);
        }

        async focus() {
            // overriden by main
        }

        async show() {
            this.buttonGroupElms.forEach(elm => elm.classList.remove('hidden'));
            this.pageElm.classList.remove('hidden');
            this.pageMenuElm.classList.add('active');
            this.visible = true;

            this.selectable.activate();
        }

        async hide() {
            this.buttonGroupElms.forEach(elm => elm.classList.add('hidden'));
            this.pageElm.classList.add('hidden');
            this.pageMenuElm.classList.remove('active');
            this.visible = false;

            this.selectable.disable();
        }

        createImport(filePaths) {
            showLoader()
                .then(() =>
                    exec({
                        command: 'createImport',
                        params: {
                            filePaths: filePaths || false
                        }
                    })
                )
                .then(() => this.focus())
                .catch(() => false)
                .finally(() => hideLoader());
        }

        createImportFromMaildir() {
            showLoader()
                .then(() =>
                    exec({
                        command: 'createImportFromMaildir'
                    })
                )
                .then(() => this.focus())
                .catch(() => false)
                .finally(() => hideLoader());
        }

        createImportFromFolder() {
            showLoader()
                .then(() =>
                    exec({
                        command: 'createImportFromFolder'
                    })
                )
                .then(() => this.focus())
                .catch(() => false)
                .finally(() => hideLoader());
        }

        async init() {
            const menu = new Menu();

            menu.append(
                new MenuItem({
                    label: 'Import from email files…',
                    click: () => {
                        this.createImport();
                    }
                })
            );

            menu.append(
                new MenuItem({
                    label: 'Import from Maildir…',
                    click: () => {
                        this.createImportFromMaildir();
                    }
                })
            );

            menu.append(
                new MenuItem({
                    label: 'Scan folder recursively for *.eml files…',
                    click: () => {
                        this.createImportFromFolder();
                    }
                })
            );

            if (typeof process !== 'undefined' && process && process.env && process.env.USER) {
                try {
                    let path = '/var/mail/' + process.env.USER;
                    let stats = await fs.stat(path);
                    if (stats && stats.size) {
                        menu.append(
                            new MenuItem({
                                label: 'Import local mail account',
                                click: () => {
                                    showLoader()
                                        .then(() =>
                                            exec({
                                                command: 'createImport',
                                                params: {
                                                    filePaths: [path]
                                                }
                                            })
                                        )
                                        .then(() => this.focus())
                                        .catch(() => false)
                                        .finally(() => hideLoader());
                                }
                            })
                        );
                    }
                } catch (err) {
                    // just ignore
                }
            }

            // Add the listener
            let menuBtnElm = document.querySelector('#imports-import-menu');
            menuBtnElm.addEventListener('click', () => {
                let rect = menuBtnElm.getBoundingClientRect();
                menu.popup({ window: getCurrentWindow(), x: Math.round(rect.x), y: Math.ceil(rect.y + rect.height) });
            });

            await this.reloadImports();
            window.events.subscribe('import-update', data => {
                let importRow = this.rows.find(row => row.data.id === data.id);

                if (importRow) {
                    importRow.data = data;
                    this.paintImportCell(importRow.elm, data);

                    window.__hasChanges++;
                }
            });

            window.events.subscribe('import-list', data => {
                this.renderImports(data);
            });

            window.events.subscribe('menu-click', data => {
                switch (data.type) {
                    case 'import-create':
                        return this.createImport();
                    case 'import-maildir':
                        return this.createImportFromMaildir();
                    case 'import-folder':
                        return this.createImportFromFolder();
                }
            });

            let dropElm = document.getElementById('middle-pane');
            dropElm.ondragover = () => false;
            dropElm.ondragleave = () => false;
            dropElm.ondragend = () => false;
            dropElm.ondrop = e => {
                e.preventDefault();

                let filePaths = [];
                for (let f of e.dataTransfer.files) {
                    filePaths.push(f.path);
                }

                if (filePaths.length) {
                    this.createImport(filePaths);
                }

                return false;
            };
        }

        paintImportCell(rowElm, importData) {
            rowElm.querySelector('td.cell-01').textContent = humanize.date('Y-m-d H:i', new Date(importData.created));
            rowElm.querySelector('td.cell-02').textContent = humanize.numberFormat(importData.emails, 0, '.', ' ');
            rowElm.querySelector('td.cell-03').textContent = humanize.filesize(importData.size || 0, 1024, 0, '.', ' ');
            rowElm.querySelector('td.cell-04').textContent = (importData.totalsize ? Math.round((importData.processed / importData.totalsize) * 100) : 0) + '%';
            rowElm.querySelector('td.cell-05').textContent = !importData.finished ? 'Importing…' : importData.errored ? 'Failed' : 'Finished';
        }

        renderImportListItem(importData) {
            let rowElm = document.createElement('tr');

            let cell01Elm = document.createElement('td');
            let cell02Elm = document.createElement('td');
            let cell03Elm = document.createElement('td');
            let cell04Elm = document.createElement('td');
            let cell05Elm = document.createElement('td');

            cell01Elm.classList.add('cell-01');
            cell02Elm.classList.add('cell-02', 'text-right');
            cell03Elm.classList.add('cell-03', 'text-right');
            cell04Elm.classList.add('cell-04', 'text-right');
            cell05Elm.classList.add('cell-05');

            rowElm.appendChild(cell01Elm);
            rowElm.appendChild(cell02Elm);
            rowElm.appendChild(cell03Elm);
            rowElm.appendChild(cell04Elm);
            rowElm.appendChild(cell05Elm);

            this.rows.push({ data: importData, elm: rowElm });
            this.importListElm.appendChild(rowElm);
            this.paintImportCell(rowElm, importData);
        }

        renderImports(list) {
            if (!list || !list.data) {
                return;
            }

            this.rows.forEach(importData => {
                if (importData.elm.parentNode === this.importListElm) {
                    this.importListElm.removeChild(importData.elm);
                }
            });
            this.rows = [];

            list.data.forEach(importData => {
                this.renderImportListItem(importData);
            });

            this.selectable.update(this.rows);

            return true;
        }

        async reloadImports() {
            let list = await exec({
                command: 'listImports'
            });

            this.renderImports(list);
        }
    }

    window.ImportPage = ImportPage;
})();
