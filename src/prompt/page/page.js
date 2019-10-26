// Forked from https://github.com/p-sam/electron-prompt
// Licensed under MIT by p-sam

/* eslint global-require:0 */
/* global window, document */
'use strict';

(() => {
    const fs = require('fs');
    const { ipcRenderer } = require('electron');
    const docReady = require('doc-ready');

    let promptId = null;
    let promptOptions = null;

    const promptError = e => {
        if (e instanceof Error) {
            e = e.message;
        }

        ipcRenderer.sendSync('prompt-error:' + promptId, e);
    };

    const promptCancel = () => {
        ipcRenderer.sendSync('prompt-post-data:' + promptId, null);
    };

    const promptSubmit = () => {
        const dataEl = document.querySelector('#data');
        let data = null;

        if (promptOptions.type === 'input') {
            data = dataEl.value;
        } else if (promptOptions.type === 'select') {
            if (promptOptions.selectMultiple) {
                data = dataEl.querySelectorAll('option[selected]').map(o => o.getAttribute('value'));
            } else {
                data = dataEl.value;
            }
        }

        ipcRenderer.sendSync('prompt-post-data:' + promptId, data);
    };

    window.addEventListener('error', error => {
        if (promptId) {
            promptError('An error has occured on the prompt window: \n' + error);
        }
    });

    docReady(() => {
        promptId = document.location.hash.replace('#', '');

        document.querySelector('#form').addEventListener('submit', ev => {
            ev.preventDefault();
            ev.stopPropagation();
            promptSubmit();
        });

        try {
            promptOptions = JSON.parse(ipcRenderer.sendSync('prompt-get-options:' + promptId));
        } catch (error) {
            return promptError(error);
        }

        if (promptOptions.useHtmlLabel) {
            document.querySelector('#label').innerHTML = promptOptions.label;
        } else {
            document.querySelector('#label').textContent = promptOptions.label;
        }

        try {
            if (promptOptions.customStylesheet) {
                const customStyleContent = fs.readFileSync(promptOptions.customStylesheet);
                if (customStyleContent) {
                    const customStyle = document.createElement('style');
                    customStyle.setAttribute('rel', 'stylesheet');
                    customStyle.append(document.createTextNode(customStyleContent));
                    document.head.append(customStyle);
                }
            }
        } catch (error) {
            return promptError(error);
        }

        document.querySelector('#ok').addEventListener('click', () => promptSubmit());
        document.querySelector('#cancel').addEventListener('click', () => promptCancel());

        let dataEl = document.querySelector('#data');

        if (promptOptions.value) {
            dataEl.value = promptOptions.value;
        } else {
            dataEl.value = '';
        }

        if (promptOptions.inputAttrs && typeof promptOptions.inputAttrs === 'object') {
            for (const k in promptOptions.inputAttrs) {
                if (!Object.prototype.hasOwnProperty.call(promptOptions.inputAttrs, k)) {
                    continue;
                }

                dataEl.setAttribute(k, promptOptions.inputAttrs[k]);
            }
        }

        dataEl.addEventListener('keyup', e => {
            if (e.key === 'Enter') {
                promptSubmit();
            }

            if (e.key === 'Escape') {
                promptCancel();
            }
        });

        dataEl.focus();
        if (promptOptions.type === 'input') {
            dataEl.select();
        }
    });
})();
