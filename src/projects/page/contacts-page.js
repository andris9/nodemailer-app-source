/* eslint global-require: 0 */
/* global window, document, exec, showLoader, hideLoader */

'use strict';

(() => {
    const humanize = require('humanize');

    class ContactsPage {
        constructor() {
            this.componentElms = Array.from(document.querySelectorAll('.contacts-component'));
            this.pageElm = document.getElementById('page-contacts');
            this.pageMenuElm = document.getElementById('page-menu-contacts');

            this.pageNrElm = document.getElementById('contacts-page-nr');
            this.pageTotalElm = document.getElementById('contacts-page-total');

            this.pageNextElm = document.getElementById('contacts-page-next');
            this.pagePrevElm = document.getElementById('contacts-page-prev');

            this.rowListElm = document.getElementById('contacts-list');
            this.rows = [];

            this.selectable = new window.Selectable(this.rows, (...args) => this.listAction(...args));

            this.lastChanges = 0;

            this.term = '';
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
            this.componentElms.forEach(elm => elm.classList.remove('hidden'));
            this.pageElm.classList.remove('hidden');
            this.pageMenuElm.classList.add('active');
            this.visible = true;

            if (this.page !== 1 || this.term) {
                this.clearSearch();
                this.lastChanges = window.__hasChanges;
                await this.reload();
            } else if (window.__hasChanges !== this.lastChanges) {
                this.lastChanges = window.__hasChanges;
                await this.reload();
            }

            this.selectable.activate();
        }

        async hide() {
            this.componentElms.forEach(elm => elm.classList.add('hidden'));
            this.pageElm.classList.add('hidden');
            this.pageMenuElm.classList.remove('active');
            this.visible = false;

            this.selectable.disable();
        }

        renderEmptyInfo() {
            let rowElm = document.createElement('tr');

            let cell01Elm = document.createElement('td');
            cell01Elm.setAttribute('colspan', '4');

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
            let cell04Elm = document.createElement('td');

            cell01Elm.classList.add('cell-01', 'text-right');
            cell02Elm.classList.add('cell-02');
            cell03Elm.classList.add('cell-03');
            cell04Elm.classList.add('cell-04', 'text-right');

            cell01Elm.textContent = humanize.numberFormat(nr, 0, '.', ' ');
            cell02Elm.textContent = data.name || '';
            cell03Elm.textContent = data.address;
            cell04Elm.textContent = humanize.numberFormat(data.messages, 0, '.', ' ');

            rowElm.appendChild(cell01Elm);
            rowElm.appendChild(cell02Elm);
            rowElm.appendChild(cell03Elm);
            rowElm.appendChild(cell04Elm);

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

            if (!list.data.length && this.page === 1 && !this.term) {
                this.renderEmptyInfo();
            }

            this.selectable.update(this.rows);
        }

        async reload() {
            await showLoader();
            let list = await exec({
                command: 'listContacts',
                params: {
                    page: this.page,
                    term: this.term ? '%' + this.term + '%' : false
                }
            });

            this.render(list);
            await hideLoader();
        }

        find() {
            this.search().catch(() => false);
        }

        async search() {
            if (this.searchPending) {
                return;
            }
            this.searchPending = true;
            let term;
            try {
                term = await exec({
                    command: 'searchContacts',
                    params: {
                        term: this.term || ''
                    }
                });
            } finally {
                this.searchPending = false;
            }

            term = (term || '').trim();
            if (term) {
                this.term = term;
                this.page = 1;

                let searchBlockElm = document.getElementById('contacts-search-block');
                searchBlockElm.classList.remove('hidden');
                let searchClearElm = document.getElementById('contacts-search-clear');
                searchClearElm.classList.remove('hidden');
                let searchTermElm = document.getElementById('contacts-search-term');
                searchTermElm.innerText = term;

                await this.reload();
            }
        }

        listAction(action, row) {
            switch (action) {
                case 'open':
                    this.actionOpen(row).catch(() => false);
                    return;
            }
        }

        async actionOpen(row) {
            // TODO: filter messages related to specific person
            if (row && row.data && row.data.id) {
                try {
                    await this.pageViews.emails.focus();
                    await this.pageViews.emails.search({ contact: row.data.id }, `"contact:${row.data.address}"`);
                    this.pageViews.emails.selectable.focus();
                } catch (err) {
                    console.error(err);
                }
            }
        }

        clearSearch() {
            this.page = 1;
            this.term = '';

            let searchBlockElm = document.getElementById('contacts-search-block');
            searchBlockElm.classList.add('hidden');
            let searchClearElm = document.getElementById('contacts-search-clear');
            searchClearElm.classList.add('hidden');
        }

        async init() {
            await this.reload();

            let refreshBtnElm = document.querySelector('#contacts-reload');
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

            let searchBtnElm = document.querySelector('#contacts-search');
            searchBtnElm.addEventListener('click', () => {
                searchBtnElm.classList.add('active');
                this.search()
                    .catch(() => false)
                    .finally(() => {
                        searchBtnElm.classList.remove('active');
                    });
            });

            let searchClearElm = document.getElementById('contacts-search-clear');
            searchClearElm.addEventListener('click', () => {
                this.clearSearch();

                this.reload().catch(() => false);
            });
        }
    }

    window.ContactsPage = ContactsPage;
})();
