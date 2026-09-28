import { useEffect, useState } from 'react';

import type { NetworkActivity } from '../../../shared/network/activity';
import { getBridge, unwrap } from '../../services/ipc';

import './diagnostics.css';

function describe(category: string): string {
  if (category === 'app') return 'Raml KQL (Microsoft sign-in, Azure, release lookups)';
  if (category === 'git') return 'Git sources you added';
  if (category.startsWith('extension:')) return `Extension ${category.slice('extension:'.length)}`;
  return category;
}

/**
 * "Developer: Show Network Activity" (spec 10): every host contacted this session, so the
 * privacy claims can be checked. Hosts only; refreshed every two seconds.
 */
export function NetworkActivityEditor(): React.JSX.Element {
  const [activity, setActivity] = useState<NetworkActivity | undefined>(undefined);
  useEffect(() => {
    let current = true;
    const load = (): void => {
      void unwrap(getBridge().app.networkActivity())
        .then((next) => {
          if (current) setActivity(next);
        })
        .catch(() => undefined);
    };
    load();
    const timer = setInterval(load, 2000);
    return () => {
      current = false;
      clearInterval(timer);
    };
  }, []);

  return (
    <div className="diagnostics">
      <h1>Network Activity</h1>
      <p className="diagnostics-note">
        Hosts contacted since{' '}
        {activity === undefined ? '…' : new Date(activity.since).toLocaleTimeString()} (this session
        only; nothing is recorded to disk). Raml KQL has no telemetry: you should only see Microsoft
        endpoints, git hosts you added, and hosts you allowed extensions to reach.
      </p>
      {activity !== undefined && activity.hosts.length === 0 ? (
        <p className="diagnostics-message">No network requests yet.</p>
      ) : (
        <table className="diagnostics-table" aria-label="Hosts contacted">
          <thead>
            <tr>
              <th>Host</th>
              <th>Made by</th>
              <th className="numeric">Requests</th>
              <th>Last</th>
            </tr>
          </thead>
          <tbody>
            {(activity?.hosts ?? []).map((host) => (
              <tr key={`${host.category}|${host.host}`}>
                <td>{host.host}</td>
                <td>{describe(host.category)}</td>
                <td className="numeric">{host.count.toLocaleString()}</td>
                <td>{new Date(host.lastSeen).toLocaleTimeString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
