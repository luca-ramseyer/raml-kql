import { ENGINE_DEFAULTS } from './limits';

/** Full-jitter exponential backoff (spec 04): random in [0, min(cap, base · 2^(attempt-1))]. */
export function backoffMs(
  attempt: number,
  random: () => number = Math.random,
  base: number = ENGINE_DEFAULTS.backoffBaseMs,
  cap: number = ENGINE_DEFAULTS.backoffCapMs,
): number {
  const ceiling = Math.min(cap, base * 2 ** Math.max(0, attempt - 1));
  return Math.floor(random() * ceiling);
}

/** Resolves after `ms`, or rejects with an AbortError when the signal fires. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(signal.reason as Error);
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal?.reason as Error);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
