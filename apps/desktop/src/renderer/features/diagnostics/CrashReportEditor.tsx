import { useEffect, useState } from 'react';

import { closeEditor } from '../../platform/editors';
import { notify } from '../../platform/notifications';
import { getBridge, unwrap } from '../../services/ipc';

import './diagnostics.css';

/**
 * The crash report preview (spec 10): the sanitized report, editable, then "Open GitHub Issue"
 * opens a prefilled issue in the browser for the user to submit. Nothing is sent from here.
 */
export function CrashReportEditor(): React.JSX.Element {
  const [title, setTitle] = useState<string | undefined>(undefined);
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    let current = true;
    unwrap(getBridge().crash.report())
      .then((report) => {
        if (!current) return;
        setTitle(report.title);
        setBody(report.body);
      })
      .catch(() => {
        if (current) setError('The crash report could not be built.');
      });
    return () => {
      current = false;
    };
  }, []);

  if (error !== undefined) return <p className="diagnostics-message">{error}</p>;
  if (title === undefined) return <p className="diagnostics-message">Preparing the report…</p>;
  return (
    <div className="diagnostics">
      <h1>Crash Report</h1>
      <p className="diagnostics-note">
        Review what will be shared. The report is sanitized: tenant, subscription and workspace IDs
        and names, e-mail addresses, IP addresses, tokens, file paths and query text are replaced.
        You can edit it; the issue opens in your browser and you submit it yourself.
      </p>
      <label className="diagnostics-field">
        <span>Title</span>
        <input
          className="input"
          value={title}
          onChange={(event) => {
            setTitle(event.target.value);
          }}
        />
      </label>
      <label className="diagnostics-field grow">
        <span>Report</span>
        <textarea
          className="input diagnostics-report"
          value={body}
          spellCheck={false}
          onChange={(event) => {
            setBody(event.target.value);
          }}
        />
      </label>
      <div className="diagnostics-actions">
        <button
          type="button"
          className="button button-primary"
          onClick={() => {
            void unwrap(getBridge().crash.openIssue({ title, body }))
              .then(() => unwrap(getBridge().crash.dismiss()))
              .catch(() => {
                notify({
                  severity: 'error',
                  message: 'The browser could not be opened.',
                  source: 'Crash Reporting',
                });
              });
          }}
        >
          Open GitHub Issue
        </button>
        <button
          type="button"
          className="button button-secondary"
          onClick={() => {
            void unwrap(getBridge().shell.writeClipboard({ text: `# ${title}\n\n${body}` })).then(
              () => {
                notify({ severity: 'info', message: 'Report copied.', source: 'Crash Reporting' });
              },
            );
          }}
        >
          Copy
        </button>
        <button
          type="button"
          className="button button-secondary"
          onClick={() => {
            void unwrap(getBridge().crash.dismiss()).catch(() => undefined);
            closeEditor('crashReport');
          }}
        >
          Don&apos;t Send
        </button>
      </div>
    </div>
  );
}
