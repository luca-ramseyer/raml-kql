import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearAllNotifications,
  dismissNotification,
  MAX_VISIBLE_TOASTS,
  notify,
  TOAST_AUTO_HIDE_MS,
  toggleNotificationCenter,
  useNotifications,
} from './notifications';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  clearAllNotifications();
  useNotifications.setState({ notifications: [], toasts: [], centerVisible: false });
  vi.useRealTimers();
});

describe('notifications', () => {
  it('shows a toast and keeps the notification in the center', () => {
    const id = notify({ message: 'Hello' });
    expect(useNotifications.getState().toasts).toEqual([id]);
    expect(useNotifications.getState().notifications[0]).toMatchObject({
      message: 'Hello',
      severity: 'info',
    });
  });

  it('auto-hides info toasts without actions, like VS Code', () => {
    notify({ message: 'info' });
    const withAction = notify({ message: 'act', actions: [{ label: 'Do', run: vi.fn() }] });
    const error = notify({ severity: 'error', message: 'err' });
    vi.advanceTimersByTime(TOAST_AUTO_HIDE_MS);
    expect(useNotifications.getState().toasts).toEqual([withAction, error]);
    expect(useNotifications.getState().notifications).toHaveLength(3);
  });

  it(`shows at most ${String(MAX_VISIBLE_TOASTS)} toasts`, () => {
    for (let i = 0; i < 5; i++) notify({ severity: 'warning', message: String(i) });
    expect(useNotifications.getState().toasts).toHaveLength(MAX_VISIBLE_TOASTS);
  });

  it('replaces notifications with the same key', () => {
    notify({ key: 'settings', severity: 'error', message: 'line 1' });
    notify({ key: 'settings', severity: 'error', message: 'line 2' });
    expect(useNotifications.getState().notifications.map((n) => n.message)).toEqual(['line 2']);
  });

  it('dismisses and clears', () => {
    const id = notify({ severity: 'error', message: 'x' });
    dismissNotification(id);
    expect(useNotifications.getState().notifications).toEqual([]);
    notify({ severity: 'error', message: 'y' });
    clearAllNotifications();
    expect(useNotifications.getState()).toMatchObject({ notifications: [], toasts: [] });
  });

  it('opening the center hides toasts', () => {
    notify({ severity: 'error', message: 'x' });
    toggleNotificationCenter(true);
    expect(useNotifications.getState()).toMatchObject({ centerVisible: true, toasts: [] });
    notify({ severity: 'error', message: 'while open' });
    expect(useNotifications.getState().toasts).toEqual([]);
  });
});
