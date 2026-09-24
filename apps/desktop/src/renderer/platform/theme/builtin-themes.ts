import type { ColorTheme } from '../../../shared/theme/theme-schema';

import darkModern from './builtin/default-dark-modern.json';
import highContrastLight from './builtin/default-high-contrast-light.json';
import highContrast from './builtin/default-high-contrast.json';
import lightModern from './builtin/default-light-modern.json';

/** The themes that ship with the app, ported from VS Code (see scripts/import-vscode-themes.mjs). */
export const BUILTIN_THEMES: readonly ColorTheme[] = [
  darkModern,
  lightModern,
  highContrast,
  highContrastLight,
].map((theme) => ({
  id: theme.id,
  label: theme.label,
  uiTheme: theme.uiTheme as ColorTheme['uiTheme'],
  colors: theme.colors,
  tokenColors: theme.tokenColors as unknown[],
}));

export const DEFAULT_DARK_THEME = 'Default Dark Modern';
