import type { BrowserWindowConstructorOptions } from 'electron';

/** Height of the workbench title bar, as in VS Code. Keep in sync with the renderer CSS. */
export const TITLE_BAR_HEIGHT = 35;

/**
 * macOS: inset traffic lights over our own title bar (spec 05).
 * Windows/Linux: frameless, with the OS-drawn window controls overlaid on our title bar
 * (keeps native behaviour such as Windows 11 snap layouts); the renderer recolours them to
 * match the theme via `window.setTitleBarOverlay`.
 */
export function titleBarOptions(
  platform: NodeJS.Platform,
  colors: { color: string; symbolColor: string },
): BrowserWindowConstructorOptions {
  if (platform === 'darwin') {
    return { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 12, y: 11 } };
  }
  return {
    titleBarStyle: 'hidden',
    titleBarOverlay: { ...colors, height: TITLE_BAR_HEIGHT },
  };
}
