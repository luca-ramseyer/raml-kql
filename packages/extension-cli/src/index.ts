/**
 * raml-kql-ext — command-line tool for extension and query pack authors (specs 07, 08).
 *
 * `pack validate` works now; the extension commands (`init`, `validate`, `package`) arrive in
 * Phase 9, together with a `bin` entry and a build step.
 */
import { validatePacks } from './pack-validate';

export interface CliIo {
  out: (line: string) => void;
  err: (line: string) => void;
}

export const CLI_NAME = 'raml-kql-ext';
export const CLI_VERSION = '0.0.0';

const HELP = `Usage: ${CLI_NAME} <command>

Commands:
  pack validate [dir]   Validate the query packs in a folder (default: the current folder)

Coming in a later release:
  init                  Scaffold a new extension
  validate              Validate an extension manifest
  package               Build a .rkqlx package

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
  if (first === 'pack') {
    const [, sub, dir = '.'] = argv;
    if (sub === 'validate') return validatePacks(dir, io);
    io.err(`${CLI_NAME}: unknown pack command '${sub ?? ''}'. Try '${CLI_NAME} pack validate'.`);
    return 2;
  }
  io.err(`${CLI_NAME}: unknown command '${first}'. Run '${CLI_NAME} --help'.`);
  return 2;
}
