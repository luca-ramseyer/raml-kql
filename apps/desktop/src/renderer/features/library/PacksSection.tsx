import { useEffect, useMemo, useState } from 'react';

import type { InstalledPack, PackQueryInfo } from '../../../shared/packs/models';
import { executeCommand } from '../../platform/commands';
import { notify } from '../../platform/notifications';
import { Codicon } from '../../workbench/common/Codicon';
import { ContextMenu, type MenuEntry } from '../../workbench/common/ContextMenu';
import { loadSchema, useSchema } from '../editor/schema-store';
import { checkPackUpdates, openUpdateReview, removePackSource } from '../packs/pack-commands';
import {
  duplicateToMyQueries,
  isFilterEmpty,
  loadPacks,
  matchesPackQuery,
  openPackQuery,
  packDisambiguator,
  packKey,
  parsePackFilter,
  usePacks,
} from '../packs/packs-store';

const CATEGORY_LABELS: Record<string, string> = {
  hunting: 'Hunting',
  investigation: 'Investigation',
  triage: 'Triage',
  reporting: 'Reporting',
  health: 'Health',
  '': 'Other',
};

type Row =
  | { kind: 'pack'; key: string; pack: InstalledPack; open: boolean }
  | { kind: 'category'; key: string; label: string; open: boolean; count: number }
  | { kind: 'query'; key: string; pack: InstalledPack; query: PackQueryInfo; level: number };

type Menu = { x: number; y: number; pack: InstalledPack; query?: PackQueryInfo | undefined };

/**
 * Installed query packs (spec 08): packs → categories → queries. Single click opens a preview
 * tab, double click keeps it; packs never run anything by themselves.
 */
export function PacksSection({ search }: { search: string }): React.JSX.Element {
  const { snapshot, loaded } = usePacks();
  const merged = useSchema((s) => s.merged);
  const [compatibleOnly, setCompatibleOnly] = useState(false);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const [menu, setMenu] = useState<Menu | undefined>(undefined);

  useEffect(() => {
    if (!loaded) void loadPacks();
  }, [loaded]);

  const available = useMemo(
    () =>
      compatibleOnly && merged !== undefined
        ? new Set(merged.tables.map((t) => t.name.toLowerCase()))
        : undefined,
    [compatibleOnly, merged],
  );

  const rows = useMemo((): Row[] => {
    const filter = parsePackFilter(search);
    const filtering = !isFilterEmpty(filter) || available !== undefined;
    const out: Row[] = [];
    for (const pack of snapshot.packs) {
      const key = packKey(pack);
      const queries = pack.queries.filter((q) => matchesPackQuery(pack, q, filter, available));
      if (filtering && queries.length === 0) continue;
      const open = filtering || !collapsed.has(key);
      out.push({ kind: 'pack', key, pack, open });
      if (!open) continue;
      const categories = [...new Set(queries.map((q) => q.category ?? ''))].sort((a, b) =>
        a === '' ? 1 : b === '' ? -1 : a.localeCompare(b),
      );
      const flat = categories.length === 1;
      for (const category of categories) {
        const inCategory = queries.filter((q) => (q.category ?? '') === category);
        const categoryKey = `${key}#${category}`;
        const categoryOpen = filtering || !collapsed.has(categoryKey);
        if (!flat) {
          out.push({
            kind: 'category',
            key: categoryKey,
            label: CATEGORY_LABELS[category] ?? category,
            open: categoryOpen,
            count: inCategory.length,
          });
          if (!categoryOpen) continue;
        }
        for (const query of inCategory.sort((a, b) => a.name.localeCompare(b.name))) {
          out.push({ kind: 'query', key: `${key}/${query.id}`, pack, query, level: flat ? 2 : 3 });
        }
      }
    }
    return out;
  }, [snapshot.packs, search, available, collapsed]);

  const toggle = (key: string): void => {
    const next = new Set(collapsed);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setCollapsed(next);
  };

  const sourceOf = (pack: InstalledPack) => snapshot.sources.find((s) => s.id === pack.sourceId);

  const menuEntries = ({ pack, query }: Menu): MenuEntry[] => {
    if (query !== undefined) {
      return [
        { kind: 'item', label: 'Open', run: () => void openPackQuery(pack, query, false) },
        { kind: 'separator' },
        {
          kind: 'item',
          label: 'Duplicate to My Queries',
          run: () => void duplicateToMyQueries(pack, query),
        },
      ];
    }
    const source = sourceOf(pack);
    return [
      ...(source?.update === undefined
        ? []
        : ([
            {
              kind: 'item',
              label: 'Review Update…',
              run: () => {
                openUpdateReview(source);
              },
            },
          ] satisfies MenuEntry[])),
      ...(source?.type === 'git'
        ? ([
            {
              kind: 'item',
              label: 'Check for Updates',
              run: () => void checkPackUpdates(source.id),
            },
          ] satisfies MenuEntry[])
        : []),
      ...(pack.problems.length > 0
        ? ([
            {
              kind: 'item',
              label: `Show ${String(pack.problems.length)} Skipped ${pack.problems.length === 1 ? 'Query' : 'Queries'}`,
              run: () => {
                notify({
                  severity: 'warning',
                  message: `${pack.name}: ${String(pack.problems.length)} ${pack.problems.length === 1 ? 'query was' : 'queries were'} skipped.`,
                  detail: pack.problems.map((p) => `${p.file}: ${p.message}`).join('\n'),
                  source: 'Query Packs',
                });
              },
            },
          ] satisfies MenuEntry[])
        : []),
      { kind: 'separator' },
      { kind: 'item', label: 'Remove Source…', run: () => void removePackSource(pack.sourceId) },
    ];
  };

  const sourceErrors = snapshot.sources.filter((s) => s.error !== undefined);
  return (
    <div className="library-section-body">
      <div className="library-section library-section-header">
        <span>Packs</span>
        <span className="library-section-actions">
          <button
            type="button"
            className="action-item library-toggle"
            aria-label="Only queries compatible with the current targets"
            title="Only queries whose tables exist in the current targets"
            aria-pressed={compatibleOnly}
            onClick={() => {
              if (!compatibleOnly && merged === undefined) void loadSchema();
              setCompatibleOnly(!compatibleOnly);
            }}
          >
            <Codicon name="filter" />
          </button>
          <button
            type="button"
            className="action-item"
            aria-label="Add Pack Source"
            title="Add Pack Source…"
            onClick={() => void executeCommand('library.addPackSource')}
          >
            <Codicon name="repo-clone" />
          </button>
          <button
            type="button"
            className="action-item"
            aria-label="Import Pack"
            title="Import Pack or Queries from File…"
            onClick={() => void executeCommand('library.importPack')}
          >
            <Codicon name="file-zip" />
          </button>
          <button
            type="button"
            className="action-item"
            aria-label="Check for Pack Updates"
            title="Check for Pack Updates"
            onClick={() => void executeCommand('library.checkPackUpdates')}
          >
            <Codicon name="sync" />
          </button>
        </span>
      </div>
      {loaded && snapshot.packs.length === 0 && sourceErrors.length === 0 ? (
        <div className="library-hint">
          <p>
            Query packs are shared sets of queries. Add a git repository or import a .rkqlpack file;
            you review what it contains before it is added.
          </p>
          <button
            type="button"
            className="button button-primary welcome-view-button"
            onClick={() => void executeCommand('library.addPackSource')}
          >
            Add Pack Source…
          </button>
        </div>
      ) : null}
      {sourceErrors.map((source) => (
        <p key={source.id} className="library-hint" role="alert">
          <Codicon name="warning" /> {source.label}: {source.error}
        </p>
      ))}
      {compatibleOnly && merged === undefined ? (
        <p className="library-hint">Loading the schema of the current targets…</p>
      ) : null}
      <ul className="library-tree" role="tree" aria-label="Packs">
        {rows.map((row) => {
          if (row.kind === 'pack') {
            const { pack } = row;
            const source = sourceOf(pack);
            const other = packDisambiguator(pack, snapshot);
            return (
              <li
                key={row.key}
                role="treeitem"
                aria-level={1}
                aria-expanded={row.open}
                aria-selected={selected === row.key}
                tabIndex={selected === row.key ? 0 : -1}
                className={`library-row${selected === row.key ? ' selected' : ''}${pack.problems.length > 0 ? ' problem' : ''}`}
                style={{ paddingLeft: '12px' }}
                title={[
                  `${pack.name} ${pack.version} (${pack.id})`,
                  pack.description,
                  `Source: ${source?.label ?? pack.sourceId}`,
                  pack.problems.length > 0
                    ? `${String(pack.problems.length)} queries skipped (right-click for details)`
                    : '',
                ]
                  .filter((line) => line !== '')
                  .join('\n')}
                onClick={() => {
                  setSelected(row.key);
                  toggle(row.key);
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setSelected(row.key);
                  setMenu({ x: event.clientX, y: event.clientY, pack });
                }}
              >
                <Codicon name={row.open ? 'chevron-down' : 'chevron-right'} className="twistie" />
                <Codicon name="package" />
                <span className="library-label">{pack.name}</span>
                <span className="library-description">
                  {pack.version}
                  {other === undefined ? '' : ` · ${other}`}
                </span>
                {source?.update === undefined ? null : (
                  <button
                    type="button"
                    className="library-badge"
                    title="An update is available: review it"
                    onClick={(event) => {
                      event.stopPropagation();
                      openUpdateReview(source);
                    }}
                  >
                    Update
                  </button>
                )}
              </li>
            );
          }
          if (row.kind === 'category') {
            return (
              <li
                key={row.key}
                role="treeitem"
                aria-level={2}
                aria-expanded={row.open}
                aria-selected={false}
                tabIndex={-1}
                className="library-row"
                style={{ paddingLeft: '28px' }}
                onClick={() => {
                  toggle(row.key);
                }}
              >
                <Codicon name={row.open ? 'chevron-down' : 'chevron-right'} className="twistie" />
                <span className="library-label">{row.label}</span>
                <span className="library-description">{row.count}</span>
              </li>
            );
          }
          const { pack, query } = row;
          return (
            <li
              key={row.key}
              role="treeitem"
              aria-level={row.level}
              aria-selected={selected === row.key}
              tabIndex={selected === row.key ? 0 : -1}
              className={`library-row${selected === row.key ? ' selected' : ''}`}
              style={{ paddingLeft: `${String(12 + (row.level - 1) * 16)}px` }}
              title={[
                query.name,
                query.description,
                `Tables: ${query.tables.join(', ')}`,
                query.mitre === undefined ? '' : `MITRE ATT&CK: ${query.mitre.join(', ')}`,
                query.tags === undefined ? '' : `Tags: ${query.tags.join(', ')}`,
              ]
                .filter((line) => line !== '')
                .join('\n')}
              onClick={() => {
                setSelected(row.key);
                void openPackQuery(pack, query, true);
              }}
              onDoubleClick={() => void openPackQuery(pack, query, false)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void openPackQuery(pack, query, false);
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                setSelected(row.key);
                setMenu({ x: event.clientX, y: event.clientY, pack, query });
              }}
            >
              <span className="twistie-spacer" />
              <Codicon name="file-code" />
              <span className="library-label">{query.name}</span>
              {search.trim() !== '' ? (
                <span className="library-description">{pack.name}</span>
              ) : (query.mitre?.length ?? 0) > 0 ? (
                <span className="library-description">{query.mitre?.[0]}</span>
              ) : null}
            </li>
          );
        })}
      </ul>
      {menu === undefined ? null : (
        <ContextMenu
          label="Packs"
          entries={menuEntries(menu)}
          x={menu.x}
          y={menu.y}
          onClose={() => {
            setMenu(undefined);
          }}
        />
      )}
    </div>
  );
}
