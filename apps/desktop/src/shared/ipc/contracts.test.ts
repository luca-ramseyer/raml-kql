import { describe, expect, it } from 'vitest';

import { listChannels } from './contracts';
import { eventChannel, ipcEvents } from './events';

describe('IPC contract table', () => {
  it('uses unique "namespace:method" channel names', () => {
    const channels = listChannels();
    for (const { namespace, method, channel } of channels) {
      expect(channel.name).toBe(`${namespace}:${method}`);
    }
    expect(new Set(channels.map((c) => c.channel.name)).size).toBe(channels.length);
  });

  it('keeps event channels separate from invoke channels', () => {
    const invoke = new Set(listChannels().map((c) => c.channel.name));
    for (const name of Object.keys(ipcEvents) as (keyof typeof ipcEvents)[]) {
      expect(eventChannel(name).startsWith('event:')).toBe(true);
      expect(invoke.has(eventChannel(name))).toBe(false);
    }
  });
});
