'use strict';
/* eslint global-require: 0 */
/* globals document, alert, exec, window */

(() => {
    const humanize = require('humanize');
    const { getCurrentWindow, Menu, MenuItem } = require('electron').remote;

    class ImportPage {
        constructor() {
            this.importListElm = document.getElementById('import-list');
            this.imports = [];

            this.buttonGroupElm = document.getElementById('import-button-group');
            this.pageImportsElm = document.getElementById('page-imports');
            this.pageMenuImportsElm = document.getElementById('page-menu-imports');

            this.visible = false;
        }

        show() {
            this.buttonGroupElm.classList.remove('hidden');
            this.pageImportsElm.classList.remove('hidden');
            this.pageMenuImportsElm.classList.add('active');
            this.visible = true;
        }

        hide() {
            this.buttonGroupElm.classList.add('hidden');
            this.pageImportsElm.classList.add('hidden');
            this.pageMenuImportsElm.classList.remove('active');
            this.visible = false;
        }

        async init() {
            const menu = new Menu();
            menu.append(
                new MenuItem({
                    label: 'Import from MBOX',
                    click() {
                        exec({
                            command: 'createImportFromFile'
                        })
                            .then(res => {
                                if (res) {
                                    alert(`Import started`);
                                }
                            })
                            .catch(() => false);
                    }
                })
            );

            menu.append(
                new MenuItem({
                    label: 'Import from MAILDIR',
                    click() {
                        exec({
                            command: 'createImportFromMaildir'
                        })
                            .then(res => {
                                if (res) {
                                    alert(`Import started`);
                                }
                            })
                            .catch(() => false);
                    }
                })
            );

            menu.append(
                new MenuItem({
                    label: 'Scan folder for EML files',
                    click() {
                        exec({
                            command: 'createImportFromFolder'
                        })
                            .then(res => {
                                if (res) {
                                    alert(`Import started`);
                                }
                            })
                            .catch(() => false);
                    }
                })
            );

            // Add the listener
            let menuBtnElm = document.querySelector('#imports-import-menu');
            menuBtnElm.addEventListener('click', () => {
                let rect = menuBtnElm.getBoundingClientRect();
                menu.popup({ window: getCurrentWindow(), x: Math.round(rect.x), y: Math.ceil(rect.y + rect.height) });
            });

            await this.reloadImports();
            window.events.subscribe('import-update', data => {
                let importRow = this.imports.find(row => row.data.id === data.id);

                if (importRow) {
                    importRow.data = data;
                    this.paintImportCell(importRow.elm, data);
                }
            });

            window.events.subscribe('import-list', data => {
                this.renderImports(data);
            });
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

            this.imports.push({ data: importData, elm: rowElm });
            this.importListElm.appendChild(rowElm);
            this.paintImportCell(rowElm, importData);
        }

        renderImports(list) {
            if (!list || !list.data) {
                return;
            }

            this.imports.forEach(importData => {
                if (importData.elm.parentNode === this.importListElm) {
                    this.importListElm.removeChild(importData.elm);
                }
            });
            this.imports = [];

            list.data.forEach(importData => {
                this.renderImportListItem(importData);
            });

            return true;
        }

        async reloadImports() {
            let list = await exec({
                command: 'listImports'
            });

            this.renderImports(list);
        }
    }

    class ContactsPage {
        constructor() {
            this.buttonGroupElm = document.getElementById('contacts-button-group');
            this.pageContactsElm = document.getElementById('page-contacts');
            this.pageMenuContactsElm = document.getElementById('page-menu-contacts');

            this.visible = false;
        }

        show() {
            this.buttonGroupElm.classList.remove('hidden');
            this.pageContactsElm.classList.remove('hidden');
            this.pageMenuContactsElm.classList.add('active');
            this.visible = true;
        }

        hide() {
            this.buttonGroupElm.classList.add('hidden');
            this.pageContactsElm.classList.add('hidden');
            this.pageMenuContactsElm.classList.remove('active');
            this.visible = false;
        }

        async init() {}
    }

    async function main() {
        let pages = {
            imports: new ImportPage(),
            contacts: new ContactsPage()
        };

        // show import page by default
        let selected = 'imports';
        pages.imports.show();

        await Promise.all([pages.imports.init(), pages.contacts.init()]);

        let menuItems = Array.from(document.querySelectorAll('.page-menu'));
        menuItems.forEach(menuItem => {
            let target = menuItem.dataset.target;

            menuItem.addEventListener('click', () => {
                if (!pages[target] || target === selected) {
                    // nothing to do here
                    return;
                }
                pages[selected].hide();
                pages[target].show();
                selected = target;
            });
        });
    }

    main().catch(err => alert(err.message));
})();
