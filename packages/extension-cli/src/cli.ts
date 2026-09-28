/** The `raml-kql-ext` executable (built to dist/cli.js). */
import { runCli } from './index';

process.exitCode = runCli(process.argv.slice(2), {
  out: (line) => {
    console.log(line);
  },
  err: (line) => {
    console.error(line);
  },
});
