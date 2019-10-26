'use strict';
/* eslint global-require: 0 */
/* globals document, exec, confirm, alert */

(() => {
    let elements = [];

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
            deleteActiveBtn.classList.remove('hidden');
            editActiveBtn.classList.remove('hidden');
        } else {
            deleteActiveBtn.classList.add('hidden');
            editActiveBtn.classList.add('hidden');
        }
    };

    let openProject = (elms, id) => {
        exec({
            command: 'openProject',
            params: {
                id
            }
        }).finally(() => {
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
        let menuGroupElm = document.createElement('div');
        menuGroupElm.classList.add('btn-group', 'pull-right');
        let menuBtnOpenElm = document.createElement('button');
        menuBtnOpenElm.classList.add('btn', 'btn-default');
        let menuBtnOpenIconElm = document.createElement('span');
        menuBtnOpenIconElm.classList.add('icon', 'icon-export');
        menuBtnOpenElm.appendChild(menuBtnOpenIconElm);
        menuGroupElm.appendChild(menuBtnOpenElm);
        liElm.appendChild(menuGroupElm);

        menuBtnOpenElm.addEventListener('click', () => {
            menuBtnOpenElm.classList.add('active');
            openProject([menuBtnOpenElm, liElm], data.id);
        });

        // body
        let divBodyElm = document.createElement('div');
        divBodyElm.classList.add('media-body');
        liElm.appendChild(divBodyElm);

        let titleElm = document.createElement('strong');
        titleElm.textContent = data.name;
        divBodyElm.appendChild(titleElm);

        let descriptionElm = document.createElement('p');
        descriptionElm.textContent = data.folderName;
        divBodyElm.appendChild(descriptionElm);

        container.appendChild(liElm);

        elements.push({ data, elm: liElm });

        liElm.addEventListener('click', e => setActive(e, liElm));
        liElm.addEventListener('mousedown', e => setActive(e, liElm));
        liElm.addEventListener('touchstart', e => setActive(e, liElm));

        liElm.addEventListener('dblclick', e => {
            setActive(e, liElm);
            openProject([liElm], data.id);
        });
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
    };

    let redrawList = async () => {
        let projects = await exec({
            command: 'listProjects'
        });

        console.log(projects);

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

    let createProjectElm = document.getElementById('create-project-btn');
    createProjectElm.addEventListener('click', () => {
        createProjectElm.classList.add('active');
        exec({
            command: 'createProject'
        })
            .then(result => {
                if (result) {
                    return redrawList();
                }
            })
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
            .finally(() => {
                editActiveBtn.classList.remove('active');
            });
    });

    main()
        .catch(err => console.error(err))
        .finally(() => false);
})();
