import { AppError } from '../../../shared/errors';
import type { SourceInfo, SourcePreview } from '../../../shared/packs/models';
import { executeCommand, registerCommand } from '../../platform/commands';
import { openEditorInput } from '../../platform/editors';
import { dismissNotification, notify } from '../../platform/notifications';
import {
  showInputBox,
  showQuickPick,
  type QuickPickItem,
} from '../../platform/quickinput/quick-input';
import { getBridge, unwrap } from '../../services/ipc';
import { loadMyQueries } from '../library/my-queries';

import { loadPacks, reportPackError, setPacksSnapshot, usePacks } from './packs-store';

/** Library commands for query pack sources (spec 08, "Sources"). */

function ask(options: {
  placeholder: string;
  prompt: string;
  value?: string;
  password?: boolean;
  validate?: (value: string) => string | undefined;
}): Promise<string | undefined> {
  return new Promise((resolve) => {
    showInputBox({
      ...options,
      onAccept: (value) => {
        resolve(value.trim());
      },
      onCancel: () => {
        resolve(undefined);
      },
    });
  });
}

function pick(placeholder: string, items: QuickPickItem[]): Promise<QuickPickItem | undefined> {
  return new Promise((resolve) => {
    showQuickPick({
      placeholder,
      getItems: () => items,
      onAccept: (item) => {
        resolve(item);
      },
      onCancel: () => {
        resolve(undefined);
      },
    });
  });
}

/** Show what a source contains and ask before adding it (spec 08: "preview, then Add"). */
async function confirmPreview(preview: SourcePreview): Promise<void> {
  const queries = preview.packs.reduce((sum, pack) => sum + pack.queries, 0);
  const problems = [...preview.problems, ...preview.packs.flatMap((p) => p.problems)];
  const items: QuickPickItem[] = [];
  if (!preview.alreadyAdded && preview.packs.length > 0) {
    items.push({ id: 'add', label: 'Add Source', icon: 'add' });
  }
  items.push({ id: 'cancel', label: 'Cancel', icon: 'close' });
  preview.packs.forEach((pack, index) => {
    items.push({
      id: `pack:${String(index)}`,
      label: `${pack.name} ${pack.version}`,
      description: `${String(pack.queries)} ${pack.queries === 1 ? 'query' : 'queries'}${
        pack.problems.length > 0 ? ` · ${String(pack.problems.length)} skipped` : ''
      }`,
      detail: pack.conflict
        ? `Another source already provides ${pack.id}; both are kept.`
        : pack.id,
      icon: 'package',
      group: index === 0 ? 'Packs' : undefined,
    });
  });
  problems.slice(0, 20).forEach((problem, index) => {
    items.push({
      id: `problem:${String(index)}`,
      label: problem.message,
      description: problem.file,
      icon: 'warning',
      group: index === 0 ? 'Problems' : undefined,
    });
  });
  const summary = preview.alreadyAdded
    ? `${preview.label} is already added.`
    : preview.packs.length === 0
      ? `${preview.label} contains no valid query packs.`
      : `${preview.label}: ${String(preview.packs.length)} ${preview.packs.length === 1 ? 'pack' : 'packs'}, ${String(queries)} queries. Add this source?`;
  const choice = await pick(summary, items);
  if (choice?.id !== 'add') {
    await unwrap(getBridge().packs.cancelPreview({ previewId: preview.previewId })).catch(
      () => undefined,
    );
    return;
  }
  try {
    const snapshot = await unwrap(getBridge().packs.add({ previewId: preview.previewId }));
    setPacksSnapshot(snapshot);
    notify({
      severity: 'info',
      message: `Added ${String(preview.packs.length)} query ${preview.packs.length === 1 ? 'pack' : 'packs'} from ${preview.label}.`,
      source: 'Query Packs',
      actions: [
        { label: 'Show Library', run: () => void executeCommand('workbench.view.library') },
      ],
    });
  } catch (error) {
    reportPackError(error, 'The source could not be added.');
  }
}

/** "Library: Add Pack Source…": a git URL, optionally `#branch` or `#tag`. */
export async function addPackSource(initialUrl?: string): Promise<void> {
  const input =
    initialUrl ??
    (await ask({
      placeholder: 'https://github.com/contoso/kql-packs',
      prompt: 'Git repository URL of a query pack source (add #branch or #tag to pin a ref)',
      validate: (value) =>
        value.trim() === '' || /^https?:\/\//i.test(value.trim())
          ? undefined
          : 'Enter an https:// URL.',
    }));
  if (input === undefined || input === '') return;
  const [url = '', ref] = input.split('#');
  let token: string | undefined;
  for (;;) {
    const progress = notify({
      severity: 'info',
      message: `Reading ${url}…`,
      source: 'Query Packs',
      key: 'packs.preview',
    });
    try {
      const preview = await unwrap(
        getBridge().packs.previewGit({
          url,
          ...(ref === undefined || ref === '' ? {} : { ref }),
          ...(token === undefined ? {} : { token }),
        }),
      );
      dismissNotification(progress);
      await confirmPreview(preview);
      return;
    } catch (error) {
      dismissNotification(progress);
      if (error instanceof AppError && error.code === 'SOURCE_AUTH_REQUIRED') {
        token = await ask({
          placeholder: 'Personal access token (read-only)',
          prompt: `${url} is private or refused the token. Enter a read-only token; it is kept in the OS keychain`,
          password: true,
          validate: (value) => (value.trim() === '' ? 'Enter a token.' : undefined),
        });
        if (token === undefined) return;
        continue;
      }
      reportPackError(error, 'The source could not be read.');
      return;
    }
  }
}

/** Import a `.rkqlpack`, loose `.kql` files, or a pack folder. */
export async function importPack(kind: 'file' | 'folder'): Promise<void> {
  try {
    const result = await unwrap(getBridge().packs.importFile({ kind }));
    if (result.type === 'pack') await confirmPreview(result.preview);
    if (result.type === 'queries') {
      void loadMyQueries();
      notify({
        severity: 'info',
        message: `Imported ${String(result.paths.length)} ${result.paths.length === 1 ? 'query' : 'queries'} into My Queries.`,
        source: 'Query Packs',
      });
    }
  } catch (error) {
    reportPackError(error, 'The import failed.');
  }
}

export function openUpdateReview(source: Pick<SourceInfo, 'id' | 'label'>): void {
  const name = source.label
    .replace(/\.git$/, '')
    .split('/')
    .slice(-2)
    .join('/');
  openEditorInput({
    id: `pack-update:${source.id}`,
    kind: 'packUpdate',
    title: `Update: ${name}`,
    icon: 'cloud-download',
  });
}

let manualCheck = false;
const announced = new Set<string>();

/**
 * `packs.changed`: reload, and announce updates found by the background check (once per
 * update; a manual check reports its own result).
 */
export async function refreshPacks(): Promise<void> {
  await loadPacks();
  const fresh = usePacks
    .getState()
    .snapshot.sources.filter(
      (s) => s.update !== undefined && !announced.has(`${s.id}@${s.update.sha}`),
    );
  for (const source of fresh) announced.add(`${source.id}@${source.update?.sha ?? ''}`);
  if (fresh.length > 0 && !manualCheck) notifyUpdates(fresh.length);
}

/** "Check for Pack Updates": always asks the hosts (no 24-hour throttle). */
export async function checkPackUpdates(sourceId?: string): Promise<void> {
  manualCheck = true;
  try {
    const result = await unwrap(
      getBridge().packs.checkUpdates({
        ...(sourceId === undefined ? {} : { sourceId }),
        force: true,
      }),
    );
    await loadPacks();
    for (const error of result.errors) {
      notify({
        severity: 'warning',
        message: `${error.label}: ${error.message}`,
        source: 'Query Packs',
      });
    }
    if (result.checked === 0) {
      notify({
        severity: 'info',
        message: 'There are no git pack sources to check.',
        source: 'Query Packs',
      });
      return;
    }
    const withUpdates = usePacks.getState().snapshot.sources.filter((s) => s.update !== undefined);
    if (withUpdates.length === 0) {
      if (result.errors.length === 0) {
        notify({
          severity: 'info',
          message: 'All query packs are up to date.',
          source: 'Query Packs',
        });
      }
      return;
    }
    const [only] = withUpdates;
    if (withUpdates.length === 1 && only !== undefined) openUpdateReview(only);
    else notifyUpdates(withUpdates.length);
  } catch (error) {
    reportPackError(error, 'The update check failed.');
  } finally {
    // Also covers the `packs.changed` event the check itself triggers.
    for (const s of usePacks.getState().snapshot.sources) {
      if (s.update !== undefined) announced.add(`${s.id}@${s.update.sha}`);
    }
    manualCheck = false;
  }
}

/** "Updates are available…" with a Review action (startup check, or several sources). */
export function notifyUpdates(count: number): void {
  notify({
    severity: 'info',
    message: `Updates are available for ${String(count)} query pack ${count === 1 ? 'source' : 'sources'}.`,
    source: 'Query Packs',
    key: 'packs.updates',
    actions: [
      {
        label: 'Review',
        run: () => {
          for (const source of usePacks.getState().snapshot.sources) {
            if (source.update !== undefined) openUpdateReview(source);
          }
        },
      },
    ],
  });
}

export async function removePackSource(sourceId?: string): Promise<void> {
  const { sources } = usePacks.getState().snapshot;
  let target = sources.find((s) => s.id === sourceId);
  if (target === undefined) {
    if (sources.length === 0) {
      notify({
        severity: 'info',
        message: 'No pack sources are installed.',
        source: 'Query Packs',
      });
      return;
    }
    const choice = await pick(
      'Select the pack source to remove',
      sources.map((s) => ({
        id: s.id,
        label: s.label,
        description: s.type === 'git' ? (s.ref ?? 'default branch') : 'imported file',
        icon: s.type === 'git' ? 'repo' : 'file-zip',
      })),
    );
    target = sources.find((s) => s.id === choice?.id);
    if (target === undefined) return;
  }
  const confirm = await pick(
    `Remove ${target.label}? Its packs leave the Library; open tabs keep their text.`,
    [
      { id: 'remove', label: 'Remove Source', icon: 'trash' },
      { id: 'cancel', label: 'Cancel' },
    ],
  );
  if (confirm?.id !== 'remove') return;
  try {
    setPacksSnapshot(await unwrap(getBridge().packs.remove({ sourceId: target.id })));
  } catch (error) {
    reportPackError(error, 'The source could not be removed.');
  }
}

export function registerPackCommands(): () => void {
  const disposers = [
    registerCommand({
      id: 'library.addPackSource',
      title: 'Add Pack Source…',
      category: 'Library',
      icon: 'repo-clone',
      run: () => addPackSource(),
    }),
    registerCommand({
      id: 'library.importPack',
      title: 'Import Pack or Queries from File…',
      category: 'Library',
      icon: 'file-zip',
      run: () => importPack('file'),
    }),
    registerCommand({
      id: 'library.importPackFolder',
      title: 'Import Pack from Folder…',
      category: 'Library',
      icon: 'folder',
      run: () => importPack('folder'),
    }),
    registerCommand({
      id: 'library.checkPackUpdates',
      title: 'Check for Pack Updates',
      category: 'Library',
      icon: 'sync',
      run: () => checkPackUpdates(),
    }),
    registerCommand({
      id: 'library.removePackSource',
      title: 'Remove Pack Source…',
      category: 'Library',
      icon: 'trash',
      run: () => removePackSource(),
    }),
  ];
  return () => {
    for (const dispose of disposers) dispose();
  };
}
