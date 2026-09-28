import type { SettingValues } from '../../../shared/settings/registry';
import type { ColorTheme } from '../../../shared/theme/theme-schema';

import { DEFAULT_DARK_THEME } from './builtin-themes';

export interface OsAppearance {
  dark: boolean;
  highContrast: boolean;
}

type ThemeSettings = Pick<
  SettingValues,
  | 'workbench.colorTheme'
  | 'window.autoDetectColorScheme'
  | 'workbench.preferredDarkColorTheme'
  | 'workbench.preferredLightColorTheme'
  | 'window.autoDetectHighContrast'
  | 'workbench.preferredHighContrastColorTheme'
  | 'workbench.preferredHighContrastLightColorTheme'
>;

/** Which theme label the settings ask for, given the OS appearance (VS Code's rules). */
export function selectThemeLabel(settings: ThemeSettings, os: OsAppearance): string {
  if (settings['window.autoDetectHighContrast'] && os.highContrast) {
    return os.dark
      ? settings['workbench.preferredHighContrastColorTheme']
      : settings['workbench.preferredHighContrastLightColorTheme'];
  }
  if (settings['window.autoDetectColorScheme']) {
    return os.dark
      ? settings['workbench.preferredDarkColorTheme']
      : settings['workbench.preferredLightColorTheme'];
  }
  return settings['workbench.colorTheme'];
}

/** Find a theme by label, falling back to the default dark theme (then to the first theme). */
export function findTheme(themes: readonly ColorTheme[], label: string): ColorTheme {
  const found =
    themes.find((theme) => theme.label === label) ??
    themes.find((theme) => theme.label === DEFAULT_DARK_THEME) ??
    themes[0];
  if (found === undefined) throw new Error('No colour themes available');
  return found;
}
