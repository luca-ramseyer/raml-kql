import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api.js';
import { useEffect, useRef, useState } from 'react';

import type { QueryChange, UpdatePreview } from '../../../shared/packs/models';
import { closeEditor } from '../../platform/editors';
import { notify } from '../../platform/notifications';
import { getBridge, unwrap } from '../../services/ipc';
import { Codicon } from '../../workbench/common/Codicon';
import { MONACO_THEME_NAME } from '../editor/monaco-theme';

import { reportPackError, setPacksSnapshot } from './packs-store';

import './PackUpdateEditor.css';

const CHANGE_ICON: Record<QueryChange['change'], string> = {
  added: 'diff-added',
  removed: 'diff-removed',
  changed: 'diff-modified',
};

/** Monaco's diff editor, read-only, for one changed query. */
function QueryDiff({ change }: { change: QueryChange }): React.JSX.Element {
  const container = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let disposed = false;
    let dispose = (): void => undefined;
    // Monaco is a separate chunk (loaded with the first query editor anyway).
    void Promise.all([import('../editor/monaco-loader'), import('../editor/monaco-theme-sync')])
      .then(async ([{ loadMonaco }, { syncTheme }]) => ({ loaded: await loadMonaco(), syncTheme }))
      .then(({ loaded, syncTheme }) => {
        if (disposed || container.current === null) return;
        syncTheme(loaded);
        const { monaco } = loaded;
        const original = monaco.editor.createModel(change.before ?? '', 'kusto');
        const modified = monaco.editor.createModel(change.after ?? '', 'kusto');
        const editor: Monaco.editor.IStandaloneDiffEditor = monaco.editor.createDiffEditor(
          container.current,
          {
            readOnly: true,
            originalEditable: false,
            automaticLayout: true,
            renderSideBySide: true,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            theme: MONACO_THEME_NAME,
          },
        );
        editor.setModel({ original, modified });
        dispose = () => {
          editor.dispose();
          original.dispose();
          modified.dispose();
        };
      })
      .catch(() => {
        setFailed(true);
      });
    return () => {
      disposed = true;
      dispose();
    };
  }, [change]);
  return failed ? (
    <div className="pack-update-message">The diff could not be shown.</div>
  ) : (
    <div className="pack-update-diff" ref={container} aria-label={`Changes in ${change.name}`} />
  );
}

/**
 * Reviewing a query pack update (spec 08, "Updates"): the commits since the pinned one and the
 * added, removed and changed queries with a diff. Nothing changes until "Apply Update".
 */
export function PackUpdateEditor({
  editorId,
  sourceId,
}: {
  editorId: string;
  sourceId: string;
}): React.JSX.Element {
  const [preview, setPreview] = useState<UpdatePreview | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [selected, setSelected] = useState(0);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    let current = true;
    unwrap(getBridge().packs.updatePreview({ sourceId }))
      .then((result) => {
        if (current) setPreview(result);
      })
      .catch((e: unknown) => {
        if (current) setError(e instanceof Error ? e.message : 'The update could not be loaded.');
      });
    return () => {
      current = false;
    };
  }, [sourceId]);

  if (error !== undefined)
    return (
      <div className="pack-update-message" role="alert">
        {error}
      </div>
    );
  if (preview === undefined) return <div className="pack-update-message">Loading the update…</div>;

  const apply = async (): Promise<void> => {
    setApplying(true);
    try {
      setPacksSnapshot(
        await unwrap(getBridge().packs.applyUpdate({ sourceId, sha: preview.toSha })),
      );
      notify({
        severity: 'info',
        message: `Updated ${preview.label} to ${preview.toSha.slice(0, 7)}.`,
        source: 'Query Packs',
      });
      closeEditor(editorId);
    } catch (e) {
      setApplying(false);
      reportPackError(e, 'The update could not be applied.');
    }
  };

  const change = preview.changes[selected];
  return (
    <div className="pack-update">
      <header className="pack-update-header">
        <div>
          <h1>{preview.label}</h1>
          <p className="pack-update-shas">
            {preview.fromSha.slice(0, 7)} → {preview.toSha.slice(0, 7)} ·{' '}
            {preview.packs
              .map((p) =>
                p.fromVersion === p.toVersion
                  ? `${p.name} ${p.toVersion ?? ''}`
                  : `${p.name} ${p.fromVersion ?? 'new'} → ${p.toVersion ?? 'removed'}`,
              )
              .join(', ')}
          </p>
        </div>
        <div className="pack-update-actions">
          <button
            type="button"
            className="button button-primary"
            disabled={applying}
            onClick={() => void apply()}
          >
            Apply Update
          </button>
          <button
            type="button"
            className="button button-secondary"
            onClick={() => {
              closeEditor(editorId);
            }}
          >
            Not Now
          </button>
        </div>
      </header>
      <div className="pack-update-body">
        <aside className="pack-update-side">
          <h2>Commits</h2>
          <ul className="pack-update-commits" aria-label="Commits">
            {preview.commits.map((commit) => (
              <li key={commit.oid} title={`${commit.oid}\n${commit.author}, ${commit.date}`}>
                <span className="pack-update-commit-message">{commit.message}</span>
                <span className="pack-update-meta">
                  {commit.oid.slice(0, 7)} · {commit.author} ·{' '}
                  {new Date(commit.date).toLocaleDateString()}
                </span>
              </li>
            ))}
            {preview.moreCommits ? <li className="pack-update-meta">and older commits…</li> : null}
          </ul>
          <h2>Changed Queries ({preview.changes.length})</h2>
          <ul className="pack-update-changes" role="listbox" aria-label="Changed queries">
            {preview.changes.length === 0 ? (
              <li className="pack-update-meta">No query changes.</li>
            ) : null}
            {preview.changes.map((c, index) => (
              <li
                key={`${c.packId}/${c.queryId}`}
                role="option"
                aria-selected={index === selected}
                tabIndex={index === selected ? 0 : -1}
                className={`pack-update-change ${c.change}${index === selected ? ' selected' : ''}`}
                onClick={() => {
                  setSelected(index);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowDown')
                    setSelected(Math.min(index + 1, preview.changes.length - 1));
                  if (event.key === 'ArrowUp') setSelected(Math.max(index - 1, 0));
                }}
              >
                <Codicon name={CHANGE_ICON[c.change]} />
                <span className="pack-update-change-name">{c.name}</span>
                <span className="pack-update-meta">{c.change}</span>
              </li>
            ))}
          </ul>
          {preview.problems.length > 0 ? (
            <>
              <h2>Problems in the New Version</h2>
              <ul className="pack-update-problems">
                {preview.problems.map((p) => (
                  <li key={`${p.file}:${p.message}`}>
                    <Codicon name="warning" /> {p.file}: {p.message}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </aside>
        {change === undefined ? (
          <div className="pack-update-message">Select a changed query to see the diff.</div>
        ) : (
          <QueryDiff key={`${change.packId}/${change.queryId}`} change={change} />
        )}
      </div>
    </div>
  );
}
