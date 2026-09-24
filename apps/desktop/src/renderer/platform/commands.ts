import { create } from 'zustand';

import { getContextValues } from './context-keys';
import { notify } from './notifications';
import { matchesWhen } from './when';

/**
 * Central command registry (VS Code's model, spec 01). Menus, keybindings, the command palette
 * and later extensions all refer to commands by id.
 */
export interface CommandDescriptor {
  id: string;
  /** Title in the palette, e.g. "Toggle Primary Side Bar Visibility". */
  title: string;
  /** Palette prefix, e.g. "View" → "View: Toggle ...". */
  category?: string;
  /** Codicon name. */
  icon?: string;
  /** Only runnable (and listed) while this when-clause holds. */
  when?: string;
  /** Hide from the command palette (still runnable by keybinding or menu). */
  hideFromPalette?: boolean;
  run: (...args: unknown[]) => unknown;
}

interface CommandsState {
  commands: ReadonlyMap<string, CommandDescriptor>;
  /** Most recently used command ids, newest first (command palette history). */
  recent: string[];
}

export const useCommands = create<CommandsState>(() => ({ commands: new Map(), recent: [] }));

export function registerCommand(descriptor: CommandDescriptor): () => void {
  useCommands.setState((state) => {
    const commands = new Map(state.commands);
    commands.set(descriptor.id, descriptor);
    return { commands };
  });
  return () => {
    useCommands.setState((state) => {
      const commands = new Map(state.commands);
      if (commands.get(descriptor.id) === descriptor) commands.delete(descriptor.id);
      return { commands };
    });
  };
}

export function getCommand(id: string): CommandDescriptor | undefined {
  return useCommands.getState().commands.get(id);
}

export function commandLabel(command: CommandDescriptor): string {
  return command.category === undefined ? command.title : `${command.category}: ${command.title}`;
}

export function isCommandEnabled(command: CommandDescriptor): boolean {
  return matchesWhen(command.when, getContextValues());
}

/** Record a palette pick so it shows under "recently used". */
export function recordRecentCommand(id: string, limit: number): void {
  useCommands.setState((state) => ({
    recent: limit <= 0 ? [] : [id, ...state.recent.filter((r) => r !== id)].slice(0, limit),
  }));
}

/**
 * Run a command. Unknown or currently disabled commands are ignored (returns false); errors
 * thrown by a command become an error notification rather than breaking the workbench.
 */
export async function executeCommand(id: string, ...args: unknown[]): Promise<boolean> {
  const command = getCommand(id);
  if (command === undefined || !isCommandEnabled(command)) return false;
  try {
    await command.run(...args);
  } catch (error) {
    notify({
      severity: 'error',
      message: `Command "${commandLabel(command)}" failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    });
  }
  return true;
}
