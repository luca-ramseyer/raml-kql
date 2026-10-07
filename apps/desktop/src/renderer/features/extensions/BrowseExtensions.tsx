import { useState } from 'react';

import type { CatalogResult } from '../../../shared/extensions/models';
import { Codicon } from '../../workbench/common/Codicon';

import { ago, loadCatalog, useCatalog } from './catalog-store';
import { installFromCatalog } from './extension-commands';
import { useExtensions } from './extensions-store';

type Entry = CatalogResult['entries'][number];

function matches(entry: Entry, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const haystack = [
    entry.displayName,
    entry.id,
    entry.publisher,
    entry.description,
    ...entry.categories,
  ]
    .join(' ')
    .toLowerCase();
  return words.every((word) => haystack.includes(word));
}

function BrowseItem({
  entry,
  installedVersion,
}: {
  entry: Entry;
  installedVersion: string | undefined;
}): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  return (
    <li className="extension-item browse-item">
      <div className="extension-header browse-header">
        <span className="extension-name">{entry.displayName}</span>
        {entry.version === undefined ? null : (
          <span className="extension-version">{entry.version}</span>
        )}
      </div>
      <p className="extension-meta browse-publisher">{entry.publisher}</p>
      <p className="extension-description browse-description">{entry.description}</p>
      {entry.categories.length === 0 ? null : (
        <ul className="browse-categories" aria-label="Categories">
          {entry.categories.map((category) => (
            <li key={category}>{category}</li>
          ))}
        </ul>
      )}
      <div className="extension-actions">
        {installedVersion === undefined ? (
          <button
            type="button"
            className="button button-primary"
            disabled={busy}
            aria-label={`Install ${entry.displayName}`}
            onClick={() => {
              setBusy(true);
              void installFromCatalog(entry.id, entry.displayName).finally(() => {
                setBusy(false);
              });
            }}
          >
            Install
          </button>
        ) : (
          <span className="extension-meta">
            <Codicon name="check" /> Installed {installedVersion}
          </span>
        )}
      </div>
    </li>
  );
}

/** The Browse tab (D-058): extensions from the catalog, with search and an Install button. */
export function BrowseExtensions(): React.JSX.Element {
  const { result, loading, error, search } = useCatalog();
  const installed = useExtensions((state) => state.snapshot.extensions);

  if (result !== undefined && !result.enabled) {
    return (
      <div className="welcome-view">
        <p>
          Browsing the extension catalog is turned off. Turn on the setting{' '}
          <code>extensions.catalog.enabled</code> to see the list. Nothing is fetched while it is
          off.
        </p>
      </div>
    );
  }
  if (result === undefined) {
    return (
      <div className="welcome-view" role="status">
        {error === undefined ? (
          <p>{loading ? 'Loading the extension catalog…' : 'Opening the catalog…'}</p>
        ) : (
          <>
            <p role="alert">{error}</p>
            <button
              type="button"
              className="button button-secondary welcome-view-button"
              onClick={() => void loadCatalog(true)}
            >
              Try again
            </button>
          </>
        )}
      </div>
    );
  }
  const shown = result.entries.filter((entry) => matches(entry, search));
  return (
    <>
      <div className="browse-status" role="status">
        {result.demo
          ? 'Demo catalog: these are sample entries and cannot be installed.'
          : result.error !== undefined
            ? result.error
            : result.fromCache
              ? `Saved list${result.fetchedAt === undefined ? '' : `, updated ${ago(result.fetchedAt)}`}.`
              : `Updated ${result.fetchedAt === undefined ? 'now' : ago(result.fetchedAt)}.`}
        <button
          type="button"
          className="browse-refresh"
          title="Refresh the catalog"
          aria-label="Refresh the catalog"
          disabled={loading || result.demo}
          onClick={() => void loadCatalog(true)}
        >
          <Codicon name="refresh" />
        </button>
      </div>
      {result.problems.length === 0 ? null : (
        <p className="extension-meta browse-problems">
          {String(result.problems.length)} catalog{' '}
          {result.problems.length === 1 ? 'entry was' : 'entries were'} skipped or could not be
          read.
        </p>
      )}
      {shown.length === 0 ? (
        <p className="extension-meta browse-empty">
          {result.entries.length === 0
            ? 'The catalog lists no extensions.'
            : `No extensions match "${search}".`}
        </p>
      ) : (
        <ul className="extensions-list" aria-label="Extensions in the catalog">
          {shown.map((entry) => (
            <BrowseItem
              key={entry.id}
              entry={entry}
              installedVersion={installed.find((e) => e.id === entry.id)?.version}
            />
          ))}
        </ul>
      )}
    </>
  );
}
