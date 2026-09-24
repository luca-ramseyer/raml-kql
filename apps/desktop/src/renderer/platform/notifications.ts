import { create } from 'zustand';

/** Notifications (spec 05): VS Code-style toasts bottom-right plus a notification center. */

export type Severity = 'info' | 'warning' | 'error';

export interface NotificationAction {
  label: string;
  run: () => void;
}

export interface AppNotification {
  id: number;
  severity: Severity;
  message: string;
  /** Optional extra detail (already redacted), shown expanded. */
  detail?: string | undefined;
  source?: string | undefined;
  actions: NotificationAction[];
  createdAt: number;
}

export interface NotifyOptions {
  severity?: Severity;
  message: string;
  detail?: string | undefined;
  source?: string | undefined;
  actions?: NotificationAction[];
  /** Replace an existing notification with the same key instead of adding another. */
  key?: string;
}

interface NotificationsState {
  notifications: AppNotification[];
  /** Ids currently shown as toasts, oldest first. */
  toasts: number[];
  centerVisible: boolean;
}

export const MAX_VISIBLE_TOASTS = 3;
/** Info toasts without actions hide themselves after this delay, as in VS Code. */
export const TOAST_AUTO_HIDE_MS = 10_000;

export const useNotifications = create<NotificationsState>(() => ({
  notifications: [],
  toasts: [],
  centerVisible: false,
}));

let nextId = 1;
const keyed = new Map<string, number>();
const timers = new Map<number, ReturnType<typeof setTimeout>>();

export function notify(options: NotifyOptions): number {
  if (options.key !== undefined) {
    const previous = keyed.get(options.key);
    if (previous !== undefined) dismissNotification(previous);
  }
  const notification: AppNotification = {
    id: nextId++,
    severity: options.severity ?? 'info',
    message: options.message,
    detail: options.detail,
    source: options.source,
    actions: options.actions ?? [],
    createdAt: Date.now(),
  };
  if (options.key !== undefined) keyed.set(options.key, notification.id);

  useNotifications.setState((state) => ({
    notifications: [notification, ...state.notifications].slice(0, 200),
    toasts: state.centerVisible
      ? state.toasts
      : [...state.toasts, notification.id].slice(-MAX_VISIBLE_TOASTS),
  }));

  if (notification.severity === 'info' && notification.actions.length === 0) {
    timers.set(
      notification.id,
      setTimeout(() => {
        hideToast(notification.id);
      }, TOAST_AUTO_HIDE_MS),
    );
  }
  return notification.id;
}

/** Hide the toast but keep the notification in the center. */
export function hideToast(id: number): void {
  clearTimeout(timers.get(id));
  timers.delete(id);
  useNotifications.setState((state) => ({ toasts: state.toasts.filter((t) => t !== id) }));
}

export function hideAllToasts(): void {
  for (const id of useNotifications.getState().toasts) hideToast(id);
}

/** Remove the notification entirely (close button). */
export function dismissNotification(id: number): void {
  hideToast(id);
  for (const [key, value] of keyed) if (value === id) keyed.delete(key);
  useNotifications.setState((state) => ({
    notifications: state.notifications.filter((n) => n.id !== id),
  }));
}

export function clearAllNotifications(): void {
  for (const notification of useNotifications.getState().notifications) {
    dismissNotification(notification.id);
  }
}

export function toggleNotificationCenter(visible?: boolean): void {
  useNotifications.setState((state) => {
    const centerVisible = visible ?? !state.centerVisible;
    return { centerVisible, toasts: centerVisible ? [] : state.toasts };
  });
}
