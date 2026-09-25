import { executeCommand } from '../../platform/commands';
import { useEditors } from '../../platform/editors';
import { showPanelTab, togglePanel } from '../../platform/layout';
import { notify } from '../../platform/notifications';
import { getSetting } from '../../platform/settings';
import { getActiveCodeEditor } from '../editor/active-editor';
import { selectedWorkspaces, useTargets } from '../targets/targets-store';

import { useQueryDocs, type QueryDoc } from './query-docs';
import { startRun, useRuns } from './run-store';
import { queryToRun } from './run-text';
import { timespanFor } from './time-range';

/** The active tab when it's a query tab. */
export function activeQuery(): { id: string; doc: QueryDoc } | undefined {
  const { editors, activeId } = useEditors.getState();
  const editor = editors.find((e) => e.id === activeId);
  if (editor?.kind !== 'query') return undefined;
  const doc = useQueryDocs.getState().docs[editor.id];
  return doc === undefined ? undefined : { id: editor.id, doc };
}

/** Shift+Enter (spec 05): pre-flight, then fan out to the selected targets. */
export async function runActiveQuery(options: { scope?: 'block' | 'all' } = {}): Promise<void> {
  const active = activeQuery();
  if (active === undefined) return;
  if (useRuns.getState().byTab[active.id]?.state === 'running') return;

  const editor = getActiveCodeEditor();
  const model = editor?.getModel() ?? undefined;
  const selection = editor?.getSelection() ?? undefined;
  const runText = queryToRun(
    model?.getValue() ?? active.doc.text,
    editor?.getPosition()?.lineNumber ?? 1,
    options.scope ?? getSetting('editor.runScope'),
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
  const { groupId } = useTargets.getState();
  const title = useEditors.getState().editors.find((e) => e.id === active.id)?.title;
  await startRun({
    tabId: active.id,
    query: runText.text,
    ...(timespan === undefined ? {} : { timespan }),
    resourceIds: targets.map((w) => w.resourceId),
    ...(groupId === undefined ? {} : { groupId }),
    timeRange: active.doc.timeRange,
    ...(title === undefined ? {} : { tabTitle: title }),
  });
}
