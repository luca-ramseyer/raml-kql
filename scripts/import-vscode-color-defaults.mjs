#!/usr/bin/env node
/**
 * Imports the *default values* of VS Code's workbench colour registry (MIT licensed).
 *
 * VS Code themes only list the colours they change; every other key falls back to a default
 * registered in VS Code's source (`registerColor('tab.border', { dark: ..., light: ... })`),
 * often expressed as a transform of another colour (`transparent(foreground, 0.7)`).
 * High-contrast themes in particular rely almost entirely on these defaults.
 *
 * This script downloads the registry source files for a pinned VS Code release, *parses* them
 * with the TypeScript compiler API (the downloaded code is never executed), and writes the
 * default expressions as JSON. The app evaluates them at runtime
 * (src/renderer/platform/theme/color-defaults.ts).
 *
 * Maintainer tool; the output is committed. Usage:
 *   node scripts/import-vscode-color-defaults.mjs [vscode-tag]
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as ts from 'typescript';

const VSCODE_TAG = process.argv[2] ?? '1.139.0';
const RAW = `https://raw.githubusercontent.com/microsoft/vscode/${VSCODE_TAG}/`;
const OUT_FILE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../apps/desktop/src/renderer/platform/theme/vscode-color-defaults.json',
);

const SOURCES = [
  'src/vs/platform/theme/common/colors/baseColors.ts',
  'src/vs/platform/theme/common/colors/chartsColors.ts',
  'src/vs/platform/theme/common/colors/editorColors.ts',
  'src/vs/platform/theme/common/colors/inputColors.ts',
  'src/vs/platform/theme/common/colors/listColors.ts',
  'src/vs/platform/theme/common/colors/menuColors.ts',
  'src/vs/platform/theme/common/colors/minimapColors.ts',
  'src/vs/platform/theme/common/colors/miscColors.ts',
  'src/vs/platform/theme/common/colors/quickpickColors.ts',
  'src/vs/platform/theme/common/colors/searchColors.ts',
  'src/vs/workbench/common/theme.ts',
  'src/vs/workbench/contrib/preferences/common/settingsEditorColorRegistry.ts',
];

const NAMED_COLORS = {
  white: '#FFFFFF',
  black: '#000000',
  red: '#FF0000',
  blue: '#0000FF',
  green: '#00FF00',
  cyan: '#00FFFF',
  lightgrey: '#D3D3D3',
  transparent: '#00000000',
};
const TRANSFORMS = new Set([
  'transparent',
  'darken',
  'lighten',
  'opaque',
  'oneOf',
  'ifDefinedThenElse',
  'lessProminent',
  'mix',
]);
const VARIANTS = ['dark', 'light', 'hcDark', 'hcLight'];

const hex2 = (n) => Math.round(n).toString(16).padStart(2, '0').toUpperCase();
function rgbaHex(r, g, b, a = 1) {
  return `#${hex2(r)}${hex2(g)}${hex2(b)}${a === 1 ? '' : hex2(a * 255)}`;
}

/** Unwrap parentheses and `as` casts. */
function unwrap(node) {
  while (ts.isParenthesizedExpression(node) || ts.isAsExpression(node)) node = node.expression;
  return node;
}

/** Non-registered constants (`const rulerTransparency = 0.6`, `const x = new Color(...)`). */
const constants = new Map();

function numberOf(node, where) {
  node = unwrap(node);
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (ts.isIdentifier(node) && typeof constants.get(node.text) === 'number') {
    return constants.get(node.text);
  }
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken) {
    return -numberOf(node.operand, where);
  }
  throw new Error(`${where}: expected a number, got ${node.getText()}`);
}

/** Convert a colour default expression to its JSON form. */
function convert(node, names, where) {
  node = unwrap(node);
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isStringLiteral(node)) {
    return node.text.startsWith('#') ? node.text.toUpperCase() : { ref: node.text };
  }
  if (ts.isIdentifier(node)) {
    const id = names.get(node.text);
    if (id !== undefined) return { ref: id };
    if (constants.has(node.text)) return constants.get(node.text);
    throw new Error(`${where}: unknown colour constant ${node.text}`);
  }
  if (ts.isPropertyAccessExpression(node) && node.expression.getText() === 'Color') {
    const named = NAMED_COLORS[node.name.text];
    if (named === undefined) throw new Error(`${where}: unknown Color.${node.name.text}`);
    return named;
  }
  if (ts.isNewExpression(node) && node.expression.getText() === 'Color') {
    const rgba = unwrap(node.arguments[0]);
    if (!ts.isNewExpression(rgba) || rgba.expression.getText() !== 'RGBA') {
      throw new Error(`${where}: unsupported ${node.getText()}`);
    }
    const [r, g, b, a] = rgba.arguments.map((arg) => numberOf(arg, where));
    return rgbaHex(r, g, b, a ?? 1);
  }
  if (ts.isCallExpression(node)) {
    const callee = node.expression.getText();
    if (callee === 'Color.fromHex') return convert(node.arguments[0], names, where);
    // Method chains on a colour: `Color.white.transparent(0.12)`, `Color.black.lighten(0.2)`.
    if (
      ts.isPropertyAccessExpression(node.expression) &&
      ['transparent', 'darken', 'lighten'].includes(node.expression.name.text)
    ) {
      return {
        fn: node.expression.name.text,
        args: [
          convert(node.expression.expression, names, where),
          numberOf(node.arguments[0], where),
        ],
      };
    }
    if (TRANSFORMS.has(callee)) {
      return {
        fn: callee,
        args: node.arguments.map((arg) => {
          const inner = unwrap(arg);
          return ts.isNumericLiteral(inner) || ts.isPrefixUnaryExpression(inner)
            ? numberOf(inner, where)
            : convert(inner, names, where);
        }),
      };
    }
  }
  if (ts.isObjectLiteralExpression(node)) {
    // A literal transform: `{ op: ColorTransformType.Mix, color, with, ratio }`.
    const op = node.properties.find((p) => p.name?.getText() === 'op');
    if (op !== undefined && ts.isPropertyAssignment(op)) {
      const get = (name) =>
        node.properties.find((p) => p.name?.getText() === name)?.initializer ??
        (() => {
          throw new Error(`${where}: transform without ${name}`);
        })();
      if (op.initializer.getText() !== 'ColorTransformType.Mix') {
        throw new Error(`${where}: unsupported transform ${op.initializer.getText()}`);
      }
      return {
        fn: 'mix',
        args: [
          convert(get('color'), names, where),
          convert(get('with'), names, where),
          numberOf(get('ratio'), where),
        ],
      };
    }
    const result = {};
    for (const prop of node.properties) {
      if (!ts.isPropertyAssignment(prop))
        throw new Error(`${where}: unsupported ${prop.getText()}`);
      result[prop.name.getText()] = convert(prop.initializer, names, where);
    }
    for (const variant of VARIANTS) {
      if (!(variant in result)) throw new Error(`${where}: missing ${variant}`);
    }
    return result;
  }
  throw new Error(`${where}: unsupported expression ${node.getText()}`);
}

/** Every `registerColor('id', defaults, ...)` call in a file, with the const it's assigned to. */
function registrations(sourceFile) {
  const found = [];
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      node.expression.getText() === 'registerColor' &&
      node.arguments.length >= 2 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      const decl = node.parent;
      found.push({
        id: node.arguments[0].text,
        constName: ts.isVariableDeclaration(decl) ? decl.name.getText() : undefined,
        defaults: node.arguments[1],
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

const files = [];
for (const source of SOURCES) {
  const response = await fetch(RAW + source);
  if (!response.ok) throw new Error(`GET ${source}: HTTP ${response.status}`);
  const text = await response.text();
  files.push({ source, file: ts.createSourceFile(source, text, ts.ScriptTarget.Latest, true) });
}

// Pass 1: constant name → colour id, across all files (constants are imported between files).
const names = new Map();
for (const { file } of files) {
  for (const { id, constName } of registrations(file)) {
    if (constName !== undefined) names.set(constName, id);
  }
}

// Pass 1b: plain constants used inside defaults (numbers and literal colours).
for (const { file } of files) {
  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const decl of statement.declarationList.declarations) {
      if (!decl.initializer || !ts.isIdentifier(decl.name) || names.has(decl.name.text)) continue;
      const init = unwrap(decl.initializer);
      try {
        constants.set(
          decl.name.text,
          ts.isNumericLiteral(init) ? Number(init.text) : convert(init, names, decl.name.text),
        );
      } catch {
        // Not a colour or number constant; ignore.
      }
    }
  }
}

// Pass 2: convert every default, normalised to one value per theme variant.
const defaults = {};
let skipped = 0;
for (const { source, file } of files) {
  for (const { id, defaults: expr } of registrations(file)) {
    try {
      const value = convert(expr, names, `${path.basename(source)} ${id}`);
      const perVariant =
        value !== null && typeof value === 'object' && 'dark' in value
          ? value
          : Object.fromEntries(VARIANTS.map((v) => [v, value]));
      defaults[id] = Object.fromEntries(VARIANTS.map((v) => [v, perVariant[v]]));
    } catch (error) {
      skipped += 1;
      console.warn(`skipped: ${error.message}`);
    }
  }
}

const sorted = Object.fromEntries(Object.entries(defaults).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(
  OUT_FILE,
  JSON.stringify(
    {
      $comment: `Generated by scripts/import-vscode-color-defaults.mjs from microsoft/vscode@${VSCODE_TAG} (MIT License, Copyright (c) Microsoft Corporation). Do not edit by hand.`,
      defaults: sorted,
    },
    null,
    1,
  ) + '\n',
);
console.log(`${Object.keys(sorted).length} colour defaults written, ${skipped} skipped`);
