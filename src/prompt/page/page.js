// Forked from https://github.com/p-sam/electron-prompt
// Licensed under MIT by p-sam

/* eslint global-require:0 */
/* global window, document, alert, exec, showLoader, hideLoader */
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

            if (dataFieldElm.disabled || dataFieldElm.readOnly) {
                continue;
            }

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

        let renderSelectBox = dataFieldElm => {
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
        };

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
                    if (promptOptions.selectOptions && promptOptions.selectOptions[dataFieldElm.name]) {
                        // populate select options
                        renderSelectBox(dataFieldElm);
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

        let setValueKeys = () => {
            Object.keys(promptOptions.query || {}).forEach(key => {
                try {
                    let elms = document.querySelectorAll('.value-' + key.replace(/:/g, '_'));
                    let valueElm = document.getElementById('data-' + key);
                    let value;
                    if (valueElm.selectedIndex && valueElm.options && valueElm.options[valueElm.selectedIndex]) {
                        value = valueElm.options[valueElm.selectedIndex].textContent.trim();
                    } else {
                        value = (valueElm && valueElm.value) || promptOptions.query[key] || '';
                    }
                    if ((!value || value === '0') && valueElm && valueElm.dataset.defaultValue) {
                        value = valueElm.dataset.defaultValue;
                    }

                    for (let i = 0; i < elms.length; i++) {
                        let elm = elms[i];
                        if (/^input$/i.test(elm.tagName)) {
                            elm.value = value;
                        } else {
                            elm.textContent = value;
                        }
                    }
                } catch (err) {
                    // ignore
                    console.error(err);
                }
            });
        };
        setValueKeys();

        let catchAllEnabledElm = document.getElementById('data-catchall:enabled');
        let catchAllProjectElm = document.getElementById('data-catchall:project');

        if (catchAllProjectElm) {
            catchAllProjectElm.addEventListener('change', setValueKeys);
            catchAllProjectElm.addEventListener('click', setValueKeys);
        }

        let list = document.querySelectorAll('.can-use-catchall');
        let displayCatchall = () => {
            for (let elm of list) {
                if (promptOptions.query['catchall:domain']) {
                    elm.classList.remove('hidden');
                } else {
                    elm.classList.add('hidden');
                }
            }
        };

        let checkingCatchall = false;
        let checkCatchallStatus = async () => {
            if (promptOptions.query['catchall:domain']) {
                return displayCatchall();
            }

            if (checkingCatchall || !catchAllEnabledElm.checked) {
                return;
            }
            checkingCatchall = true;

            // no domain set, have to request for new
            await showLoader();
            try {
                let catchallConfig = await exec({
                    command: 'setupCatchall'
                });

                if (catchallConfig) {
                    if (catchallConfig.domain) {
                        promptOptions.query['catchall:domain'] = catchallConfig.domain;
                    }

                    if (catchallConfig.secret) {
                        promptOptions.query['catchall:secret'] = catchallConfig.secret;
                    }

                    // update field values
                    document.getElementById('data-catchall:domain').value = catchallConfig.domain;
                    document.getElementById('data-catchall:secret').value = catchallConfig.secret;

                    for (let elm of document.querySelectorAll('.value-catchall_domain')) {
                        elm.textContent = catchallConfig.domain;
                    }

                    for (let elm of document.querySelectorAll('.value-catchall_secret')) {
                        elm.textContent = catchallConfig.secret;
                    }

                    renderSelectBox(document.getElementById('data-catchall:project'));

                    return displayCatchall();
                }
            } finally {
                await hideLoader();
                checkingCatchall = false;
            }
        };

        if (catchAllEnabledElm) {
            catchAllEnabledElm.addEventListener('click', () => checkCatchallStatus().catch(err => console.error(err)));
            catchAllEnabledElm.addEventListener('change', () => checkCatchallStatus().catch(err => console.error(err)));
        }

        displayCatchall();

        if (typeof window.afterReady === 'function') {
            window.afterReady();
        }
    });
})();
