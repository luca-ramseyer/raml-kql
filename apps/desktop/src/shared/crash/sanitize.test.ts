import { describe, expect, it } from 'vitest';

import { sanitize } from './sanitize';

/**
 * Corpus test (spec 10): every sensitive token in these realistic crash texts must be gone
 * after sanitizing, while the stack keeps its shape.
 */
const HOME = '/Users/analyst';
// A fake token, built at runtime so the source contains nothing token-shaped (secret scanning).
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
/** Base64url of ASCII text (shared code has no Node `Buffer`). */
function b64url(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i += 3) {
    const [a = 0, b = 0, c = 0] = [0, 1, 2].map((k) => text.charCodeAt(i + k) || 0);
    const n = (a << 16) | (b << 8) | c;
    const chars = [18, 12, 6, 0].map((shift) => B64.charAt((n >> shift) & 63));
    out += chars.slice(0, Math.min(4, text.length - i + 1)).join('');
  }
  return out;
}
const JWT = [
  b64url('{"alg":"RS256","typ":"JWT"}'),
  b64url('{"tid":"00000000-0000-0000-0000-000000000001"}'),
  b64url('signature-fake-that-is-long-enough'),
].join('.');

const CORPUS: { text: string; secrets: string[] }[] = [
  {
    text: `TypeError: Cannot read properties of undefined (reading 'tables')
    at ResultStore.append (${HOME}/dev/raml-kql/out/main/index.js:1234:18)
    at QueryEngine.finish (/Applications/Raml KQL.app/Contents/Resources/app.asar/out/main/index.js:88:3)`,
    secrets: ['analyst'],
  },
  {
    text: `Error: Request failed for workspace /subscriptions/00000000-0000-0000-0000-000000000501/resourcegroups/rg-la-contoso-soc/providers/microsoft.operationalinsights/workspaces/la-contoso-soc (tenant 00000000-0000-0000-0000-0000000000a1)`,
    secrets: [
      '00000000-0000-0000-0000-000000000501',
      'rg-la-contoso-soc',
      'la-contoso-soc',
      '00000000-0000-0000-0000-0000000000a1',
    ],
  },
  {
    text: `AADSTS50076: Due to a configuration change made by your administrator, alice.admin@fabrikam.onmicrosoft.com must use multi-factor authentication. Authorization: Bearer ${JWT}`,
    secrets: ['alice.admin', 'fabrikam.onmicrosoft.com', JWT.slice(0, 30)],
  },
  {
    text: `SemanticError: 'where' operator: Failed to resolve column 'UserPrincipalName' in SigninLogs | where UserPrincipalName == "bob@contoso.com" | summarize count() by IPAddress`,
    secrets: ['bob@contoso.com', 'summarize count() by IPAddress'],
  },
  {
    text: `fetch failed: connect ECONNREFUSED 203.0.113.7:443 (via 2001:db8:85a3::8a2e:370:7334) url=https://api.loganalytics.io/v1/workspaces/x/query?access_token=abc123secretvalue&sig=zzz`,
    secrets: ['203.0.113.7', '2001:db8:85a3::8a2e:370:7334', 'abc123secretvalue'],
  },
  {
    text: `Error in C:\\Users\\jdoe\\AppData\\Roaming\\Raml KQL\\session-cache\\spill-01.bin: cache key 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08`,
    secrets: ['jdoe', '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08'],
  },
  {
    text: `Unhandled rejection: tenant "Fabrikam Holdings Ltd" workspace Woodgrove-Sentinel-EU failed: 'let MinFailures = 10; SigninLogs | where ResultType != "0"'`,
    secrets: ['Fabrikam Holdings Ltd', 'Woodgrove-Sentinel-EU', 'MinFailures'],
  },
];

describe('sanitize', () => {
  it.each(CORPUS.map((entry, i) => [i, entry] as const))(
    'removes every secret from corpus %i',
    (_i, entry) => {
      const out = sanitize(entry.text, {
        homeDir: HOME,
        names: ['Woodgrove-Sentinel-EU', 'Fabrikam Holdings Ltd'],
      });
      for (const secret of entry.secrets) expect(out).not.toContain(secret);
    },
  );

  it('keeps the stack readable with app-relative paths', () => {
    const out = sanitize(CORPUS[0]?.text ?? '', {
      homeDir: HOME,
      appDir: '/Applications/Raml KQL.app/Contents/Resources',
    });
    expect(out).toContain('at ResultStore.append (~/dev/raml-kql/out/main/index.js:1234:18)');
    expect(out).toContain('(<app>/app.asar/out/main/index.js:88:3)');
    expect(out).toContain("TypeError: Cannot read properties of undefined (reading 'tables')");
  });

  it('builds its fake token like a real one', () => {
    expect(b64url('{"alg":"RS256","typ":"JWT"}')).toBe('eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9');
  });

  it('marks what it replaced', () => {
    expect(
      sanitize(
        'user bob@contoso.com from 198.51.100.4 tenant 00000000-0000-0000-0000-000000000009',
      ),
    ).toBe('user <email> from <ip> tenant <guid>');
  });
});
