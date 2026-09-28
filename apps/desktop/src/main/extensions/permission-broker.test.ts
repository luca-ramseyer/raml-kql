import { describe, expect, it, vi } from 'vitest';

import { MemoryListStore } from '../config/jsonc-list-store';

import { PermissionBroker, type PersistedGrant, type PromptAnswer } from './permission-broker';

const NETWORK = {
  id: 'network' as const,
  hosts: ['www.virustotal.com'],
  reason: 'Query VirusTotal',
};
const EXT = 'raml.virustotal-enricher';

function setup(answers: PromptAnswer[] = []) {
  const store = new MemoryListStore<PersistedGrant>();
  const prompt = vi.fn(() => Promise.resolve(answers.shift()));
  const audit = vi.fn();
  const broker = new PermissionBroker({ store, prompt, audit });
  const fetchCheck = (
    runId: string | undefined,
    host = 'www.virustotal.com',
    invocationId?: string,
  ) =>
    broker.check({
      extensionId: EXT,
      permission: 'network',
      declared: NETWORK,
      runId,
      invocationId,
      host,
      detail: `connect to ${host}`,
    });
  return { store, prompt, audit, broker, fetchCheck };
}

describe('PermissionBroker', () => {
  it('asks once per query run by default', async () => {
    const { prompt, fetchCheck } = setup(['run', 'run']);
    expect(await fetchCheck('run-1')).toBe(true);
    expect(await fetchCheck('run-1')).toBe(true);
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(await fetchCheck('run-2')).toBe(true);
    expect(prompt).toHaveBeenCalledTimes(2);
  });

  it('never allows undeclared permissions or hosts, and never asks for them', async () => {
    const { prompt, broker, fetchCheck } = setup(['always']);
    expect(await fetchCheck('run-1', 'evil.example.com')).toBe(false);
    expect(
      await broker.check({
        extensionId: EXT,
        permission: 'results.read',
        declared: undefined,
        detail: '',
      }),
    ).toBe(false);
    expect(prompt).not.toHaveBeenCalled();
  });

  it('grants low-risk declared permissions without asking', async () => {
    const { prompt, broker } = setup();
    expect(
      await broker.check({
        extensionId: EXT,
        permission: 'secrets',
        declared: { id: 'secrets', reason: 'API key' },
        detail: '',
      }),
    ).toBe(true);
    expect(prompt).not.toHaveBeenCalled();
  });

  it('persists "always", which survives a new broker (restart), until revoked', async () => {
    const { store, fetchCheck, broker, audit } = setup(['always']);
    expect(await fetchCheck('run-1')).toBe(true);
    expect((await store.read()).items).toEqual([
      expect.objectContaining({
        extension: EXT,
        permission: 'network',
        hosts: ['www.virustotal.com'],
      }),
    ]);
    const restarted = new PermissionBroker({ store, prompt: vi.fn(), audit: vi.fn() });
    expect(
      await restarted.check({
        extensionId: EXT,
        permission: 'network',
        declared: NETWORK,
        runId: 'run-9',
        host: 'www.virustotal.com',
        detail: '',
      }),
    ).toBe(true);
    await broker.revoke(EXT, 'network');
    expect((await store.read()).items).toEqual([]);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'revoke', permission: 'network' }),
    );
  });

  it('keeps session grants until the app quits', async () => {
    const { prompt, fetchCheck, broker } = setup(['session']);
    await fetchCheck('run-1');
    expect(await fetchCheck('run-2')).toBe(true);
    expect(prompt).toHaveBeenCalledTimes(1);
    expect((await broker.grants()).map((g) => g.scope)).toEqual(['session']);
  });

  it('remembers a denial for the run instead of asking again', async () => {
    const { prompt, fetchCheck } = setup(['deny']);
    expect(await fetchCheck('run-1')).toBe(false);
    expect(await fetchCheck('run-1')).toBe(false);
    expect(prompt).toHaveBeenCalledTimes(1);
  });

  it('asks once for concurrent calls', async () => {
    const { prompt, fetchCheck } = setup(['run']);
    expect(
      await Promise.all([fetchCheck('run-1'), fetchCheck('run-1'), fetchCheck('run-1')]),
    ).toEqual([true, true, true]);
    expect(prompt).toHaveBeenCalledTimes(1);
  });

  it('scopes grants without a run to the invocation', async () => {
    const { prompt, fetchCheck, broker } = setup(['run', 'run']);
    expect(await fetchCheck(undefined, 'www.virustotal.com', 'inv-1')).toBe(true);
    expect(await fetchCheck(undefined, 'www.virustotal.com', 'inv-1')).toBe(true);
    broker.endInvocation('inv-1');
    expect(await fetchCheck(undefined, 'www.virustotal.com', 'inv-2')).toBe(true);
    expect(prompt).toHaveBeenCalledTimes(2);
  });

  it('drops always-grants that an update widens', async () => {
    const { store, broker, fetchCheck } = setup(['always']);
    await fetchCheck('run-1');
    await broker.retainFor(EXT, [
      { ...NETWORK, hosts: ['www.virustotal.com', 'other.example.com'] },
    ]);
    expect((await store.read()).items).toEqual([]);
  });

  it('asks once for several permissions of one action', async () => {
    const { prompt, broker, fetchCheck } = setup(['run']);
    const readSelection = {
      extensionId: EXT,
      permission: 'results.readSelection',
      declared: { id: 'results.readSelection' as const, reason: 'Read values' },
      runId: 'run-1',
      detail: '',
    };
    const network = {
      extensionId: EXT,
      permission: 'network',
      declared: NETWORK,
      runId: 'run-1',
      host: 'www.virustotal.com',
      detail: '',
    };
    expect(
      await broker.checkMany([readSelection, network], 'send 14 values to www.virustotal.com'),
    ).toBe(true);
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(prompt).toHaveBeenCalledWith(
      expect.objectContaining({ permission: 'results.readSelection + network', risk: 'high' }),
    );
    // Both are granted for the run: the enricher's fetches don't ask again.
    expect(await fetchCheck('run-1')).toBe(true);
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(await broker.checkMany([{ ...readSelection, runId: 'run-2' }], 'x')).toBe(false);
  });
});
