import { describe, expect, it } from 'vitest';

import { ColorThemeSchema, isValidColorKey, sanitizeColors, uiThemeFromType } from './theme-schema';

describe('theme schema', () => {
  it('keeps only well-formed colour entries (values end up in CSS)', () => {
    expect(
      sanitizeColors({
        'editor.background': '#1e1e1e',
        foreground: '#FFF',
        'tab.border': '#00000080',
        'bad key': '#000000',
        'editor.foreground': 'red',
        'x.y': '#1234567',
        injected: '#000; background: url(https://evil.example)',
        number: 5,
      }),
    ).toEqual({ 'editor.background': '#1e1e1e', foreground: '#FFF', 'tab.border': '#00000080' });
  });

  it('validates colour keys', () => {
    expect(isValidColorKey('statusBarItem.remoteBackground')).toBe(true);
    expect(isValidColorKey('a..b')).toBe(false);
    expect(isValidColorKey('--x')).toBe(false);
  });

  it('maps VS Code theme types', () => {
    expect(uiThemeFromType('dark')).toBe('vs-dark');
    expect(uiThemeFromType('light')).toBe('vs');
    expect(uiThemeFromType('hc')).toBe('hc-black');
    expect(uiThemeFromType('hcLight')).toBe('hc-light');
    expect(uiThemeFromType('weird')).toBeUndefined();
  });

  it('sanitises colours when parsing', () => {
    const theme = ColorThemeSchema.parse({
      id: 'x',
      label: 'X',
      uiTheme: 'vs',
      colors: { ok: '#fff', bad: 'nope' },
    });
    expect(theme.colors).toEqual({ ok: '#fff' });
    expect(theme.tokenColors).toEqual([]);
  });
});
