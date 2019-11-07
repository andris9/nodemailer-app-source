/* eslint global-require: 0 */
/* global window, document, exec, alert, showLoader, hideLoader */

'use strict';

(() => {
    const humanize = require('humanize');

    class ContactsPage {
        constructor() {
            this.buttonGroupElms = Array.from(document.querySelectorAll('.contacts-button-group'));
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
            } else if (window.__hasChanges !== this.lastChanges) {
                this.lastChanges = window.__hasChanges;
                await this.reload();
            }

            this.selectable.activate();
        }

        async hide() {
            this.buttonGroupElms.forEach(elm => elm.classList.add('hidden'));
            this.pageElm.classList.add('hidden');
            this.pageMenuElm.classList.remove('active');
            this.visible = false;

            this.selectable.disable();
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

        async search() {
            let term = await exec({
                command: 'searchContacts',
                params: {
                    term: this.term || ''
                }
            });
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
            console.log(action, row);
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

            let searchBtnElm = document.querySelector('#contacts-search');
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

            let searchClearElm = document.getElementById('contacts-search-clear');
            searchClearElm.addEventListener('click', () => {
                this.clearSearch();

                this.reload().catch(err => {
                    alert(err.message);
                });
            });
        }
    }

    window.ContactsPage = ContactsPage;
})();
