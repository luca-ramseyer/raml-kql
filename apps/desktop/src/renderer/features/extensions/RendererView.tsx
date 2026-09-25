import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { getBridge, unwrap } from '../../services/ipc';
import { useAccounts } from '../accounts/accounts-store';
import { useNamer } from '../privacy/privacy';
import { useActiveRun } from '../results/active-run';
import { buildDisplayNames } from '../results/display-names';
import { useInventory } from '../workspaces/inventory-store';

import { ExtensionFrame } from './ExtensionFrame';

/** At most this many rows are handed to a renderer. */
const MAX_ROWS = 10_000;

/**
 * A result renderer panel tab (spec 07): the extension's UI draws the active result. Reading
 * the result needs `results.read`, asked per query run by default; the rows it gets use the
 * names on screen (aliased in presentation mode).
 */
export function RendererView({
  extensionId,
  title,
  ui,
}: {
  extensionId: string;
  title: string;
  ui: string;
}): React.JSX.Element {
  const { run } = useActiveRun();
  const namer = useNamer();
  const workspaces = useInventory((s) => s.inventory.workspaces);
  const accounts = useAccounts((s) => s.snapshot.accounts);
  const display = useMemo(
    () => buildDisplayNames(namer, workspaces, accounts),
    [namer, workspaces, accounts],
  );
  // The answer for a run (and a retry counter), so a new run starts unanswered.
  const [answer, setAnswer] = useState<{ key: string; allowed: boolean } | undefined>(undefined);
  const [ask, setAsk] = useState(0);
  const post = useRef<((message: unknown) => void) | undefined>(undefined);
  const table = run?.tables[0];
  const runId = run?.state === 'running' ? undefined : run?.runId;

  const key = `${runId ?? ''}#${String(ask)}`;
  const allowed = answer?.key === key ? answer.allowed : undefined;

  useEffect(() => {
    if (runId === undefined || table === undefined) return undefined;
    let current = true;
    void unwrap(
      getBridge().extensions.resultsAccess({
        extensionId,
        runId,
        rows: Math.min(table.rowCount, MAX_ROWS),
      }),
    )
      .then(({ allowed: ok }) => {
        if (current) setAnswer({ key, allowed: ok });
      })
      .catch(() => {
        if (current) setAnswer({ key, allowed: false });
      });
    return () => {
      current = false;
    };
  }, [extensionId, runId, table, key]);

  const send = useRef<() => void>(() => undefined);
  useLayoutEffect(() => {
    send.current = () => {
      if (
        allowed !== true ||
        runId === undefined ||
        table === undefined ||
        post.current === undefined
      )
        return;
      const target = post.current;
      void unwrap(
        getBridge().results.view({
          runId,
          tableIndex: table.index,
          view: { sort: [], filters: {}, quickSearch: '', valueFilters: [] },
          display,
          offset: 0,
          limit: MAX_ROWS,
        }),
      ).then((page) => {
        target({
          type: 'render',
          table: {
            name: table.name,
            columns: table.columns.map((c) => ({ name: c.name, type: c.type })),
            rows: page.rows,
            truncated: table.rowCount > MAX_ROWS,
          },
        });
      });
    };
  });
  useEffect(() => {
    send.current();
  }, [allowed, runId, table, display]);

  if (run === undefined || table === undefined) {
    return <p className="panel-empty">Run a query; {title} draws its result here.</p>;
  }
  if (runId === undefined || allowed === undefined)
    return <p className="panel-empty">Waiting for the result…</p>;
  if (!allowed) {
    return (
      <div className="panel-empty">
        <p>{title} was not allowed to read this result.</p>
        <button
          type="button"
          className="button button-secondary"
          onClick={() => {
            setAsk(ask + 1);
          }}
        >
          Ask Again
        </button>
      </div>
    );
  }
  return (
    <ExtensionFrame
      key={runId}
      extensionId={extensionId}
      path={ui}
      title={title}
      onReady={(target) => {
        post.current = target;
        send.current();
      }}
    />
  );
}
