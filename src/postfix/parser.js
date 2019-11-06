/* eslint no-constant-condition: 0, no-bitwise: 0 */
'use strict';

function parser(buf) {
    let message = {
        sender: null,
        original_recipient: null,
        recipient: null,
        arrival_time: null,
        params: {},
        lines: []
    };

    let firstRecord = true;
    let pos = 0;
    while (pos < buf.length) {
        // read record type
        let recordType = buf.readUInt8(pos++);
        if (firstRecord) {
            firstRecord = false;
            if (String.fromCharCode(recordType) !== 'C') {
                throw new Error('invalid first record');
            }
        }

        // find out record length
        let recordLength = 0;
        let shift = 0;

        while (true) {
            if (pos >= buf.length || shift > 8 * 4) {
                throw new Error('pos too big');
            }

            let recordLenByte = buf.readUInt8(pos++);

            recordLength |= (recordLenByte & 0x7f) << shift;

            if ((recordLenByte & 0x80) === 0) {
                break;
            }

            shift += 7;
        }

        if (pos + recordLength > buf.length) {
            throw new Error('pos too big');
        }

        let record = buf.slice(pos, pos + recordLength);
        pos += record.length;

        // see https://opensource.apple.com/source/postfix/postfix-174/postfix/src/global/rec_type.h.auto.html
        switch (String.fromCharCode(recordType)) {
            case 'T':
                message.arrival_time = new Date(
                    Number(
                        record
                            .toString()
                            .split(' ')
                            .shift()
                    ) * 1000
                );
                break;

            case 'A':
                {
                    let parts = record.toString().split('=');
                    let key = parts.shift();
                    let val = parts.join('=');
                    if (key === 'create_time') {
                        val = new Date(Number(val) * 1000);
                    }
                    message.params[key] = val;
                }
                break;

            case 'S':
                message.sender = record.toString();
                break;

            case 'O':
                message.original_recipient = record.toString();
                break;

            case 'R':
                message.recipient = record.toString();
                break;

            case 'N':
            case 'L': // not sure about L though :S
                message.lines.push(record);
                break;
            default:
            // ignore record
        }
    }

    return message;
}

module.exports = parser;
