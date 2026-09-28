import type { ColorTheme } from '../../../shared/theme/theme-schema';

import darkModern from './builtin/default-dark-modern.json';
import highContrastLight from './builtin/default-high-contrast-light.json';
import highContrast from './builtin/default-high-contrast.json';
import lightModern from './builtin/default-light-modern.json';
import ramlDark from './builtin/raml-dark.json';
import ramlLight from './builtin/raml-light.json';

/**
 * The themes that ship with the app: the Raml brand themes (scripts/build-raml-themes.mjs) and
 * VS Code's defaults (scripts/import-vscode-themes.mjs).
 */
export const BUILTIN_THEMES: readonly ColorTheme[] = [
  ramlDark,
  ramlLight,
  darkModern,
  lightModern,
  highContrast,
  highContrastLight,
].map((theme) => ({
  id: theme.id,
  label: theme.label,
  uiTheme: theme.uiTheme as ColorTheme['uiTheme'],
  colors: theme.colors,
  tokenColors: theme.tokenColors,
}));

export const DEFAULT_DARK_THEME = 'Raml Dark';
export const DEFAULT_LIGHT_THEME = 'Raml Light';
