'use strict';

const fs = require('fs');
const pathlib = require('path');
const packagePath = pathlib.join(__dirname, 'package.json');
const exec = require('child_process').exec;

let packageData = JSON.parse(fs.readFileSync(packagePath), 'utf-8');

exec('git rev-parse HEAD', (err, stdout) => {
    if (err) {
        console.error(err);
        return process.exit(1);
    }
    let hash = (stdout || '')
        .toString()
        .trim()
        .toUpperCase()
        .substr(0, 8);
    if (!hash) {
        hash = Date.now()
            .toString(16)
            .toUpperCase();
    }
    packageData.config.forge.packagerConfig.buildVersion = hash;

    const opsys = process.platform;

    let icon;
    if (opsys === 'darwin') {
        icon = './src/icons/mac/icon.icns';
    } else if (opsys === 'win32' || opsys === 'win64') {
        icon = './src/icons/win/icon.ico';
    } else if (opsys === 'linux') {
        icon = './src/icons/png/128x128.png';
    }

    packageData.config.forge.packagerConfig.icon = icon;

    fs.writeFileSync(packagePath, JSON.stringify(packageData, false, 2));
});
