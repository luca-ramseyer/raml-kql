// Vite `?worker` imports (bundled module workers).
declare module '*?worker' {
  const WorkerFactory: new () => Worker;
  export default WorkerFactory;
}

// Monaco entry points without their own typings (same API as editor.api).
declare module 'monaco-editor/esm/vs/editor/edcore.main.js' {
  export * from 'monaco-editor/esm/vs/editor/editor.api.js';
}
declare module 'monaco-editor/esm/vs/editor/editor.worker.js';
