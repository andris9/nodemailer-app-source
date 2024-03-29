'use strict';
/* eslint global-require: 0 */
/* globals document, window, exec, confirm */

(() => {
    let elements = [];

    const humanize = require('humanize');

    let projectEditGroupElm = document.getElementById('project-edit-group');

    let deleteActiveBtn = document.getElementById('delete-active-btn');
    let editActiveBtn = document.getElementById('edit-active-btn');

    let openProject = id => {
        exec({
            command: 'openProject',
            params: {
                id
            }
        }).catch(() => false);
    };

    let deactivate = async () => {
        projectEditGroupElm.classList.add('hidden');

        await exec({
            command: 'updateMenu',
            params: {
                id: ['rename-project', 'delete-project'],
                enabled: false
            }
        });
    };

    let selectable = new window.Selectable(elements, (action, row) => {
        switch (action) {
            case 'open':
                openProject(row.data.id);
                deactivate().catch(() => false);
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
                deactivate().catch(() => false);
                break;
        }
    });

    let renderProject = (container, data) => {
        let liElm = document.createElement('li');
        liElm.classList.add('list-group-item');

        // icon
        let imgElm = document.createElement('img');
        imgElm.classList.add('img-circle', 'media-object', 'pull-left');
        imgElm.setAttribute(
            'src',
            `data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' height='100px' width='100px'%3E%3Crect x='0' y='0' width='100' height='100' style='fill:%23${data.color.substr(
                1
            )};' /%3E%3C/svg%3E`
        );
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
        middleText.textContent = ` email${Number(data.emails) !== 1 ? 's' : ''} indexed (`;
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

        if (!projects.data.length) {
            document.getElementById('empty-project-list').classList.remove('hidden');

            // hide project tools menu
            deactivate().catch(() => false);
        } else {
            document.getElementById('empty-project-list').classList.add('hidden');
        }

        selectable.update(elements);
    };

    let serverStatus = {
        running: false
    };

    let main = async () => {
        let projects = await exec({
            command: 'listProjects'
        });

        let iconElm = document.getElementById('server-toggle-btn').querySelector('.icon');

        let container = document.getElementById('project-list');
        projects.data.forEach(projectData => {
            renderProject(container, projectData);
        });

        if (!projects.data.length) {
            document.getElementById('empty-project-list').classList.remove('hidden');
        } else {
            document.getElementById('empty-project-list').classList.add('hidden');
        }

        selectable.update(elements);
        selectable.activate();

        window.events.subscribe('project-created', () => {
            return redrawList();
        });

        serverStatus = await exec({
            command: 'serverStatus'
        });

        window.events.subscribe('server-status', update => {
            serverStatus = update;
            if (serverStatus.running) {
                iconElm.classList.remove('icon-play');
                iconElm.classList.add('icon-stop');
            } else {
                iconElm.classList.add('icon-play');
                iconElm.classList.remove('icon-stop');
            }
        });

        if (serverStatus.running) {
            iconElm.classList.remove('icon-play');
            iconElm.classList.add('icon-stop');
        } else {
            iconElm.classList.add('icon-play');
            iconElm.classList.remove('icon-stop');
        }

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

    let serverConfigBtn = document.getElementById('server-config-btn');
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

    let serverStartBtn = document.getElementById('server-toggle-btn');
    serverStartBtn.addEventListener('click', () => {
        serverStartBtn.classList.add('active');
        exec({
            command: serverStatus.running ? 'serverStop' : 'serverStart'
        })
            .catch(() => false)
            .finally(() => {
                serverStartBtn.classList.remove('active');
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

    window.events.subscribe('find', () => {
        searchElm.focus();
        searchElm.select();
    });

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
