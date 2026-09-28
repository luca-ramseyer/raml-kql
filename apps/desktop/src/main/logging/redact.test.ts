import { describe, expect, it } from 'vitest';

import { describeError, redact } from './redact';

describe('redact', () => {
  // A fake JWT ({"alg":"RS256"}.{"sub":"user"}.signature), assembled at runtime so no
  // token-shaped literal sits in the repository (gitleaks would rightly flag it).
  const jwt = ['eyJhbGciOiJSUzI1NiJ9', 'eyJzdWIiOiJ1c2VyIn0', 'c2lnbmF0dXJlLXZhbHVl'].join('.');

  it('removes JWTs, bearer tokens and Authorization headers', () => {
    expect(redact(`token ${jwt} end`)).toBe('token [redacted-jwt] end');
    expect(redact('Authorization: Bearer abcdefghijklmnop')).not.toContain('abcdefghijklmnop');
    expect(redact('{"authorization":"Bearer abc.def.ghi-jkl"}')).not.toContain('abc.def');
    expect(redact('call with bearer QWERTYUIOPASDF')).toBe('call with bearer [redacted]');
  });

  it('leaves normal text alone', () => {
    expect(
      redact('AADSTS50076: MFA required for tenant 00000000-0000-0000-0000-0000000000a1'),
    ).toBe('AADSTS50076: MFA required for tenant 00000000-0000-0000-0000-0000000000a1');
  });

  it('describeError redacts and truncates', () => {
    const text = describeError(new Error(`failed with ${jwt} ${'x'.repeat(1000)}`));
    expect(text).not.toContain('eyJ');
    expect(text.length).toBeLessThanOrEqual(500);
  });
});
