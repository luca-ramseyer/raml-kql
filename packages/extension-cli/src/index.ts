/**
 * raml-kql-ext — command-line tool for extension authors (spec 07).
 *
 * Phase 0 placeholder: argument handling only. `init`, `validate` and `package` arrive in
 * Phase 9, together with a `bin` entry and a build step.
 */

export interface CliIo {
  out: (line: string) => void;
  err: (line: string) => void;
}

export const CLI_NAME = 'raml-kql-ext';
export const CLI_VERSION = '0.0.0';

const HELP = `Usage: ${CLI_NAME} <command>

Commands (coming in a later release):
  init        Scaffold a new extension
  validate    Validate an extension manifest
  package     Build a .rkqlx package

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
  io.err(`${CLI_NAME}: unknown command '${first}'. Run '${CLI_NAME} --help'.`);
  return 2;
}
