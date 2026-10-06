import { beforeEach, describe, expect, it } from 'vitest';

import { useNotifications } from '../../platform/notifications';

import { offerRestart, reportManualCheck } from './update';

function latest() {
  const { notifications } = useNotifications.getState();
  return notifications[notifications.length - 1];
}

describe('update notifications', () => {
  beforeEach(() => {
    useNotifications.setState({ notifications: [], toasts: [], centerVisible: false });
  });

  it('offers Restart to Update when a download is ready', () => {
    offerRestart('1.2.0');
    expect(latest()?.message).toContain('1.2.0');
    expect(latest()?.actions.map((a) => a.label)).toEqual(['Restart to Update', 'Later']);
  });

  it('tells the user the outcome of a manual check', () => {
    reportManualCheck({ status: 'upToDate' });
    expect(latest()?.message).toBe('Raml KQL is up to date.');
    reportManualCheck({ status: 'error', message: 'offline' });
    expect(latest()).toMatchObject({ severity: 'error', detail: 'offline' });
    reportManualCheck({ status: 'unsupported', reason: 'Updates are disabled in demo mode.' });
    expect(latest()?.message).toMatch(/demo mode/);
  });

  it('stays silent while a check is still running', () => {
    reportManualCheck({ status: 'checking' });
    expect(useNotifications.getState().notifications).toHaveLength(0);
  });
});
