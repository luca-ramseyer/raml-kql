import { useEffect, useRef } from 'react';

import type { ResultColumn } from '../../../shared/query/models';

/**
 * Hide/show columns (spec 06). Attribution columns default to `results.attributionColumns`;
 * per-tab choices override the default for that tab.
 */
export function isColumnShown(
  column: ResultColumn,
  overrides: Readonly<Record<string, boolean>>,
  shownAttribution: readonly string[],
): boolean {
  return (
    overrides[column.name] ??
    (column.attribution === true ? shownAttribution.includes(column.name) : true)
  );
}

export function ColumnPicker({
  columns,
  overrides,
  shownAttribution,
  onChange,
  onClose,
}: {
  columns: ResultColumn[];
  overrides: Readonly<Record<string, boolean>>;
  shownAttribution: readonly string[];
  onChange: (name: string, shown: boolean) => void;
  onClose: () => void;
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (event: MouseEvent): void => {
      if (ref.current !== null && !ref.current.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);
  return (
    <div ref={ref} className="column-picker" role="dialog" aria-label="Choose columns">
      {columns.map((column) => (
        <label key={column.name} className="column-picker-item">
          <input
            type="checkbox"
            checked={isColumnShown(column, overrides, shownAttribution)}
            onChange={(event) => {
              onChange(column.name, event.target.checked);
            }}
          />
          <span className={column.attribution === true ? 'attribution-name' : undefined}>
            {column.name}
          </span>
        </label>
      ))}
    </div>
  );
}
