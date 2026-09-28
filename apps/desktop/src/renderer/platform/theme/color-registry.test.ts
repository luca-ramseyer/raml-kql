import { describe, expect, it } from 'vitest';

import { BUILTIN_THEMES } from './builtin-themes';
import { ColorResolver, cssVariableName, variantOf } from './color-registry';

const theme = (label: string) => {
  const found = BUILTIN_THEMES.find((t) => t.label === label);
  if (found === undefined) throw new Error(label);
  return found;
};

describe('ColorResolver', () => {
  it('uses the theme’s own colours first', () => {
    const resolver = new ColorResolver(theme('Default Dark Modern'));
    expect(resolver.getColor('editor.background')?.toString()).toBe('#1f1f1f');
    expect(resolver.getColor('statusBar.background')?.toString()).toBe('#181818');
  });

  it('falls back to VS Code’s registry defaults, with transforms', () => {
    const resolver = new ColorResolver({ uiTheme: 'vs-dark', colors: { foreground: '#cccccc' } });
    // descriptionForeground = transparent(foreground, 0.7) in dark themes
    expect(resolver.getColor('descriptionForeground')?.toString()).toBe('#ccccccb3');
  });

  it('high contrast themes get contrast borders from the defaults', () => {
    const resolver = new ColorResolver(theme('Default High Contrast'));
    expect(resolver.getColor('contrastBorder')?.toString()).toBe('#6fc3df');
    expect(resolver.getColor('tab.border')?.toString()).toBe('#6fc3df');
    expect(resolver.getColor('focusBorder')?.toString()).toBe('#f38518');
  });

  it('resolves the colours every workbench part uses, for all built-in themes', () => {
    const required = [
      'foreground',
      'focusBorder',
      'titleBar.activeBackground',
      'titleBar.activeForeground',
      'activityBar.background',
      'activityBar.foreground',
      'sideBar.background',
      'editor.background',
      'tab.activeBackground',
      'panel.background',
      'panel.border',
      'statusBar.background',
      'statusBar.foreground',
      'quickInput.background',
      'quickInputList.focusBackground',
      'input.background',
      'button.background',
      'notifications.background',
      'menu.background',
      'keybindingLabel.background',
      'settings.modifiedItemIndicator',
    ];
    // High contrast leaves these unset on purpose (it uses contrast borders and outlines
    // instead); the CSS falls back to transparent for them.
    const unsetInHighContrast = new Set(['statusBar.background', 'quickInputList.focusBackground']);
    for (const t of BUILTIN_THEMES) {
      const colors = new ColorResolver(t).resolveAll();
      for (const key of required) {
        if (t.uiTheme.startsWith('hc') && unsetInHighContrast.has(key)) {
          expect(colors[key], `${t.label}: ${key}`).toBeUndefined();
          continue;
        }
        expect(colors[key], `${t.label}: ${key}`).toMatch(/^#[0-9a-f]{6}([0-9a-f]{2})?$/);
      }
    }
  });

  it('evaluates ifDefinedThenElse against the theme', () => {
    const defaults = {
      a: {
        dark: { fn: 'ifDefinedThenElse', args: [{ ref: 'b' }, '#111111', '#222222'] },
        light: null,
        hcDark: null,
        hcLight: null,
      },
      b: { dark: '#333333', light: null, hcDark: null, hcLight: null },
    } as const;
    const withB = new ColorResolver(
      { uiTheme: 'vs-dark', colors: { b: '#444444' } },
      defaults as never,
    );
    const withoutB = new ColorResolver({ uiTheme: 'vs-dark', colors: {} }, defaults as never);
    expect(withB.getColor('a')?.toString()).toBe('#111111');
    expect(withoutB.getColor('a')?.toString()).toBe('#222222');
  });

  it('survives reference cycles', () => {
    const defaults = {
      a: { dark: { ref: 'b' }, light: null, hcDark: null, hcLight: null },
      b: { dark: { ref: 'a' }, light: null, hcDark: null, hcLight: null },
    };
    const resolver = new ColorResolver({ uiTheme: 'vs-dark', colors: {} }, defaults);
    expect(resolver.getColor('a')).toBeUndefined();
  });

  it('names CSS variables like VS Code', () => {
    expect(cssVariableName('statusBarItem.remoteBackground')).toBe(
      '--vscode-statusBarItem-remoteBackground',
    );
    expect(variantOf('hc-light')).toBe('hcLight');
  });
});
