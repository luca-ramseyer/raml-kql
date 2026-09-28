import { kqlString, ParameterValueError } from '@raml-kql/pack-schema/kql-literal';
import { describe, expect, it } from 'vitest';

import { syntaxDiagnostics, topLevelStatements } from '../kusto/kusto-parser';

import { injectParameters, withParameters } from './parameters';

/** The literal value the Kusto parser reads from `let X = <literal>;`. */
function parsedStringValue(literal: string): unknown {
  topLevelStatements(''); // loads the parser
  const kusto = (
    globalThis as unknown as {
      Kusto: {
        Language: {
          KustoCode: {
            Parse(text: string): {
              Syntax: {
                Statements: {
                  getItem(i: number): { Element$1: { Expression: { LiteralValue: unknown } } };
                };
              };
            };
          };
        };
      };
    }
  ).Kusto;
  return kusto.Language.KustoCode.Parse(`let X = ${literal};\nprint X`).Syntax.Statements.getItem(0)
    .Element$1.Expression.LiteralValue;
}

describe('KQL string literals through the Kusto parser', () => {
  const samples = [
    '',
    'plain',
    'o"brien',
    "it's",
    'C:\\Windows\\System32\\',
    'line1\nline2\r\n\ttabbed',
    '\u0000\u0001\u001f\u007f',
    'Müller Straße 😀 中文',
    '\u2028\u2029',
    '"; print "pwned"; let x = "',
    '\\"',
    '```',
    '//not a comment',
  ];
  it.each(samples)('round-trips %j', (value) => {
    const literal = kqlString(value);
    expect(syntaxDiagnostics(`let X = ${literal};\nprint X`)).toEqual([]);
    expect(parsedStringValue(literal)).toBe(value);
  });
});

describe('injectParameters', () => {
  const body = 'SigninLogs\n| where Failures >= MinFailures and UserPrincipalName has UserFilter';

  it('prepends typed let statements', () => {
    const query = injectParameters(body, [
      { name: 'MinFailures', type: 'long', value: 10 },
      { name: 'UserFilter', type: 'string', value: 'o"brien' },
    ]);
    expect(query).toBe(`let MinFailures = long(10);\nlet UserFilter = "o\\"brien";\n${body}`);
    expect(syntaxDiagnostics(query)).toEqual([]);
  });

  it("replaces the query's own top-level let of the same name, keeping comments", () => {
    const portable = [
      '// Minimum failures',
      'let MinFailures = 5; // default for the portal',
      'let Helper = (x: long) { let MinFailures = 1; x * MinFailures };',
      'let UserFilter = "";',
      body,
    ].join('\n');
    const query = injectParameters(portable, [
      { name: 'MinFailures', type: 'long', value: 25 },
      { name: 'UserFilter', type: 'string', value: 'alice' },
    ]);
    expect(query).toBe(
      [
        '// Minimum failures',
        'let MinFailures = long(25); // default for the portal',
        // A let inside a function body isn't a parameter.
        'let Helper = (x: long) { let MinFailures = 1; x * MinFailures };',
        'let UserFilter = "alice";',
        body,
      ].join('\n'),
    );
    expect(syntaxDiagnostics(query)).toEqual([]);
  });

  it('does not touch strings or comments that look like a let', () => {
    const tricky = 'print s = "let MinFailures = 1;" // let MinFailures = 2;';
    expect(injectParameters(tricky, [{ name: 'MinFailures', type: 'int', value: 3 }])).toBe(
      `let MinFailures = int(3);\n${tricky}`,
    );
  });

  it('produces valid KQL for every type', () => {
    const query = injectParameters('print 1', [
      { name: 'S', type: 'string', value: 'x\ny' },
      { name: 'E', type: 'enum', values: ['High', 'Low'], value: 'Low' },
      { name: 'I', type: 'int', value: -5 },
      { name: 'L', type: 'long', value: '9223372036854775807' },
      { name: 'R', type: 'real', value: 0.25 },
      { name: 'Rn', type: 'real', value: 'nan' },
      { name: 'B', type: 'bool', value: true },
      { name: 'D', type: 'datetime', value: '2026-01-31T12:00:00.123Z' },
      { name: 'T', type: 'timespan', value: '1.5d' },
      { name: 'T2', type: 'timespan', value: '01:30:00' },
      { name: 'J', type: 'dynamic', value: { a: ['b"c', 1, null] } },
      { name: 'SL', type: 'stringList', value: ['alice@contoso.com', 'o"brien'] },
      { name: 'Empty', type: 'stringList', value: [] },
    ]);
    expect(syntaxDiagnostics(query)).toEqual([]);
  });

  it('refuses values that do not fit their type', () => {
    expect(() =>
      injectParameters(body, [{ name: 'MinFailures', type: 'long', value: '1; print 2' }]),
    ).toThrow(ParameterValueError);
    expect(() =>
      injectParameters(body, [{ name: 'T', type: 'timespan', value: '1d) | take 1 //' }]),
    ).toThrow(ParameterValueError);
  });

  it('leaves queries without parameters alone', () => {
    expect(injectParameters(body, [])).toBe(body);
  });
});

describe('withParameters', () => {
  const request = {
    tabId: 'q1',
    query: 'let N = 1;\nHeartbeat | take N',
    resourceIds: ['/subscriptions/00000000-0000-0000-0000-000000000001/x'],
  };

  it('injects the values and drops the parameters from the engine request', () => {
    expect(
      withParameters({ ...request, parameters: [{ name: 'N', type: 'int', value: 5 }] }),
    ).toEqual({
      ...request,
      query: 'let N = int(5);\nHeartbeat | take N',
    });
    expect(withParameters(request)).toEqual(request);
  });

  it('refuses invalid values with a user-facing error', () => {
    expect(() =>
      withParameters({ ...request, parameters: [{ name: 'N', type: 'int', value: 'x' }] }),
    ).toThrow(expect.objectContaining({ code: 'PARAMETER_INVALID' }) as Error);
  });
});
