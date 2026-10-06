import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as signBytes,
  verify as verifyBytes,
} from 'node:crypto';

import { z } from 'zod';

/**
 * Signed extension packages ("Verified by Raml KQL", spec 07 and D-057).
 *
 * A signed `.rkqlx` contains a `SIGNATURE.json` next to the extension's own files. The signature
 * covers every other file: its path and the SHA-256 of its content. Changing, adding or
 * removing any file makes the signature fail. The signing key is Ed25519; the app trusts a short
 * list of public keys compiled into it.
 */
export const SIGNATURE_FILE = 'SIGNATURE.json';

const PAYLOAD_HEADER = 'raml-kql-extension-v1\n';

export const SignatureFileSchema = z
  .object({
    version: z.literal(1),
    algorithm: z.literal('ed25519'),
    /** First 16 hex characters of the SHA-256 of the public key (SPKI DER). */
    keyId: z.string().regex(/^[0-9a-f]{16}$/),
    /** Base64 of the Ed25519 signature over `signedPayload(files)`. */
    signature: z
      .string()
      .regex(/^[A-Za-z0-9+/]+={0,2}$/)
      .max(200),
  })
  .strict();
export type SignatureFile = z.infer<typeof SignatureFileSchema>;

export interface TrustedKey {
  /** What the badge says, e.g. "Raml KQL". */
  name: string;
  publicKeyPem: string;
}

export type SignatureCheck =
  | { status: 'unsigned' }
  | { status: 'invalid'; reason: string }
  | { status: 'untrusted'; keyId: string }
  | { status: 'verified'; keyId: string; signedBy: string };

type Files = ReadonlyMap<string, Uint8Array>;

/** The bytes that are signed: a header, then `<sha256>  <path>` for every file but the signature. */
export function signedPayload(files: Files): Uint8Array {
  const lines = [...files.keys()]
    .filter((name) => name !== SIGNATURE_FILE)
    .sort()
    .map((name) => {
      const digest = createHash('sha256')
        .update(files.get(name) ?? new Uint8Array())
        .digest('hex');
      return `${digest}  ${name}\n`;
    });
  return new TextEncoder().encode(PAYLOAD_HEADER + lines.join(''));
}

/** Identifies a public key. Printed by `keygen`, stored in the signature file. */
export function keyIdOf(publicKeyPem: string): string {
  const der = createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' });
  return createHash('sha256').update(der).digest('hex').slice(0, 16);
}

export function generateSigningKeyPair(): {
  privateKeyPem: string;
  publicKeyPem: string;
  keyId: string;
} {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  return {
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKeyPem,
    keyId: keyIdOf(publicKeyPem),
  };
}

/** The contents of `SIGNATURE.json` for these files. */
export function signFiles(files: Files, privateKeyPem: string): Uint8Array {
  const privateKey = createPrivateKey(privateKeyPem);
  if (privateKey.asymmetricKeyType !== 'ed25519') {
    throw new Error('The signing key must be an Ed25519 key.');
  }
  const publicKeyPem = createPublicKey(privateKey)
    .export({ type: 'spki', format: 'pem' })
    .toString();
  const file: SignatureFile = {
    version: 1,
    algorithm: 'ed25519',
    keyId: keyIdOf(publicKeyPem),
    signature: signBytes(null, signedPayload(files), privateKey).toString('base64'),
  };
  return new TextEncoder().encode(`${JSON.stringify(file, null, 2)}\n`);
}

/** Is this package signed, and by a key we trust? Never throws. */
export function checkSignature(files: Files, trusted: readonly TrustedKey[]): SignatureCheck {
  const raw = files.get(SIGNATURE_FILE);
  if (raw === undefined) return { status: 'unsigned' };
  let signature: SignatureFile;
  try {
    const parsed = SignatureFileSchema.safeParse(JSON.parse(new TextDecoder().decode(raw)));
    if (!parsed.success) return { status: 'invalid', reason: `${SIGNATURE_FILE} is malformed.` };
    signature = parsed.data;
  } catch {
    return { status: 'invalid', reason: `${SIGNATURE_FILE} is not valid JSON.` };
  }
  for (const key of trusted) {
    let keyId: string;
    try {
      keyId = keyIdOf(key.publicKeyPem);
    } catch {
      continue; // A broken entry in the trust list never verifies anything.
    }
    if (keyId !== signature.keyId) continue;
    const ok = verifyBytes(
      null,
      signedPayload(files),
      createPublicKey(key.publicKeyPem),
      Buffer.from(signature.signature, 'base64'),
    );
    return ok
      ? { status: 'verified', keyId, signedBy: key.name }
      : {
          status: 'invalid',
          reason: 'The files do not match the signature (modified after signing).',
        };
  }
  return { status: 'untrusted', keyId: signature.keyId };
}
