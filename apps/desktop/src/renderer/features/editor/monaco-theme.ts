import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api.js';

import type { ColorTheme } from '../../../shared/theme/theme-schema';
import { ColorResolver } from '../../platform/theme/color-registry';

/**
 * Build a Monaco theme from the active VS Code colour theme: editor colours from the resolved
 * workbench colours, and KQL token colours from the theme's TextMate rules, so KQL looks
 * right in any VS Code theme (including high contrast and user themes).
 */

/** monaco-kusto semantic token → TextMate scopes to look up (first match wins). */
const TOKEN_SCOPES: Record<string, string[]> = {
  comment: ['comment'],
  stringLiteral: ['string'],
  literal: ['constant.numeric', 'constant'],
  keyword: ['keyword', 'storage'],
  queryOperator: ['keyword.control', 'keyword'],
  command: ['keyword.control', 'keyword'],
  function: ['entity.name.function', 'support.function'],
  type: ['storage.type', 'support.type', 'entity.name.type'],
  table: ['entity.name.type', 'support.class', 'entity.name.class'],
  database: ['entity.name.type', 'support.class'],
  materializedView: ['entity.name.type', 'support.class'],
  column: ['variable.other.property', 'variable'],
  variable: ['variable'],
  parameter: ['variable.parameter', 'variable'],
  scalarParameter: ['variable.parameter', 'variable'],
  queryParameter: ['variable.parameter', 'variable'],
  clientParameter: ['variable.parameter', 'variable'],
  directive: ['keyword.control.directive', 'meta.preprocessor', 'keyword'],
};

interface TokenColorRule {
  scope?: unknown;
  settings?: { foreground?: string; fontStyle?: string };
}

/** Foreground for a TextMate scope: the most specific rule whose scope prefixes it. */
export function scopeForeground(
  tokenColors: readonly unknown[],
  scope: string,
): string | undefined {
  let best: { length: number; color: string } | undefined;
  for (const raw of tokenColors) {
    // User themes are not validated beyond "an array": skip anything that isn't a rule.
    if (typeof raw !== 'object' || raw === null) continue;
    const rule = raw as TokenColorRule;
    const color = rule.settings?.foreground;
    if (color === undefined || !/^#[0-9a-f]{3,8}$/i.test(color)) continue;
    const scopes =
      typeof rule.scope === 'string'
        ? rule.scope.split(',')
        : Array.isArray(rule.scope)
          ? rule.scope.filter((s): s is string => typeof s === 'string')
          : [];
    for (const candidate of scopes.map((s) => s.trim())) {
      if (candidate === '' || candidate.includes(' ')) continue; // ignore descendant selectors
      if (scope === candidate || scope.startsWith(`${candidate}.`)) {
        if (best === undefined || candidate.length >= best.length)
          best = { length: candidate.length, color };
      }
    }
  }
  return best?.color;
}

const BASE: Record<ColorTheme['uiTheme'], Monaco.editor.BuiltinTheme> = {
  vs: 'vs',
  'vs-dark': 'vs-dark',
  'hc-black': 'hc-black',
  'hc-light': 'hc-light',
};

export const MONACO_THEME_NAME = 'raml-kql';

export function toMonacoTheme(theme: ColorTheme): Monaco.editor.IStandaloneThemeData {
  const resolved = new ColorResolver(theme).resolveAll();
  const colors = Object.fromEntries(
    Object.entries(resolved).filter(
      ([key]) =>
        key.startsWith('editor') ||
        key.startsWith('scrollbar') ||
        key === 'focusBorder' ||
        key === 'foreground' ||
        key.startsWith('input') ||
        key.startsWith('list') ||
        key.startsWith('widget'),
    ),
  );
  const rules: Monaco.editor.ITokenThemeRule[] = [];
  for (const [token, scopes] of Object.entries(TOKEN_SCOPES)) {
    for (const scope of scopes) {
      const color = scopeForeground(theme.tokenColors, scope);
      if (color !== undefined) {
        rules.push({ token, foreground: color.replace('#', '') });
        break;
      }
    }
  }
  return { base: BASE[theme.uiTheme], inherit: true, rules, colors };
}
