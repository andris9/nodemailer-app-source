/* global Tabs, document, window, alert */
'use strict';

(() => {
    window.afterReady = () => {
        try {
            let preferencesTabs = new Tabs('preferences');

            let activeTabElm = document.getElementById('active-tab');
            let activeTab = (activeTabElm && activeTabElm.value) || 'smtp';

            preferencesTabs.show(activeTab);
            preferencesTabs.activate(activeTab);
        } catch (err) {
            alert(err.message);
        }
    };
})();
