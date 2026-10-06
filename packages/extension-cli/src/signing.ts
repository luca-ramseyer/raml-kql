import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  SIGNATURE_FILE,
  checkSignature,
  generateSigningKeyPair,
  signFiles,
} from '@raml-kql/pack-schema/extension-signature';
import { unzipSync, zipSync } from 'fflate';

import type { CliIo } from './index';

/**
 * `raml-kql-ext keygen | sign | verify`: signed extension packages ("Verified by Raml KQL", D-057).
 * Only packages signed with a key the app trusts get the badge; anyone can sign with their own key
 * (it then shows as signed by an unknown key and gets no badge).
 */

/** The entries of a `.rkqlx`, with a single top-level folder stripped like the app does. */
function readPackage(file: string): Map<string, Uint8Array> {
  const entries = unzipSync(new Uint8Array(readFileSync(file)));
  const files = new Map<string, Uint8Array>();
  for (const [name, bytes] of Object.entries(entries)) {
    if (!name.endsWith('/')) files.set(name, bytes);
  }
  const roots = new Set([...files.keys()].map((name) => name.split('/')[0]));
  const [root] = roots;
  if (roots.size === 1 && root !== undefined && !files.has('package.json')) {
    return new Map([...files].map(([name, bytes]) => [name.slice(root.length + 1), bytes]));
  }
  return files;
}

export function keygenCommand(outDir: string, io: CliIo): number {
  const privatePath = path.join(outDir, 'raml-kql-signing.key');
  const publicPath = path.join(outDir, 'raml-kql-signing.pub');
  if (existsSync(privatePath) || existsSync(publicPath)) {
    io.err(`${outDir} already contains a signing key. Choose another folder.`);
    return 1;
  }
  const { privateKeyPem, publicKeyPem, keyId } = generateSigningKeyPair();
  mkdirSync(outDir, { recursive: true });
  writeFileSync(privatePath, privateKeyPem, { mode: 0o600 });
  chmodSync(privatePath, 0o600);
  writeFileSync(publicPath, publicKeyPem);
  io.out(`Key id: ${keyId}`);
  io.out(`Private key: ${privatePath}`);
  io.out('  Keep it secret: store it in a password manager and as a CI secret, never commit it.');
  io.out(`Public key: ${publicPath}`);
  io.out('  This one is safe to share. The app trusts the public keys compiled into it.');
  return 0;
}

export function signCommand(
  file: string,
  options: { keyFile?: string | undefined; keyEnv?: string | undefined; out?: string | undefined },
  io: CliIo,
): number {
  let privateKeyPem: string;
  try {
    privateKeyPem =
      options.keyFile !== undefined
        ? readFileSync(options.keyFile, 'utf8')
        : (options.keyEnv ?? '').replace(/\\n/g, '\n');
  } catch {
    io.err(`Could not read the signing key ${options.keyFile ?? ''}.`);
    return 1;
  }
  if (privateKeyPem.trim() === '') {
    io.err('No signing key: pass --key <file> or set RAML_KQL_SIGNING_KEY to the key itself.');
    return 2;
  }
  let files: Map<string, Uint8Array>;
  try {
    files = readPackage(file);
  } catch {
    io.err(`${file} is not a valid .rkqlx (zip) package.`);
    return 1;
  }
  files.delete(SIGNATURE_FILE); // Signing again replaces an earlier signature.
  let signature: Uint8Array;
  try {
    signature = signFiles(files, privateKeyPem);
  } catch (error) {
    io.err(error instanceof Error ? error.message : 'The key could not be used.');
    return 1;
  }
  const entries: Record<string, Uint8Array> = Object.fromEntries(files);
  entries[SIGNATURE_FILE] = signature;
  const target = options.out ?? file;
  writeFileSync(target, zipSync(entries, { level: 9 }));
  io.out(`Signed ${String(files.size)} files into ${target}`);
  return 0;
}

export function verifyCommand(file: string, publicKeyFile: string | undefined, io: CliIo): number {
  if (publicKeyFile === undefined) {
    io.err('Usage: raml-kql-ext verify <file.rkqlx> --key <public-key.pub>');
    return 2;
  }
  let publicKeyPem: string;
  let files: Map<string, Uint8Array>;
  try {
    publicKeyPem = readFileSync(publicKeyFile, 'utf8');
    files = readPackage(file);
  } catch {
    io.err('Could not read the package or the public key.');
    return 1;
  }
  const result = checkSignature(files, [{ name: 'the given key', publicKeyPem }]);
  switch (result.status) {
    case 'verified':
      io.out(`Verified: signed with key ${result.keyId}.`);
      return 0;
    case 'unsigned':
      io.err('Not signed.');
      return 1;
    case 'untrusted':
      io.err(`Signed with a different key (${result.keyId}).`);
      return 1;
    case 'invalid':
      io.err(`Invalid signature: ${result.reason}`);
      return 1;
  }
}
