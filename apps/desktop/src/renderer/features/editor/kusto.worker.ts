// Dedicated worker for label "kusto": the Kusto language service plus Monaco's editor worker
// (monaco-kusto README: routing "kusto" to the generic editor worker no longer works).
import '@kusto/monaco-kusto/release/esm/kusto.worker';
import 'monaco-editor/esm/vs/editor/editor.worker.js';
