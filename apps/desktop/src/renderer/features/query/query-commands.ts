import { registerCommand } from '../../platform/commands';
import { onEditorClosed, openQueryEditor, useEditors } from '../../platform/editors';
import { getSetting } from '../../platform/settings';
import { runEditorAction } from '../editor/active-editor';
import { disposeQueryModel } from '../editor/query-models';
import { loadSchema } from '../editor/schema-store';
import { showTimeRangePicker } from '../editor/TimeRangePicker';

import {
  createQueryDoc,
  deleteQueryDoc,
  STARTER_QUERY,
  updateQueryDoc,
  useQueryDocs,
} from './query-docs';

let starterShown = false;

/** Open a new query tab. The first one of a session starts with the sample query (spec 05). */
export function newQuery(): string {
  const id = openQueryEditor();
  createQueryDoc(id, starterShown ? '' : STARTER_QUERY);
  starterShown = true;
  return id;
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
      deleteQueryDoc(editor.id);
      disposeQueryModel(editor.id);
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
