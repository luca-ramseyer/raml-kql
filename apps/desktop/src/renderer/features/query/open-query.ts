import { newQueryEditorId, openQueryEditor, useEditors } from '../../platform/editors';
import { copyTabTargets, setTabTargets } from '../targets/targets-store';

import { createQueryDoc, STARTER_QUERY, type QueryDoc } from './query-docs';

/** Opening query tabs: new ones, and ones with their own text, targets and time range. */
let starterShown = false;

/** Open a new query tab. The first one of a session starts with the sample query (spec 05). */
export function newQuery(): string {
  const id = openQueryEditor();
  createQueryDoc(id, starterShown ? '' : STARTER_QUERY);
  starterShown = true;
  return id;
}

/**
 * Open a query in a tab with its own targets and time range (History, My Queries). A preview
 * tab (single click) is replaced by the next preview; `pinned: false, preview: false` keeps it.
 */
export function openQueryTab(options: {
  text: string;
  title?: string | undefined;
  preview?: boolean | undefined;
  timeRange?: QueryDoc['timeRange'] | undefined;
  targets?: { selected: readonly string[]; groupId: string | undefined } | undefined;
  file?: QueryDoc['file'] | undefined;
  description?: string | undefined;
}): string {
  const id = newQueryEditorId();
  createQueryDoc(id, options.text, {
    ...(options.timeRange === undefined ? {} : { timeRange: options.timeRange }),
    ...(options.file === undefined ? {} : { file: options.file }),
  });
  if (options.targets !== undefined) {
    setTabTargets(id, options.targets.selected, options.targets.groupId);
  } else if (useEditors.getState().activeId !== undefined) {
    copyTabTargets(useEditors.getState().activeId ?? '', id);
  }
  openQueryEditor({
    id,
    title: options.title,
    preview: options.preview,
    description: options.description,
  });
  starterShown = true;
  return id;
}

/** Restored tabs exist: the sample query isn't needed any more. */
export function markStarterShown(): void {
  starterShown = true;
}

/** For tests. */
export function resetOpenQuery(): void {
  starterShown = false;
}
