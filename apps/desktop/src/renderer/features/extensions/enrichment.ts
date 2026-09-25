import type { EntityType } from '@raml-kql/pack-schema/extension-manifest';
import type { ColDef } from 'ag-grid-community';
import { create } from 'zustand';

import type { EnrichmentResultData, ExtensionInfo } from '../../../shared/extensions/models';
import { ENTITY_LABELS, detectEntity } from '../../../shared/results/entities';
import { notify } from '../../platform/notifications';
import { matchesWhen } from '../../platform/when';
import { getBridge, unwrap } from '../../services/ipc';
import type { MenuEntry } from '../../workbench/common/ContextMenu';
import type { GridRow } from '../results/grid/column-defs';

import { reportExtensionError, runExtensionCommand, useExtensions } from './extensions-store';

/**
 * Enrichment (spec 07): an enricher looks up result values (IPs, hashes…) and its answers are
 * shown as extra columns next to the result. This is a derived view: the result data itself
 * never changes, and the overlay lives only in memory with the run's results.
 */
export interface EnrichmentOverlay {
  key: string;
  title: string;
  /** The result column whose values were enriched. */
  column: number;
  fields: string[];
  values: Record<string, EnrichmentResultData>;
}

export const useEnrichment = create<{ byRun: Record<string, EnrichmentOverlay[]> }>(() => ({
  byRun: {},
}));

export function forgetEnrichment(runId: string): void {
  useEnrichment.setState((state) => {
    const { [runId]: _removed, ...rest } = state.byRun;
    return { byRun: rest };
  });
}

function addResults(
  runId: string,
  overlay: Omit<EnrichmentOverlay, 'fields' | 'values'>,
  results: EnrichmentResultData[],
): void {
  useEnrichment.setState((state) => {
    const existing = state.byRun[runId]?.find(
      (o) => o.key === overlay.key && o.column === overlay.column,
    );
    const values = { ...existing?.values };
    for (const result of results) values[result.entity.value] = result;
    const fields = [
      ...new Set([...(existing?.fields ?? []), ...results.flatMap((r) => Object.keys(r.fields))]),
    ];
    const next: EnrichmentOverlay = { ...overlay, fields, values };
    const others = (state.byRun[runId] ?? []).filter(
      (o) => !(o.key === overlay.key && o.column === overlay.column),
    );
    return { byRun: { ...state.byRun, [runId]: [...others, next] } };
  });
}

/** Extra grid columns for a run's overlays ("VirusTotal: malicious"). */
export function overlayColumnDefs(
  overlays: readonly EnrichmentOverlay[],
  fieldOf: (column: number) => string,
): ColDef<GridRow>[] {
  return overlays.flatMap((overlay) =>
    overlay.fields.map((field): ColDef<GridRow> => ({
      colId: `enrichment:${overlay.key}:${String(overlay.column)}:${field}`,
      headerName: `${overlay.title}: ${field}`,
      headerClass: 'enrichment-header',
      cellClass: 'cell-enrichment',
      sortable: false,
      filter: false,
      resizable: true,
      width: 150,
      valueGetter: (params) => {
        const value = params.data?.[fieldOf(overlay.column) as `c${number}`];
        if (typeof value !== 'string') return null;
        const hit = overlay.values[value];
        return hit === undefined ? null : (hit.fields[field] ?? null);
      },
    })),
  );
}

interface CellContext {
  runId: string;
  column: number;
  columnName: string;
  value: unknown;
  /** Distinct values of this column among the rows loaded in the grid. */
  columnValues: () => unknown[];
}

async function enrich(
  extension: ExtensionInfo,
  enricher: { id: string; title: string },
  cell: CellContext,
  type: EntityType,
  values: string[],
): Promise<void> {
  try {
    const { results } = await unwrap(
      getBridge().extensions.enrich({
        extensionId: extension.id,
        enricherId: enricher.id,
        runId: cell.runId,
        entities: values.map((value) => ({ type, value })),
      }),
    );
    addResults(
      cell.runId,
      { key: `${extension.id}/${enricher.id}`, title: enricher.title, column: cell.column },
      results,
    );
    notify({
      severity: 'info',
      message: `${enricher.title}: enriched ${String(results.length)} of ${String(values.length)} ${ENTITY_LABELS[type]}.`,
      source: extension.displayName,
    });
  } catch (error) {
    reportExtensionError(error, 'The enrichment failed.');
  }
}

/** Context menu entries for a result cell: enrichers and extension menu items. */
export function extensionCellMenu(cell: CellContext): MenuEntry[] {
  const type = detectEntity(cell.columnName, cell.value);
  const extensions = useExtensions
    .getState()
    .snapshot.extensions.filter((e) => e.enabled && e.state !== 'failed');
  const entries: MenuEntry[] = [];
  if (type !== undefined) {
    for (const extension of extensions) {
      for (const enricher of extension.contributes.enrichers ?? []) {
        if (!enricher.entityTypes.includes(type)) continue;
        entries.push(
          {
            kind: 'item',
            label: `Enrich Value with ${enricher.title}`,
            run: () => void enrich(extension, enricher, cell, type, [String(cell.value)]),
          },
          {
            kind: 'item',
            label: `Enrich Column with ${enricher.title}`,
            run: () => {
              const values = [
                ...new Set(
                  cell
                    .columnValues()
                    .filter(
                      (v): v is string =>
                        typeof v === 'string' && detectEntity(cell.columnName, v) === type,
                    ),
                ),
              ].slice(0, 100);
              void enrich(extension, enricher, cell, type, values);
            },
          },
        );
      }
    }
  }
  const context = { cellEntityType: type ?? '', resultsFocus: true };
  for (const extension of extensions) {
    for (const item of extension.contributes.menus?.['results/cell/context'] ?? []) {
      if (!matchesWhen(item.when, context)) continue;
      const command = extension.contributes.commands?.find((c) => c.command === item.command);
      if (command === undefined) continue;
      entries.push({
        kind: 'item',
        label: command.title,
        run: () =>
          void runExtensionCommand(
            command.command,
            [{ value: cell.value as never, column: cell.columnName, entityType: type ?? null }],
            true,
          ),
      });
    }
  }
  return entries.length === 0 ? [] : [{ kind: 'separator' }, ...entries];
}
