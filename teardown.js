'use strict';

const fs = require('fs');
const pathlib = require('path');
const packagePath = pathlib.join(__dirname, 'package.json');

let packageData = JSON.parse(fs.readFileSync(packagePath), 'utf-8');

packageData.config.forge.packagerConfig.buildVersion = '';
packageData.config.forge.packagerConfig.icon = '';

fs.writeFileSync(packagePath, JSON.stringify(packageData, false, 4));
