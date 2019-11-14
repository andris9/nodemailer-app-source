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
        let dataFieldElms = document.querySelectorAll('.prompt-field');
        let result = {};
        for (let i = 0; i < dataFieldElms.length; i++) {
            let dataFieldElm = dataFieldElms[i];
            result[dataFieldElm.name] = dataFieldElm.value;
        }
        ipcRenderer.sendSync('prompt-post-data:' + promptId, JSON.stringify(result));
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

        if (promptOptions.label) {
            if (promptOptions.useHtmlLabel) {
                document.querySelector('#label').innerHTML = promptOptions.label;
            } else {
                document.querySelector('#label').textContent = promptOptions.label;
            }
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

        let dataFieldElms = document.querySelectorAll('.prompt-field');
        for (let i = 0; i < dataFieldElms.length; i++) {
            let dataFieldElm = dataFieldElms[i];
            dataFieldElm.addEventListener('keyup', e => {
                if (dataFieldElm.tagName === 'INPUT' && e.key === 'Enter') {
                    promptSubmit();
                }

                if (dataFieldElm.tagName === 'INPUT' && e.key === 'Escape') {
                    promptCancel();
                }
            });

            if (dataFieldElm.classList.contains('autoselect')) {
                dataFieldElm.focus();
                dataFieldElm.select();
            }

            if (promptOptions.query && promptOptions.query[dataFieldElm.name]) {
                if (dataFieldElm.tagName === 'select') {
                    for (let j = 0; j < dataFieldElm.options.length; i++) {
                        if (dataFieldElm.options[i].value === promptOptions.query[dataFieldElm.name]) {
                            dataFieldElm.selectedIndex = i;
                            break;
                        }
                    }
                } else {
                    dataFieldElm.value = promptOptions.query[dataFieldElm.name];
                }
            }
        }
    });
})();
