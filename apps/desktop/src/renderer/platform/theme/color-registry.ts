import type { UiTheme } from '../../../shared/theme/theme-schema';

import { Color } from './color';
import registryJson from './vscode-color-defaults.json';

/**
 * Resolves every workbench colour for a theme: the theme's own value if it sets one,
 * otherwise VS Code's registered default for the theme's base (dark, light, hcDark, hcLight),
 * evaluated with VS Code's transforms. Mirrors `ColorThemeData.getColor` in VS Code.
 */

export type ColorVariant = 'dark' | 'light' | 'hcDark' | 'hcLight';

export type ColorExpression =
  string | null | { ref: string } | { fn: string; args: (ColorExpression | number)[] };

type ColorDefaults = Record<string, Record<ColorVariant, ColorExpression>>;
const REGISTRY_DEFAULTS = (registryJson as unknown as { defaults: ColorDefaults }).defaults;

export function variantOf(uiTheme: UiTheme): ColorVariant {
  switch (uiTheme) {
    case 'vs':
      return 'light';
    case 'vs-dark':
      return 'dark';
    case 'hc-black':
      return 'hcDark';
    case 'hc-light':
      return 'hcLight';
  }
}

export interface ThemeColorsInput {
  uiTheme: UiTheme;
  colors: Readonly<Record<string, string>>;
}

export class ColorResolver {
  private readonly cache = new Map<string, Color | undefined>();
  private readonly resolving = new Set<string>();
  private readonly variant: ColorVariant;

  constructor(
    private readonly theme: ThemeColorsInput,
    private readonly defaults: ColorDefaults = REGISTRY_DEFAULTS,
  ) {
    this.variant = variantOf(theme.uiTheme);
  }

  /** The theme defines this key itself (VS Code's `theme.defines`). */
  defines(key: string): boolean {
    return Object.hasOwn(this.theme.colors, key);
  }

  getColor(key: string): Color | undefined {
    if (this.cache.has(key)) return this.cache.get(key);
    if (this.resolving.has(key)) return undefined; // a cycle in the defaults: give up quietly
    this.resolving.add(key);
    let color: Color | undefined;
    const own = this.theme.colors[key];
    if (own !== undefined) {
      color = Color.fromHex(own);
    } else {
      const expression = this.defaults[key]?.[this.variant];
      color = expression === undefined ? undefined : this.evaluate(expression);
    }
    this.resolving.delete(key);
    this.cache.set(key, color);
    return color;
  }

  private evaluate(expression: ColorExpression | number): Color | undefined {
    if (expression === null || typeof expression === 'number') return undefined;
    if (typeof expression === 'string') {
      return expression.startsWith('#') ? Color.fromHex(expression) : this.getColor(expression);
    }
    if ('ref' in expression) return this.getColor(expression.ref);

    const [a, b, c, d] = expression.args;
    const num = (value: ColorExpression | number | undefined): number =>
      typeof value === 'number' ? value : 0;
    switch (expression.fn) {
      case 'transparent':
        return this.evaluate(a ?? null)?.transparent(num(b));
      case 'darken':
        return this.evaluate(a ?? null)?.darken(num(b));
      case 'lighten':
        return this.evaluate(a ?? null)?.lighten(num(b));
      case 'opaque': {
        const background = this.evaluate(b ?? null);
        const value = this.evaluate(a ?? null);
        return background === undefined ? value : value?.makeOpaque(background);
      }
      case 'oneOf':
        for (const candidate of expression.args) {
          const color = this.evaluate(candidate);
          if (color !== undefined) return color;
        }
        return undefined;
      case 'ifDefinedThenElse': {
        const ifKey = typeof a === 'object' && a !== null && 'ref' in a ? a.ref : a;
        return this.evaluate(
          typeof ifKey === 'string' && this.defines(ifKey) ? (b ?? null) : (c ?? null),
        );
      }
      case 'lessProminent': {
        const from = this.evaluate(a ?? null);
        if (from === undefined) return undefined;
        const background = this.evaluate(b ?? null);
        const factor = num(c);
        const transparency = num(d);
        if (background === undefined) return from.transparent(factor * transparency);
        return from.isDarkerThan(background)
          ? Color.getLighterColor(from, background, factor).transparent(transparency)
          : Color.getDarkerColor(from, background, factor).transparent(transparency);
      }
      case 'mix': {
        const primary = this.evaluate(a ?? null) ?? Color.transparentBlack;
        const other = this.evaluate(b ?? null) ?? Color.transparentBlack;
        return primary.mix(other, num(c));
      }
      default:
        return undefined;
    }
  }

  /** Every resolvable colour: registry keys plus any extra keys the theme sets. */
  resolveAll(): Record<string, string> {
    const keys = new Set([...Object.keys(this.defaults), ...Object.keys(this.theme.colors)]);
    const result: Record<string, string> = {};
    for (const key of keys) {
      const color = this.getColor(key);
      if (color !== undefined) result[key] = color.toString();
    }
    return result;
  }
}

/** `editor.background` → `--vscode-editor-background` (VS Code's naming). */
export function cssVariableName(key: string): string {
  return `--vscode-${key.replace(/\./g, '-')}`;
}
