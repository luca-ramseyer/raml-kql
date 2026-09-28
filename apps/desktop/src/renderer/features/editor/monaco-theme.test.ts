import { describe, expect, it } from 'vitest';

import { BUILTIN_THEMES } from '../../platform/theme/builtin-themes';

import { scopeForeground, toMonacoTheme } from './monaco-theme';

describe('scopeForeground', () => {
  const rules = [
    { scope: 'keyword', settings: { foreground: '#111111' } },
    { scope: ['keyword.control', 'storage'], settings: { foreground: '#222222' } },
    { scope: 'string, constant', settings: { foreground: '#333333' } },
    { scope: 'meta.embedded keyword', settings: { foreground: '#444444' } },
    { scope: 'variable', settings: { foreground: 'red' } },
  ];

  it('picks the most specific matching rule', () => {
    expect(scopeForeground(rules, 'keyword')).toBe('#111111');
    expect(scopeForeground(rules, 'keyword.control.flow')).toBe('#222222');
    expect(scopeForeground(rules, 'constant.numeric')).toBe('#333333');
  });

  it('ignores descendant selectors, non-hex colours and unknown scopes', () => {
    expect(scopeForeground(rules, 'variable')).toBeUndefined();
    expect(scopeForeground(rules, 'entity.name.function')).toBeUndefined();
    expect(scopeForeground([null, 'x', {}], 'keyword')).toBeUndefined();
    expect(
      scopeForeground([{ scope: 42, settings: { foreground: '#123456' } }], 'keyword'),
    ).toBeUndefined();
  });
});

describe('toMonacoTheme', () => {
  it.each(BUILTIN_THEMES.map((theme) => [theme.label, theme] as const))(
    '%s maps to a Monaco theme with editor colours and KQL token rules',
    (_label, theme) => {
      const monacoTheme = toMonacoTheme(theme);
      expect(monacoTheme.inherit).toBe(true);
      expect(monacoTheme.colors['editor.background']).toMatch(/^#[0-9a-f]{6,8}$/i);
      for (const color of Object.values(monacoTheme.colors)) {
        expect(color).toMatch(/^#[0-9a-f]{3,8}$/i);
      }
      const tokens = monacoTheme.rules.map((rule) => rule.token);
      expect(tokens).toEqual(expect.arrayContaining(['comment', 'stringLiteral', 'keyword']));
      for (const rule of monacoTheme.rules) expect(rule.foreground).toMatch(/^[0-9a-f]{3,8}$/i);
    },
  );

  it('uses the base theme matching the UI theme', () => {
    const bases = new Set(BUILTIN_THEMES.map((theme) => toMonacoTheme(theme).base));
    expect(bases).toEqual(new Set(['vs', 'vs-dark', 'hc-black', 'hc-light']));
  });
});
