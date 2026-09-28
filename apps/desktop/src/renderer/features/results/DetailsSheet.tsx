import { useEffect, useMemo, useState } from 'react';

import type { ResultColumn } from '../../../shared/query/models';
import type { DisplayNames } from '../../../shared/results/display-names';
import { kqlName } from '../../../shared/results/kql-literal';
import { useSetting } from '../../platform/settings';
import { getBridge, unwrap } from '../../services/ipc';
import { Codicon } from '../../workbench/common/Codicon';

import { formatCell, prettyJson } from './grid/cell-format';
import { copyText } from './result-actions';
import { EMPTY_VIEW } from './results-ui';

/** A KQL path to a value inside a dynamic column, e.g. `Details.users[0]['odd key']`. */
export function jsonPath(column: string, path: readonly (string | number)[]): string {
  return path.reduce<string>(
    (out, key) =>
      typeof key === 'number'
        ? `${out}[${String(key)}]`
        : /^[A-Za-z_][A-Za-z0-9_]*$/.test(key)
          ? `${out}.${key}`
          : `${out}['${key.replace(/'/g, "\\'")}']`,
    kqlName(column),
  );
}

function JsonNode({
  name,
  value,
  path,
  column,
  depth,
}: {
  name: string | undefined;
  value: unknown;
  path: (string | number)[];
  column: string;
  depth: number;
}): React.JSX.Element {
  const [open, setOpen] = useState(depth < 2);
  const isObject = typeof value === 'object' && value !== null;
  const entries: (readonly [string | number, unknown])[] = isObject
    ? Array.isArray(value)
      ? (value as unknown[]).map((v, i) => [i, v] as const)
      : Object.entries(value as Record<string, unknown>)
    : [];
  return (
    <li className="json-node">
      <div className="json-line">
        {isObject ? (
          <button
            type="button"
            className="json-toggle"
            aria-label={open ? 'Collapse' : 'Expand'}
            aria-expanded={open}
            onClick={() => {
              setOpen(!open);
            }}
          >
            <Codicon name={open ? 'chevron-down' : 'chevron-right'} />
          </button>
        ) : (
          <span className="json-toggle-spacer" />
        )}
        {name === undefined ? null : <span className="json-key">{name}: </span>}
        {isObject ? (
          <span className="json-summary">
            {Array.isArray(value) ? `[${String(entries.length)}]` : `{${String(entries.length)}}`}
          </span>
        ) : (
          <span className={`json-value json-${typeof value}`}>{JSON.stringify(value)}</span>
        )}
        {path.length > 0 ? (
          <button
            type="button"
            className="action-item json-copy"
            title={`Copy path: ${jsonPath(column, path)}`}
            aria-label="Copy JSON path"
            onClick={() => void copyText(jsonPath(column, path), 'Path copied.')}
          >
            <Codicon name="symbol-field" />
          </button>
        ) : null}
      </div>
      {isObject && open ? (
        <ul className="json-children">
          {entries.map(([key, child]) => (
            <JsonNode
              key={String(key)}
              name={String(key)}
              value={child}
              path={[...path, key]}
              column={column}
              depth={depth + 1}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/**
 * Row and cell details (spec 06): a side sheet with every column of a row (like the portal's
 * expanded row, with search), or one dynamic value as pretty JSON with a tree.
 */
export function DetailsSheet({
  runId,
  tableIndex,
  columns,
  display,
  details,
  onClose,
}: {
  runId: string;
  tableIndex: number;
  columns: ResultColumn[];
  display: DisplayNames | undefined;
  details: { kind: 'row'; position: number } | { kind: 'cell'; position: number; column: number };
  onClose: () => void;
}): React.JSX.Element {
  const zone = useSetting('time.displayZone');
  const [row, setRow] = useState<unknown[] | undefined>(undefined);
  const [search, setSearch] = useState('');
  const displayKey = JSON.stringify(display ?? null);

  useEffect(() => {
    let current = true;
    void unwrap(
      getBridge().results.view({
        runId,
        tableIndex,
        view: EMPTY_VIEW,
        ...(display === undefined ? {} : { display }),
        offset: details.position,
        limit: 1,
      }),
    ).then((page) => {
      if (current) setRow(page.rows[0]);
    });
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- display is tracked by displayKey
  }, [runId, tableIndex, details.position, displayKey]);

  const fields = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return columns
      .map((column, index) => ({
        column,
        index,
        text: formatCell(row?.[index], column.type, zone),
      }))
      .filter(
        (f) =>
          needle === '' ||
          f.column.name.toLowerCase().includes(needle) ||
          f.text.toLowerCase().includes(needle),
      );
  }, [columns, row, search, zone]);

  const cell = details.kind === 'cell' ? columns[details.column] : undefined;
  const cellValue = details.kind === 'cell' ? row?.[details.column] : undefined;
  const pretty = prettyJson(cellValue);

  return (
    <aside
      className="details-sheet"
      aria-label={details.kind === 'row' ? 'Row details' : 'Cell details'}
    >
      <div className="details-header">
        <h3>{details.kind === 'row' ? 'Row Details' : `Cell Details: ${cell?.name ?? ''}`}</h3>
        <button
          type="button"
          className="action-item"
          title="Close"
          aria-label="Close details"
          onClick={onClose}
        >
          <Codicon name="close" />
        </button>
      </div>
      {row === undefined ? (
        <p className="panel-empty">Loading…</p>
      ) : details.kind === 'row' ? (
        <>
          <input
            className="details-search"
            type="search"
            placeholder="Search columns and values"
            aria-label="Search row details"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
            }}
          />
          <dl className="details-fields">
            {fields.map((f) => (
              <div key={f.index} className="details-field">
                <dt title={f.column.type}>{f.column.name}</dt>
                <dd>
                  {prettyJson(row[f.index]) === undefined ? (
                    f.text
                  ) : (
                    <pre className="details-json">{prettyJson(row[f.index])}</pre>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </>
      ) : (
        <div className="details-cell">
          <div className="details-actions">
            <button
              type="button"
              className="button button-secondary"
              onClick={() =>
                void copyText(pretty ?? formatCell(cellValue, cell?.type ?? 'string', zone))
              }
            >
              Copy Value
            </button>
          </div>
          {pretty === undefined ? (
            <pre className="details-json">
              {formatCell(cellValue, cell?.type ?? 'string', zone)}
            </pre>
          ) : (
            <ul className="json-tree" aria-label="JSON value">
              <JsonNode
                name={undefined}
                value={JSON.parse(pretty) as unknown}
                path={[]}
                column={cell?.name ?? 'value'}
                depth={0}
              />
            </ul>
          )}
        </div>
      )}
    </aside>
  );
}
