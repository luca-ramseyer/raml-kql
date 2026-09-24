import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Resolve the config directory (spec 09, "Location"):
 * 1. `--config-dir <path>` / `--config-dir=<path>`
 * 2. `RAML_KQL_CONFIG_DIR`
 * 3. `~/.raml-kql/`, or `$XDG_CONFIG_HOME/raml-kql/` on Linux when XDG_CONFIG_HOME is set,
 *    or `%USERPROFILE%\.raml-kql\` on Windows.
 */
export function resolveConfigDir(options: {
  argv: readonly string[];
  env: Readonly<Record<string, string | undefined>>;
  platform: NodeJS.Platform;
  homeDir: string;
}): string {
  const { argv, env, platform, homeDir } = options;
  const pathApi = platform === 'win32' ? path.win32 : path.posix;

  const flagIndex = argv.indexOf('--config-dir');
  const flagValue =
    flagIndex >= 0
      ? argv[flagIndex + 1]
      : argv.find((arg) => arg.startsWith('--config-dir='))?.slice('--config-dir='.length);
  if (flagValue !== undefined && flagValue.trim() !== '' && !flagValue.startsWith('--')) {
    return pathApi.resolve(flagValue);
  }

  const envValue = env['RAML_KQL_CONFIG_DIR'];
  if (envValue !== undefined && envValue.trim() !== '') {
    return pathApi.resolve(envValue);
  }

  if (platform === 'linux') {
    const xdg = env['XDG_CONFIG_HOME'];
    if (xdg !== undefined && xdg.trim() !== '') return pathApi.join(xdg, 'raml-kql');
  }
  if (platform === 'win32') {
    return pathApi.join(env['USERPROFILE'] ?? homeDir, '.raml-kql');
  }
  return pathApi.join(homeDir, '.raml-kql');
}

/** Paths of the files and folders inside the config dir that the app uses. */
export interface ConfigPaths {
  readonly root: string;
  readonly settingsFile: string;
  readonly keybindingsFile: string;
  readonly themesDir: string;
  readonly stateDir: string;
  readonly layoutStateFile: string;
}

export function configPaths(root: string): ConfigPaths {
  return {
    root,
    settingsFile: path.join(root, 'settings.jsonc'),
    keybindingsFile: path.join(root, 'keybindings.jsonc'),
    themesDir: path.join(root, 'themes'),
    stateDir: path.join(root, 'state'),
    layoutStateFile: path.join(root, 'state', 'ui-layout.json'),
  };
}

const GITIGNORE = `# Written by Raml KQL. Machine-local data that should not be shared or committed.
state/
sources/
extensions/
audit/
`;

const README = `# Raml KQL configuration

This folder holds your Raml KQL configuration as plain, human-readable files. You can keep it
in a dotfiles repository, share parts of it with your team, or symlink it.

Shareable (no secrets, no machine paths):

- settings.jsonc      all settings
- keybindings.jsonc   keyboard shortcuts (VS Code format)
- themes/             colour themes (VS Code colour theme JSON), listed automatically

Machine-local (ignored by the .gitignore next to this file):

- state/              window layout, open tabs, history, caches
- sources/, extensions/, audit/

No tokens, passwords or query results are ever stored here.
`;

/** Create the config dir and its first-run files. Existing files are never overwritten. */
export async function ensureConfigDir(paths: ConfigPaths): Promise<void> {
  await mkdir(paths.root, { recursive: true });
  await mkdir(paths.stateDir, { recursive: true });
  await mkdir(paths.themesDir, { recursive: true });
  await writeIfMissing(path.join(paths.root, '.gitignore'), GITIGNORE);
  await writeIfMissing(path.join(paths.root, 'README.md'), README);
}

async function writeIfMissing(file: string, content: string): Promise<void> {
  try {
    await writeFile(file, content, { encoding: 'utf8', flag: 'wx' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
}
