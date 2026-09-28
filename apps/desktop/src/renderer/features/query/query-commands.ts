import { registerCommand } from '../../platform/commands';
import {
  activateEditor,
  focusGroup,
  moveEditor,
  onEditorClosed,
  openQueryEditor,
  previousEditorInGroup,
  splitGroup,
  updateEditor,
  useEditors,
} from '../../platform/editors';
import { notify } from '../../platform/notifications';
import {
  filterQuickPickItems,
  registerQuickAccessProvider,
  showQuickPick,
} from '../../platform/quickinput/quick-input';
import { getSetting } from '../../platform/settings';
import { getBridge, unwrap } from '../../services/ipc';
import { getCodeEditor, runEditorAction } from '../editor/active-editor';
import { disposeQueryModel } from '../editor/query-models';
import { loadSchema } from '../editor/schema-store';
import { showTimeRangePicker } from '../editor/TimeRangePicker';
import { clearHistory, openHistoryEntry, queryLabel, useHistory } from '../history/history-store';
import {
  folderOf,
  loadMyQueries,
  openMyQuery,
  useMyQueries,
  newFolder,
  newQueryFile,
  revealQuery,
  saveTab,
  saveTabAs,
} from '../library/my-queries';
import { forgetTabResults } from '../results/results-ui';
import { copyTabTargets, forgetTabTargets } from '../targets/targets-store';

import { newQuery } from './open-query';
import { createQueryDoc, deleteQueryDoc, updateQueryDoc, useQueryDocs } from './query-docs';
import { activeQuery, runActiveQuery } from './run-query';
import { cancelTabRun, clearAllResults, forgetTabRun, rerunTab } from './run-store';

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

/**
 * Split Right (spec 05, Ctrl/Cmd+\\): a query tab is duplicated into a new group to the right
 * (its own copy of the text, time range and targets); other editors move there.
 */
export function splitActiveEditor(): void {
  const { activeId, editors } = useEditors.getState();
  const active = editors.find((e) => e.id === activeId);
  const groupId = splitGroup();
  if (active === undefined) {
    newQuery();
    return;
  }
  if (active.kind !== 'query') {
    moveEditor(active.id, groupId);
    return;
  }
  const doc = useQueryDocs.getState().docs[active.id];
  const id = openQueryEditor({ title: active.title, groupId });
  createQueryDoc(id, doc?.text ?? '');
  if (doc !== undefined) {
    updateQueryDoc(id, { timeRange: doc.timeRange, timeSetInQuery: doc.timeSetInQuery });
  }
  copyTabTargets(active.id, id);
}

const IN_QUERY = "editorLangId == 'kusto'";

export function registerQueryCommands(): () => void {
  const disposers = [
    onEditorClosed((editor) => {
      if (editor.kind !== 'query') return;
      forgetTabRun(editor.id);
      forgetTabResults(editor.id);
      forgetTabTargets(editor.id);
      deleteQueryDoc(editor.id);
      disposeQueryModel(editor.id);
    }),
    registerCommand({
      id: 'query.run',
      title: 'Run Query',
      category: 'Query',
      icon: 'play',
      when: IN_QUERY,
      run: () => runActiveQuery(),
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
    // Ctrl/Cmd+P (spec 05): open editors, My Queries and recent runs.
    registerQuickAccessProvider({
      prefix: '',
      helpText: 'Go to Query (open editors, My Queries, history)',
      placeholder:
        'Search open editors, My Queries and history (append > to run commands, ? for help)',
      noResultsText: 'Nothing matches. Type > to search commands.',
      getItems: (filter) => {
        const editors = useEditors.getState().editors.map((editor, i) => ({
          id: `editor:${editor.id}`,
          label: editor.title,
          icon: editor.icon,
          description: editor.description,
          ...(i === 0 ? { group: 'open editors' } : {}),
        }));
        const queries = useMyQueries
          .getState()
          .nodes.filter((n) => n.kind === 'file')
          .map((node, i) => ({
            id: `query:${node.path}`,
            label: node.name,
            icon: 'file-code',
            description: folderOf(node.path) || 'My Queries',
            ...(i === 0 ? { group: 'my queries' } : {}),
          }));
        const history = useHistory
          .getState()
          .entries.slice(0, 200)
          .map((entry, i) => ({
            id: `history:${entry.id}`,
            label: queryLabel(entry.query),
            icon: 'history',
            description: new Date(entry.ts).toLocaleString(),
            ...(i === 0 ? { group: 'recently run' } : {}),
          }));
        if (filter.trim() === '') return [...editors, ...queries, ...history.slice(0, 20)];
        // Keep the groups in order; within each, best matches first.
        return [
          ...filterQuickPickItems(editors, filter, { sort: true }),
          ...filterQuickPickItems(queries, filter, { sort: true, matchDescription: true }),
          ...filterQuickPickItems(history, filter, { sort: true }),
        ];
      },
      onAccept: (item) => {
        const id = item?.id ?? '';
        if (id.startsWith('editor:')) activateEditor(id.slice('editor:'.length));
        else if (id.startsWith('query:')) void openMyQuery(id.slice('query:'.length), false);
        else if (id.startsWith('history:')) {
          const entry = useHistory.getState().entries.find((e) => `history:${e.id}` === id);
          if (entry !== undefined) openHistoryEntry(entry, false);
        }
      },
    }),
    registerCommand({
      id: 'query.save',
      title: 'Save',
      category: 'Query',
      icon: 'save',
      when: IN_QUERY,
      run: () => {
        const active = activeQuery();
        if (active !== undefined) void saveTab(active.id);
      },
    }),
    registerCommand({
      id: 'query.saveAs',
      title: 'Save As…',
      category: 'Query',
      when: IN_QUERY,
      run: () => {
        const active = activeQuery();
        if (active !== undefined) void saveTabAs(active.id);
      },
    }),
    registerCommand({
      id: 'library.newQuery',
      title: 'New Query in My Queries…',
      category: 'Library',
      icon: 'new-file',
      run: () => newQueryFile(),
    }),
    registerCommand({
      id: 'library.newFolder',
      title: 'New Folder in My Queries…',
      category: 'Library',
      icon: 'new-folder',
      run: () => newFolder(),
    }),
    registerCommand({
      id: 'library.refresh',
      title: 'Refresh My Queries',
      category: 'Library',
      icon: 'refresh',
      run: loadMyQueries,
    }),
    registerCommand({
      id: 'library.reveal',
      title: 'Reveal My Queries in File Manager',
      category: 'Library',
      run: () => {
        revealQuery();
      },
    }),
    registerCommand({
      id: 'history.clear',
      title: 'Clear History',
      category: 'History',
      icon: 'clear-all',
      run: async () => {
        const confirmed = await new Promise<boolean>((resolve) => {
          showQuickPick({
            placeholder: 'Clear the query history? This cannot be undone.',
            getItems: () => [
              { id: 'clear', label: 'Clear History', icon: 'clear-all' },
              { id: 'cancel', label: 'Cancel' },
            ],
            onAccept: (item) => {
              resolve(item?.id === 'clear');
            },
            onCancel: () => {
              resolve(false);
            },
          });
        });
        if (!confirmed) return;
        await clearHistory();
        notify({ severity: 'info', message: 'History cleared.', source: 'History' });
      },
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
      id: 'workbench.action.splitEditor',
      title: 'Split Editor Right',
      category: 'View',
      icon: 'split-horizontal',
      run: splitActiveEditor,
    }),
    ...[1, 2, 3, 4].map((n) =>
      registerCommand({
        id: `workbench.action.focus${['First', 'Second', 'Third', 'Fourth'][n - 1] ?? ''}EditorGroup`,
        title: `Focus ${['First', 'Second', 'Third', 'Fourth'][n - 1] ?? ''} Editor Group`,
        category: 'View',
        run: () => {
          const group = useEditors.getState().groups[n - 1];
          if (group === undefined) return;
          focusGroup(group.id);
          if (group.activeId !== undefined) getCodeEditor(group.activeId)?.focus();
        },
      }),
    ),
    registerCommand({
      id: 'workbench.action.openPreviousRecentlyUsedEditorInGroup',
      title: 'Open Previous Recently Used Editor in Group',
      category: 'View',
      run: () => {
        const previous = previousEditorInGroup();
        if (previous !== undefined) activateEditor(previous);
      },
    }),
    registerCommand({
      id: 'workbench.action.keepEditor',
      title: 'Keep Editor',
      category: 'View',
      when: 'activeEditor',
      run: () => {
        const { activeId } = useEditors.getState();
        if (activeId !== undefined) updateEditor(activeId, { preview: false });
      },
    }),
    registerCommand({
      id: 'workbench.action.pinEditor',
      title: 'Pin Editor',
      category: 'View',
      when: 'activeEditor',
      run: () => {
        const { activeId } = useEditors.getState();
        if (activeId !== undefined) updateEditor(activeId, { pinned: true, preview: false });
      },
    }),
    registerCommand({
      id: 'workbench.action.unpinEditor',
      title: 'Unpin Editor',
      category: 'View',
      when: 'activeEditor',
      run: () => {
        const { activeId } = useEditors.getState();
        if (activeId !== undefined) updateEditor(activeId, { pinned: false });
      },
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
