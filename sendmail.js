'use strict';

const { getAppDataPath } = require('appdata-path');
const cli = require('./src/cli/cli');

const APPNAME = 'NodemailerApp';
cli({
    quit() {
        process.exit();
    },
    getPath() {
        return getAppDataPath(APPNAME);
    }
});
