'use strict';

const fs = require('fs');
const pathlib = require('path');
const packagePath = pathlib.join(__dirname, 'package.json');

let packageData = JSON.parse(fs.readFileSync(packagePath), 'utf-8');
packageData.config.forge.packagerConfig.buildVersion = Date.now()
    .toString(16)
    .toUpperCase();

fs.writeFileSync(packagePath, JSON.stringify(packageData, false, 2));
