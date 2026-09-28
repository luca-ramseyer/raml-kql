import { create } from 'zustand';

import type { UserThemesSnapshot } from '../../../shared/config/config-snapshots';
import type { ColorTheme } from '../../../shared/theme/theme-schema';
import { getBridge } from '../../services/ipc';
import { notify } from '../notifications';
import { useSettings } from '../settings';

import { BUILTIN_THEMES, DEFAULT_DARK_THEME } from './builtin-themes';
import { Color } from './color';
import { ColorResolver, cssVariableName } from './color-registry';
import { findTheme, selectThemeLabel, type OsAppearance } from './theme-selection';

interface ThemeState {
  userThemes: ColorTheme[];
  os: OsAppearance;
  /** A theme shown temporarily while browsing the theme picker. */
  previewLabel: string | undefined;
  active: ColorTheme;
}

export const useTheme = create<ThemeState>(() => ({
  userThemes: [],
  os: { dark: true, highContrast: false },
  previewLabel: undefined,
  active: findTheme(BUILTIN_THEMES, DEFAULT_DARK_THEME),
}));

export function allThemes(): ColorTheme[] {
  return [...BUILTIN_THEMES, ...useTheme.getState().userThemes];
}

/** The theme the current settings and OS appearance select. */
export function configuredThemeLabel(): string {
  return selectThemeLabel(useSettings.getState().values, useTheme.getState().os);
}

/** Show a theme temporarily (theme picker preview); `undefined` ends the preview. */
export function previewTheme(label: string | undefined): void {
  useTheme.setState({ previewLabel: label });
  refreshTheme();
}

export function setUserThemes(snapshot: UserThemesSnapshot): void {
  useTheme.setState({ userThemes: snapshot.themes });
  const [first] = snapshot.problems;
  if (first !== undefined) {
    notify({
      key: 'theme-problems',
      severity: 'warning',
      message: `Could not load colour theme ${first.file}: ${first.message}`,
    });
  }
  refreshTheme();
}

let appliedVariables: string[] = [];
let lastThemeKey = '';

/** Re-evaluate which theme should be active and apply it if it changed. */
export function refreshTheme(): void {
  const state = useTheme.getState();
  const label = state.previewLabel ?? configuredThemeLabel();
  const theme = findTheme(allThemes(), label);
  const key = JSON.stringify([theme.id, theme.colors]);
  if (key === lastThemeKey) return;
  lastThemeKey = key;
  useTheme.setState({ active: theme });
  applyTheme(theme);
}

/** Write the theme as CSS variables on :root, plus VS Code's base-theme classes on <body>. */
export function applyTheme(theme: ColorTheme, root: HTMLElement = document.documentElement): void {
  const colors = new ColorResolver(theme).resolveAll();
  for (const name of appliedVariables) root.style.removeProperty(name);
  appliedVariables = [];
  for (const [key, value] of Object.entries(colors)) {
    const name = cssVariableName(key);
    root.style.setProperty(name, value);
    appliedVariables.push(name);
  }

  const body = root.ownerDocument.body;
  body.classList.remove('vs', 'vs-dark', 'hc-black', 'hc-light');
  body.classList.add(theme.uiTheme);
  const dark = theme.uiTheme === 'vs-dark' || theme.uiTheme === 'hc-black';
  root.style.colorScheme = dark ? 'dark' : 'light';
  root.dataset['theme'] = theme.id;

  // Native window controls (Windows/Linux) must match the title bar.
  const background =
    Color.fromHex(colors['editor.background'] ?? '#1f1f1f') ?? Color.fromHex('#1f1f1f');
  const opaque = (value: string | undefined, fallback: string): string => {
    const color = Color.fromHex(value ?? fallback) ?? Color.fromHex(fallback);
    return (
      (background === undefined ? color : color?.makeOpaque(background))?.toString().slice(0, 7) ??
      fallback
    );
  };
  void getBridge()
    .window.setTitleBarOverlay({
      color: opaque(colors['titleBar.activeBackground'], '#181818'),
      symbolColor: opaque(colors['titleBar.activeForeground'], '#cccccc'),
    })
    .catch(() => undefined);
}

/** Track the OS dark/light and high-contrast appearance. Returns a function that stops. */
export function watchOsAppearance(): () => void {
  const dark = window.matchMedia('(prefers-color-scheme: dark)');
  const contrast = window.matchMedia('(forced-colors: active), (prefers-contrast: more)');
  const update = (): void => {
    useTheme.setState({ os: { dark: dark.matches, highContrast: contrast.matches } });
    refreshTheme();
  };
  dark.addEventListener('change', update);
  contrast.addEventListener('change', update);
  update();
  return () => {
    dark.removeEventListener('change', update);
    contrast.removeEventListener('change', update);
  };
}
