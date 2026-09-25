import { describe, expect, it } from 'vitest';

import {
  ExtensionManifestSchema,
  extensionId,
  hostAllowed,
  permissionRisk,
} from './extension-manifest';
import { compareVersions, parseVersion, satisfies } from './semver';

const VALID = {
  name: 'virustotal-enricher',
  publisher: 'raml',
  displayName: 'VirusTotal Enricher',
  version: '1.2.0',
  engines: { 'raml-kql': '^1.0.0' },
  main: 'dist/extension.js',
  activationEvents: ['onCommand:virustotal.lookup', 'onEnricher:virustotal'],
  permissions: [
    { id: 'network', hosts: ['www.virustotal.com'], reason: 'Query the VirusTotal API' },
    { id: 'secrets', reason: 'Store your API key' },
  ],
  contributes: {
    commands: [
      { command: 'virustotal.lookup', title: 'Look up on VirusTotal', category: 'VirusTotal' },
    ],
    menus: {
      'results/cell/context': [{ command: 'virustotal.lookup', when: 'cellEntityType =~ /ip/' }],
    },
    enrichers: [{ id: 'virustotal', title: 'VirusTotal', entityTypes: ['ip', 'sha256'] }],
    configuration: {
      properties: { 'virustotal-enricher.maxLookups': { type: 'number', default: 25 } },
    },
  },
  scripts: { build: 'esbuild' },
};

describe('extension manifest', () => {
  it('accepts the spec example (and npm fields)', () => {
    const parsed = ExtensionManifestSchema.parse(VALID);
    expect(extensionId(parsed)).toBe('raml.virustotal-enricher');
  });

  it.each([
    ['a bad name', { name: 'Bad Name' }],
    ['a bad engine range', { engines: { 'raml-kql': 'latest' } }],
    ['an unknown permission', { permissions: [{ id: 'filesystem', reason: 'x' }] }],
    [
      'a network permission with a URL',
      { permissions: [{ id: 'network', hosts: ['https://x.com'], reason: 'x' }] },
    ],
    [
      'a menu for an unknown command',
      { contributes: { menus: { commandPalette: [{ command: 'x.y' }] } } },
    ],
    [
      'settings outside the extension name',
      { contributes: { configuration: { properties: { 'other.key': { type: 'string' } } } } },
    ],
    ['commands without main', { main: undefined }],
    ['a path escaping the package', { main: '../evil.js' }],
    [
      'duplicate permissions',
      {
        permissions: [
          { id: 'secrets', reason: 'a' },
          { id: 'secrets', reason: 'b' },
        ],
      },
    ],
  ])('refuses %s', (_label, patch) => {
    expect(ExtensionManifestSchema.safeParse({ ...VALID, ...patch }).success).toBe(false);
  });

  it('matches hosts exactly or by subdomain wildcard', () => {
    expect(hostAllowed('www.virustotal.com', ['www.virustotal.com'])).toBe(true);
    expect(hostAllowed('evil.com', ['www.virustotal.com'])).toBe(false);
    expect(hostAllowed('api.example.com', ['*.example.com'])).toBe(true);
    expect(hostAllowed('example.com', ['*.example.com'])).toBe(false);
    expect(hostAllowed('example.com.evil.net', ['*.example.com'])).toBe(false);
    expect(hostAllowed('badexample.com', ['*.example.com'])).toBe(false);
  });

  it('knows the risk of each permission', () => {
    expect(permissionRisk('network')).toBe('high');
    expect(permissionRisk('auth:https://api.loganalytics.io')).toBe('high');
    expect(permissionRisk('results.readSelection')).toBe('medium');
    expect(permissionRisk('secrets')).toBe('low');
  });
});

describe('semver', () => {
  it('compares versions, prereleases first', () => {
    const v = (s: string) => parseVersion(s) ?? { major: -1, minor: 0, patch: 0, prerelease: [] };
    expect(compareVersions(v('1.2.0'), v('1.10.0'))).toBeLessThan(0);
    expect(compareVersions(v('1.0.0-beta.2'), v('1.0.0'))).toBeLessThan(0);
    expect(compareVersions(v('1.0.0-beta.10'), v('1.0.0-beta.2'))).toBeGreaterThan(0);
    expect(parseVersion('v2.3.4')).toMatchObject({ major: 2, minor: 3, patch: 4 });
  });

  it('checks ranges', () => {
    expect(satisfies('1.4.2', '^1.0.0')).toBe(true);
    expect(satisfies('2.0.0', '^1.0.0')).toBe(false);
    expect(satisfies('0.3.1', '^0.3.0')).toBe(true);
    expect(satisfies('0.4.0', '^0.3.0')).toBe(false);
    expect(satisfies('1.2.9', '~1.2.0')).toBe(true);
    expect(satisfies('1.3.0', '~1.2.0')).toBe(false);
    expect(satisfies('1.5.0', '>=1.2.0 <2.0.0')).toBe(true);
    expect(satisfies('3.0.0', '^1.0.0 || ^3.0.0')).toBe(true);
    expect(satisfies('1.0.0', '*')).toBe(true);
    expect(satisfies('nonsense', '*')).toBe(false);
  });
});
