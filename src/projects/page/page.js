'use strict';
/* eslint global-require: 0 */
/* globals window, document, alert, ImportPage, ContactsPage, AttachmentsPage, EmailsPage */

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

    async function main() {
        let pages = {
            imports: new ImportPage(),
            contacts: new ContactsPage(),
            attachments: new AttachmentsPage(),
            emails: new EmailsPage()
        };

        await showLoader();

        await Promise.all([pages.imports.init(), pages.contacts.init(), pages.attachments.init(), pages.emails.init()]);

        // show import page by default
        let selected = 'imports';
        await pages.imports.show();

        let activateView = target => {
            if (!pages[target] || target === selected) {
                // nothing to do here
                return;
            }
            pages[selected]
                .hide()
                .then(() => {})
                .catch(err => console.error(err))
                .finally(() => {
                    pages[target]
                        .show()
                        .then(() => {})
                        .catch(err => console.error(err))
                        .finally(() => {
                            selected = target;
                        });
                });
        };

        Object.keys(pages).forEach(target => {
            pages[target].pages = pages;
            pages[target].focus = () => activateView(target);
        });

        let menuItems = Array.from(document.querySelectorAll('.page-menu'));
        for (let menuItem of menuItems) {
            let target = menuItem.dataset.target;

            menuItem.addEventListener('click', () => {
                activateView(target);
            });
        }

        await hideLoader();
    }

    main().catch(err => alert(err.message));
})();
