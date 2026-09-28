import { create } from 'zustand';

import type { KeybindingsSnapshot } from '../../../shared/config/config-snapshots';
import {
  DEFAULT_KEYBINDINGS,
  type DefaultKeybinding,
} from '../../../shared/keybindings/keybindings';
import { formatKeySequence, type KeyPress, type Platform } from '../../../shared/keybindings/keys';
import { getBridge } from '../../services/ipc';
import { executeCommand } from '../commands';
import { getContextValues } from '../context-keys';
import { notify } from '../notifications';
import { registerStatusBarItem, type StatusBarItemHandle } from '../statusbar';

import {
  dispatchKeyPress,
  primaryKeybinding,
  resolveKeybindings,
  type ResolvedKeybinding,
} from './keybinding-resolver';
import { keyPressFromEvent } from './keyboard-event';

interface KeybindingState {
  platform: Platform;
  bindings: ResolvedKeybinding[];
}

export const useKeybindings = create<KeybindingState>(() => ({
  platform: 'darwin',
  bindings: resolveKeybindings(DEFAULT_KEYBINDINGS, [], 'darwin').bindings,
}));

let lastProblemsSignature = '';
/** Keybindings contributed by extensions: above the defaults, below the user's own. */
let extensionKeybindings: readonly DefaultKeybinding[] = [];
let lastApplied: { platform: Platform; snapshot: KeybindingsSnapshot } = {
  platform: 'darwin',
  snapshot: { entries: [], problems: [] },
};

export function setExtensionKeybindings(bindings: readonly DefaultKeybinding[]): void {
  extensionKeybindings = bindings;
  applyKeybindingsSnapshot(lastApplied.platform, lastApplied.snapshot);
}

export function applyKeybindingsSnapshot(platform: Platform, snapshot: KeybindingsSnapshot): void {
  lastApplied = { platform, snapshot };
  const { bindings, problems } = resolveKeybindings(
    [...DEFAULT_KEYBINDINGS, ...extensionKeybindings],
    snapshot.entries,
    platform,
  );
  useKeybindings.setState({ platform, bindings });

  const allProblems = [...snapshot.problems, ...problems];
  const signature = JSON.stringify(allProblems);
  if (signature === lastProblemsSignature) return;
  lastProblemsSignature = signature;
  const [first] = allProblems;
  if (first !== undefined) {
    notify({
      key: 'keybindings-problems',
      severity: 'warning',
      message:
        first.line > 0
          ? `keybindings.jsonc has errors (line ${String(first.line)}).`
          : `keybindings.jsonc: ${first.message}`,
      detail: allProblems.map((p) => p.message).join('\n'),
      actions: [
        {
          label: 'Open keybindings.jsonc',
          run: () => void getBridge().shell.openConfigFile({ file: 'keybindings' }),
        },
      ],
    });
  }
}

/** Label such as `⇧⌘P` / `Ctrl+Shift+P` for a command, if it has a keybinding. */
export function keybindingLabel(command: string): string | undefined {
  const { bindings, platform } = useKeybindings.getState();
  const sequence = primaryKeybinding(bindings, command);
  return sequence === undefined ? undefined : formatKeySequence(sequence, platform);
}

export function useKeybindingLabel(command: string): string | undefined {
  return useKeybindings((state) => {
    const sequence = primaryKeybinding(state.bindings, command);
    return sequence === undefined ? undefined : formatKeySequence(sequence, state.platform);
  });
}

let pendingChord: KeyPress | undefined;
let chordStatus: StatusBarItemHandle | undefined;
let chordStatusTimer: ReturnType<typeof setTimeout> | undefined;

function showChordStatus(text: string, autoHide: boolean): void {
  clearTimeout(chordStatusTimer);
  chordStatus?.dispose();
  chordStatus = registerStatusBarItem({
    id: 'status.keybindingChord',
    alignment: 'left',
    priority: -1000,
    text,
  });
  if (autoHide) {
    chordStatusTimer = setTimeout(() => {
      chordStatus?.dispose();
      chordStatus = undefined;
    }, 5000);
  }
}

/** Handle a keydown for the whole workbench. Returns true when a keybinding consumed it. */
export function handleKeyDown(event: KeyboardEvent): boolean {
  if (event.isComposing) return false;
  const press = keyPressFromEvent(event);
  if (press === undefined) return false;

  const { bindings, platform } = useKeybindings.getState();
  const result = dispatchKeyPress(bindings, press, pendingChord, getContextValues());
  switch (result.kind) {
    case 'none':
      return false;
    case 'chord':
      pendingChord = result.first;
      showChordStatus(
        `(${formatKeySequence([result.first], platform)}) was pressed. Waiting for second key of chord...`,
        false,
      );
      event.preventDefault();
      event.stopPropagation();
      return true;
    case 'chordMiss':
      pendingChord = undefined;
      showChordStatus(
        `The key combination (${formatKeySequence([result.first, result.second], platform)}) is not a command.`,
        true,
      );
      event.preventDefault();
      event.stopPropagation();
      return true;
    case 'command': {
      if (pendingChord !== undefined) {
        pendingChord = undefined;
        chordStatus?.dispose();
        chordStatus = undefined;
      }
      event.preventDefault();
      event.stopPropagation();
      const { command, args } = result.binding;
      void (args === undefined ? executeCommand(command) : executeCommand(command, args));
      return true;
    }
  }
}
