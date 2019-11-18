'use strict';
/* eslint global-require: 0 */
/* globals window, document, alert, ImportPage, ContactsPage, AttachmentsPage, EmailsPage, Tabs, exec */

(() => {
    let loaderQueue = 0;
    let loaderElm = document.createElement('div');
    loaderElm.classList.add('loader');

    async function showLoader() {
        loaderQueue++;
        if (loaderQueue === 1) {
            // show loader
            document.body.appendChild(loaderElm);
        }
    }
    window.showLoader = showLoader;

    async function hideLoader() {
        loaderQueue--;
        if (loaderQueue < 0) {
            loaderQueue = 0;
        }
        if (!loaderQueue) {
            // clear loader
            document.body.removeChild(loaderElm);
        }
    }

    window.hideLoader = hideLoader;

    class ServerPage {
        constructor() {
            this.buttonGroupElms = Array.from(document.querySelectorAll('.server-component'));
            this.pageElm = document.getElementById('page-server');
            this.pageMenuElm = document.getElementById('page-menu-server');

            // overriden by main
            this.pageViews = false;

            this.viewTabs = new Tabs('server-tab');
        }

        async focus() {
            // overriden by main
        }

        async show() {
            this.buttonGroupElms.forEach(elm => elm.classList.remove('hidden'));
            this.pageElm.classList.remove('hidden');
            this.pageMenuElm.classList.add('active');
            this.visible = true;

            this.viewTabs.show('overview');
            this.viewTabs.activate('overview');
        }

        async hide() {
            this.buttonGroupElms.forEach(elm => elm.classList.add('hidden'));
            this.pageElm.classList.add('hidden');
            this.pageMenuElm.classList.remove('active');
            this.visible = false;
        }

        updateServerStatus() {
            let serverStatusRecordElm = document.getElementById('server-status-record');
            let serverStatusTextElm = document.getElementById('server-status-text');
            if (!this.serverStatus) {
                serverStatusRecordElm.classList.add('status-red');
                serverStatusRecordElm.classList.remove('status-green');
                serverStatusTextElm.textContent = 'status';
            } else {
                serverStatusRecordElm.classList.remove('status-red');
                serverStatusRecordElm.classList.add('status-green');
                serverStatusTextElm.textContent = 'running';
            }
        }

        async init() {
            window.events.subscribe('server-start', () => {
                console.log('server-start');
                this.serverStatus = true;
                this.updateServerStatus();
            });

            window.events.subscribe('server-stop', () => {
                console.log('server-stop');
                this.serverStatus = false;
                this.updateServerStatus();
            });

            this.serverStatus = await exec({
                command: 'serverStatus',
                params: {}
            });

            this.updateServerStatus();
        }
    }

    async function main() {
        let pageViews = {
            imports: new ImportPage(),
            contacts: new ContactsPage(),
            attachments: new AttachmentsPage(),
            emails: new EmailsPage(),
            server: new ServerPage()
        };

        await showLoader();

        await Promise.all([
            pageViews.imports.init(),
            pageViews.contacts.init(),
            pageViews.attachments.init(),
            pageViews.emails.init(),
            pageViews.server.init()
        ]);

        // show import page by default
        let selected = 'imports';
        await pageViews.imports.show();

        let activateView = async target => {
            if (!pageViews[target] || target === selected) {
                // nothing to do here
                return;
            }

            try {
                await pageViews[selected].hide();
            } catch (err) {
                console.error(err);
            }

            try {
                await pageViews[target].show();
                selected = target;
            } catch (err) {
                console.error(err);
            }
        };

        Object.keys(pageViews).forEach(target => {
            pageViews[target].pageViews = pageViews;
            pageViews[target].focus = async () => await activateView(target);
        });

        let menuItems = Array.from(document.querySelectorAll('.page-menu'));
        for (let menuItem of menuItems) {
            let target = menuItem.dataset.target;

            menuItem.addEventListener('click', () => {
                activateView(target).catch(err => console.error(err));
            });
        }

        await hideLoader();
    }

    main().catch(err => alert(err.message));
})();
