import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { UpdateState } from '../../shared/update/models';

import { unsupportedReason } from './electron-backend';
import {
  CHECK_INTERVAL_MS,
  describeError,
  FIRST_CHECK_DELAY_MS,
  Updater,
  type BackendHandlers,
  type UpdaterBackend,
} from './updater';

function fakeBackend(onCheck?: (handlers: BackendHandlers) => void | Promise<void>) {
  let handlers: BackendHandlers | undefined;
  const configure = vi.fn<UpdaterBackend['configure']>();
  const backend: UpdaterBackend = {
    configure,
    checkForUpdates: vi.fn(async () => {
      if (handlers !== undefined) await onCheck?.(handlers);
    }),
    quitAndInstall: vi.fn(),
    subscribe: (h) => {
      handlers = h;
      return () => {
        handlers = undefined;
      };
    },
  };
  return Object.assign(backend, { configure });
}

function create(
  backend: UpdaterBackend,
  options: { automatic?: boolean; channel?: 'stable' | 'beta'; unsupported?: string } = {},
) {
  const states: UpdateState[] = [];
  const updater = new Updater({
    backend,
    unsupportedReason: options.unsupported,
    channel: () => options.channel ?? 'stable',
    checkAutomatically: () => options.automatic ?? true,
    emit: (state) => states.push(state),
  });
  return { updater, states };
}

describe('Updater', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('walks from available through downloading to ready, then installs', async () => {
    const backend = fakeBackend((h) => {
      h.available('1.2.0');
      h.progress(40);
      h.downloaded('1.2.0');
    });
    const { updater, states } = create(backend);
    await updater.check();
    expect(states.map((s) => s.status)).toEqual(['checking', 'available', 'downloading', 'ready']);
    expect(updater.state()).toEqual({ status: 'ready', version: '1.2.0' });
    updater.install();
    expect(backend.quitAndInstall).toHaveBeenCalledOnce();
    updater.stop();
  });

  it('does not install before an update is downloaded', async () => {
    const backend = fakeBackend((h) => {
      h.notAvailable();
    });
    const { updater } = create(backend);
    await updater.check();
    expect(updater.state()).toEqual({ status: 'upToDate' });
    updater.install();
    expect(backend.quitAndInstall).not.toHaveBeenCalled();
    updater.stop();
  });

  it('allows pre-releases only on the beta channel', async () => {
    const stable = fakeBackend();
    await create(stable, { channel: 'stable' }).updater.check();
    expect(stable.configure).toHaveBeenCalledWith({ allowPrerelease: false });
    const beta = fakeBackend();
    await create(beta, { channel: 'beta' }).updater.check();
    expect(beta.configure).toHaveBeenCalledWith({ allowPrerelease: true });
  });

  it('records a failed check as an error state with a short, URL-free message', async () => {
    const backend = fakeBackend(() => {
      throw new Error('404 https://api.github.com/repos/x/y/releases?token=abc\nstack line');
    });
    const { updater } = create(backend);
    const state = await updater.check();
    expect(state).toEqual({ status: 'error', message: '404 (url)' });
    updater.stop();
  });

  it('shares one check between concurrent callers', async () => {
    const backend = fakeBackend();
    const { updater } = create(backend);
    await Promise.all([updater.check(), updater.check()]);
    expect(backend.checkForUpdates).toHaveBeenCalledOnce();
    updater.stop();
  });

  it('does not re-check while an update is already downloaded', async () => {
    const backend = fakeBackend((h) => {
      h.available('2.0.0');
      h.downloaded('2.0.0');
    });
    const { updater } = create(backend);
    await updater.check();
    await updater.check();
    expect(backend.checkForUpdates).toHaveBeenCalledOnce();
    updater.stop();
  });

  it('checks 30 s after start, then every 6 h, honouring the setting', async () => {
    const backend = fakeBackend();
    let automatic = true;
    const updater = new Updater({
      backend,
      unsupportedReason: undefined,
      channel: () => 'stable',
      checkAutomatically: () => automatic,
      emit: () => undefined,
    });
    updater.start();
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS - 1);
    expect(backend.checkForUpdates).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(backend.checkForUpdates).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS);
    expect(backend.checkForUpdates).toHaveBeenCalledTimes(2);
    automatic = false;
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS);
    expect(backend.checkForUpdates).toHaveBeenCalledTimes(2);
    updater.stop();
  });

  it('never touches the network on installs that cannot update', async () => {
    const backend = fakeBackend();
    const { updater } = create(backend, { unsupported: 'demo' });
    updater.start();
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS * 2);
    expect(await updater.check()).toEqual({ status: 'unsupported', reason: 'demo' });
    expect(backend.checkForUpdates).not.toHaveBeenCalled();
  });
});

describe('describeError', () => {
  it('keeps only the first line and hides URLs and paths', () => {
    expect(describeError(new Error('ENOENT /Users/analyst/Library/x/app-update.yml\nat foo'))).toBe(
      'ENOENT (path)',
    );
    expect(describeError('')).toBe('Unknown error');
  });
});

describe('unsupportedReason', () => {
  const base = { packaged: true, demo: false, platform: 'darwin' as const, appImage: undefined };
  it('supports packaged builds', () => {
    expect(unsupportedReason(base)).toBeUndefined();
    expect(
      unsupportedReason({ ...base, platform: 'linux', appImage: '/x.AppImage' }),
    ).toBeUndefined();
  });
  it('rejects demo, development and deb/rpm installs', () => {
    expect(unsupportedReason({ ...base, demo: true })).toMatch(/demo/);
    expect(unsupportedReason({ ...base, packaged: false })).toMatch(/installed builds/);
    expect(unsupportedReason({ ...base, platform: 'linux' })).toMatch(/package manager/);
  });
});
