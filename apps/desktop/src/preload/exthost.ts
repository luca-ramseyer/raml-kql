/**
 * Preload of the hidden extension host window. It exposes nothing: it only hands the
 * MessagePorts main creates for each extension to the host page (the documented Electron
 * pattern for transferring ports into a context-isolated page).
 */
import { ipcRenderer } from 'electron';

/** The page's window (preloads are typed without the DOM). */
const page = globalThis as unknown as {
  postMessage(message: unknown, targetOrigin: string, transfer?: unknown[]): void;
};

ipcRenderer.on('exthost:start', (event, message: { id: string; code: string }) => {
  page.postMessage({ type: 'start', id: message.id, code: message.code }, '*', event.ports);
});

ipcRenderer.on('exthost:stop', (_event, message: { id: string }) => {
  page.postMessage({ type: 'stop', id: message.id }, '*');
});
