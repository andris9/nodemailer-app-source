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
        menuBtnElm.addEventListener('click', e => {
            console.log(e);
            let rect = menuBtnElm.getBoundingClientRect();
            console.log(rect);
            menu.popup({ window: getCurrentWindow(), x: Math.round(rect.x), y: Math.ceil(rect.y + rect.height) });
            console.log({ x: rect.x, y: rect.y + rect.height });
            //menu.popup({ window: getCurrentWindow(), x: rect.x, y: rect.y + rect.height });
        });
    });
})();
