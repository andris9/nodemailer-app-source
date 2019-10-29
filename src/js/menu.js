'use strict';
/* eslint global-require: 0*/
/* global document, exec */

(() => {
    const { getCurrentWindow, Menu, MenuItem } = require('electron').remote;

    // Build our new menu
    const menu = new Menu();
    menu.append(
        new MenuItem({
            label: 'Developer Tools',
            click() {
                // Trigger an alert when menu item is clicked
                exec({
                    command: 'openDevTools'
                })
                    .catch(() => false)
                    .finally(() => false);
            }
        })
    );

    // Add the listener
    document.addEventListener('DOMContentLoaded', function() {
        let menuBtnElm = document.querySelector('.js-context-menu');
        menuBtnElm.addEventListener('click', () => {
            let rect = menuBtnElm.getBoundingClientRect();
            menu.popup({ window: getCurrentWindow(), x: Math.round(rect.x), y: Math.ceil(rect.y + rect.height) });
        });
    });
})();
