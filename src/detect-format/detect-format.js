'use strict';

const fs = require('fs').promises;
const pathlib = require('path');
const zlib = require('zlib');

const DEFAULT_READ_SIZE = 256;

const gunzip = buffer => {
    return new Promise((resolve, reject) => {
        let unzip = zlib.createGunzip({
            chunkSize: 1 * DEFAULT_READ_SIZE
        });
        let chunks = [];
        let chunklen = 0;

        let fin = () => {
            resolve(Buffer.concat(chunks, chunklen));
        };

        unzip.on('readable', () => {
            let chunk;
            while ((chunk = unzip.read()) !== null) {
                chunks.push(chunk);
                chunklen += chunk.length;
            }
            if (chunklen) {
                fin();
            }
        });

        unzip.once('end', () => fin());
        unzip.once('error', err => reject(err));

        unzip.write(buffer);
        unzip.flush();

        // probably throws an error but this happens after first content is already resolved
        unzip.end();
    });
};

const readBytes = async (path, stats) => {
    let readSize = Math.min(DEFAULT_READ_SIZE, stats.size);
    let buffer = Buffer.alloc(readSize);
    let fd = await fs.open(path, 'r');
    try {
        await fd.read(buffer, 0, buffer.length, 0);
    } finally {
        try {
            await fd.close();
        } catch (err) {
            console.error(err);
            // ignore
        }
    }

    if (buffer.length > 2 && buffer[0] === 0x1f && buffer[1] === 0x8b) {
        let output = await gunzip(buffer);
        return output;
    }

    return buffer;
};

const seemsEmlx = buffer => {
    let lines = buffer.toString().split(/\r?\n/);
    lines.pop(); // just in case last line is incomplete and would seem invalid
    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];
        if (i === 0) {
            // first line has to be a number
            line = line.trimEnd();
            if (line && /^[0-9]+$/i.test(line) && Number(line) > 0) {
                // seems like a length definition
                continue;
            }
            return false;
        }

        if (/^[a-z]+[a-z0-9-]*[a-z0-9]+:/i.test(line)) {
            // normal header line
            continue;
        }
        if (i && /^[ \t]+[^ \t]+/i.test(line)) {
            // folded header line
            continue;
        }

        if (i && line.length === 0) {
            // header end
            break;
        }
        return false;
    }

    return true;
};

const seemsEml = buffer => {
    let lines = buffer.toString().split(/\r?\n/);
    lines.pop(); // just in case last line is incomplete and would seem invalid
    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];
        if (/^[a-z]+[a-z0-9-]*[a-z0-9]+:/i.test(line)) {
            // normal header line
            continue;
        }
        if (i && /^[ \t]+[^ \t]+/i.test(line)) {
            // folded header line
            continue;
        }

        if (i && line.length === 0) {
            // header end
            break;
        }
        return false;
    }

    return true;
};

const seemsMaildir = async path => {
    let curPath = pathlib.join(path, 'cur');
    try {
        let stats = await fs.stat(curPath);
        if (!stats.isDirectory()) {
            return false;
        }
        return true;
    } catch (err) {
        return false;
    }
};

const detectFileFormat = async (path, stats) => {
    let buffer = await readBytes(path, stats);
    if (!buffer) {
        return false;
    }

    // try to match signature
    if (buffer.length > 4 && buffer.slice(0, 5).toString() === 'From ') {
        return 'mbox';
    }

    if (buffer.length > 2 && buffer[0] === 0x43 && buffer[1] === 0x4f) {
        return 'postfix';
    }

    if (seemsEmlx(buffer)) {
        return 'emlx';
    }

    if (seemsEml(buffer)) {
        return 'eml';
    }

    return false;
};

const detectFormat = async path => {
    let stats = await fs.stat(path);
    if (stats.isFile()) {
        if (!stats.size) {
            return false;
        }
        return await detectFileFormat(path, stats);
    }

    if (stats.isDirectory) {
        if (await seemsMaildir(path)) {
            return 'maildir';
        }
        return 'folder';
    }

    return false;
};

module.exports = detectFormat;
