import { create } from 'zustand';

import type { MergedSchema } from '../../../shared/schema/models';
import { notify } from '../../platform/notifications';
import { getSetting, useSettings } from '../../platform/settings';
import { getBridge, unwrap } from '../../services/ipc';
import { useTargets } from '../targets/targets-store';

import { availabilityText, toKustoSchema, type KustoEngineSchema } from './kusto-schema';

/**
 * The merged schema of the selected targets (spec 05, "Schema-aware IntelliSense"). Loaded
 * lazily: nothing is fetched until the first query editor opens.
 */
interface SchemaState {
  merged: MergedSchema | undefined;
  loading: boolean;
  /** The Kusto schema for the language service, rebuilt when the schema or settings change. */
  kusto: KustoEngineSchema | undefined;
  /** The Kusto schema the language service has confirmed (after `setSchema` resolved). */
  applied: KustoEngineSchema | undefined;
}

export const useSchema = create<SchemaState>(() => ({
  merged: undefined,
  loading: false,
  kusto: undefined,
  applied: undefined,
}));

let sequence = 0;
let schemaVersion = 0;

function kustoFor(merged: MergedSchema | undefined): KustoEngineSchema | undefined {
  return merged === undefined
    ? undefined
    : toKustoSchema(merged, {
        hideTablesMissingEverywhere: getSetting('schema.hideTablesMissingEverywhere'),
        version: ++schemaVersion,
      });
}

function rebuildKusto(): void {
  useSchema.setState({ kusto: kustoFor(useSchema.getState().merged) });
}

/** Load the merged schema for the current targets; `refresh` bypasses the disk cache. */
export async function loadSchema(refresh = false): Promise<void> {
  const current = ++sequence;
  const resourceIds = [...useTargets.getState().selected];
  useSchema.setState({ loading: true });
  try {
    const merged = await unwrap(getBridge().schema.get({ resourceIds, refresh }));
    if (current !== sequence) return; // a newer request superseded this one
    // One update, so no observer sees the new schema without its Kusto form.
    useSchema.setState({
      merged,
      kusto: kustoFor(merged),
      loading: false,
    });
    if (refresh && merged.failed > 0) {
      notify({
        severity: 'warning',
        message: `Schema could not be loaded for ${String(merged.failed)} of ${String(resourceIds.length)} workspaces. IntelliSense shows what is known.`,
        source: 'Schema',
      });
    }
  } catch (error) {
    if (current !== sequence) return;
    useSchema.setState({ loading: false });
    notify({
      severity: 'error',
      message: error instanceof Error ? error.message : 'Could not load the schema.',
      source: 'Schema',
    });
  }
}

let stopSync: (() => void) | undefined;

/** Keep the schema in sync with the targets (debounced). Idempotent. */
export function startSchemaSync(): void {
  if (stopSync !== undefined) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const unsubscribeTargets = useTargets.subscribe((state, previous) => {
    if (state.selected === previous.selected) return;
    clearTimeout(timer);
    timer = setTimeout(() => void loadSchema(), 300);
  });
  const unsubscribeSettings = useSettings.subscribe((state, previous) => {
    if (
      state.values['schema.hideTablesMissingEverywhere'] !==
      previous.values['schema.hideTablesMissingEverywhere']
    ) {
      rebuildKusto();
    }
  });
  stopSync = () => {
    clearTimeout(timer);
    unsubscribeTargets();
    unsubscribeSettings();
  };
  void loadSchema();
}

/** The language service now has this schema. */
export function markSchemaApplied(schema: KustoEngineSchema): void {
  useSchema.setState({ applied: schema });
}

/** The subtle completion suffix ("3/5") for a table or function not in every target. */
export function completionSuffix(name: string): string | undefined {
  const { merged } = useSchema.getState();
  if (merged === undefined) return undefined;
  const item =
    merged.tables.find((t) => t.name === name) ?? merged.functions.find((f) => f.name === name);
  if (item === undefined || availabilityText(item.available, merged.loaded) === undefined) {
    return undefined;
  }
  return `${String(item.available)}/${String(merged.loaded)}`;
}

/** For tests. */
export function resetSchemaStore(): void {
  sequence = 0;
  stopSync?.();
  stopSync = undefined;
  useSchema.setState({
    merged: undefined,
    loading: false,
    kusto: undefined,
    applied: undefined,
  });
}
