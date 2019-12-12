'use strict';

// allows to resolve homedir correctly using effective UID instead of using $HOME
// otherwise suid does not work
delete process.env.HOME;

const { getAppDataPath } = require('appdata-path');
const cli = require('./src/cli/cli');

const APPNAME = 'NodemailerApp';
cli({
    exit() {
        process.exit();
    },
    getPath() {
        return getAppDataPath(APPNAME);
    }
});
