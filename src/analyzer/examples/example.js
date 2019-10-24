'use strict';

const fs = require('fs');
const Analyzer = require('../lib/analyzer');
const { eachMessage } = require('mbox-reader');

let analyzer = new Analyzer({
    projectName: 'testikas_' + Date.now()
});

async function importer() {
    let filename = '/var/mail/andrisreinman';

    filename = '/Users/andrisreinman/Temp/dumps/gmail/Takeout/E-post/Kõik kirjad, sh rämpspost ja prügikast.mbox';

    //filename = '/Users/andrisreinman/Temp/dumps/podesta/podesta-emails.mbox-2016-11-06';
    // filename = '/Users/andrisreinman/Temp/dumps/winmail.dat';

    let totalsize = (await fs.promises.stat(filename)).size;

    let input = fs.createReadStream(filename);

    let c = 0;
    let now = Date.now();

    let MAX_BATCH_ITEMS = 3;
    let MAX_BATCH_SIZE = 20 * 1024 * 1024;

    let batchSize = 0;
    let batch = [];

    async function processBatch() {
        let parsers = batch.map(message => {
            let parser = async () => {
                await analyzer.import(
                    {
                        idate: message.time,
                        returnPath: message.returnPath
                    },
                    message.content
                );

                console.log(
                    'oki #%s %ss %sMB %s %s%',
                    ++c,
                    (Date.now() - now) / 1000,
                    Math.round((message.content.length * 100) / (1024 * 1024)) / 100,
                    message.returnPath,
                    Math.round((message.readSize / totalsize) * 1000) / 10
                );
            };
            return parser();
        });

        return await Promise.all(parsers);
    }

    for await (let message of eachMessage(input)) {
        batch.push(message);
        batchSize += message.content.length;
        if (batch.length > MAX_BATCH_ITEMS || batchSize >= MAX_BATCH_SIZE) {
            await processBatch();
            batch = [];
            batchSize = 0;
        }
    }

    await processBatch();

    console.log('doki %s %s', c, (Date.now() - now) / 1000);
}

analyzer
    .prepare()
    .then(() => {
        return importer();
    })
    .then(() => {
        console.log('fin');
        return analyzer.close();
    })
    .catch(err => console.error(err))
    .finally(() => {
        console.log('done');
    });
