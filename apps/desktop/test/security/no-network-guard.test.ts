import http from 'node:http';
import net from 'node:net';

import { describe, expect, it } from 'vitest';

describe('test network guard', () => {
  it('blocks fetch to real hosts', () => {
    expect(() => fetch('https://api.loganalytics.io/v1/workspaces')).toThrow(
      /Blocked real network/,
    );
  });

  it('blocks http.request to real hosts', () => {
    expect(() => http.request('http://management.azure.com/')).toThrow(/Blocked real network/);
  });

  it('blocks raw sockets to real hosts', () => {
    expect(() => net.connect(443, 'login.microsoftonline.com')).toThrow(/Blocked real network/);
  });

  it('allows loopback (used by the fake Azure server)', async () => {
    const server = http.createServer((_req, res) => res.end('ok'));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as net.AddressInfo;
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`);
      expect(await response.text()).toBe('ok');
    } finally {
      server.close();
    }
  });
});
