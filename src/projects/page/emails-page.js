/* eslint global-require: 0 */
/* global window, document */

'use strict';

(() => {
    class EmailsPage {
        constructor() {
            this.buttonGroupElms = Array.from(document.querySelectorAll('.emails-button-group'));
            this.pageElm = document.getElementById('page-emails');
            this.pageMenuElm = document.getElementById('page-menu-emails');
            this.visible = false;
        }

        async show() {
            this.buttonGroupElms.forEach(elm => elm.classList.remove('hidden'));
            this.pageElm.classList.remove('hidden');
            this.pageMenuElm.classList.add('active');
            this.visible = true;
        }

        async hide() {
            this.buttonGroupElms.forEach(elm => elm.classList.add('hidden'));
            this.pageElm.classList.add('hidden');
            this.pageMenuElm.classList.remove('active');
            this.visible = false;
        }

        async init() {}
    }

    window.EmailsPage = EmailsPage;
})();
