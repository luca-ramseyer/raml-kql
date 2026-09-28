import { create } from 'zustand';

/**
 * Modal dialogs (VS Code's custom dialog style): a message, optional detail content and
 * buttons. `showDialog` resolves with the index of the clicked button, or `undefined` when
 * the dialog was cancelled (Escape).
 */
export interface DialogOptions {
  severity: 'info' | 'warning' | 'error' | 'shield';
  message: string;
  detail?: React.ReactNode;
  buttons: string[];
  /** The button focused when the dialog opens. */
  defaultButton?: number;
  /** An accessible label (defaults to the message). */
  label?: string;
}

interface OpenDialog extends DialogOptions {
  id: number;
  resolve: (button: number | undefined) => void;
}

export const useDialogs = create<{ queue: OpenDialog[] }>(() => ({ queue: [] }));

let nextId = 1;

export function showDialog(options: DialogOptions): Promise<number | undefined> {
  return new Promise((resolve) => {
    const dialog: OpenDialog = { ...options, id: nextId++, resolve };
    useDialogs.setState((state) => ({ queue: [...state.queue, dialog] }));
  });
}

/** Close the front dialog with a button (or `undefined` for cancel). */
export function closeDialog(id: number, button: number | undefined): void {
  const dialog = useDialogs.getState().queue.find((d) => d.id === id);
  useDialogs.setState((state) => ({ queue: state.queue.filter((d) => d.id !== id) }));
  dialog?.resolve(button);
}

/** For tests. */
export function resetDialogs(): void {
  for (const dialog of useDialogs.getState().queue) dialog.resolve(undefined);
  useDialogs.setState({ queue: [] });
}
