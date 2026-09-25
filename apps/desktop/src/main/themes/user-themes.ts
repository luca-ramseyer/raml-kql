import { readdir } from 'node:fs/promises';
import path from 'node:path';

import { getNodeValue } from 'jsonc-parser';

import type { ConfigProblem, UserThemesSnapshot } from '../../shared/config/config-snapshots';
import {
  sanitizeColors,
  uiThemeFromType,
  type ColorTheme,
  type UiTheme,
} from '../../shared/theme/theme-schema';
import { parseJsonc, readTextFile } from '../config/jsonc';

const MAX_THEME_FILES = 100;
const MAX_INCLUDE_DEPTH = 5;

interface RawTheme {
  name?: unknown;
  type?: unknown;
  include?: unknown;
  colors?: unknown;
  tokenColors?: unknown;
}

interface ResolvedTheme {
  name: string | undefined;
  uiTheme: UiTheme | undefined;
  colors: Record<string, unknown>;
  tokenColors: unknown[];
}

/**
 * Load VS Code colour theme files from `<config>/themes/` (spec 09). `include` is resolved
 * relative to the including file but must stay inside the themes folder.
 */
export async function loadUserThemes(themesDir: string): Promise<UserThemesSnapshot> {
  const problems: ConfigProblem[] = [];
  let files: string[];
  try {
    files = (await readdir(themesDir))
      .filter((name) => /\.(json|jsonc)$/i.test(name))
      .sort()
      .slice(0, MAX_THEME_FILES);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { themes: [], problems };
    throw error;
  }

  const root = path.resolve(themesDir);
  const themes: ColorTheme[] = [];
  const labels = new Set<string>();
  for (const file of files) {
    const label = `themes/${file}`;
    try {
      const resolved = await resolveTheme(root, path.join(root, file), label, 0);
      const themeLabel = resolved.name ?? file.replace(/\.(json|jsonc)$/i, '');
      if (labels.has(themeLabel)) {
        problems.push({ file: label, line: 0, message: `Duplicate theme name "${themeLabel}".` });
        continue;
      }
      labels.add(themeLabel);
      themes.push({
        id: `user:${file}`,
        label: themeLabel.slice(0, 200),
        uiTheme: resolved.uiTheme ?? 'vs-dark',
        colors: sanitizeColors(resolved.colors),
        tokenColors: resolved.tokenColors.slice(0, 5000),
      });
    } catch (error) {
      problems.push({ file: label, line: 0, message: (error as Error).message });
    }
  }
  return { themes, problems };
}

async function resolveTheme(
  root: string,
  file: string,
  label: string,
  depth: number,
): Promise<ResolvedTheme> {
  if (depth > MAX_INCLUDE_DEPTH) throw new Error('Theme "include" chain is too deep.');
  const text = await readTextFile(file);
  if (text === undefined) throw new Error(`Included file not found: ${path.basename(file)}`);
  const { tree, problems } = parseJsonc(text, label);
  if (problems.length > 0) {
    const first = problems[0];
    throw new Error(`${first?.message ?? 'Syntax error'} (line ${String(first?.line ?? 0)})`);
  }
  const raw = (tree === undefined ? {} : getNodeValue(tree)) as RawTheme;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('A theme file must contain a JSON object.');
  }

  let parent: ResolvedTheme = { name: undefined, uiTheme: undefined, colors: {}, tokenColors: [] };
  if (typeof raw.include === 'string') {
    const includePath = path.resolve(path.dirname(file), raw.include);
    if (!includePath.startsWith(root + path.sep)) {
      throw new Error('Theme "include" must stay inside the themes folder.');
    }
    parent = await resolveTheme(root, includePath, label, depth + 1);
  }

  const colors =
    typeof raw.colors === 'object' && raw.colors !== null && !Array.isArray(raw.colors)
      ? (raw.colors as Record<string, unknown>)
      : {};
  return {
    name: typeof raw.name === 'string' && raw.name.trim() !== '' ? raw.name.trim() : parent.name,
    uiTheme: uiThemeFromType(raw.type) ?? parent.uiTheme,
    colors: { ...parent.colors, ...colors },
    // `tokenColors` may also be a path to a .tmTheme file; that form isn't supported.
    tokenColors: [
      ...parent.tokenColors,
      ...(Array.isArray(raw.tokenColors) ? (raw.tokenColors as unknown[]) : []),
    ],
  };
}

/** Holds the current user themes and notifies when the themes folder changes. */
/** A colour theme contributed by an extension (spec 07: data only, no include files). */
export interface ExtensionThemeSource {
  extensionId: string;
  label: string;
  uiTheme: string;
  json: string;
}

export function extensionTheme(source: ExtensionThemeSource): ColorTheme {
  const { tree, problems } = parseJsonc(source.json, source.label);
  if (problems.length > 0 || tree === undefined)
    throw new Error('The theme file is not valid JSON.');
  const raw = getNodeValue(tree) as RawTheme;
  const colors =
    typeof raw.colors === 'object' && raw.colors !== null && !Array.isArray(raw.colors)
      ? (raw.colors as Record<string, unknown>)
      : {};
  return {
    id: `extension:${source.extensionId}:${source.label}`,
    label: source.label.slice(0, 200),
    uiTheme:
      (['vs', 'vs-dark', 'hc-black', 'hc-light'] as const).find((t) => t === source.uiTheme) ??
      'vs-dark',
    colors: sanitizeColors(colors),
    tokenColors: (Array.isArray(raw.tokenColors) ? (raw.tokenColors as unknown[]) : []).slice(
      0,
      5000,
    ),
  };
}

export class UserThemesService {
  private snapshot: UserThemesSnapshot = { themes: [], problems: [] };
  private readonly listeners = new Set<(snapshot: UserThemesSnapshot) => void>();
  private extensionThemes: () => Promise<ExtensionThemeSource[]> = () => Promise.resolve([]);

  constructor(private readonly themesDir: string) {}

  /** Themes from enabled extensions join the user's themes (call `reload` after changes). */
  setExtensionThemes(provider: () => Promise<ExtensionThemeSource[]>): void {
    this.extensionThemes = provider;
  }

  get current(): UserThemesSnapshot {
    return this.snapshot;
  }

  onDidChange(listener: (snapshot: UserThemesSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async reload(): Promise<UserThemesSnapshot> {
    let next: UserThemesSnapshot;
    try {
      next = await loadUserThemes(this.themesDir);
      const labels = new Set(next.themes.map((t) => t.label));
      for (const source of await this.extensionThemes()) {
        try {
          const theme = extensionTheme(source);
          if (labels.has(theme.label)) continue;
          labels.add(theme.label);
          next = { ...next, themes: [...next.themes, theme] };
        } catch (error) {
          next = {
            ...next,
            problems: [
              ...next.problems,
              {
                file: `extension ${source.extensionId}`,
                line: 0,
                message: (error as Error).message,
              },
            ],
          };
        }
      }
    } catch (error) {
      next = {
        themes: this.snapshot.themes,
        problems: [{ file: 'themes/', line: 0, message: (error as Error).message }],
      };
    }
    if (JSON.stringify(next) !== JSON.stringify(this.snapshot)) {
      this.snapshot = next;
      for (const listener of this.listeners) listener(next);
    }
    return this.snapshot;
  }
}
