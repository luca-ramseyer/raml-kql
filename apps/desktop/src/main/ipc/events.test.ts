import { describe, expect, it, vi } from 'vitest';

import { createEventSender } from './events';

describe('createEventSender', () => {
  it('sends validated payloads on the namespaced channel to live targets only', () => {
    const live = { isDestroyed: () => false, send: vi.fn() };
    const dead = { isDestroyed: () => true, send: vi.fn() };
    const emit = createEventSender(() => [live, dead]);
    emit('menu.runCommand', { command: 'workbench.action.showCommands' });
    expect(live.send).toHaveBeenCalledWith('event:menu.runCommand', {
      command: 'workbench.action.showCommands',
    });
    expect(dead.send).not.toHaveBeenCalled();
  });

  it('refuses to send payloads that break the event contract', () => {
    const target = { isDestroyed: () => false, send: vi.fn() };
    const emit = createEventSender(() => [target]);
    expect(() => {
      emit('window.fullScreenChanged', { fullScreen: 'yes' as unknown as boolean });
    }).toThrow();
    expect(target.send).not.toHaveBeenCalled();
  });
});
