import { describe, expect, it } from 'vitest';

import { kqlLiteral, kqlString, letStatement, ParameterValueError } from './kql-literal';

/** Round-trips through the real Kusto parser are in apps/desktop (parameter injection tests). */
describe('kqlString', () => {
  it('escapes quotes, backslashes and control characters', () => {
    expect(kqlString('o"brien')).toBe('"o\\"brien"');
    expect(kqlString('C:\\Windows\\')).toBe('"C:\\\\Windows\\\\"');
    expect(kqlString('a\nb\r\tc')).toBe('"a\\nb\\r\\tc"');
    expect(kqlString('\u0000\u001f\u007f\u2028')).toBe('"\\u0000\\u001f\\u007f\\u2028"');
    expect(kqlString('')).toBe('""');
  });

  it('keeps unicode as is and never leaves the literal', () => {
    expect(kqlString('Müller 😀')).toBe('"Müller 😀"');
    const hostile = '"; print "pwned"; let x = "';
    const literal = kqlString(hostile);
    expect(literal.slice(1, -1)).not.toMatch(/(^|[^\\])"/);
  });
});

describe('kqlLiteral', () => {
  it('encodes each type', () => {
    expect(kqlLiteral({ name: 'S', type: 'string' }, 'x')).toBe('"x"');
    expect(kqlLiteral({ name: 'E', type: 'enum', values: ['High'] }, 'High')).toBe('"High"');
    expect(kqlLiteral({ name: 'I', type: 'int' }, -5)).toBe('int(-5)');
    expect(kqlLiteral({ name: 'L', type: 'long' }, 10)).toBe('long(10)');
    expect(kqlLiteral({ name: 'L', type: 'long' }, '9223372036854775807')).toBe(
      'long(9223372036854775807)',
    );
    expect(kqlLiteral({ name: 'R', type: 'real' }, 1.5)).toBe('real(1.5)');
    expect(kqlLiteral({ name: 'R', type: 'real' }, 'nan')).toBe('real(nan)');
    expect(kqlLiteral({ name: 'B', type: 'bool' }, false)).toBe('false');
    expect(kqlLiteral({ name: 'D', type: 'datetime' }, '2026-01-31T12:00:00Z')).toBe(
      'datetime(2026-01-31T12:00:00Z)',
    );
    expect(kqlLiteral({ name: 'T', type: 'timespan' }, '4h')).toBe('timespan(4h)');
    expect(kqlLiteral({ name: 'J', type: 'dynamic' }, { a: 'x"y' })).toBe(
      'parse_json("{\\"a\\":\\"x\\\\\\"y\\"}")',
    );
    expect(kqlLiteral({ name: 'L', type: 'stringList' }, ['a', 'b"c'])).toBe(
      'dynamic(["a", "b\\"c"])',
    );
    expect(kqlLiteral({ name: 'L', type: 'stringList' }, [])).toBe('dynamic([])');
  });

  it('rejects values that do not fit instead of coercing them', () => {
    expect(() => kqlLiteral({ name: 'N', type: 'long' }, '10; print 1')).toThrow(
      ParameterValueError,
    );
    expect(() => kqlLiteral({ name: 'E', type: 'enum', values: ['a'] }, 'b')).toThrow(/one of a/);
    expect(() => kqlLiteral({ name: 'D', type: 'datetime' }, 'now()')).toThrow(/ISO 8601/);
  });

  it('builds let statements', () => {
    expect(letStatement({ name: 'UserFilter', type: 'string' }, 'o"brien')).toBe(
      'let UserFilter = "o\\"brien";',
    );
  });
});
