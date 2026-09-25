import { create } from 'zustand';

import { AppError } from '../../../shared/errors';
import type { ExtensionsSnapshot } from '../../../shared/extensions/models';
import { registerCommand } from '../../platform/commands';
import { useEditors } from '../../platform/editors';
import { notify } from '../../platform/notifications';
import { getBridge, unwrap } from '../../services/ipc';
import { useRuns } from '../query/run-store';

/** Installed extensions and their grants (spec 07). */
export const useExtensions = create<{ snapshot: ExtensionsSnapshot; loaded: boolean }>(() => ({
  snapshot: { extensions: [], grants: [], problems: [] },
  loaded: false,
}));

export function reportExtensionError(error: unknown, fallback: string): void {
  notify({
    severity: 'error',
    message: error instanceof Error ? error.message : fallback,
    detail: error instanceof AppError ? error.detail : undefined,
    source: 'Extensions',
  });
}

export function setExtensionsSnapshot(snapshot: ExtensionsSnapshot): void {
  useExtensions.setState({ snapshot, loaded: true });
}

export async function loadExtensions(): Promise<void> {
  try {
    setExtensionsSnapshot(await unwrap(getBridge().extensions.list()));
  } catch (error) {
    useExtensions.setState({ loaded: true });
    reportExtensionError(error, 'Extensions could not be listed.');
  }
}

/** The run of the active query tab: "per query run" grants belong to it (spec 07). */
export function activeRunId(): string | undefined {
  const { activeId } = useEditors.getState();
  return activeId === undefined ? undefined : useRuns.getState().byTab[activeId]?.runId;
}

export async function runExtensionCommand(command: string, args: unknown[] = []): Promise<unknown> {
  const runId = activeRunId();
  try {
    const result = await unwrap(
      getBridge().extensions.executeCommand({
        command,
        args: args.filter((a) => a !== undefined) as never[],
        ...(runId === undefined ? {} : { runId }),
      }),
    );
    return result.value;
  } catch (error) {
    reportExtensionError(error, 'The extension command failed.');
    return undefined;
  }
}

/**
 * Keep the command registry in step with enabled extensions' `contributes.commands`: the
 * palette lists them before the extension is running (activation is lazy).
 */
export function startExtensionContributions(): () => void {
  let disposers: (() => void)[] = [];
  let last = '';
  const sync = (snapshot: ExtensionsSnapshot): void => {
    const commands = snapshot.extensions
      .filter((e) => e.enabled && e.state !== 'failed')
      .flatMap((e) => e.contributes.commands ?? []);
    const key = JSON.stringify(commands);
    if (key === last) return;
    last = key;
    for (const dispose of disposers) dispose();
    disposers = commands.map((command) =>
      registerCommand({
        id: command.command,
        title: command.title,
        ...(command.category === undefined ? {} : { category: command.category }),
        ...(command.icon === undefined ? {} : { icon: command.icon.slice(2, -1) }),
        run: (...args: unknown[]) => runExtensionCommand(command.command, args),
      }),
    );
  };
  sync(useExtensions.getState().snapshot);
  const unsubscribe = useExtensions.subscribe((state) => {
    sync(state.snapshot);
  });
  return () => {
    unsubscribe();
    for (const dispose of disposers) dispose();
  };
}

export function resetExtensions(): void {
  useExtensions.setState({ snapshot: { extensions: [], grants: [], problems: [] }, loaded: false });
}
