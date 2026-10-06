import { describe, expect, it } from 'vitest';

import {
  SIGNATURE_FILE,
  checkSignature,
  generateSigningKeyPair,
  keyIdOf,
  signFiles,
  signedPayload,
} from './extension-signature';

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

function extensionFiles(): Map<string, Uint8Array> {
  return new Map([
    ['package.json', bytes('{"name":"demo"}')],
    ['dist/extension.js', bytes('export function activate() {}')],
  ]);
}

function signed(privateKeyPem: string): Map<string, Uint8Array> {
  const files = extensionFiles();
  files.set(SIGNATURE_FILE, signFiles(files, privateKeyPem));
  return files;
}

describe('extension signatures', () => {
  const key = generateSigningKeyPair();
  const trusted = [{ name: 'Raml KQL', publicKeyPem: key.publicKeyPem }];

  it('verifies a package signed with a trusted key', () => {
    expect(checkSignature(signed(key.privateKeyPem), trusted)).toEqual({
      status: 'verified',
      keyId: key.keyId,
      signedBy: 'Raml KQL',
    });
  });

  it('reports a package without a signature as unsigned', () => {
    expect(checkSignature(extensionFiles(), trusted)).toEqual({ status: 'unsigned' });
  });

  it('rejects a package whose files changed after signing', () => {
    const changed = signed(key.privateKeyPem);
    changed.set('dist/extension.js', bytes('export function activate() { steal(); }'));
    expect(checkSignature(changed, trusted).status).toBe('invalid');
  });

  it('rejects added and removed files', () => {
    const added = signed(key.privateKeyPem);
    added.set('dist/extra.js', bytes('1'));
    expect(checkSignature(added, trusted).status).toBe('invalid');

    const removed = signed(key.privateKeyPem);
    removed.delete('dist/extension.js');
    expect(checkSignature(removed, trusted).status).toBe('invalid');
  });

  it('rejects a renamed file even when its content is unchanged', () => {
    const renamed = signed(key.privateKeyPem);
    const content = renamed.get('dist/extension.js');
    renamed.delete('dist/extension.js');
    renamed.set('dist/other.js', content ?? bytes(''));
    expect(checkSignature(renamed, trusted).status).toBe('invalid');
  });

  it('does not trust a valid signature from an unknown key', () => {
    const stranger = generateSigningKeyPair();
    const result = checkSignature(signed(stranger.privateKeyPem), trusted);
    expect(result).toEqual({ status: 'untrusted', keyId: stranger.keyId });
  });

  it('cannot be fooled by claiming a trusted key id with another key', () => {
    const stranger = generateSigningKeyPair();
    const files = extensionFiles();
    const forged = JSON.parse(
      new TextDecoder().decode(signFiles(files, stranger.privateKeyPem)),
    ) as {
      keyId: string;
    };
    forged.keyId = key.keyId;
    files.set(SIGNATURE_FILE, bytes(JSON.stringify(forged)));
    expect(checkSignature(files, trusted).status).toBe('invalid');
  });

  it('handles a malformed signature file and a broken trust list without throwing', () => {
    const files = extensionFiles();
    files.set(SIGNATURE_FILE, bytes('not json'));
    expect(checkSignature(files, trusted).status).toBe('invalid');
    files.set(SIGNATURE_FILE, bytes('{"version":2}'));
    expect(checkSignature(files, trusted).status).toBe('invalid');
    expect(
      checkSignature(signed(key.privateKeyPem), [{ name: 'Broken', publicKeyPem: 'nonsense' }])
        .status,
    ).toBe('untrusted');
  });

  it('ignores the signature file itself and the order of files', () => {
    const a = extensionFiles();
    const b = new Map([...a].reverse());
    b.set(SIGNATURE_FILE, bytes('anything'));
    expect(signedPayload(a)).toEqual(signedPayload(b));
  });

  it('refuses a key that is not Ed25519', async () => {
    const { generateKeyPairSync } = await import('node:crypto');
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 })
      .privateKey.export({ type: 'pkcs8', format: 'pem' })
      .toString();
    expect(() => signFiles(extensionFiles(), rsa)).toThrow(/Ed25519/);
  });

  it('derives a stable 16 character key id', () => {
    expect(keyIdOf(key.publicKeyPem)).toBe(key.keyId);
    expect(key.keyId).toMatch(/^[0-9a-f]{16}$/);
  });
});
