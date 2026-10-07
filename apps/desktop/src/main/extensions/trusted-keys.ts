import type { TrustedKey } from '@raml-kql/pack-schema/extension-signature';

/**
 * Public keys whose signatures earn an extension the "Verified by Raml KQL" badge (D-057).
 * Public keys are not secret. The matching private key lives only in the release workflow's
 * `release` environment (secret `EXTENSION_SIGNING_KEY`) and in the maintainer's password manager.
 *
 * To rotate or revoke a key, change this list in an app release: add the new key first, and
 * remove the old one when extensions signed with it have been re-released. See
 * docs/contributing/releasing.md ("Signing the example extensions").
 */
export const TRUSTED_SIGNING_KEYS: readonly TrustedKey[] = [
  {
    name: 'Raml KQL',
    publicKeyPem: `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAlKagWJnrArQJM76wDtY7MyOim0XznrGVAhbThtbMm50=
-----END PUBLIC KEY-----
`,
  },
];
