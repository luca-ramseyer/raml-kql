/**
 * Fan-out scheduling (spec 04): one queue per principal (the Log Analytics limits are per
 * user), each with a concurrency limit, a token bucket for the request rate and a cooldown
 * after throttling, plus an overall concurrency cap. Waiters are served first in, first out,
 * skipping those whose principal is currently blocked.
 */
export interface SchedulerOptions {
  perPrincipal: () => number;
  total: () => number;
  bucketCapacity: number;
  bucketWindowMs: number;
  now?: () => number;
}

interface Principal {
  running: number;
  tokens: number;
  refilledAt: number;
  cooldownUntil: number;
}

interface Waiter {
  principal: string;
  resolve: (release: () => void) => void;
  reject: (reason: unknown) => void;
  signal: AbortSignal | undefined;
  onAbort: () => void;
}

export class Scheduler {
  private readonly principals = new Map<string, Principal>();
  private readonly waiters: Waiter[] = [];
  private running = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly now: () => number;

  constructor(private readonly options: SchedulerOptions) {
    this.now = options.now ?? Date.now;
  }

  /** Wait for a slot; the returned function must be called exactly once when done. */
  acquire(principal: string, signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted === true) return Promise.reject(signal.reason as Error);
    return new Promise((resolve, reject) => {
      const waiter: Waiter = {
        principal,
        resolve,
        reject,
        signal,
        onAbort: () => {
          const index = this.waiters.indexOf(waiter);
          if (index >= 0) this.waiters.splice(index, 1);
          reject(signal?.reason as Error);
        },
      };
      signal?.addEventListener('abort', waiter.onAbort, { once: true });
      this.waiters.push(waiter);
      this.pump();
    });
  }

  /** Pause every request of a principal until `untilMs` (after a 429). */
  cooldown(principal: string, untilMs: number): void {
    const state = this.state(principal);
    state.cooldownUntil = Math.max(state.cooldownUntil, untilMs);
    this.pump();
  }

  /** For the status bar / tests. */
  get activeCount(): number {
    return this.running;
  }

  get queuedCount(): number {
    return this.waiters.length;
  }

  private state(principal: string): Principal {
    let state = this.principals.get(principal);
    if (state === undefined) {
      state = {
        running: 0,
        tokens: this.options.bucketCapacity,
        refilledAt: this.now(),
        cooldownUntil: 0,
      };
      this.principals.set(principal, state);
    }
    return state;
  }

  private refill(state: Principal, now: number): void {
    const rate = this.options.bucketCapacity / this.options.bucketWindowMs;
    state.tokens = Math.min(
      this.options.bucketCapacity,
      state.tokens + (now - state.refilledAt) * rate,
    );
    state.refilledAt = now;
  }

  private pump(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    const now = this.now();
    let wakeAt = Infinity;
    for (let i = 0; i < this.waiters.length && this.running < this.options.total();) {
      const waiter = this.waiters[i];
      if (waiter === undefined) break;
      const state = this.state(waiter.principal);
      this.refill(state, now);
      if (state.cooldownUntil > now) {
        wakeAt = Math.min(wakeAt, state.cooldownUntil);
        i++;
        continue;
      }
      if (state.running >= this.options.perPrincipal()) {
        i++;
        continue;
      }
      if (state.tokens < 1) {
        const rate = this.options.bucketCapacity / this.options.bucketWindowMs;
        wakeAt = Math.min(wakeAt, now + Math.ceil((1 - state.tokens) / rate));
        i++;
        continue;
      }
      this.waiters.splice(i, 1);
      waiter.signal?.removeEventListener('abort', waiter.onAbort);
      state.tokens -= 1;
      state.running += 1;
      this.running += 1;
      let released = false;
      waiter.resolve(() => {
        if (released) return;
        released = true;
        state.running -= 1;
        this.running -= 1;
        this.pump();
      });
    }
    if (wakeAt !== Infinity && this.waiters.length > 0) {
      this.timer = setTimeout(
        () => {
          this.pump();
        },
        Math.max(1, wakeAt - now),
      );
    }
  }
}
