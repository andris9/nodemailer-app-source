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

    fs.writeFileSync(
        pathlib.join(__dirname, 'src', 'meta.json'),
        JSON.stringify({
            name: packageData.name,
            version: packageData.version,
            commit: (stdout || '').toString().trim()
        })
    );

    let hash = parseInt(
        (stdout || '')
            .toString()
            .trim()
            .substr(0, 6),
        16
    );
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
    } else {
        icon = './src/icons/png/256x256.png';
    }

    packageData.config.forge.packagerConfig.icon = icon;

    packageData.config.forge.packagerConfig.extraResource = [];
    if (opsys === 'win32' || opsys === 'win64') {
        let sendmailFiles = fs.readdirSync('.').filter(file => /^sendmail(.exe)?$/.test(file));
        sendmailFiles.forEach(file => {
            packageData.config.forge.packagerConfig.extraResource.push(pathlib.join(__dirname, file));
        });
    }

    fs.writeFileSync(packagePath, JSON.stringify(packageData, false, 4));
});
