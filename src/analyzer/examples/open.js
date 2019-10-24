///Users/andrisreinman/Library/Application Support/Email Anaylzer/testikas_1571740887371/data.db

'use strict';

const Analyzer = require('../lib/analyzer');
const util = require('util');

let analyzer = new Analyzer({
    projectName: 'testikas_1571918144599' //'testikas_1571740887371'
});

let now = Date.now();

async function read() {
    console.log((Date.now() - now) / 1000);
    let res = await analyzer.sql.findOne('SELECT count(rowid) AS rows FROM emails');
    console.log(res);

    res = await analyzer.getContacts({
        term: '%andris%',
        page: 1
    });
    console.log(res);

    res = await analyzer.getEmails({
        debug: true,

        //term: 'andris',
        page: 1,
        attachments: true
        /*
        headers: {
            subject: true
        },
*/
        //subject: '%andris%',

        //      deliveredTo: ['%andris%'],
        /*
        from: 717,

        messageId: '<-5023877418849927037@unknownmsgid>',
        date: {
            start: new Date('2015-06-17'),
            end: new Date('2015-06-19')
        },
*/
        // attachments: true
        /*
        attachments: {
            size: {
                start: 100 * 1024
            }
        }
        */
    });
    console.log(util.inspect(res, false, 22));

    res = await analyzer.getAttachments({
        debug: true,
        page: 1,
        // from: '%julia%',
        attachments: {
            contentId: '<%'
        }
    });
    console.log(util.inspect(res, false, 22));

    res = await analyzer.getEmail(828);
    if (res) {
        /*
        for (let att of res.attachments) {
            att.dataUri = await analyzer.getAttachmentBuffer(att.id, { dataUri: true });
        }*/
        console.log(util.inspect(res, false, 22));
    }
}

analyzer
    .prepare()
    .then(() => {
        return read();
    })
    .then(() => {
        console.log('fin');
        return analyzer.close();
    })
    .catch(err => console.error(err))
    .finally(() => {
        console.log('done');
    });
