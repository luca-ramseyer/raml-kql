import { createScanner, parse } from 'jsonc-parser';
import { describe, expect, it } from 'vitest';

import { removeTopLevelProperty, setTopLevelProperty, Tok } from './jsonc-edit';

describe('removeTopLevelProperty', () => {
  it('removes the first property but keeps every comment', () => {
    const text = `{
  // my favourite
  "a": 1,
  /* keep */ "b": 2,
}
`;
    const result = removeTopLevelProperty(text, 'a');
    expect(result).toBe(`{
  // my favourite
  /* keep */ "b": 2,
}
`);
  });

  it('removes the last property and the comma before it', () => {
    const text = '{\n  "a": 1,\n  // about b\n  "b": 2\n}\n';
    const result = removeTopLevelProperty(text, 'b');
    expect(result).toBe('{\n  "a": 1\n  // about b\n}\n');
    expect(parse(result)).toEqual({ a: 1 });
  });

  it('removes a middle property on a shared line without breaking JSON', () => {
    const text = '{ "a": 1, "b": 2, "c": 3 }';
    const result = removeTopLevelProperty(text, 'b');
    expect(parse(result)).toEqual({ a: 1, c: 3 });
  });

  it('handles the only property and trailing commas', () => {
    expect(parse(removeTopLevelProperty('{\n  "a": 1,\n}\n', 'a'))).toEqual({});
    expect(parse(removeTopLevelProperty('{ "a": 1 }', 'a'))).toEqual({});
  });

  it('leaves the text unchanged when the key is absent', () => {
    expect(removeTopLevelProperty('{ "a": 1 }', 'zzz')).toBe('{ "a": 1 }');
  });
});

describe('setTopLevelProperty', () => {
  it('replaces a value in place and keeps comments', () => {
    const text = '{\n  // theme\n  "a": "x", // trailing\n}\n';
    expect(setTopLevelProperty(text, 'a', 'y')).toBe('{\n  // theme\n  "a": "y", // trailing\n}\n');
  });

  it('adds new properties', () => {
    const result = setTopLevelProperty('{\n  // hi\n}\n', 'b', true);
    expect(result).toContain('// hi');
    expect(parse(result)).toEqual({ b: true });
  });
});

describe('Tok', () => {
  it('mirrors jsonc-parser token kinds', () => {
    const kinds: number[] = [];
    const scanner = createScanner(',// c\n/* b */ ', false);
    for (let kind: number = scanner.scan(); kind !== Tok.EOF; kind = scanner.scan())
      kinds.push(kind);
    expect(kinds).toEqual([
      Tok.Comma,
      Tok.LineComment,
      Tok.LineBreak,
      Tok.BlockComment,
      Tok.Trivia,
    ]);
  });
});
