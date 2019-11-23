/* global Tabs, document, window, alert */
'use strict';

(() => {
    let uploadTabs = new Tabs('tabs');

    uploadTabs.show('smtp');
    uploadTabs.activate('smtp');
})();
