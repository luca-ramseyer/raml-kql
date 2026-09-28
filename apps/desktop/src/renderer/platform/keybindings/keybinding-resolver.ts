import type { ConfigProblem } from '../../../shared/config/config-snapshots';
import {
  defaultKeyFor,
  type DefaultKeybinding,
  type KeybindingEntry,
} from '../../../shared/keybindings/keybindings';
import {
  parseKeySequence,
  pressToString,
  type KeyPress,
  type KeySequence,
  type Platform,
} from '../../../shared/keybindings/keys';
import { parseWhen, type ContextValues, matchesWhen } from '../when';

export interface ResolvedKeybinding {
  command: string;
  sequence: KeySequence;
  when: string | undefined;
  args: unknown;
  source: 'default' | 'user';
}

/**
 * Combine the default keybindings with the user's keybindings.jsonc (VS Code semantics):
 * user entries come after defaults (later wins), and `-command` removes matching entries —
 * all bindings of that command, narrowed by `key` and `when` when they are given.
 */
export function resolveKeybindings(
  defaults: readonly DefaultKeybinding[],
  user: readonly KeybindingEntry[],
  platform: Platform,
): { bindings: ResolvedKeybinding[]; problems: ConfigProblem[] } {
  const problems: ConfigProblem[] = [];
  const bindings: ResolvedKeybinding[] = [];

  for (const binding of defaults) {
    const sequence = parseKeySequence(defaultKeyFor(binding, platform));
    if (sequence === undefined) continue; // a bug in the defaults; covered by a unit test
    bindings.push({
      command: binding.command,
      sequence,
      when: binding.when,
      args: undefined,
      source: 'default',
    });
  }

  for (const entry of user) {
    const sequence = parseKeySequence(entry.key);
    if (sequence === undefined) {
      problems.push({
        file: 'keybindings.jsonc',
        line: 0,
        message: `Unknown key "${entry.key}" for command "${entry.command}".`,
      });
      continue;
    }
    if (entry.when !== undefined) {
      try {
        parseWhen(entry.when);
      } catch (error) {
        problems.push({
          file: 'keybindings.jsonc',
          line: 0,
          message: `Invalid "when" for "${entry.command}": ${(error as Error).message}`,
        });
        continue;
      }
    }

    if (entry.command.startsWith('-')) {
      const command = entry.command.slice(1);
      const key = sequence.map(pressToString).join(' ');
      for (let i = bindings.length - 1; i >= 0; i--) {
        const candidate = bindings[i];
        if (
          candidate !== undefined &&
          candidate.command === command &&
          candidate.sequence.map(pressToString).join(' ') === key &&
          (entry.when === undefined || candidate.when === entry.when)
        ) {
          bindings.splice(i, 1);
        }
      }
      continue;
    }

    bindings.push({
      command: entry.command,
      sequence,
      when: entry.when,
      args: entry.args,
      source: 'user',
    });
  }
  return { bindings, problems };
}

export type DispatchResult =
  | { kind: 'none' }
  /** First press of a chord: wait for the second. */
  | { kind: 'chord'; first: KeyPress }
  | { kind: 'command'; binding: ResolvedKeybinding }
  /** A chord was started but the second press matched nothing. */
  | { kind: 'chordMiss'; first: KeyPress; second: KeyPress };

const same = (a: KeyPress, b: KeyPress | undefined): boolean =>
  b !== undefined && pressToString(a) === pressToString(b);

/**
 * Decide what a key press does. Like VS Code, the last binding (in resolution order) whose
 * first press matches and whose `when` holds wins; if it's a chord, enter chord mode.
 */
export function dispatchKeyPress(
  bindings: readonly ResolvedKeybinding[],
  press: KeyPress,
  pendingChord: KeyPress | undefined,
  context: ContextValues,
): DispatchResult {
  if (pendingChord !== undefined) {
    for (let i = bindings.length - 1; i >= 0; i--) {
      const binding = bindings[i];
      if (
        binding?.sequence.length === 2 &&
        same(pendingChord, binding.sequence[0]) &&
        same(press, binding.sequence[1]) &&
        matchesWhen(binding.when, context)
      ) {
        return { kind: 'command', binding };
      }
    }
    return { kind: 'chordMiss', first: pendingChord, second: press };
  }

  for (let i = bindings.length - 1; i >= 0; i--) {
    const binding = bindings[i];
    if (binding === undefined || !same(press, binding.sequence[0])) continue;
    if (!matchesWhen(binding.when, context)) continue;
    return binding.sequence.length === 2
      ? { kind: 'chord', first: press }
      : { kind: 'command', binding };
  }
  return { kind: 'none' };
}

/** The keybinding shown next to a command (menus, palette): the last one defined. */
export function primaryKeybinding(
  bindings: readonly ResolvedKeybinding[],
  command: string,
): KeySequence | undefined {
  for (let i = bindings.length - 1; i >= 0; i--) {
    const binding = bindings[i];
    if (binding?.command === command) return binding.sequence;
  }
  return undefined;
}
