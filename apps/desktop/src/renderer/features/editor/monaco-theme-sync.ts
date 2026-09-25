import { useTheme } from '../../platform/theme/theme-service';

import type { LoadedMonaco } from './monaco-loader';
import { MONACO_THEME_NAME, toMonacoTheme } from './monaco-theme';

let themeSynced = false;

/** Keep Monaco's theme in step with the workbench theme (tokenColors → Monaco rules). */
export function syncTheme({ monaco }: LoadedMonaco): void {
  const apply = (): void => {
    monaco.editor.defineTheme(MONACO_THEME_NAME, toMonacoTheme(useTheme.getState().active));
    monaco.editor.setTheme(MONACO_THEME_NAME);
  };
  apply();
  if (themeSynced) return;
  themeSynced = true;
  useTheme.subscribe((state, previous) => {
    if (state.active !== previous.active) apply();
  });
}
