import type { UpdateState } from '../../shared/update/models';

/** First automatic check, after start (spec 11). */
export const FIRST_CHECK_DELAY_MS = 30_000;
/** Interval between automatic checks. */
export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * The slice of electron-updater's `autoUpdater` the `Updater` uses. Keeping it this small lets
 * unit tests drive the state machine without Electron or the network.
 */
export interface UpdaterBackend {
  /** `beta` also considers pre-releases. */
  configure(options: { allowPrerelease: boolean }): void;
  /** Start a check; results arrive through the handlers given to `subscribe`. */
  checkForUpdates(): Promise<void>;
  quitAndInstall(): void;
  subscribe(handlers: BackendHandlers): () => void;
}

export interface BackendHandlers {
  available(version: string): void;
  notAvailable(): void;
  progress(percent: number): void;
  downloaded(version: string): void;
  error(error: unknown): void;
}

export interface UpdaterDependencies {
  backend: UpdaterBackend;
  /** `undefined` when this install can update itself; otherwise why it can't. */
  unsupportedReason: string | undefined;
  channel: () => 'stable' | 'beta';
  checkAutomatically: () => boolean;
  emit: (state: UpdateState) => void;
}

/**
 * Auto-update (spec 11): checks GitHub Releases in the background, downloads, then lets the
 * workbench offer "Restart to Update". Automatic failures are kept quiet (the state records
 * them, the workbench doesn't nag); a manual check always reports its outcome.
 */
export class Updater {
  private current: UpdateState;
  private firstCheck: ReturnType<typeof setTimeout> | undefined;
  private interval: ReturnType<typeof setInterval> | undefined;
  private unsubscribe: (() => void) | undefined;
  private inFlight: Promise<UpdateState> | undefined;

  constructor(private readonly deps: UpdaterDependencies) {
    this.current =
      deps.unsupportedReason === undefined
        ? { status: 'idle' }
        : { status: 'unsupported', reason: deps.unsupportedReason };
  }

  state(): UpdateState {
    return this.current;
  }

  /** Begin the schedule. Does nothing on installs that can't update. */
  start(): void {
    if (this.deps.unsupportedReason !== undefined || this.interval !== undefined) return;
    this.subscribe();
    this.firstCheck = setTimeout(() => {
      this.automaticCheck();
    }, FIRST_CHECK_DELAY_MS);
    this.interval = setInterval(() => {
      this.automaticCheck();
    }, CHECK_INTERVAL_MS);
  }

  private subscribe(): void {
    if (this.unsubscribe !== undefined) return;
    this.unsubscribe = this.deps.backend.subscribe({
      available: (version) => {
        this.set({ status: 'available', version });
      },
      notAvailable: () => {
        this.set({ status: 'upToDate' });
      },
      progress: (percent) => {
        if (this.current.status === 'available' || this.current.status === 'downloading') {
          this.set({
            status: 'downloading',
            version: this.current.version,
            percent: Math.max(0, Math.min(100, Math.round(percent))),
          });
        }
      },
      downloaded: (version) => {
        this.set({ status: 'ready', version });
      },
      error: (error) => {
        this.set({ status: 'error', message: describeError(error) });
      },
    });
  }

  stop(): void {
    if (this.firstCheck !== undefined) clearTimeout(this.firstCheck);
    if (this.interval !== undefined) clearInterval(this.interval);
    this.firstCheck = undefined;
    this.interval = undefined;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  /** A manual check ("Check for Updates…"). Resolves with the state the check ended in. */
  check(): Promise<UpdateState> {
    if (this.deps.unsupportedReason !== undefined) return Promise.resolve(this.current);
    if (this.inFlight !== undefined) return this.inFlight;
    // A downloaded update is already waiting; don't start over.
    if (this.current.status === 'ready' || this.current.status === 'downloading') {
      return Promise.resolve(this.current);
    }
    this.subscribe();
    this.inFlight = this.run().finally(() => {
      this.inFlight = undefined;
    });
    return this.inFlight;
  }

  install(): void {
    if (this.current.status === 'ready') this.deps.backend.quitAndInstall();
  }

  private automaticCheck(): void {
    if (!this.deps.checkAutomatically()) return;
    void this.check();
  }

  private async run(): Promise<UpdateState> {
    this.set({ status: 'checking' });
    this.deps.backend.configure({ allowPrerelease: this.deps.channel() === 'beta' });
    try {
      await this.deps.backend.checkForUpdates();
    } catch (error) {
      this.set({ status: 'error', message: describeError(error) });
      return this.current;
    }
    // Downloads continue in the background: a check that found an update resolves now with
    // "available" or "downloading"; "ready" arrives later as an event.
    return this.current;
  }

  private set(state: UpdateState): void {
    this.current = state;
    this.deps.emit(state);
  }
}

/** A short message for the user: no stack, no URLs (they can carry tokens), no file paths. */
export function describeError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const firstLine = raw.split('\n')[0] ?? '';
  const cleaned = firstLine
    .replace(/https?:\/\/\S+/g, '(url)')
    .replace(/(?:[A-Za-z]:)?[\\/][\w .\\/-]{8,}/g, '(path)')
    .trim();
  return (cleaned || 'Unknown error').slice(0, 300);
}
