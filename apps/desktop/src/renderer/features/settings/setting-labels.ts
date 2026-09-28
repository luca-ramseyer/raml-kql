/** "colorTheme" → "Color Theme", "autoDetectColorScheme" → "Auto Detect Color Scheme". */
export function humanize(segment: string): string {
  return segment
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .split(' ')
    .filter((word) => word !== '')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * VS Code's setting titles: all but the last key segment become the category prefix.
 * `workbench.statusBar.visible` → { category: "Workbench › Status Bar", label: "Visible" }.
 */
export function settingTitle(key: string): { category: string; label: string } {
  const segments = key.split('.');
  const last = segments.pop() ?? key;
  return { category: segments.map(humanize).join(' › '), label: humanize(last) };
}

/**
 * Split a description into text and `code` parts (settings descriptions use backticks for
 * setting keys and values).
 */
export function descriptionParts(text: string): { text: string; code: boolean }[] {
  return text
    .split(/(`[^`]*`)/)
    .filter((part) => part !== '')
    .map((part) =>
      part.startsWith('`') && part.endsWith('`') && part.length >= 2
        ? { text: part.slice(1, -1), code: true }
        : { text: part, code: false },
    );
}
