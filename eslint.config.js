// @ts-check
/**
 * ESLint flat config for the whole monorepo (spec 11, "Lint and format").
 *
 * - typescript-eslint "strict-type-checked": catches unsafe `any`, floating promises, etc.
 * - React + React Hooks rules for the renderer.
 * - import-x: consistent import order and no import cycles.
 * - Boundary rules: the renderer and the extension API must not import Electron or Node.js.
 *
 * Formatting is Prettier's job, so no stylistic rules here.
 */
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';
import { flatConfigs as importX } from 'eslint-plugin-import-x';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import { configs as tsConfigs } from 'typescript-eslint';

/** Node.js built-ins, with and without the `node:` prefix. */
const nodeBuiltinPatterns = ['node:*', ...(await import('node:module')).builtinModules];

/** @type {import('eslint').Linter.Config['rules']} */
const noElectronOrNode = {
  'no-restricted-imports': [
    'error',
    {
      paths: [
        { name: 'electron', message: 'Only the main process and preload may import Electron.' },
      ],
      patterns: [
        {
          group: nodeBuiltinPatterns,
          message: 'Node.js APIs are not available here. Go through the main process via IPC.',
        },
      ],
    },
  ],
};

export default defineConfig(
  {
    ignores: [
      '**/node_modules/**',
      '**/out/**',
      '**/dist/**',
      '**/release/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
    ],
  },

  js.configs.recommended,
  tsConfigs.strictTypeChecked,
  importX.recommended,
  importX.typescript,

  {
    languageOptions: {
      parserOptions: {
        projectService: {
          // Root-level tool configs aren't part of any tsconfig project.
          allowDefaultProject: ['eslint.config.js', 'vitest.config.ts'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    settings: {
      'import-x/resolver-next': [
        createTypeScriptImportResolver({
          project: ['apps/*/tsconfig.*.json', 'packages/*/tsconfig.json'],
          noWarnOnMultipleProjects: true,
        }),
      ],
    },
    rules: {
      'import-x/no-cycle': 'error',
      'import-x/order': [
        'error',
        {
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],
      // Numbers and booleans in template strings are fine and common in messages.
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true, allowBoolean: true },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  // Plain JS config files: no type-aware rules.
  {
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    ...tsConfigs.disableTypeChecked,
    languageOptions: { ...tsConfigs.disableTypeChecked.languageOptions, globals: globals.node },
  },

  // Renderer: browser globals, React, and no Electron/Node imports.
  {
    files: ['apps/desktop/src/renderer/**/*.{ts,tsx}'],
    ...react.configs.flat['recommended'],
    ...react.configs.flat['jsx-runtime'],
    plugins: { react, 'react-hooks': reactHooks },
    languageOptions: { globals: globals.browser },
    settings: { react: { version: '19.3' } },
    rules: {
      ...react.configs.flat['recommended']?.rules,
      ...react.configs.flat['jsx-runtime']?.rules,
      ...reactHooks.configs.flat['recommended-latest'].rules,
      ...noElectronOrNode,
    },
  },

  // The extension API runs inside a sandboxed Web Worker: no Electron, no Node.
  {
    files: ['packages/extension-api/src/**/*.ts'],
    rules: noElectronOrNode,
  },

  // Tests: allow the looser patterns that test doubles need.
  {
    files: ['**/*.test.{ts,tsx}', '**/test/**/*.ts', '**/e2e/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/unbound-method': 'off',
    },
  },
);
