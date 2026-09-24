import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  commandLabel,
  executeCommand,
  recordRecentCommand,
  registerCommand,
  useCommands,
} from './commands';
import { setContextKey, useContextKeys } from './context-keys';
import { useNotifications } from './notifications';

afterEach(() => {
  useCommands.setState({ commands: new Map(), recent: [] });
  useContextKeys.setState({ values: {} });
  useNotifications.setState({ notifications: [], toasts: [], centerVisible: false });
});

describe('command registry', () => {
  it('runs registered commands with arguments', async () => {
    const run = vi.fn();
    registerCommand({ id: 'test.run', title: 'Run', run });
    expect(await executeCommand('test.run', 1, 'two')).toBe(true);
    expect(run).toHaveBeenCalledWith(1, 'two');
  });

  it('ignores unknown commands', async () => {
    expect(await executeCommand('nope')).toBe(false);
  });

  it('respects when-clauses', async () => {
    const run = vi.fn();
    registerCommand({ id: 'test.when', title: 'When', when: 'panelVisible', run });
    expect(await executeCommand('test.when')).toBe(false);
    setContextKey('panelVisible', true);
    expect(await executeCommand('test.when')).toBe(true);
    expect(run).toHaveBeenCalledOnce();
  });

  it('turns command failures into error notifications', async () => {
    registerCommand({
      id: 'test.fail',
      title: 'Fail',
      category: 'Test',
      run: () => {
        throw new Error('boom');
      },
    });
    await executeCommand('test.fail');
    const [notification] = useNotifications.getState().notifications;
    expect(notification).toMatchObject({ severity: 'error' });
    expect(notification?.message).toContain('Test: Fail');
    expect(notification?.message).toContain('boom');
  });

  it('unregisters', () => {
    const dispose = registerCommand({ id: 'test.x', title: 'X', run: vi.fn() });
    dispose();
    expect(useCommands.getState().commands.has('test.x')).toBe(false);
  });

  it('labels with the category', () => {
    expect(commandLabel({ id: 'a', title: 'Toggle Panel', category: 'View', run: vi.fn() })).toBe(
      'View: Toggle Panel',
    );
  });

  it('keeps a bounded most-recent-first history', () => {
    recordRecentCommand('a', 2);
    recordRecentCommand('b', 2);
    recordRecentCommand('a', 2);
    recordRecentCommand('c', 2);
    expect(useCommands.getState().recent).toEqual(['c', 'a']);
    recordRecentCommand('d', 0);
    expect(useCommands.getState().recent).toEqual([]);
  });
});
