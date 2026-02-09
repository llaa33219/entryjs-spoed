'use strict';

Entry.WasmEngine = class WasmEngine {
    constructor() {
        this._api = null;
        this._canvas = null;
        this._active = false;
    }

    isAvailable() {
        return (
            typeof window.EntryCompiler !== 'undefined' &&
            typeof window.EntryCompiler.run === 'function'
        );
    }

    isActive() {
        return this._active;
    }

    _getProjectJSON() {
        return {
            objects: Entry.container.toJSON(),
            scenes: Entry.scene.toJSON(),
            variables: Entry.variableContainer.getVariableJSON(),
            messages: Entry.variableContainer.getMessageJSON(),
            functions: Entry.variableContainer.getFunctionJSON(),
            speed: Entry.FPS,
        };
    }

    _createOverlayCanvas() {
        const entryCanvas = document.getElementById('entryCanvas');
        if (!entryCanvas) {
            return null;
        }

        const parent = entryCanvas.parentNode;
        if (window.getComputedStyle(parent).position === 'static') {
            parent.style.position = 'relative';
        }

        const canvas = document.createElement('canvas');
        canvas.id = 'wasmCanvas';
        canvas.width = 1920;
        canvas.height = 1080;
        canvas.style.position = 'absolute';
        canvas.style.top = entryCanvas.offsetTop + 'px';
        canvas.style.left = entryCanvas.offsetLeft + 'px';
        canvas.style.width = entryCanvas.offsetWidth + 'px';
        canvas.style.height = entryCanvas.offsetHeight + 'px';
        canvas.style.zIndex = '10';
        canvas.style.background = '#fff';

        parent.appendChild(canvas);
        entryCanvas.style.visibility = 'hidden';

        return canvas;
    }

    _pauseEntryJS() {
        if (Entry.stage && Entry.stage.timer) {
            clearTimeout(Entry.stage.timer);
            Entry.stage.timer = null;
        }
        if (Entry.engine && Entry.engine.ticker) {
            clearInterval(Entry.engine.ticker);
            Entry.engine.ticker = null;
        }
        Entry.requestUpdate = false;
    }

    _resumeEntryJS() {
        Entry.requestUpdate = true;
        if (Entry.stage && !Entry.stage.timer) {
            Entry.stage.render();
        }
    }

    _removeOverlayCanvas() {
        if (this._canvas && this._canvas.parentNode) {
            this._canvas.parentNode.removeChild(this._canvas);
        }
        this._canvas = null;
        const entryCanvas = document.getElementById('entryCanvas');
        if (entryCanvas) {
            entryCanvas.style.visibility = '';
        }
    }

    async start() {
        if (!this.isAvailable() || this._active) {
            return false;
        }

        const projectJSON = this._getProjectJSON();
        this._canvas = this._createOverlayCanvas();
        if (!this._canvas) {
            console.error('[WasmEngine] Could not create overlay canvas');
            return false;
        }

        this._active = true;
        this._pauseEntryJS();

        try {
            console.log('[WasmEngine] Compiling project...');
            const api = await window.EntryCompiler.run(this._canvas, projectJSON, {
                assetBaseUrl: Entry.baseUrl || 'https://playentry.org',
            });

            if (!this._active) {
                try {
                    api.stop();
                } catch (e) {}
                return false;
            }

            this._api = api;
            console.log('[WasmEngine] Project started');
            return true;
        } catch (e) {
            if (!this._active) {
                return false;
            }
            console.error('[WasmEngine] Failed to start:', e);
            this._resumeEntryJS();
            this._active = false;
            this._removeOverlayCanvas();
            if (Entry.toast) {
                Entry.toast.alert(
                    'WASM 컴파일 오류',
                    e.message || 'WASM compilation failed',
                    true
                );
            }
            return false;
        }
    }

    stop() {
        if (this._api) {
            try {
                this._api.stop();
            } catch (e) {
                console.warn('[WasmEngine] Stop error:', e);
            }
            this._api = null;
        }
        this._resumeEntryJS();
        this._removeOverlayCanvas();
        this._active = false;
    }

    pause() {
        if (this._api) {
            try {
                this._api.pause();
            } catch (e) {
                console.warn('[WasmEngine] Pause error:', e);
            }
        }
    }

    resume() {
        if (this._api) {
            try {
                this._api.resume();
            } catch (e) {
                console.warn('[WasmEngine] Resume error:', e);
            }
        }
    }
};
