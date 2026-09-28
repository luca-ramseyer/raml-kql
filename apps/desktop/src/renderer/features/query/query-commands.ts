import { executeCommand, registerCommand } from '../../platform/commands';
import { onEditorClosed, openQueryEditor, useEditors } from '../../platform/editors';
import { showPanelTab, togglePanel } from '../../platform/layout';
import { notify } from '../../platform/notifications';
import { getSetting } from '../../platform/settings';
import { getBridge, unwrap } from '../../services/ipc';
import { getActiveCodeEditor, runEditorAction } from '../editor/active-editor';
import { disposeQueryModel } from '../editor/query-models';
import { loadSchema } from '../editor/schema-store';
import { showTimeRangePicker } from '../editor/TimeRangePicker';
import { forgetTabResults } from '../results/results-ui';
import { selectedWorkspaces } from '../targets/targets-store';

import {
  createQueryDoc,
  deleteQueryDoc,
  STARTER_QUERY,
  updateQueryDoc,
  useQueryDocs,
  type QueryDoc,
} from './query-docs';
import {
  cancelTabRun,
  clearAllResults,
  forgetTabRun,
  rerunTab,
  startRun,
  useRuns,
} from './run-store';
import { queryToRun } from './run-text';
import { timespanFor } from './time-range';

let starterShown = false;

function activeQuery(): { id: string; doc: QueryDoc } | undefined {
  const { editors, activeId } = useEditors.getState();
  const editor = editors.find((e) => e.id === activeId);
  if (editor?.kind !== 'query') return undefined;
  const doc = useQueryDocs.getState().docs[editor.id];
  return doc === undefined ? undefined : { id: editor.id, doc };
}

/** Shift+Enter (spec 05): pre-flight, then fan out to the selected targets. */
export async function runActiveQuery(): Promise<void> {
  const active = activeQuery();
  if (active === undefined) return;
  if (useRuns.getState().byTab[active.id]?.state === 'running') return;

  const editor = getActiveCodeEditor();
  const model = editor?.getModel() ?? undefined;
  const selection = editor?.getSelection() ?? undefined;
  const runText = queryToRun(
    model?.getValue() ?? active.doc.text,
    editor?.getPosition()?.lineNumber ?? 1,
    getSetting('editor.runScope'),
    model === undefined || selection === undefined || selection.isEmpty()
      ? undefined
      : {
          text: model.getValueInRange(selection),
          startLine: selection.startLineNumber,
          endLine: selection.endLineNumber,
        },
  );
  if (runText === undefined) {
    notify({ severity: 'info', message: 'There is no query to run here.', source: 'Query' });
    return;
  }

  if (editor !== undefined && model !== undefined) {
    const { syntaxErrors } = await import('../editor/preflight');
    const [error] = await syntaxErrors(model, runText.startLine, runText.endLine).catch(() => []);
    if (error !== undefined) {
      editor.setPosition({ lineNumber: error.line, column: error.column });
      editor.revealLineInCenterIfOutsideViewport(error.line);
      editor.focus();
      notify({
        severity: 'error',
        message: `Syntax error on line ${String(error.line)}: ${error.message} The query was not sent.`,
        source: 'Query',
      });
      return;
    }
  }

  const targets = selectedWorkspaces();
  if (targets.length === 0) {
    notify({
      severity: 'warning',
      message: 'Select at least one workspace in Targets to run the query.',
      source: 'Query',
      actions: [
        { label: 'Show Targets', run: () => void executeCommand('workbench.view.targets') },
      ],
    });
    return;
  }

  togglePanel(true);
  showPanelTab('results');
  const timespan = timespanFor(active.doc.timeRange, active.doc.timeSetInQuery);
  await startRun({
    tabId: active.id,
    query: runText.text,
    ...(timespan === undefined ? {} : { timespan }),
    resourceIds: targets.map((w) => w.resourceId),
  });
}

/** Open a new query tab. The first one of a session starts with the sample query (spec 05). */
export function newQuery(): string {
  const id = openQueryEditor();
  createQueryDoc(id, starterShown ? '' : STARTER_QUERY);
  starterShown = true;
  return id;
}

async function verifyAuditLog(): Promise<void> {
  try {
    const result = await unwrap(getBridge().audit.verify());
    notify(
      result.ok
        ? {
            severity: 'info',
            message: `The audit log is intact: ${String(result.entries)} entries in ${String(result.files)} file${result.files === 1 ? '' : 's'}.`,
            source: 'Audit',
          }
        : {
            severity: 'error',
            message: `The audit log has been modified: ${result.problem?.reason ?? 'unknown problem'} (${result.problem?.file ?? ''}, line ${String(result.problem?.line ?? 0)}).`,
            source: 'Audit',
          },
    );
  } catch (error) {
    notify({
      severity: 'error',
      message: error instanceof Error ? error.message : 'The audit log could not be verified.',
      source: 'Audit',
    });
  }
}

/** For tests. */
export function resetQueryCommands(): void {
  starterShown = false;
}

const IN_QUERY = "editorLangId == 'kusto'";

export function registerQueryCommands(): () => void {
  const disposers = [
    onEditorClosed((editor) => {
      if (editor.kind !== 'query') return;
      forgetTabRun(editor.id);
      forgetTabResults(editor.id);
      deleteQueryDoc(editor.id);
      disposeQueryModel(editor.id);
    }),
    registerCommand({
      id: 'query.run',
      title: 'Run Query',
      category: 'Query',
      icon: 'play',
      when: IN_QUERY,
      run: runActiveQuery,
    }),
    registerCommand({
      id: 'query.cancel',
      title: 'Cancel Query',
      category: 'Query',
      icon: 'debug-stop',
      when: 'queryRunning',
      run: () => {
        const active = activeQuery();
        if (active !== undefined) void cancelTabRun(active.id);
      },
    }),
    registerCommand({
      id: 'query.rerunFailed',
      title: 'Re-run Failed Workspaces',
      category: 'Query',
      icon: 'refresh',
      when: IN_QUERY,
      run: () => {
        const active = activeQuery();
        if (active !== undefined) void rerunTab(active.id, ['failed']);
      },
    }),
    registerCommand({
      id: 'query.rerunFailedLongerTimeout',
      title: 'Re-run Failed and Timed Out with a Longer Timeout',
      category: 'Query',
      when: IN_QUERY,
      run: () => {
        const active = activeQuery();
        const timeout = Math.min(600, getSetting('query.timeoutSeconds') * 2);
        if (active !== undefined) void rerunTab(active.id, ['failed', 'timeout'], timeout);
      },
    }),
    registerCommand({
      id: 'results.clearAll',
      title: 'Clear All Results',
      category: 'Results',
      icon: 'clear-all',
      run: clearAllResults,
    }),
    registerCommand({
      id: 'audit.verify',
      title: 'Verify Log Integrity',
      category: 'Audit',
      icon: 'shield',
      run: verifyAuditLog,
    }),
    registerCommand({
      id: 'query.new',
      title: 'New Query',
      category: 'Query',
      icon: 'new-file',
      run: newQuery,
    }),
    registerCommand({
      id: 'query.selectTimeRange',
      title: 'Select Time Range',
      category: 'Query',
      icon: 'history',
      when: IN_QUERY,
      run: () => {
        const id = useEditors.getState().activeId;
        const doc = id === undefined ? undefined : useQueryDocs.getState().docs[id];
        if (id === undefined || doc === undefined) return;
        showTimeRangePicker(doc.timeRange, getSetting('time.displayZone'), (timeRange) => {
          updateQueryDoc(id, { timeRange });
        });
      },
    }),
    registerCommand({
      id: 'schema.refresh',
      title: 'Refresh Schema',
      category: 'Query',
      icon: 'refresh',
      run: () => loadSchema(true),
    }),
    registerCommand({
      id: 'editor.action.formatDocument',
      title: 'Format Document',
      when: IN_QUERY,
      run: () => runEditorAction('editor.action.formatDocument'),
    }),
    registerCommand({
      id: 'editor.action.commentLine',
      title: 'Toggle Line Comment',
      when: IN_QUERY,
      run: () => runEditorAction('editor.action.commentLine'),
    }),
    registerCommand({
      id: 'actions.find',
      title: 'Find',
      when: IN_QUERY,
      run: () => runEditorAction('actions.find'),
    }),
    registerCommand({
      id: 'editor.action.startFindReplaceAction',
      title: 'Replace',
      when: IN_QUERY,
      run: () => runEditorAction('editor.action.startFindReplaceAction'),
    }),
  ];
  return () => {
    for (const dispose of disposers) dispose();
  };
}
