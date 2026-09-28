import { getNodeValue } from 'jsonc-parser';

import type { ConfigProblem, KeybindingsSnapshot } from '../../shared/config/config-snapshots';
import { describeIssues } from '../../shared/ipc/channel';
import { KeybindingEntrySchema, type KeybindingEntry } from '../../shared/keybindings/keybindings';
import { lineOf, parseJsonc, readTextFile } from '../config/jsonc';

/** Maximum user keybindings; far above any real use, bounds work on a hostile file. */
const MAX_ENTRIES = 2000;

/**
 * Validate keybindings.jsonc (VS Code format: an array of `{ key, command, when?, args? }`).
 * Syntax errors keep the previous entries; individually invalid entries are skipped and
 * reported. Key strings and when-clauses are checked by the renderer's keybinding service.
 */
export function evaluateKeybindingsText(
  text: string | undefined,
  previous: readonly KeybindingEntry[],
  file = 'keybindings.jsonc',
): KeybindingsSnapshot {
  if (text === undefined || text.trim() === '') return { entries: [], problems: [] };

  const { tree, problems } = parseJsonc(text, file);
  if (problems.length > 0) return { entries: [...previous], problems };
  if (tree?.type !== 'array') {
    return {
      entries: [...previous],
      problems: [{ file, line: 1, message: `${file} must contain a JSON array.` }],
    };
  }

  const entries: KeybindingEntry[] = [];
  const entryProblems: ConfigProblem[] = [];
  for (const node of (tree.children ?? []).slice(0, MAX_ENTRIES)) {
    const parsed = KeybindingEntrySchema.safeParse(getNodeValue(node));
    if (parsed.success) {
      entries.push(parsed.data);
    } else {
      entryProblems.push({
        file,
        line: lineOf(text, node.offset),
        message: `Invalid keybinding: ${describeIssues(parsed.error)}`,
      });
    }
  }
  return { entries, problems: entryProblems };
}

export const NEW_KEYBINDINGS_FILE = `// Place your key bindings in this file to override the defaults.
// Format (same as VS Code): { "key": "ctrl+shift+b", "command": "<command id>", "when": "..." }
// Prefix a command with "-" to remove a default keybinding.
[
]
`;

export class KeybindingsService {
  private snapshot: KeybindingsSnapshot = { entries: [], problems: [] };
  private readonly listeners = new Set<(snapshot: KeybindingsSnapshot) => void>();

  constructor(private readonly filePath: string) {}

  get current(): KeybindingsSnapshot {
    return this.snapshot;
  }

  onDidChange(listener: (snapshot: KeybindingsSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async reload(): Promise<KeybindingsSnapshot> {
    let next: KeybindingsSnapshot;
    try {
      next = evaluateKeybindingsText(await readTextFile(this.filePath), this.snapshot.entries);
    } catch (error) {
      next = {
        entries: this.snapshot.entries,
        problems: [
          {
            file: 'keybindings.jsonc',
            line: 0,
            message: `Could not read: ${(error as Error).message}`,
          },
        ],
      };
    }
    if (JSON.stringify(next) !== JSON.stringify(this.snapshot)) {
      this.snapshot = next;
      for (const listener of this.listeners) listener(next);
    }
    return this.snapshot;
  }
}
