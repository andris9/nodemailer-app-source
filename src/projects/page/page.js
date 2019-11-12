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
        let pageViews = {
            imports: new ImportPage(),
            contacts: new ContactsPage(),
            attachments: new AttachmentsPage(),
            emails: new EmailsPage()
        };

        await showLoader();

        await Promise.all([pageViews.imports.init(), pageViews.contacts.init(), pageViews.attachments.init(), pageViews.emails.init()]);

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
