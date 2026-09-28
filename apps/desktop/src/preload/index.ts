/**
 * Preload entry. Runs sandboxed (no Node APIs besides a small Electron subset), so every
 * dependency is bundled into this file by electron-vite. Exposes exactly one global:
 * `window.ramlKql`. The renderer never touches `ipcRenderer` directly.
 */
import { contextBridge, ipcRenderer } from 'electron';

import { createRamlKqlApi } from './api';

contextBridge.exposeInMainWorld('ramlKql', createRamlKqlApi(ipcRenderer));
