import { describe, expect, it } from 'vitest';

import {
  defaultSettingValues,
  getSettingDefinition,
  isSettingKey,
  settingDefinitions,
  settingsJsonSchema,
} from './registry';

describe('settings registry', () => {
  it('has unique keys', () => {
    const keys = settingDefinitions.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('every default is valid for its own schema', () => {
    for (const definition of settingDefinitions) {
      expect(definition.schema.safeParse(definition.default).success, definition.key).toBe(true);
    }
  });

  it('every setting has a description and a category', () => {
    for (const definition of settingDefinitions) {
      expect(definition.description.length, definition.key).toBeGreaterThan(10);
      expect(definition.category.length, definition.key).toBeGreaterThan(0);
    }
  });

  it('derives Settings UI controls from schemas', () => {
    expect(getSettingDefinition('window.autoDetectColorScheme')?.control).toEqual({
      kind: 'boolean',
    });
    expect(getSettingDefinition('workbench.commandPalette.history')?.control).toEqual({
      kind: 'number',
    });
    expect(getSettingDefinition('workbench.colorTheme')?.control).toEqual({ kind: 'colorTheme' });
  });

  it('follows the OS appearance by default (roadmap Phase 1)', () => {
    expect(defaultSettingValues()['window.autoDetectColorScheme']).toBe(true);
    expect(defaultSettingValues()['workbench.colorTheme']).toBe('Raml Dark');
  });

  it('generates a JSON Schema for settings.jsonc', () => {
    const schema = settingsJsonSchema() as {
      properties: Record<string, { type?: string; default?: unknown }>;
    };
    expect(schema.properties['window.autoDetectColorScheme']).toMatchObject({
      type: 'boolean',
      default: true,
    });
    expect(Object.keys(schema.properties)).toHaveLength(settingDefinitions.length);
  });

  it('isSettingKey', () => {
    expect(isSettingKey('workbench.colorTheme')).toBe(true);
    expect(isSettingKey('nope')).toBe(false);
  });
});
