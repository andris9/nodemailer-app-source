// Forked from https://github.com/p-sam/electron-prompt
// Licensed under MIT by p-sam

/* eslint global-require:0 */
/* global window, document, alert */
'use strict';

(() => {
    const fs = require('fs');
    const { ipcRenderer } = require('electron');
    const docReady = require('doc-ready');

    let promptId = null;
    let promptOptions = null;

    const promptError = e => {
        if (e && e.message) {
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
            if (dataFieldElm.type === 'checkbox') {
                result[dataFieldElm.name] = !!dataFieldElm.checked;
            } else {
                result[dataFieldElm.name] = dataFieldElm.value;
            }
        }
        ipcRenderer.sendSync('prompt-post-data:' + promptId, JSON.stringify(result));
    };

    window.addEventListener('error', error => {
        if (promptId) {
            promptError(error);
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

        if (promptOptions.values) {
            Object.keys(promptOptions.values).forEach(key => {
                try {
                    let elm = document.getElementById(key);
                    if (elm) {
                        if (/^input$/i.test(elm.tagName)) {
                            elm.value = promptOptions.values[key] || '';
                        } else {
                            elm.textContent = promptOptions.values[key] || '';
                        }
                    }
                } catch (err) {
                    alert(err.message);
                }
            });
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
                if (/^input$/i.test(dataFieldElm.tagName) && e.key === 'Enter') {
                    promptSubmit();
                }

                if (/^input$/i.test(dataFieldElm.tagName) && e.key === 'Escape') {
                    promptCancel();
                }
            });

            if (promptOptions.query && dataFieldElm.name in promptOptions.query) {
                if (/^select$/i.test(dataFieldElm.tagName)) {
                    if (promptOptions.selectOptions[dataFieldElm.name]) {
                        // populate select options
                        dataFieldElm.innerHTML = '';
                        let groups = new Map();
                        for (let j = 0; j < promptOptions.selectOptions[dataFieldElm.name].length; j++) {
                            let opt = promptOptions.selectOptions[dataFieldElm.name][j];
                            let elm = document.createElement('option');
                            elm.value = opt.value.toString();
                            elm.textContent = opt.title;

                            if (opt.group) {
                                let groupElm = groups.get(opt.group);
                                if (!groupElm) {
                                    groupElm = document.createElement('optgroup');
                                    groupElm.label = opt.group;
                                    groups.set(opt.group, groupElm);
                                    dataFieldElm.appendChild(groupElm);
                                }
                                groupElm.appendChild(elm);
                            } else {
                                dataFieldElm.appendChild(elm);
                            }
                        }
                    }
                    for (let j = 0; j < dataFieldElm.options.length; j++) {
                        if (dataFieldElm.options[j] && dataFieldElm.options[j].value === promptOptions.query[dataFieldElm.name].toString()) {
                            dataFieldElm.selectedIndex = j;
                            break;
                        }
                    }
                } else if (/^checkbox$/i.test(dataFieldElm.type)) {
                    dataFieldElm.checked = !!promptOptions.query[dataFieldElm.name];
                } else {
                    dataFieldElm.value = promptOptions.query[dataFieldElm.name];
                }
            }

            if (dataFieldElm.classList.contains('autoselect')) {
                dataFieldElm.focus();
                dataFieldElm.select();
            }
        }

        if (typeof window.afterReady === 'function') {
            window.afterReady();
        }
    });
})();
