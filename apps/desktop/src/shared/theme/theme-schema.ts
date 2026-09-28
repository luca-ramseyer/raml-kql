import { z } from 'zod';

/**
 * Colour themes use VS Code's colour theme JSON format (spec 05), so any VS Code theme can be
 * dropped into `<config>/themes/`. Themes may come from users and, later, from extensions, so
 * everything that ends up in CSS is validated here: colour keys must look like `a.b.c` and
 * values must be hex colours. Anything else is dropped.
 */

/** VS Code's base themes. */
export const UiThemeSchema = z.enum(['vs', 'vs-dark', 'hc-black', 'hc-light']);
export type UiTheme = z.infer<typeof UiThemeSchema>;

const COLOR_KEY = /^[A-Za-z][A-Za-z0-9]*(\.[A-Za-z][A-Za-z0-9]*)*$/;
const HEX_COLOR = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

export function isValidColorKey(key: string): boolean {
  return key.length <= 100 && COLOR_KEY.test(key);
}

export function isValidHexColor(value: string): boolean {
  return HEX_COLOR.test(value);
}

/** Keep only well-formed `key: #hex` entries. */
export function sanitizeColors(colors: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(colors)) {
    if (typeof value === 'string' && isValidColorKey(key) && isValidHexColor(value)) {
      result[key] = value;
    }
  }
  return result;
}

/** A theme after `include` resolution, ready for the renderer. */
export const ColorThemeSchema = z.object({
  /** Stable id: builtin ids are fixed; user themes use `user:<file name>`. */
  id: z.string().min(1).max(300),
  /** Display name; this is what `workbench.colorTheme` stores. */
  label: z.string().min(1).max(200),
  uiTheme: UiThemeSchema,
  colors: z.record(z.string(), z.string()).transform(sanitizeColors),
  /** TextMate token rules, used by the editor from Phase 4. Kept opaque here. */
  tokenColors: z.array(z.unknown()).max(5000).default([]),
});
export type ColorTheme = z.output<typeof ColorThemeSchema>;

/** Map VS Code's `type` field (in user theme files) to a base theme. */
export function uiThemeFromType(type: unknown): UiTheme | undefined {
  switch (type) {
    case 'dark':
      return 'vs-dark';
    case 'light':
      return 'vs';
    case 'hc':
    case 'hcDark':
    case 'hc-black':
      return 'hc-black';
    case 'hcLight':
    case 'hc-light':
      return 'hc-light';
    default:
      return undefined;
  }
}
