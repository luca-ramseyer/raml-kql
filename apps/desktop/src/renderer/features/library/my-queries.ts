import { create } from 'zustand';

import { AppError } from '../../../shared/errors';
import type { QueryNode } from '../../../shared/queries/models';
import { activateEditor, updateEditor, useEditors } from '../../platform/editors';
import { notify } from '../../platform/notifications';
import { showInputBox, showQuickPick } from '../../platform/quickinput/quick-input';
import { getBridge, unwrap } from '../../services/ipc';
import { openQueryTab } from '../query/open-query';
import { updateQueryDoc, useQueryDocs } from '../query/query-docs';

/** My Queries (spec 08): the tree, and opening/saving `.kql` files from query tabs. */
export const useMyQueries = create<{ nodes: QueryNode[]; loaded: boolean }>(() => ({
  nodes: [],
  loaded: false,
}));

function report(error: unknown, fallback: string): void {
  notify({
    severity: 'error',
    message: error instanceof Error ? error.message : fallback,
    detail: error instanceof AppError ? error.detail : undefined,
    source: 'My Queries',
  });
}

export async function loadMyQueries(): Promise<void> {
  try {
    const { nodes } = await unwrap(getBridge().queries.list());
    useMyQueries.setState({ nodes, loaded: true });
  } catch (error) {
    useMyQueries.setState({ loaded: true });
    report(error, 'My Queries could not be listed.');
  }
}

export function folderOf(path: string): string {
  const index = path.lastIndexOf('/');
  return index < 0 ? '' : path.slice(0, index);
}

/** The open tab editing a file, if any. */
function tabFor(path: string): string | undefined {
  const { docs } = useQueryDocs.getState();
  return useEditors.getState().editors.find((e) => docs[e.id]?.file?.path === path)?.id;
}

/** Open a saved query (single click: preview tab; double click: a tab that stays). */
export async function openMyQuery(path: string, preview: boolean): Promise<void> {
  const open = tabFor(path);
  if (open !== undefined) {
    activateEditor(open);
    if (!preview) updateEditor(open, { preview: false });
    return;
  }
  try {
    const file = await unwrap(getBridge().queries.read({ path }));
    openQueryTab({
      text: file.body,
      title: file.name,
      preview,
      file: { path: file.path, savedText: file.body },
      description: folderOf(file.path) || undefined,
    });
  } catch (error) {
    report(error, 'The query could not be opened.');
  }
}

function askName(prompt: string, value: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    showInputBox({
      placeholder: 'Query name',
      prompt,
      value,
      validate: (text) => (text.trim() === '' ? 'Enter a name.' : undefined),
      onAccept: (text) => {
        resolve(text.trim());
      },
      onCancel: () => {
        resolve(undefined);
      },
    });
  });
}

function linkTab(tabId: string, path: string, name: string, savedText: string): void {
  updateQueryDoc(tabId, { file: { path, savedText } });
  updateEditor(tabId, {
    title: name,
    description: folderOf(path) || undefined,
    dirty: false,
    preview: false,
  });
}

/** Save As: a new file in My Queries (optionally in a folder), linked to the tab. */
export async function saveTabAs(tabId: string, folder = ''): Promise<boolean> {
  const doc = useQueryDocs.getState().docs[tabId];
  const title = useEditors.getState().editors.find((e) => e.id === tabId)?.title ?? 'New Query';
  if (doc === undefined) return false;
  const name = await askName(
    'Save the query in My Queries as',
    /^Query \d+$/.test(title) ? '' : title,
  );
  if (name === undefined) return false;
  try {
    const file = await unwrap(
      getBridge().queries.save({ name, body: doc.text, ...(folder === '' ? {} : { folder }) }),
    );
    linkTab(tabId, file.path, file.name, doc.text);
    void loadMyQueries();
    return true;
  } catch (error) {
    report(error, 'The query could not be saved.');
    return false;
  }
}

/** Ctrl/Cmd+S (spec 05): write the tab to its file, or Save As for a new query. */
export async function saveTab(tabId: string): Promise<boolean> {
  const doc = useQueryDocs.getState().docs[tabId];
  if (doc === undefined) return false;
  if (doc.file === undefined) return saveTabAs(tabId);
  try {
    const text = doc.text;
    const file = await unwrap(getBridge().queries.save({ path: doc.file.path, body: text }));
    linkTab(tabId, file.path, file.name, text);
    return true;
  } catch (error) {
    report(error, 'The query could not be saved.');
    return false;
  }
}

export async function newQueryFile(folder = ''): Promise<void> {
  const name = await askName('Name of the new query', '');
  if (name === undefined) return;
  try {
    const file = await unwrap(
      getBridge().queries.save({ name, body: '', ...(folder === '' ? {} : { folder }) }),
    );
    await loadMyQueries();
    await openMyQuery(file.path, false);
  } catch (error) {
    report(error, 'The query could not be created.');
  }
}

export async function newFolder(parent = ''): Promise<void> {
  const name = await new Promise<string | undefined>((resolve) => {
    showInputBox({
      placeholder: 'Folder name',
      prompt: parent === '' ? 'New folder in My Queries' : `New folder in ${parent}`,
      validate: (text) =>
        text.trim() === '' || /[/\\]/.test(text) || text.trim().startsWith('.')
          ? 'Enter a folder name (no slashes).'
          : undefined,
      onAccept: (text) => {
        resolve(text.trim());
      },
      onCancel: () => {
        resolve(undefined);
      },
    });
  });
  if (name === undefined) return;
  try {
    await unwrap(
      getBridge().queries.createFolder({ path: parent === '' ? name : `${parent}/${name}` }),
    );
    await loadMyQueries();
  } catch (error) {
    report(error, 'The folder could not be created.');
  }
}

/** Keep open tabs linked after a rename or move. */
function relink(from: string, to: string, name?: string): void {
  const { docs } = useQueryDocs.getState();
  for (const editor of useEditors.getState().editors) {
    const file = docs[editor.id]?.file;
    if (file === undefined) continue;
    if (file.path === from || file.path.startsWith(`${from}/`)) {
      const path = to + file.path.slice(from.length);
      updateQueryDoc(editor.id, { file: { ...file, path } });
      updateEditor(editor.id, {
        description: folderOf(path) || undefined,
        ...(name === undefined || file.path !== from ? {} : { title: name }),
      });
    }
  }
}

export async function renameQuery(node: QueryNode): Promise<void> {
  if (node.kind !== 'file') return;
  const name = await askName('Rename the query', node.name);
  if (name === undefined || name === node.name) return;
  try {
    const file = await unwrap(getBridge().queries.rename({ path: node.path, name }));
    relink(node.path, file.path, file.name);
    await loadMyQueries();
  } catch (error) {
    report(error, 'The query could not be renamed.');
  }
}

export async function moveQuery(path: string, folder: string): Promise<void> {
  try {
    const moved = await unwrap(getBridge().queries.move({ path, folder }));
    relink(path, moved.path);
    await loadMyQueries();
  } catch (error) {
    report(error, 'It could not be moved.');
  }
}

export async function deleteQuery(node: QueryNode): Promise<void> {
  const confirmed = await new Promise<boolean>((resolve) => {
    showQuickPick({
      placeholder: `Move "${node.name}" to the trash?`,
      getItems: () => [
        {
          id: 'delete',
          label: node.kind === 'folder' ? 'Move Folder to Trash' : 'Move to Trash',
          icon: 'trash',
        },
        { id: 'cancel', label: 'Cancel' },
      ],
      onAccept: (item) => {
        resolve(item?.id === 'delete');
      },
      onCancel: () => {
        resolve(false);
      },
    });
  });
  if (!confirmed) return;
  try {
    await unwrap(getBridge().queries.delete({ path: node.path }));
    // Open tabs of deleted files become drafts again.
    const { docs } = useQueryDocs.getState();
    for (const editor of useEditors.getState().editors) {
      const file = docs[editor.id]?.file;
      if (
        file !== undefined &&
        (file.path === node.path || file.path.startsWith(`${node.path}/`))
      ) {
        updateQueryDoc(editor.id, { file: undefined });
        updateEditor(editor.id, { description: undefined, dirty: false });
      }
    }
    await loadMyQueries();
  } catch (error) {
    report(error, 'It could not be moved to the trash.');
  }
}

export function revealQuery(path?: string): void {
  void unwrap(getBridge().queries.reveal(path === undefined ? {} : { path })).catch(
    (error: unknown) => {
      report(error, 'The folder could not be shown.');
    },
  );
}
