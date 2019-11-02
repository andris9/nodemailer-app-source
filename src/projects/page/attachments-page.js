/* eslint global-require: 0 */
/* global window, document, exec, alert, showLoader, hideLoader */

'use strict';

(() => {
    const humanize = require('humanize');

    class AttachmentsPage {
        constructor() {
            this.buttonGroupElms = Array.from(document.querySelectorAll('.attachments-button-group'));
            this.pageElm = document.getElementById('page-attachments');
            this.pageMenuElm = document.getElementById('page-menu-attachments');

            this.pageNrElm = document.getElementById('attachments-page-nr');
            this.pageTotalElm = document.getElementById('attachments-page-total');

            this.pageNextElm = document.getElementById('attachments-page-next');
            this.pagePrevElm = document.getElementById('attachments-page-prev');

            this.rowListElm = document.getElementById('attachments-list');
            this.rows = [];

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
                await this.reload();
            }
        }

        async hide() {
            this.buttonGroupElms.forEach(elm => elm.classList.add('hidden'));
            this.pageElm.classList.add('hidden');
            this.pageMenuElm.classList.remove('active');
            this.visible = false;
        }

        renderListItem(data, nr) {
            let rowElm = document.createElement('tr');

            let cell01Elm = document.createElement('td');
            let cell02Elm = document.createElement('td');
            let cell03Elm = document.createElement('td');
            let cell04Elm = document.createElement('td');
            let cell05Elm = document.createElement('td');
            let cell06Elm = document.createElement('td');
            let cell07Elm = document.createElement('td');

            cell01Elm.classList.add('cell-01', 'text-right');
            cell02Elm.classList.add('cell-02');
            cell03Elm.classList.add('cell-03');
            cell04Elm.classList.add('cell-04');
            cell05Elm.classList.add('cell-05');
            cell06Elm.classList.add('cell-06', 'text-right');
            cell07Elm.classList.add('cell-07', 'text-right');

            cell01Elm.textContent = humanize.numberFormat(nr, 0, '.', ' ');

            //<div class="file-icon" data-file="webp"></div>

            if (data.thumbnail) {
                let thumbnail = document.createElement('img');
                thumbnail.src = data.thumbnail;
                thumbnail.style.display = 'block';
                thumbnail.style.width = '30px';
                thumbnail.style.height = '30px';
                thumbnail.style.margin = '2px 0';
                cell02Elm.appendChild(thumbnail);
            } else {
                let attachmentIconElm = document.createElement('div');
                attachmentIconElm.classList.add('file-icon');
                attachmentIconElm.setAttribute(
                    'data-file',
                    data.filename
                        .split('.')
                        .pop()
                        .substr(0, 5) || 'bin'
                );
                cell02Elm.appendChild(attachmentIconElm);
            }

            cell03Elm.textContent = data.filename;

            if (data.addresses && data.addresses.from && data.addresses.from[0]) {
                cell04Elm.textContent = data.addresses.from[0].address;
            }

            cell05Elm.textContent = data.subject || '';
            cell06Elm.textContent = humanize.filesize(data.size || 0, 1024, 0, '.', ' ');

            let btn = document.createElement('button');
            btn.classList.add('btn', 'btn-default');
            let btnIcon = document.createElement('span');
            btnIcon.classList.add('icon', 'icon-install');
            btn.appendChild(btnIcon);
            cell07Elm.appendChild(btn);

            rowElm.appendChild(cell01Elm);
            rowElm.appendChild(cell02Elm);
            rowElm.appendChild(cell03Elm);
            rowElm.appendChild(cell04Elm);
            rowElm.appendChild(cell05Elm);
            rowElm.appendChild(cell06Elm);
            rowElm.appendChild(cell07Elm);

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
        }

        async reload() {
            await showLoader();
            let list = await exec({
                command: 'listAttachments',
                params: {
                    page: this.page
                }
            });

            this.render(list);
            await hideLoader();
        }

        async search() {
            let term = await exec({
                command: 'searchAttachments',
                params: {
                    term: this.term || ''
                }
            });
            term = (term || '').trim();
            if (term) {
                this.term = term;
                this.page = 1;

                let searchBlockElm = document.getElementById('attachments-search-block');
                searchBlockElm.classList.remove('hidden');
                let searchClearElm = document.getElementById('attachments-search-clear');
                searchClearElm.classList.remove('hidden');
                let searchTermElm = document.getElementById('attachments-search-term');
                searchTermElm.innerText = term;

                await this.reload();
            }
        }

        async init() {
            await this.reload();

            let refreshBtnElm = document.querySelector('#attachments-reload');
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

            let searchBtnElm = document.querySelector('#attachments-search');
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

            let searchClearElm = document.getElementById('attachments-search-clear');
            searchClearElm.addEventListener('click', () => {
                this.page = 1;
                this.term = '';

                let searchBlockElm = document.getElementById('attachments-search-block');
                searchBlockElm.classList.add('hidden');
                let searchClearElm = document.getElementById('attachments-search-clear');
                searchClearElm.classList.add('hidden');

                this.reload().catch(err => {
                    alert(err.message);
                });
            });
        }
    }

    window.AttachmentsPage = AttachmentsPage;
})();
