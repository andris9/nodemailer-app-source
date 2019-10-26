'use strict';
/* eslint global-require: 0 */
/* globals document, alert */

(() => {
    const { dialog, getCurrentWindow } = require('electron').remote;

    let selectFileElm = document.getElementById('select-file');
    selectFileElm.addEventListener('click', () => {
        //ev.preventDefault();
        //ev.stopPropagation();

        selectFileElm.classList.add('active');

        dialog
            .showOpenDialog(getCurrentWindow(), { title: 'Select Mail Source', properties: ['openFile'] })
            .then(result => {
                alert(JSON.stringify(result.canceled));
                alert(result.filePaths);
            })
            .catch(err => {
                console.log(err);
            })
            .finally(() => {
                selectFileElm.classList.remove('active');
            });
    });
})();
