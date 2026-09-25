// Dedicated worker for label "kusto": the Kusto language service plus Monaco's editor worker
// (monaco-kusto README: routing "kusto" to the generic editor worker no longer works).
// ES modules evaluate in import order, so the `global` shim runs before the language service.
import './worker-globals';
import '@kusto/monaco-kusto/release/esm/kusto.worker';
import 'monaco-editor/esm/vs/editor/editor.worker.js';
