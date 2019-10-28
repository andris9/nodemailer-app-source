'use strict';
/* eslint global-require: 0 */
/* globals document, alert, exec, window */

(() => {
    const humanize = require('humanize');

    let importListElm = document.getElementById('import-list');
    let imports = [];

    let paintImportCell = (rowElm, importData) => {
        rowElm.querySelector('td.cell-01').textContent = humanize.date('Y-m-d H:i', new Date(importData.created));
        rowElm.querySelector('td.cell-02').textContent = humanize.numberFormat(importData.emails, 0, '.', ' ');
        rowElm.querySelector('td.cell-03').textContent = humanize.filesize(importData.size || 0, 1024, 0, '.', ' ');
        rowElm.querySelector('td.cell-04').textContent = (importData.totalsize ? Math.round((importData.processed / importData.totalsize) * 100) : 0) + '%';
        rowElm.querySelector('td.cell-05').textContent = !importData.finished ? 'Importing…' : importData.errored ? 'Failed' : 'Finished';
    };

    let renderImportListItem = importData => {
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

        imports.push({ data: importData, elm: rowElm });

        importListElm.appendChild(rowElm);

        paintImportCell(rowElm, importData);
    };

    let reloadImports = async () => {
        let list = await exec({
            command: 'listImports'
        });

        if (!list || !list.data) {
            return;
        }

        imports.forEach(importData => {
            if (importData.elm.parentNode === importListElm) {
                importListElm.removeChild(importData.elm);
            }
        });
        imports = [];

        list.data.forEach(importData => {
            renderImportListItem(importData);
        });
        return true;
    };

    let renderImports = async () => {};

    let selectFileElm = document.getElementById('select-file');
    selectFileElm.addEventListener('click', () => {
        //ev.preventDefault();
        //ev.stopPropagation();

        selectFileElm.classList.add('active');

        exec({
            command: 'createImportFromFile'
        })
            .then(res => {
                if (res) {
                    return reloadImports();
                }
            })
            .then(res => {
                if (res) {
                    alert(`Import started`);
                }
            })
            .catch(err => {
                alert(err.message);
            })
            .finally(() => {
                selectFileElm.classList.remove('active');
            });
    });

    let selectMaildirElm = document.getElementById('select-maildir');
    selectMaildirElm.addEventListener('click', () => {
        //ev.preventDefault();
        //ev.stopPropagation();

        selectMaildirElm.classList.add('active');

        exec({
            command: 'createImportFromMaildir'
        })
            .then(res => {
                if (res) {
                    return reloadImports();
                }
            })
            .then(res => {
                if (res) {
                    alert(`Import started`);
                }
            })
            .catch(err => {
                alert(err.message);
            })
            .finally(() => {
                selectMaildirElm.classList.remove('active');
            });
    });

    let selectFolderElm = document.getElementById('select-folder');
    selectFolderElm.addEventListener('click', () => {
        //ev.preventDefault();
        //ev.stopPropagation();

        selectFolderElm.classList.add('active');

        exec({
            command: 'createImportFromFolder'
        })
            .then(res => {
                if (res) {
                    return reloadImports();
                }
            })
            .then(res => {
                if (res) {
                    alert(`Import started`);
                }
            })
            .catch(err => {
                alert(err.message);
            })
            .finally(() => {
                selectFolderElm.classList.remove('active');
            });
    });

    async function main() {
        await reloadImports();
        window.events.subscribe('import-update', data => {
            let importRow = imports.find(row => row.data.id === data.id);

            if (importRow) {
                importRow.data = data;
                paintImportCell(importRow.elm, data);
            }
        });
    }

    main().catch(err => alert(err.message));
})();
