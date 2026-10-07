import { createPublicKey } from 'node:crypto';

import { keyIdOf } from '@raml-kql/pack-schema/extension-signature';
import { describe, expect, it } from 'vitest';

import { TRUSTED_SIGNING_KEYS } from './trusted-keys';

describe('TRUSTED_SIGNING_KEYS', () => {
  it('holds usable Ed25519 public keys with distinct ids', () => {
    expect(TRUSTED_SIGNING_KEYS.length).toBeGreaterThan(0);
    const ids = TRUSTED_SIGNING_KEYS.map((key) => {
      const publicKey = createPublicKey(key.publicKeyPem);
      expect(publicKey.asymmetricKeyType).toBe('ed25519');
      expect(key.publicKeyPem).not.toContain('PRIVATE');
      expect(key.name).not.toBe('');
      return keyIdOf(key.publicKeyPem);
    });
    expect(new Set(ids).size).toBe(ids.length);
  });
});
