import { useEffect, useRef } from 'react';

import { closeDialog, useDialogs } from '../../platform/dialogs';
import { Codicon } from '../common/Codicon';

import './DialogHost.css';

const ICONS = { info: 'info', warning: 'warning', error: 'error', shield: 'shield' } as const;

/** Shows the front dialog of the queue, modal over the workbench. */
export function DialogHost(): React.JSX.Element | null {
  const dialog = useDialogs((s) => s.queue[0]);
  const buttonsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (dialog === undefined) return;
    const buttons = buttonsRef.current?.querySelectorAll('button');
    buttons?.[dialog.defaultButton ?? 0]?.focus();
  }, [dialog]);

  if (dialog === undefined) return null;
  return (
    <div className="dialog-overlay">
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={dialog.label ?? dialog.message}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            closeDialog(dialog.id, undefined);
          }
          // Keep focus inside the dialog.
          if (event.key === 'Tab') {
            const focusable = [
              ...event.currentTarget.querySelectorAll<HTMLElement>(
                'button, a[href], [tabindex="0"]',
              ),
            ];
            const first = focusable[0];
            const last = focusable.at(-1);
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first?.focus();
            }
          }
        }}
      >
        <div className="dialog-body">
          <Codicon name={ICONS[dialog.severity]} className={`dialog-icon ${dialog.severity}`} />
          <div className="dialog-text">
            <div className="dialog-message">{dialog.message}</div>
            {dialog.detail === undefined ? null : (
              <div className="dialog-detail">{dialog.detail}</div>
            )}
          </div>
        </div>
        <div className="dialog-buttons" ref={buttonsRef}>
          {dialog.buttons.map((label, index) => (
            <button
              key={label}
              type="button"
              className={`button ${index === (dialog.defaultButton ?? 0) ? 'button-primary' : 'button-secondary'}`}
              onClick={() => {
                closeDialog(dialog.id, index);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
