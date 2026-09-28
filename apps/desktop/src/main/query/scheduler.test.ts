import { afterEach, describe, expect, it, vi } from 'vitest';

import { backoffMs, sleep } from './retry';
import { Scheduler } from './scheduler';

afterEach(() => {
  vi.useRealTimers();
});

function scheduler(options: { perPrincipal?: number; total?: number; capacity?: number } = {}) {
  return new Scheduler({
    perPrincipal: () => options.perPrincipal ?? 2,
    total: () => options.total ?? 16,
    bucketCapacity: options.capacity ?? 150,
    bucketWindowMs: 30_000,
  });
}

describe('Scheduler', () => {
  it('limits concurrency per principal and overall', async () => {
    const s = scheduler({ perPrincipal: 2, total: 3 });
    const a1 = await s.acquire('a');
    await s.acquire('a');
    let a3Granted = false;
    void s.acquire('a').then(() => (a3Granted = true));
    await s.acquire('b'); // b has its own queue; total is now 3
    let b2Granted = false;
    void s.acquire('b').then(() => (b2Granted = true));
    await Promise.resolve();
    expect([a3Granted, b2Granted, s.activeCount, s.queuedCount]).toEqual([false, false, 3, 2]);
    a1();
    await Promise.resolve();
    // First in, first out: the waiting `a` gets the freed slot.
    expect([a3Granted, b2Granted]).toEqual([true, false]);
    a1(); // releasing twice is harmless
    expect(s.activeCount).toBe(3);
  });

  it('pauses a principal during cooldown without blocking others', async () => {
    vi.useFakeTimers();
    const s = scheduler();
    s.cooldown('a', Date.now() + 1000);
    let aGranted = false;
    void s.acquire('a').then(() => (aGranted = true));
    await s.acquire('b');
    await vi.advanceTimersByTimeAsync(999);
    expect(aGranted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(aGranted).toBe(true);
  });

  it('enforces the request rate with a token bucket', async () => {
    vi.useFakeTimers();
    const s = scheduler({ perPrincipal: 10, capacity: 2 });
    (await s.acquire('a'))();
    (await s.acquire('a'))();
    let third = false;
    void s.acquire('a').then(() => (third = true));
    await vi.advanceTimersByTimeAsync(14_000);
    expect(third).toBe(false);
    await vi.advanceTimersByTimeAsync(1_100); // one token per 15 s at capacity 2 / 30 s
    expect(third).toBe(true);
  });

  it('rejects waiters whose signal aborts', async () => {
    const s = scheduler({ perPrincipal: 1 });
    await s.acquire('a');
    const controller = new AbortController();
    const waiting = s.acquire('a', controller.signal);
    controller.abort(new Error('stop'));
    await expect(waiting).rejects.toThrow('stop');
    expect(s.queuedCount).toBe(0);
    const aborted = new AbortController();
    aborted.abort(new Error('already'));
    await expect(s.acquire('a', aborted.signal)).rejects.toThrow('already');
  });
});

describe('retry helpers', () => {
  it('uses full-jitter exponential backoff with a cap', () => {
    expect(backoffMs(1, () => 0.999)).toBe(999);
    expect(backoffMs(2, () => 0.5)).toBe(1000);
    expect(backoffMs(3, () => 0.999)).toBe(3996);
    expect(backoffMs(10, () => 0.999)).toBe(29_970);
    expect(backoffMs(3, () => 0)).toBe(0);
  });

  it('sleeps and can be aborted', async () => {
    await expect(sleep(1)).resolves.toBeUndefined();
    const controller = new AbortController();
    const pending = sleep(10_000, controller.signal);
    controller.abort(new Error('cancelled'));
    await expect(pending).rejects.toThrow('cancelled');
  });
});
