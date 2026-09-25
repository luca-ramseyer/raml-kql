import { describe, expect, it } from 'vitest';

import type { CallMessage, DoneMessage, HostToWorker, WorkerToHost } from './protocol';
import { createExtensionRuntime } from './runtime';
import type { ExtensionContext, RamlKqlApi } from './types';

/** A fake host: answers calls with `handle`, and can invoke the worker. */
function setup(handle: (call: CallMessage) => unknown) {
  let toWorker: (message: HostToWorker) => void = () => undefined;
  const calls: CallMessage[] = [];
  const done = new Map<number, DoneMessage>();
  const runtime = createExtensionRuntime({
    postMessage(message: WorkerToHost) {
      if (message.t === 'done') {
        done.set(message.id, message);
        return;
      }
      if (message.t !== 'call') return;
      calls.push(message);
      void Promise.resolve()
        .then(() => handle(message))
        .then(
          (value) => {
            toWorker({ t: 'reply', id: message.id, ok: true, value });
          },
          (error: unknown) => {
            toWorker({ t: 'reply', id: message.id, ok: false, error: String(error) });
          },
        );
    },
    onMessage(listener) {
      toWorker = listener;
    },
  });
  let invokeId = 1;
  const invoke = async (
    kind: Parameters<typeof toWorker>[0] extends infer M
      ? M extends { t: 'invoke'; kind: infer K }
        ? K
        : never
      : never,
    payload: unknown,
  ) => {
    const id = invokeId++;
    toWorker({ t: 'invoke', id, kind, payload });
    await new Promise<void>((resolve) => {
      const check = (): void => {
        if (done.has(id)) resolve();
        else setTimeout(check, 1);
      };
      check();
    });
    return done.get(id);
  };
  return { runtime, calls, invoke };
}

describe('extension runtime', () => {
  it('activates the module, registers commands and runs them', async () => {
    const { runtime, calls, invoke } = setup(() => undefined);
    let api: RamlKqlApi | undefined;
    runtime.setModule({
      activate(context: ExtensionContext) {
        api = runtime.api;
        context.subscriptions.push(
          runtime.api.commands.registerCommand('hello.world', (name) => `Hello ${String(name)}`),
        );
      },
    });
    const activated = await invoke('activate', {
      extensionId: 'contoso.hello',
      version: '1.0.0',
      env: { appVersion: '0.9.0', apiVersion: '1.0.0', theme: 'dark', presentationMode: true },
    });
    expect(activated?.ok).toBe(true);
    expect(api?.env.appVersion).toBe('0.9.0');
    expect(calls.map((c) => c.method)).toEqual(['commands.register']);
    expect(await invoke('command', { command: 'hello.world', args: ['Contoso'] })).toMatchObject({
      ok: true,
      value: 'Hello Contoso',
    });
    expect(await invoke('command', { command: 'missing.command' })).toMatchObject({ ok: false });
    await invoke('deactivate', {});
    expect(calls.map((c) => c.method)).toContain('commands.unregister');
  });

  it('turns net.fetch replies into a Response-like object and rejects refused calls', async () => {
    const { runtime } = setup((call) => {
      if (call.method === 'net.fetch') {
        return {
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'application/json' },
          body: '{"a":1}',
        };
      }
      throw new Error('Permission denied: network');
    });
    const response = await runtime.api.net.fetch('https://www.virustotal.com/api');
    expect(response.ok).toBe(true);
    expect(await response.json()).toEqual({ a: 1 });
    await expect(runtime.api.secrets.get('key')).rejects.toThrow(/Permission denied/);
  });

  it('runs enrichers with a cancellation token', async () => {
    const { runtime, invoke } = setup(() => undefined);
    runtime.api.enrichment.registerProvider('vt', {
      enrich: (entities) =>
        Promise.resolve(entities.map((entity) => ({ entity, fields: { malicious: 0 } }))),
    });
    const result = await invoke('enrich', {
      provider: 'vt',
      cancelId: 'c1',
      entities: [{ type: 'ip', value: '203.0.113.7' }],
    });
    expect(result?.value).toEqual([
      { entity: { type: 'ip', value: '203.0.113.7' }, fields: { malicious: 0 } },
    ]);
  });
});
