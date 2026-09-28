import { describe, expect, it } from 'vitest';

import { defaultSettingValues } from '../../../shared/settings/registry';

import { BUILTIN_THEMES } from './builtin-themes';
import { findTheme, selectThemeLabel } from './theme-selection';

describe('selectThemeLabel', () => {
  const defaults = defaultSettingValues();

  it('follows the OS by default', () => {
    expect(selectThemeLabel(defaults, { dark: true, highContrast: false })).toBe(
      'Default Dark Modern',
    );
    expect(selectThemeLabel(defaults, { dark: false, highContrast: false })).toBe(
      'Default Light Modern',
    );
  });

  it('switches to high contrast when the OS asks for it', () => {
    expect(selectThemeLabel(defaults, { dark: true, highContrast: true })).toBe(
      'Default High Contrast',
    );
    expect(selectThemeLabel(defaults, { dark: false, highContrast: true })).toBe(
      'Default High Contrast Light',
    );
  });

  it('uses workbench.colorTheme when auto-detection is off', () => {
    const settings = {
      ...defaults,
      'window.autoDetectColorScheme': false,
      'window.autoDetectHighContrast': false,
      'workbench.colorTheme': 'Default Light Modern',
    };
    expect(selectThemeLabel(settings, { dark: true, highContrast: true })).toBe(
      'Default Light Modern',
    );
  });
});

describe('findTheme', () => {
  it('finds by label and falls back to Default Dark Modern', () => {
    expect(findTheme(BUILTIN_THEMES, 'Default Light Modern').id).toBe('default-light-modern');
    expect(findTheme(BUILTIN_THEMES, 'Not Installed').id).toBe('default-dark-modern');
  });
});
