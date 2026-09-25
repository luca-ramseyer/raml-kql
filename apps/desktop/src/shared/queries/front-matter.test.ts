import { describe, expect, it } from 'vitest';

import { formatQueryFile, parseQueryFile } from './front-matter';

describe('query front-matter', () => {
  it('parses the spec example and keeps the body', () => {
    const text = [
      '// ---',
      '// id: signin-failed-by-user',
      '// name: Failed sign-ins by user',
      '// tags: [bruteforce, password-spray]',
      '// parameters:',
      '//   - name: MinFailures',
      '//     type: long',
      '// ---',
      'SigninLogs',
      '| where TimeGenerated > ago(1d)',
    ].join('\n');
    const parsed = parseQueryFile(text);
    expect(parsed.meta).toMatchObject({
      id: 'signin-failed-by-user',
      name: 'Failed sign-ins by user',
      tags: ['bruteforce', 'password-spray'],
      parameters: [{ name: 'MinFailures', type: 'long' }],
    });
    expect(parsed.body).toBe('SigninLogs\n| where TimeGenerated > ago(1d)');
  });

  it('round-trips, and leaves files without front-matter alone', () => {
    const meta = { name: 'Odd: "name" # with symbols', tags: ['a'] };
    const text = formatQueryFile(meta, 'Heartbeat\n| take 1\n');
    expect(text.startsWith('// ---\n// name:')).toBe(true);
    expect(parseQueryFile(text)).toEqual({
      meta,
      body: 'Heartbeat\n| take 1\n',
      hasFrontMatter: true,
    });
    expect(parseQueryFile('Heartbeat')).toEqual({
      meta: {},
      body: 'Heartbeat',
      hasFrontMatter: false,
    });
    expect(formatQueryFile({}, 'Heartbeat')).toBe('Heartbeat');
  });

  it('tolerates broken YAML and unterminated blocks', () => {
    expect(parseQueryFile('// ---\n// name: [unclosed\n// ---\nT').meta).toEqual({});
    expect(parseQueryFile('// ---\n// name: x\nT').hasFrontMatter).toBe(false);
  });
});
