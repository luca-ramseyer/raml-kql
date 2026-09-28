import { useState } from 'react';

import {
  clearAllNotifications,
  dismissNotification,
  hideToast,
  toggleNotificationCenter,
  useNotifications,
  type AppNotification,
} from '../../platform/notifications';
import { Codicon } from '../common/Codicon';

import './Notifications.css';

const SEVERITY_ICON = { info: 'info', warning: 'warning', error: 'error' } as const;

function NotificationRow({
  notification,
  onClose,
}: {
  notification: AppNotification;
  onClose: () => void;
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  return (
    <div
      className={`notification severity-${notification.severity}`}
      role={notification.severity === 'error' ? 'alert' : 'status'}
      aria-label={notification.message}
    >
      <div className="notification-main">
        <Codicon name={SEVERITY_ICON[notification.severity]} className="notification-icon" />
        <div className="notification-message">{notification.message}</div>
        <div className="notification-toolbar">
          {notification.detail === undefined ? null : (
            <button
              type="button"
              className="action-item"
              title={expanded ? 'Collapse' : 'Show Details'}
              aria-label={expanded ? 'Collapse' : 'Show Details'}
              aria-expanded={expanded}
              onClick={() => {
                setExpanded(!expanded);
              }}
            >
              <Codicon name={expanded ? 'chevron-down' : 'chevron-up'} />
            </button>
          )}
          <button
            type="button"
            className="action-item"
            title="Clear Notification"
            aria-label="Clear Notification"
            onClick={onClose}
          >
            <Codicon name="close" />
          </button>
        </div>
      </div>
      {expanded && notification.detail !== undefined ? (
        <pre className="notification-detail">{notification.detail}</pre>
      ) : null}
      <div className="notification-footer">
        {notification.source === undefined ? (
          <span />
        ) : (
          <span className="notification-source">Source: {notification.source}</span>
        )}
        <div className="notification-buttons">
          {notification.actions.map((action, index) => (
            <button
              key={action.label}
              type="button"
              className={`button ${index === 0 ? 'button-primary' : 'button-secondary'}`}
              onClick={() => {
                dismissNotification(notification.id);
                action.run();
              }}
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Toasts bottom-right, and the notification center (bell in the status bar). */
export function Notifications(): React.JSX.Element {
  const { notifications, toasts, centerVisible } = useNotifications();
  const toastItems = toasts
    .map((id) => notifications.find((n) => n.id === id))
    .filter((n): n is AppNotification => n !== undefined);

  return (
    <>
      {centerVisible ? (
        <div className="notifications-center" role="region" aria-label="Notifications">
          <div className="notifications-center-header">
            <span>{notifications.length === 0 ? 'No New Notifications' : 'Notifications'}</span>
            <div className="notification-toolbar">
              <button
                type="button"
                className="action-item"
                title="Clear All Notifications"
                aria-label="Clear All Notifications"
                onClick={clearAllNotifications}
              >
                <Codicon name="clear-all" />
              </button>
              <button
                type="button"
                className="action-item"
                title="Hide Notifications"
                aria-label="Hide Notifications"
                onClick={() => {
                  toggleNotificationCenter(false);
                }}
              >
                <Codicon name="chevron-down" />
              </button>
            </div>
          </div>
          <div className="notifications-center-list">
            {notifications.map((notification) => (
              <NotificationRow
                key={notification.id}
                notification={notification}
                onClose={() => {
                  dismissNotification(notification.id);
                }}
              />
            ))}
          </div>
        </div>
      ) : null}
      {toastItems.length === 0 ? null : (
        <div className="notification-toasts" aria-live="polite">
          {toastItems.map((notification) => (
            <div key={notification.id} className="notification-toast">
              <NotificationRow
                notification={notification}
                onClose={() => {
                  hideToast(notification.id);
                }}
              />
            </div>
          ))}
        </div>
      )}
    </>
  );
}
