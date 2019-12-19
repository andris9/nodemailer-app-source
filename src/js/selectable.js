/* global window, document */

'use strict';

(() => {
    class Selectable {
        constructor(list, listener) {
            this.listener = listener;
            this.active = false;

            if (list) {
                this.update(list);
            }

            if (this._keyDownEvent) {
                document.body.removeEventListener('keydown', this._keyDownEvent);
            }

            if (this._keyUpEvent) {
                document.body.removeEventListener('keyup', this._keyUpEvent);
            }

            this.emitTimer = false;
            let keyPressCount = 0;
            this._keyDownEvent = ev => {
                if (ev.target && (typeof ev.target.form !== 'undefined' || /tagify/.test(ev.target.className))) {
                    return;
                }

                if (keyPressCount++ > 0) {
                    switch (ev.code) {
                        case 'ArrowUp':
                        case 'ArrowLeft':
                            return this.up();
                        case 'ArrowDown':
                        case 'ArrowRight':
                            return this.down();
                    }
                }
            };

            this._keyUpEvent = ev => {
                if (ev.target && (typeof ev.target.form !== 'undefined' || /tagify/.test(ev.target.className))) {
                    return;
                }

                keyPressCount = 0;
                switch (ev.code) {
                    case 'ArrowUp':
                    case 'ArrowLeft':
                        return this.up();
                    case 'ArrowDown':
                    case 'ArrowRight':
                        return this.down();
                    case 'Escape':
                        return this.select();
                    case 'Enter':
                        return this.open();
                }
            };

            document.body.addEventListener('keydown', this._keyDownEvent);
            document.body.addEventListener('keyup', this._keyUpEvent);
        }

        open(entry) {
            entry = entry || this.active;
            if (!entry) {
                return;
            }
            this.select();
            this.listener('open', entry);
        }

        update(list) {
            this.list = list;
            this.list.forEach(entry => {
                if (entry.elm.classList.contains('active')) {
                    if (!this.active) {
                        this.active = entry;
                    } else {
                        entry.elm.classList.remove('active');
                    }
                }

                entry.elm.addEventListener('click', () => this.select(entry));
                entry.elm.addEventListener('mousedown', () => this.select(entry));
                entry.elm.addEventListener('touchstart', () => this.select(entry));

                entry.elm.addEventListener('dblclick', () => {
                    this.select(entry);
                    this.open(entry);
                });
            });
        }

        activate() {
            this.activated = true;
        }

        disable() {
            this.select();
            this.activated = false;
        }

        up() {
            if (!this.activated || !this.list) {
                return;
            }

            if (!this.active) {
                return;
            }

            let prev = false;
            for (let entry of this.list) {
                if (entry === this.active) {
                    break;
                }
                if (!entry.elm.classList.contains('hidden')) {
                    prev = entry;
                }
            }
            if (!prev) {
                return;
            }
            this.select(prev);
        }

        down() {
            if (!this.activated || !this.list) {
                return;
            }

            if (!this.active) {
                if (this.list.length) {
                    this.select(this.list[0]);
                }
                return;
            }

            let next = false;
            let found = false;
            for (let entry of this.list) {
                if (entry === this.active) {
                    found = true;
                    continue;
                }
                if (found && !entry.elm.classList.contains('hidden')) {
                    next = entry;
                    break;
                }
            }
            if (!next) {
                return;
            }
            this.select(next);
        }

        getSelected() {
            return this.active;
        }

        // select first element
        focus() {
            if (this.list && this.list.length) {
                this.select(this.list[0]);
            }
        }

        selectFirst() {
            if (!this.activated || !this.list) {
                return;
            }
            this.select(this.list.length && this.list[0]);
        }

        select(entry) {
            if (!this.activated || !this.list) {
                return;
            }

            if (!entry) {
                if (this.active) {
                    let entry = this.active;
                    this.active.elm.classList.remove('active');
                    this.active = false;
                    this.listener('deactivate', entry);
                }
                return;
            }

            if (typeof entry === 'number') {
                entry = this.list.find(e => e.data && e.data.id === entry);
                if (!entry) {
                    return;
                }
            }

            if (this.active === entry) {
                // nothing to do here
                return;
            }

            if (this.active) {
                this.active.elm.classList.remove('active');
            }

            this.active = entry;
            entry.elm.classList.add('active');

            clearTimeout(this.emitTimer);
            this.emitTimer = setTimeout(() => {
                this.listener('active', entry);
            }, 100);
        }
    }

    window.Selectable = Selectable;
})();
