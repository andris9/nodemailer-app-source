'use strict';
/* eslint global-require: 0 */
/* globals document, window, exec, confirm */

(() => {
    let elements = [];

    const humanize = require('humanize');

    let projectEditGroupElm = document.getElementById('project-edit-group');

    let deleteActiveBtn = document.getElementById('delete-active-btn');
    let editActiveBtn = document.getElementById('edit-active-btn');

    let serverConfigBtn = document.getElementById('server-config-btn');

    let openProject = id => {
        exec({
            command: 'openProject',
            params: {
                id
            }
        }).catch(() => false);
    };

    let selectable = new window.Selectable(elements, (action, row) => {
        switch (action) {
            case 'open':
                openProject(row.data.id);
                break;

            case 'active':
                projectEditGroupElm.classList.remove('hidden');

                exec({
                    command: 'updateMenu',
                    params: {
                        id: ['rename-project', 'delete-project'],
                        enabled: true
                    }
                }).catch(() => false);
                break;

            case 'deactivate':
                projectEditGroupElm.classList.add('hidden');

                exec({
                    command: 'updateMenu',
                    params: {
                        id: ['rename-project', 'delete-project'],
                        enabled: false
                    }
                }).catch(() => false);
                break;
        }
    });

    let renderProject = (container, data) => {
        let liElm = document.createElement('li');
        liElm.classList.add('list-group-item');

        // icon
        let imgElm = document.createElement('img');
        imgElm.classList.add('img', 'media-object', 'pull-left');
        imgElm.setAttribute('src', '../assets/envelope.png');
        imgElm.setAttribute('width', '32');
        imgElm.setAttribute('height', '32');
        liElm.appendChild(imgElm);

        let menuBtnOpenElm = document.createElement('button');
        menuBtnOpenElm.classList.add('btn', 'btn-default', 'pull-right');
        let menuBtnOpenIconElm = document.createElement('span');
        menuBtnOpenIconElm.classList.add('icon', 'icon-export');
        menuBtnOpenElm.appendChild(menuBtnOpenIconElm);
        liElm.appendChild(menuBtnOpenElm);

        menuBtnOpenElm.addEventListener('click', () => {
            menuBtnOpenElm.classList.add('active');
            openProject(data.id);
        });

        // body
        let divBodyElm = document.createElement('div');
        divBodyElm.classList.add('media-body');
        liElm.appendChild(divBodyElm);

        let titleElm = document.createElement('strong');
        titleElm.textContent = data.name;
        divBodyElm.appendChild(titleElm);

        let descriptionElm = document.createElement('p');
        let emailCountElm = document.createElement('span');
        emailCountElm.classList.add('emails-count');
        emailCountElm.textContent = `${humanize.numberFormat(data.emails, 0, '.', ' ')}`;

        let emailSizeElm = document.createElement('span');
        emailSizeElm.classList.add('emails-size');
        emailSizeElm.textContent = `${humanize.filesize(data.size || 0, 1024, 0, '.', ' ')}`;

        // "<123> emails indexed (<456>)"
        let middleText = document.createElement('span');
        middleText.textContent = ' emails indexed (';
        let endText = document.createElement('span');
        endText.textContent = ')';

        descriptionElm.appendChild(emailCountElm);
        descriptionElm.appendChild(middleText);
        descriptionElm.appendChild(emailSizeElm);
        descriptionElm.appendChild(endText);

        divBodyElm.appendChild(descriptionElm);

        container.appendChild(liElm);

        elements.push({ data, elm: liElm });
    };

    let redrawList = async () => {
        let projects = await exec({
            command: 'listProjects'
        });

        let container = document.getElementById('project-list');
        while (elements.length) {
            let elm = elements.shift();
            container.removeChild(elm.elm);
        }

        projects.data.forEach(projectData => {
            renderProject(container, projectData);
        });

        selectable.update(elements);
    };

    let main = async () => {
        let projects = await exec({
            command: 'listProjects'
        });

        let container = document.getElementById('project-list');
        projects.data.forEach(projectData => {
            renderProject(container, projectData);
        });

        selectable.update(elements);
        selectable.activate();

        window.events.subscribe('project-created', () => {
            return redrawList();
        });

        window.events.subscribe('focus-change', data => {
            switch (data.type) {
                case 'blur':
                    return exec({
                        command: 'updateMenu',
                        params: {
                            id: ['rename-project', 'delete-project'],
                            enabled: false
                        }
                    }).catch(() => false);
                case 'focus':
                    {
                        let active = selectable.getSelected();
                        if (active) {
                            return exec({
                                command: 'updateMenu',
                                params: {
                                    id: ['rename-project', 'delete-project'],
                                    enabled: true
                                }
                            }).catch(() => false);
                        }
                    }
                    break;
            }
        });

        window.events.subscribe('menu-click', data => {
            switch (data.type) {
                case 'rename-project': {
                    let active = selectable.getSelected();
                    if (!active) {
                        return;
                    }

                    return exec({
                        command: 'renameProject',
                        params: {
                            name: active.data.name,
                            id: active.data.id
                        }
                    })
                        .then(result => {
                            if (result) {
                                return redrawList();
                            }
                        })
                        .catch(() => false);
                }

                case 'delete-project': {
                    let active = selectable.getSelected();
                    if (!active) {
                        return;
                    }
                    if (!confirm(`Are you sure you want to delete "${active.data.name}"?`)) {
                        return;
                    }
                    return exec({
                        command: 'deleteProject',
                        params: {
                            id: active.data.id
                        }
                    })
                        .then(result => {
                            if (result) {
                                return redrawList();
                            }
                        })
                        .catch(() => false);
                }
            }
        });

        window.events.subscribe('project-update', data => {
            let projectRow = elements.find(row => row.data.id === data.id);

            if (projectRow) {
                Object.keys(data).forEach(key => {
                    projectRow.data[key] = data[key];
                });

                let emailCountElm = projectRow.elm.querySelector('.emails-count');
                if (emailCountElm) {
                    emailCountElm.textContent = `${humanize.numberFormat(data.emails, 0, '.', ' ')}`;
                }

                let emailSizeElm = projectRow.elm.querySelector('.emails-size');
                if (emailSizeElm) {
                    emailSizeElm.textContent = `${humanize.filesize(data.size || 0, 1024, 0, '.', ' ')}`;
                }
            }
        });
    };

    serverConfigBtn.addEventListener('click', () => {
        serverConfigBtn.classList.add('active');
        exec({
            command: 'serverConfig'
        })
            .then(result => {
                if (result) {
                    openProject(result);
                }
            })
            .catch(() => false)
            .finally(() => {
                serverConfigBtn.classList.remove('active');
            });
    });

    let createProjectElm = document.getElementById('create-project-btn');
    createProjectElm.addEventListener('click', () => {
        createProjectElm.classList.add('active');
        exec({
            command: 'createProject'
        })
            .then(result => {
                if (result) {
                    openProject(result);
                }
            })
            .catch(() => false)
            .finally(() => {
                createProjectElm.classList.remove('active');
            });
    });

    let searchElm = document.getElementById('search-project');
    let onSearchChange = () => {
        let searchTerm = searchElm.value.trim().toLowerCase();
        elements.forEach(entry => {
            if (!searchTerm) {
                entry.elm.classList.remove('hidden');
                return;
            }
            if (entry.data.name.toLowerCase().indexOf(searchTerm) < 0) {
                entry.elm.classList.add('hidden');
            } else {
                entry.elm.classList.remove('hidden');
            }
        });
    };

    searchElm.addEventListener('change', onSearchChange);
    searchElm.addEventListener('keyup', onSearchChange);

    deleteActiveBtn.addEventListener('click', () => {
        deleteActiveBtn.classList.add('active');
        let active = elements.find(elm => elm.elm.classList.contains('active'));
        if (!active) {
            deleteActiveBtn.classList.remove('active');
            return;
        }
        if (!confirm(`Are you sure you want to delete "${active.data.name}"?`)) {
            deleteActiveBtn.classList.remove('active');
            return;
        }
        exec({
            command: 'deleteProject',
            params: {
                id: active.data.id
            }
        })
            .then(result => {
                if (result) {
                    return redrawList();
                }
            })
            .catch(() => false)
            .finally(() => {
                deleteActiveBtn.classList.remove('active');
            });
    });

    editActiveBtn.addEventListener('click', () => {
        editActiveBtn.classList.add('active');
        let active = elements.find(elm => elm.elm.classList.contains('active'));
        if (!active) {
            editActiveBtn.classList.remove('active');
            return;
        }

        exec({
            command: 'renameProject',
            params: {
                name: active.data.name,
                id: active.data.id
            }
        })
            .then(result => {
                if (result) {
                    return redrawList();
                }
            })
            .catch(() => false)
            .finally(() => {
                editActiveBtn.classList.remove('active');
            });
    });

    main()
        .catch(err => console.error(err))
        .finally(() => false);
})();
