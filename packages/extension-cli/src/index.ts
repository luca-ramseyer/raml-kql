/**
 * raml-kql-ext — command-line tool for extension and query pack authors (specs 07, 08).
 */
import { initExtension, packageExtension, validateExtension } from './extension';
import { validatePacks } from './pack-validate';
import { keygenCommand, signCommand, verifyCommand } from './signing';

export interface CliIo {
  out: (line: string) => void;
  err: (line: string) => void;
}

export const CLI_NAME = 'raml-kql-ext';
export const CLI_VERSION = '1.0.0';

const HELP = `Usage: ${CLI_NAME} <command>

Commands:
  init <dir> --publisher <p> [--name <n>]
                        Scaffold a TypeScript extension (bundled with esbuild)
  validate [dir]        Check an extension the way Raml KQL will when installing it
  package [dir] [-o <file.rkqlx>]
                        Validate and build the .rkqlx package
  pack validate [dir]   Validate the query packs in a folder (default: the current folder)
  keygen --out <dir>    Create an Ed25519 signing key pair (keep the private key secret)
  sign <file.rkqlx> [--key <file>] [-o <out>]
                        Sign a package. The key comes from --key or $RAML_KQL_SIGNING_KEY
  verify <file.rkqlx> --key <public-key.pub>
                        Check a package's signature against a public key

Options:
  -h, --help     Show this help
  -v, --version  Show the version`;

/** Runs the CLI and returns the process exit code. */
export function runCli(argv: readonly string[], io: CliIo): number {
  const [first] = argv;
  if (first === undefined || first === '-h' || first === '--help') {
    io.out(HELP);
    return 0;
  }
  if (first === '-v' || first === '--version') {
    io.out(CLI_VERSION);
    return 0;
  }
  const option = (name: string): string | undefined => {
    const index = argv.indexOf(name);
    return index < 0 ? undefined : argv[index + 1];
  };
  const positional = argv
    .slice(1)
    .filter((arg, i, all) => !arg.startsWith('-') && !all[i - 1]?.startsWith('-'));
  if (first === 'validate') return validateExtension(positional[0] ?? '.', io);
  if (first === 'package')
    return packageExtension(positional[0] ?? '.', option('-o') ?? option('--out'), io);
  if (first === 'init') {
    const dir = positional[0];
    const publisher = option('--publisher');
    if (dir === undefined || publisher === undefined) {
      io.err(`Usage: ${CLI_NAME} init <dir> --publisher <publisher> [--name <name>]`);
      return 2;
    }
    const name = option('--name') ?? dir.replace(/\/+$/, '').split(/[\\/]/).at(-1) ?? dir;
    return initExtension(dir, { name, publisher }, io);
  }
  if (first === 'keygen') {
    const out = option('--out');
    if (out === undefined) {
      io.err(`Usage: ${CLI_NAME} keygen --out <dir>`);
      return 2;
    }
    return keygenCommand(out, io);
  }
  if (first === 'sign') {
    const file = positional[0];
    if (file === undefined) {
      io.err(`Usage: ${CLI_NAME} sign <file.rkqlx> [--key <file>] [-o <out>]`);
      return 2;
    }
    return signCommand(
      file,
      {
        keyFile: option('--key'),
        keyEnv: process.env['RAML_KQL_SIGNING_KEY'],
        out: option('-o') ?? option('--out'),
      },
      io,
    );
  }
  if (first === 'verify') {
    const file = positional[0];
    if (file === undefined) {
      io.err(`Usage: ${CLI_NAME} verify <file.rkqlx> --key <public-key.pub>`);
      return 2;
    }
    return verifyCommand(file, option('--key'), io);
  }
  if (first === 'pack') {
    const [, sub, dir = '.'] = argv;
    if (sub === 'validate') return validatePacks(dir, io);
    io.err(`${CLI_NAME}: unknown pack command '${sub ?? ''}'. Try '${CLI_NAME} pack validate'.`);
    return 2;
  }
  io.err(`${CLI_NAME}: unknown command '${first}'. Run '${CLI_NAME} --help'.`);
  return 2;
}
