import { describe, expect, it } from 'vitest';

import { NetworkActivityRecorder } from './network-activity';

describe('NetworkActivityRecorder', () => {
  it('counts hosts per category and never keeps paths or queries', () => {
    let t = 0;
    const recorder = new NetworkActivityRecorder(() => new Date(Date.UTC(2026, 0, 1, 0, 0, t++)));
    recorder.record(
      'https://login.microsoftonline.com/common/oauth2/v2.0/token?code=secret',
      'app',
    );
    recorder.record('https://login.microsoftonline.com/other', 'app');
    recorder.record('https://api.loganalytics.io/v1/workspaces/x/query', 'app');
    recorder.record('http://127.0.0.1:9000/probe', 'extension:contoso.net-probe');
    recorder.record('raml-kql://app/index.html', 'app');
    recorder.record('not a url', 'app');
    const { hosts } = recorder.snapshot();
    expect(hosts.map((h) => [h.category, h.host, h.count])).toEqual([
      ['app', 'api.loganalytics.io', 1],
      ['app', 'login.microsoftonline.com', 2],
      ['extension:contoso.net-probe', '127.0.0.1:9000', 1],
    ]);
    expect(JSON.stringify(recorder.snapshot())).not.toContain('secret');
  });
});
