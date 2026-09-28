import { z } from 'zod';

/**
 * The settings registry (spec 09): every user setting is declared here exactly once. The
 * Settings UI, defaults, validation of `settings.jsonc` and its JSON Schema all derive from it.
 *
 * Add settings when the feature that reads them lands, so the Settings UI never shows a
 * setting that does nothing.
 */

export type SettingScope = 'user' | 'machine';

/** How the Settings UI renders a setting. Derived from the schema unless set explicitly. */
export type SettingControl =
  | { kind: 'boolean' }
  | { kind: 'string' }
  | { kind: 'number' }
  | { kind: 'enum'; options: readonly string[]; optionDescriptions?: readonly string[] }
  /** A colour theme label, picked from the installed themes. */
  | { kind: 'colorTheme' }
  /** Arrays and objects: edited in settings.jsonc. */
  | { kind: 'json' };

export interface SettingDefinition<S extends z.ZodType = z.ZodType> {
  readonly key: string;
  readonly schema: S;
  readonly default: z.output<S>;
  /** One or two sentences, shown under the setting in the Settings UI. */
  readonly description: string;
  /** Settings UI table-of-contents path, e.g. `['Workbench', 'Appearance']`. */
  readonly category: readonly [string, ...string[]];
  readonly scope: SettingScope;
  readonly control: SettingControl;
  readonly tags?: readonly string[];
  /** Shown in the "Commonly Used" section. */
  readonly commonlyUsed?: boolean;
}

/** Declare a setting. Keeps the key's literal type so `SettingKey` is a precise union. */
function define<const K extends string, S extends z.ZodType>(
  definition: Omit<SettingDefinition<S>, 'control' | 'key'> & { key: K; control?: SettingControl },
): SettingDefinition<S> & { readonly key: K } {
  return { ...definition, control: definition.control ?? controlFor(definition.schema) };
}

function controlFor(schema: z.ZodType): SettingControl {
  if (schema instanceof z.ZodBoolean) return { kind: 'boolean' };
  if (schema instanceof z.ZodNumber) return { kind: 'number' };
  if (schema instanceof z.ZodString) return { kind: 'string' };
  if (schema instanceof z.ZodEnum) return { kind: 'enum', options: schema.options as string[] };
  return { kind: 'json' };
}

const themeLabel = z.string().min(1).max(200);

export const settingDefinitions = [
  define({
    key: 'workbench.colorTheme',
    schema: themeLabel,
    default: 'Default Dark Modern',
    description:
      'Specifies the color theme used in the workbench when `window.autoDetectColorScheme` is off.',
    category: ['Workbench', 'Appearance'],
    scope: 'user',
    control: { kind: 'colorTheme' },
    commonlyUsed: true,
  }),
  define({
    key: 'window.autoDetectColorScheme',
    schema: z.boolean(),
    default: true,
    description:
      'If set, automatically switch to the preferred dark or light color theme based on the OS appearance.',
    category: ['Workbench', 'Appearance'],
    scope: 'user',
    commonlyUsed: true,
  }),
  define({
    key: 'workbench.preferredDarkColorTheme',
    schema: themeLabel,
    default: 'Default Dark Modern',
    description:
      'Specifies the color theme used when the OS is in dark mode and `window.autoDetectColorScheme` is on.',
    category: ['Workbench', 'Appearance'],
    scope: 'user',
    control: { kind: 'colorTheme' },
  }),
  define({
    key: 'workbench.preferredLightColorTheme',
    schema: themeLabel,
    default: 'Default Light Modern',
    description:
      'Specifies the color theme used when the OS is in light mode and `window.autoDetectColorScheme` is on.',
    category: ['Workbench', 'Appearance'],
    scope: 'user',
    control: { kind: 'colorTheme' },
  }),
  define({
    key: 'window.autoDetectHighContrast',
    schema: z.boolean(),
    default: true,
    description:
      'If set, automatically switch to a high contrast theme when the OS uses a high contrast theme.',
    category: ['Workbench', 'Appearance'],
    scope: 'user',
  }),
  define({
    key: 'workbench.preferredHighContrastColorTheme',
    schema: themeLabel,
    default: 'Default High Contrast',
    description: 'Specifies the dark high contrast color theme used in high contrast mode.',
    category: ['Workbench', 'Appearance'],
    scope: 'user',
    control: { kind: 'colorTheme' },
  }),
  define({
    key: 'workbench.preferredHighContrastLightColorTheme',
    schema: themeLabel,
    default: 'Default High Contrast Light',
    description: 'Specifies the light high contrast color theme used in high contrast mode.',
    category: ['Workbench', 'Appearance'],
    scope: 'user',
    control: { kind: 'colorTheme' },
  }),
  define({
    key: 'workbench.statusBar.visible',
    schema: z.boolean(),
    default: true,
    description: 'Controls the visibility of the status bar at the bottom of the workbench.',
    category: ['Workbench', 'Appearance'],
    scope: 'user',
  }),
  define({
    key: 'workbench.startupEditor',
    schema: z.enum(['welcomePage', 'none']),
    default: 'welcomePage',
    description: 'Controls which editor is shown at startup when no editors are restored.',
    category: ['Workbench', 'General'],
    scope: 'user',
    control: {
      kind: 'enum',
      options: ['welcomePage', 'none'],
      optionDescriptions: ['Open the Welcome page.', 'Start without an editor.'],
    },
  }),
  define({
    key: 'workbench.commandPalette.history',
    schema: z.number().int().min(0).max(500),
    default: 50,
    description:
      'Controls the number of recently used commands to keep in history for the command palette. Set to 0 to disable command history.',
    category: ['Workbench', 'General'],
    scope: 'user',
  }),
  define({
    key: 'auth.provider',
    schema: z.enum(['builtin', 'custom', 'azureCli']),
    default: 'builtin',
    description: 'The sign-in method offered first when adding an account.',
    category: ['Accounts'],
    scope: 'user',
    control: {
      kind: 'enum',
      options: ['builtin', 'custom', 'azureCli'],
      optionDescriptions: [
        'Microsoft sign-in with the Raml KQL app registration.',
        'Microsoft sign-in with your organisation’s own app registration (client ID).',
        'Use the accounts you signed in to with Azure CLI (`az login`).',
      ],
    },
  }),
  define({
    key: 'auth.sessionOnly',
    schema: z.boolean(),
    default: false,
    description:
      'Keep sign-ins in memory only, so you sign in again after every restart. Use this when no OS keyring is available (e.g. Linux without GNOME Keyring or KWallet). Takes effect after a restart.',
    category: ['Accounts'],
    scope: 'machine',
  }),
  define({
    key: 'accounts.showTenantsWithoutAccess',
    schema: z.boolean(),
    default: false,
    description: 'Show tenants where the account has no Azure access in the Accounts view.',
    category: ['Accounts'],
    scope: 'user',
  }),
  define({
    key: 'workspaces.newWorkspaceDefault',
    schema: z.enum(['enabled', 'disabled']),
    default: 'enabled',
    description: 'Whether newly discovered workspaces are enabled (shown in Targets) or disabled.',
    category: ['Workspaces'],
    scope: 'user',
  }),
  define({
    key: 'targets.groupBySubscription',
    schema: z.boolean(),
    default: false,
    description: 'Show subscriptions as a level in the Targets tree instead of as secondary text.',
    category: ['Workspaces'],
    scope: 'user',
  }),
  define({
    key: 'privacy.aliasing.enabled',
    schema: z.boolean(),
    default: true,
    description:
      'Master switch for aliasing (presentation privacy). When off, real names are always shown and the quick toggle is hidden.',
    category: ['Privacy'],
    scope: 'user',
    commonlyUsed: true,
  }),
  define({
    key: 'privacy.aliasing.activeOnStartup',
    schema: z.boolean(),
    default: true,
    description:
      'Start with customer names aliased, so opening the app on a call is safe by default.',
    category: ['Privacy'],
    scope: 'user',
  }),
  define({
    key: 'privacy.aliasing.confirmReveal',
    schema: z.boolean(),
    default: true,
    description: 'Ask for confirmation before switching from aliases to real names.',
    category: ['Privacy'],
    scope: 'user',
  }),
  define({
    key: 'privacy.aliasing.autoAliasFormat',
    schema: z.string().min(1).max(100),
    default: 'Customer {nn}',
    description:
      'Alias for tenants without one you set. `{nn}` is a stable two-digit number (`{n}`, `{nnn}` also work).',
    category: ['Privacy'],
    scope: 'user',
  }),
  define({
    key: 'privacy.aliasing.scope',
    schema: z.array(z.enum(['tenant', 'subscription', 'workspace', 'account'])).max(4),
    default: ['tenant', 'subscription', 'workspace', 'account'],
    description:
      'Which names are aliased: any of `tenant`, `subscription`, `workspace`, `account`.',
    category: ['Privacy'],
    scope: 'user',
  }),
  define({
    key: 'editor.fontFamily',
    schema: z.string().max(500),
    default: '',
    description:
      'Controls the font family of the query editor. Empty uses the platform default (Menlo on macOS, Consolas on Windows, Droid Sans Mono on Linux).',
    category: ['Text Editor', 'Font'],
    scope: 'user',
    commonlyUsed: true,
  }),
  define({
    key: 'editor.fontSize',
    schema: z.number().int().min(0).max(100),
    default: 0,
    description:
      'Controls the font size in pixels of the query editor. `0` uses the platform default (12 on macOS, 14 elsewhere).',
    category: ['Text Editor', 'Font'],
    scope: 'user',
    commonlyUsed: true,
  }),
  define({
    key: 'editor.minimap.enabled',
    schema: z.boolean(),
    default: false,
    description: 'Controls whether the minimap is shown.',
    category: ['Text Editor', 'Minimap'],
    scope: 'user',
  }),
  define({
    key: 'editor.wordWrap',
    schema: z.enum(['off', 'on']),
    default: 'off',
    description: 'Controls how lines should wrap.',
    category: ['Text Editor'],
    scope: 'user',
    commonlyUsed: true,
  }),
  define({
    key: 'schema.cacheHours',
    schema: z
      .number()
      .int()
      .min(0)
      .max(24 * 30),
    default: 24,
    description:
      'How long a workspace schema (tables and columns, never data) is cached on disk before it is fetched again. `0` always fetches.',
    category: ['Query', 'Schema'],
    scope: 'user',
  }),
  define({
    key: 'schema.hideTablesMissingEverywhere',
    schema: z.boolean(),
    default: true,
    description:
      'Hide tables from IntelliSense that exist in none of the selected workspaces (e.g. tables known only from the built-in descriptions).',
    category: ['Query', 'Schema'],
    scope: 'user',
  }),
  define({
    key: 'time.displayZone',
    schema: z.enum(['utc', 'local']),
    default: 'utc',
    description: 'Time zone used to show and enter times, e.g. in the custom time range.',
    category: ['Query', 'Time'],
    scope: 'user',
    control: {
      kind: 'enum',
      options: ['utc', 'local'],
      optionDescriptions: [
        'Coordinated Universal Time (recommended for SOC work).',
        'The time zone of this computer.',
      ],
    },
  }),
] as const satisfies readonly SettingDefinition[];

export type SettingKey = (typeof settingDefinitions)[number]['key'];

type DefinitionFor<K extends SettingKey> = Extract<(typeof settingDefinitions)[number], { key: K }>;
export type SettingValue<K extends SettingKey> = z.output<DefinitionFor<K>['schema']>;
export type SettingValues = { [K in SettingKey]: SettingValue<K> };

const byKey = new Map<string, SettingDefinition>(settingDefinitions.map((d) => [d.key, d]));

export function getSettingDefinition(key: string): SettingDefinition | undefined {
  return byKey.get(key);
}

export function isSettingKey(key: string): key is SettingKey {
  return byKey.has(key);
}

export function defaultSettingValues(): SettingValues {
  return Object.fromEntries(settingDefinitions.map((d) => [d.key, d.default])) as SettingValues;
}

/**
 * JSON Schema for settings.jsonc (editor validation and completions). Unknown keys are allowed:
 * they may belong to extensions or newer app versions.
 */
export function settingsJsonSchema(): Record<string, unknown> {
  return {
    $schema: 'http://json-schema.org/draft-07/schema#',
    type: 'object',
    properties: Object.fromEntries(
      settingDefinitions.map((d) => [
        d.key,
        { ...z.toJSONSchema(d.schema), description: d.description, default: d.default },
      ]),
    ),
  };
}
