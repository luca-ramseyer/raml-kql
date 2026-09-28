import type { Parameter } from '@raml-kql/pack-schema/schemas';
import { describe, expect, it } from 'vitest';

import { bindParameters, initialParameters, inputFor, parseInput } from './parameters';

const p = (parameter: Partial<Parameter> & Pick<Parameter, 'name' | 'type'>): Parameter =>
  parameter;

describe('parameter inputs', () => {
  it('start from the defaults', () => {
    expect(inputFor(p({ name: 'N', type: 'long', default: 10 }))).toBe('10');
    expect(inputFor(p({ name: 'B', type: 'bool' }))).toBe('false');
    expect(inputFor(p({ name: 'L', type: 'stringList', default: ['High', 'Medium'] }))).toBe(
      'High, Medium',
    );
    expect(inputFor(p({ name: 'L', type: 'stringList', default: ['a,b', 'c'] }))).toBe(
      '["a,b","c"]',
    );
    expect(inputFor(p({ name: 'J', type: 'dynamic', default: { a: 1 } }))).toBe('{"a":1}');
    expect(inputFor(p({ name: 'S', type: 'string' }))).toBe('');
  });

  it('parse and check values by type', () => {
    expect(parseInput(p({ name: 'N', type: 'long' }), ' 25 ')).toEqual({ value: 25 });
    expect(parseInput(p({ name: 'N', type: 'long' }), '9223372036854775807')).toEqual({
      value: '9223372036854775807',
    });
    expect(parseInput(p({ name: 'N', type: 'long' }), '1.5')).toEqual({
      error: 'Enter a whole number.',
    });
    expect(parseInput(p({ name: 'I', type: 'int' }), '99999999999')).toMatchObject({
      error: expect.stringMatching(/32-bit/) as string,
    });
    expect(parseInput(p({ name: 'R', type: 'real' }), '0.5')).toEqual({ value: 0.5 });
    expect(parseInput(p({ name: 'S', type: 'string' }), ' keep spaces ')).toEqual({
      value: ' keep spaces ',
    });
    expect(parseInput(p({ name: 'E', type: 'enum', values: ['A'] }), 'B')).toMatchObject({
      error: expect.stringMatching(/one of A/) as string,
    });
    expect(parseInput(p({ name: 'L', type: 'stringList' }), 'a, b,,c ')).toEqual({
      value: ['a', 'b', 'c'],
    });
    expect(parseInput(p({ name: 'L', type: 'stringList' }), '["a,b"]')).toEqual({ value: ['a,b'] });
    expect(parseInput(p({ name: 'J', type: 'dynamic' }), '{bad')).toMatchObject({
      error: expect.any(String) as string,
    });
    expect(parseInput(p({ name: 'T', type: 'timespan' }), '4h')).toEqual({ value: '4h' });
    expect(parseInput(p({ name: 'D', type: 'datetime' }), 'yesterday')).toMatchObject({
      error: expect.stringMatching(/ISO 8601/) as string,
    });
    expect(parseInput(p({ name: 'B', type: 'bool' }), 'true')).toEqual({ value: true });
  });

  it('bind all parameters or report the first problem', () => {
    const parameters = initialParameters([
      p({ name: 'MinFailures', type: 'long', default: 10 }),
      p({ name: 'Levels', type: 'enum', values: ['High', 'Low'], default: 'High' }),
    ]);
    expect(bindParameters(parameters)).toEqual({
      parameters: [
        { name: 'MinFailures', type: 'long', value: 10 },
        { name: 'Levels', type: 'enum', values: ['High', 'Low'], value: 'High' },
      ],
    });
    expect(
      bindParameters({ ...parameters, inputs: { ...parameters.inputs, MinFailures: 'x' } }),
    ).toEqual({
      error: 'Enter a whole number.',
      name: 'MinFailures',
    });
  });
});
