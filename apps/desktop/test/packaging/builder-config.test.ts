import { describe, expect, it } from 'vitest';

import { createConfig } from '../../electron-builder.config.mjs';

describe('electron-builder config (spec 11)', () => {
  it('turns off the fuses spec 01 lists and keeps asar integrity on', () => {
    expect(createConfig({}).electronFuses).toMatchObject({
      runAsNode: false,
      enableNodeOptionsEnvironmentVariable: false,
      enableNodeCliInspectArguments: false,
      enableEmbeddedAsarIntegrityValidation: true,
      onlyLoadAppFromAsar: true,
      enableCookieEncryption: true,
    });
  });

  it('publishes to GitHub Releases, the source of auto-updates', () => {
    expect(createConfig({}).publish).toMatchObject({ provider: 'github', repo: 'raml-kql' });
  });

  it('ships what the updater and the platforms need', () => {
    const config = createConfig({});
    const mac = (config.mac?.target as { target: string }[]).map((t) => t.target);
    expect(mac).toEqual(['dmg', 'zip']); // the zip is what macOS updates from
    expect(config.mac).toMatchObject({ hardenedRuntime: true, notarize: true });
    const linux = (config.linux?.target as { target: string }[]).map((t) => t.target);
    expect(linux).toEqual(['AppImage', 'deb', 'rpm']);
    expect(config.win?.target).toEqual([{ target: 'nsis', arch: ['x64', 'arm64'] }]);
  });

  it('builds unsigned, and ad-hoc re-signs after the fuses, when no certificate is given', () => {
    const config = createConfig({});
    expect(config.mac).toMatchObject({ identity: null });
    expect(config.electronFuses).toMatchObject({ resetAdHocDarwinSignature: true });
    expect(config.win).not.toHaveProperty('azureSignOptions');
  });

  it('lets electron-builder sign on macOS once a certificate is provided', () => {
    const config = createConfig({ CSC_LINK: 'base64' });
    expect(config.mac).not.toHaveProperty('identity');
    expect(config.electronFuses).not.toHaveProperty('resetAdHocDarwinSignature');
  });

  it('signs on macOS when the certificate is already in the keychain', () => {
    const config = createConfig({ RAML_KQL_SIGN_MAC: '1' });
    expect(config.mac).not.toHaveProperty('identity');
    expect(config.electronFuses).not.toHaveProperty('resetAdHocDarwinSignature');
  });

  it('enables Windows cloud signing only when every setting is present', () => {
    const all = {
      AZURE_SIGNING_ENDPOINT: 'https://eus.codesigning.azure.net',
      AZURE_SIGNING_ACCOUNT: 'account',
      AZURE_SIGNING_PROFILE: 'profile',
      AZURE_SIGNING_PUBLISHER: 'Luca Ramseyer',
    };
    expect(createConfig(all).win).toMatchObject({
      azureSignOptions: {
        endpoint: all.AZURE_SIGNING_ENDPOINT,
        codeSigningAccountName: 'account',
        certificateProfileName: 'profile',
        publisherName: 'Luca Ramseyer',
      },
    });
    expect(createConfig({ ...all, AZURE_SIGNING_PROFILE: '' }).win).not.toHaveProperty(
      'azureSignOptions',
    );
  });
});
