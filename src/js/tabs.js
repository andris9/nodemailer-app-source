/* global document, window */

'use strict';

(() => {
    class Tabs {
        constructor(prefix) {
            this.prefix = prefix;

            this.groupElm = document.getElementById(this.prefix);
            this.tabElms = Array.from(this.groupElm.querySelectorAll('.tab-item'));
            this.active = false;

            this.init();
        }

        activate(tab) {
            let tabElm = this.groupElm.querySelector(`#${this.prefix}-${tab}`);
            if (tabElm.classList.contains('active')) {
                return;
            }

            let currentActive = this.tabElms.find(item => item.classList.contains('active'));
            if (currentActive) {
                currentActive.classList.remove('active');
                document.querySelector(`#${currentActive.id}-content`).classList.add('hidden');
            }

            tabElm.classList.add('active');
            document.querySelector(`#${tabElm.id}-content`).classList.remove('hidden');
        }

        hide(tab) {
            let tabElm = this.groupElm.querySelector(`#${this.prefix}-${tab}`);
            tabElm.classList.remove('active');
            tabElm.classList.add('hidden');
            document.querySelector(`#${tabElm.id}-content`).classList.add('hidden');
        }

        show(tab) {
            let tabElm = this.groupElm.querySelector(`#${this.prefix}-${tab}`);
            tabElm.classList.remove('hidden');
        }

        init() {
            this.tabElms.forEach(tabElm => {
                tabElm.addEventListener('click', () => this.activate(tabElm.id.substr(this.prefix.length + 1)));
            });
        }
    }

    window.Tabs = Tabs;
})();
