import { describe, expect, it } from 'vitest';

import { endpoints, toResult, urlId } from './virustotal';

describe('VirusTotal helpers', () => {
  it('builds API and web URLs per entity type', () => {
    expect(endpoints({ type: 'ip', value: '203.0.113.7' })?.api).toBe(
      'https://www.virustotal.com/api/v3/ip_addresses/203.0.113.7',
    );
    expect(endpoints({ type: 'sha256', value: 'A'.repeat(64) })?.gui).toBe(
      `https://www.virustotal.com/gui/file/${'a'.repeat(64)}`,
    );
    expect(endpoints({ type: 'upn', value: 'alice@contoso.com' })).toBeUndefined();
  });

  it('encodes URL ids as unpadded base64url', () => {
    const url = 'http://www.contoso.example/path?q=ä~';
    expect(urlId(url)).toBe(Buffer.from(url).toString('base64url'));
  });

  it('summarises analysis stats', () => {
    const result = toResult(
      { type: 'ip', value: '203.0.113.7' },
      {
        data: {
          attributes: {
            reputation: -5,
            last_analysis_stats: { malicious: 3, suspicious: 1, harmless: 60, undetected: 26 },
          },
        },
      },
      'https://www.virustotal.com/gui/ip-address/203.0.113.7',
    );
    expect(result.fields).toEqual({ malicious: 3, verdict: '3/90', reputation: -5 });
  });
});
