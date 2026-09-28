import { useEffect, useMemo, useState } from 'react';

import type { HistoryEntry } from '../../../shared/query/history';
import { Codicon } from '../../workbench/common/Codicon';
import { useNamer } from '../privacy/privacy';
import { runActiveQuery } from '../query/run-query';
import { copyText } from '../results/result-actions';
import { useInventory } from '../workspaces/inventory-store';

import {
  dayLabel,
  filterHistory,
  loadHistory,
  openHistoryEntry,
  queryLabel,
  useHistory,
} from './history-store';

import './HistoryView.css';

function Entry({ entry }: { entry: HistoryEntry }): React.JSX.Element {
  const namer = useNamer();
  const tenants = entry.tenantIds.length;
  const failed = entry.counts.failed + entry.counts.timeout;
  const time = new Date(entry.ts).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
  const tenantNames = entry.tenantIds
    .slice(0, 3)
    .map((id) => namer.tenant(id))
    .join(', ');
  return (
    <li
      className="history-entry"
      role="treeitem"
      aria-level={2}
      aria-selected={false}
      tabIndex={-1}
      title={entry.query}
      onClick={() => {
        openHistoryEntry(entry, true);
      }}
      onDoubleClick={() => {
        openHistoryEntry(entry, false);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') openHistoryEntry(entry, false);
      }}
    >
      <div className="history-query">{queryLabel(entry.query)}</div>
      <div className="history-meta">
        {time} · {entry.targets.length} workspace{entry.targets.length === 1 ? '' : 's'}
        {tenants > 0
          ? ` · ${tenantNames}${tenants > 3 ? ` +${String(tenants - 3)}` : ''}`
          : ''} · {entry.rows.toLocaleString()} rows
        {failed > 0 ? <span className="history-failed"> · {failed} failed</span> : null}
      </div>
      <div className="history-actions">
        <button
          type="button"
          className="action-item"
          title="Open in New Tab"
          aria-label="Open in new tab"
          onClick={(event) => {
            event.stopPropagation();
            openHistoryEntry(entry, false);
          }}
        >
          <Codicon name="go-to-file" />
        </button>
        <button
          type="button"
          className="action-item"
          title="Run Again"
          aria-label="Run again"
          onClick={(event) => {
            event.stopPropagation();
            openHistoryEntry(entry, false);
            void runActiveQuery({ scope: 'all' });
          }}
        >
          <Codicon name="play" />
        </button>
        <button
          type="button"
          className="action-item"
          title="Copy Query"
          aria-label="Copy query"
          onClick={(event) => {
            event.stopPropagation();
            void copyText(entry.query, 'Query copied.');
          }}
        >
          <Codicon name="copy" />
        </button>
      </div>
    </li>
  );
}

/** The History view (spec 05): runs grouped by day, searchable; never result data. */
export function HistoryView(): React.JSX.Element {
  const { entries, loaded } = useHistory();
  const [search, setSearch] = useState('');
  const namer = useNamer();
  useInventory((s) => s.inventory);

  useEffect(() => {
    if (!loaded) void loadHistory();
  }, [loaded]);

  const groups = useMemo(() => {
    const filtered = filterHistory(entries, search, (id) => namer.tenant(id));
    const byDay = new Map<string, HistoryEntry[]>();
    for (const entry of filtered) {
      const label = dayLabel(entry.ts);
      const list = byDay.get(label) ?? [];
      list.push(entry);
      byDay.set(label, list);
    }
    return [...byDay.entries()];
  }, [entries, search, namer]);

  if (loaded && entries.length === 0) {
    return (
      <div className="welcome-view">
        <p>Queries you run will appear here. Only query text is kept, never results.</p>
      </div>
    );
  }
  return (
    <div className="history-view">
      <input
        type="search"
        className="input history-search"
        placeholder="Search history (query, table, tenant)"
        aria-label="Search history"
        value={search}
        onChange={(event) => {
          setSearch(event.target.value);
        }}
      />
      <ul className="history-list" role="tree" aria-label="History">
        {groups.map(([day, list]) => (
          <li key={day} role="treeitem" aria-level={1} aria-expanded aria-selected={false}>
            <div className="history-day">{day}</div>
            <ul role="group">
              {list.map((entry) => (
                <Entry key={entry.id} entry={entry} />
              ))}
            </ul>
          </li>
        ))}
      </ul>
      {groups.length === 0 && search !== '' ? (
        <p className="history-empty">No runs match.</p>
      ) : null}
    </div>
  );
}
