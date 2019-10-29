'use strict';
/* eslint global-require: 0 */
/* globals document, window, exec, confirm, alert */

(() => {
    let elements = [];

    const humanize = require('humanize');

    let projectEditGroupElm = document.getElementById('project-edit-group');

    let deleteActiveBtn = document.getElementById('delete-active-btn');
    let editActiveBtn = document.getElementById('edit-active-btn');

    let setActive = (e, selected) => {
        if (e) {
            //e.preventDefault();
        }
        elements.forEach(elm => {
            if (!selected || elm.elm !== selected) {
                elm.elm.classList.remove('active');
            }
        });
        if (selected) {
            selected.classList.add('active');
            projectEditGroupElm.classList.remove('hidden');
        } else {
            projectEditGroupElm.classList.add('hidden');
        }
    };

    let openProject = id => {
        exec({
            command: 'openProject',
            params: {
                id
            }
        })
            .catch(() => false)
            .finally(() => {
                setActive();
            });
    };

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

        // menu buttons
        /*
        <div class="btn-group pull-right">
            <button class="btn btn-default">
                <span class="icon icon-export"></span>
            </button>
        </div>
        */

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

        liElm.addEventListener('click', e => setActive(e, liElm));
        liElm.addEventListener('mousedown', e => setActive(e, liElm));
        liElm.addEventListener('touchstart', e => setActive(e, liElm));

        liElm.addEventListener('dblclick', e => {
            setActive(e, liElm);
            openProject(data.id);
        });
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

        setActive();
    };

    let main = async () => {
        let projects = await exec({
            command: 'listProjects'
        });

        let container = document.getElementById('project-list');
        projects.data.forEach(projectData => {
            renderProject(container, projectData);
        });

        setActive();

        window.events.subscribe('project-created', () => {
            return redrawList();
        });

        window.events.subscribe('project-update', data => {
            let projectRow = elements.find(row => row.data.id === data.id);

            if (projectRow) {
                projectRow.data = data;

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
        setActive();
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
            .then(() => {
                alert(`"${active.data.name}" was successfully deleted`);
            })
            .catch(err => {
                alert(err.message);
            })
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
