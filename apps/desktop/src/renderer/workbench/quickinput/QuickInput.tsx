import { useEffect, useMemo, useRef } from 'react';

import {
  acceptQuickInput,
  currentProvider,
  hideQuickInput,
  setQuickInputActiveIndex,
  setQuickInputValue,
  useQuickInput,
  type QuickPickItem,
} from '../../platform/quickinput/quick-input';
import { Codicon } from '../common/Codicon';
import { HighlightedLabel } from '../common/HighlightedLabel';
import { KeybindingLabel } from '../common/KeybindingLabel';

import './QuickInput.css';

const ROW_HEIGHT = 22;
const MAX_VISIBLE_ROWS = 20;

/** VS Code's quick input: command palette, quick open and pickers. */
export function QuickInput(): React.JSX.Element | null {
  const { visible, value, picker, activeIndex } = useQuickInput();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const { provider, filter } = currentProvider({ picker, value });
  const items = useMemo<QuickPickItem[]>(
    () => (visible && provider !== undefined ? provider.getItems(filter) : []),
    [visible, provider, filter],
  );
  const active = items[Math.min(activeIndex, items.length - 1)];

  useEffect(() => {
    if (visible) inputRef.current?.focus();
  }, [visible, picker]);

  useEffect(() => {
    if (visible) provider?.onActive?.(active);
  }, [visible, provider, active]);

  // Keep the active row scrolled into view.
  useEffect(() => {
    const list = listRef.current;
    if (list === null) return;
    const top = activeIndex * ROW_HEIGHT;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (top + ROW_HEIGHT > list.scrollTop + list.clientHeight) {
      list.scrollTop = top + ROW_HEIGHT - list.clientHeight;
    }
  }, [activeIndex]);

  if (!visible) return null;

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    const last = items.length - 1;
    switch (event.key) {
      case 'ArrowDown':
        setQuickInputActiveIndex(activeIndex >= last ? 0 : activeIndex + 1);
        break;
      case 'ArrowUp':
        setQuickInputActiveIndex(activeIndex <= 0 ? Math.max(0, last) : activeIndex - 1);
        break;
      case 'PageDown':
        setQuickInputActiveIndex(Math.min(last, activeIndex + MAX_VISIBLE_ROWS - 1));
        break;
      case 'PageUp':
        setQuickInputActiveIndex(Math.max(0, activeIndex - MAX_VISIBLE_ROWS + 1));
        break;
      case 'Enter':
        acceptQuickInput(active);
        break;
      case 'Escape':
        hideQuickInput();
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <div className="quick-input-widget" role="dialog" aria-label="Quick input">
      <div className="quick-input-header">
        <input
          ref={inputRef}
          className="quick-input-box"
          type={provider?.password === true ? 'password' : 'text'}
          role="combobox"
          aria-expanded="true"
          aria-controls="quick-input-list"
          aria-activedescendant={active === undefined ? undefined : `quick-input-item-${active.id}`}
          aria-autocomplete="list"
          spellCheck={false}
          autoComplete="off"
          placeholder={provider?.placeholder ?? ''}
          value={value}
          onChange={(event) => {
            setQuickInputValue(event.target.value);
          }}
          onKeyDown={onKeyDown}
          onBlur={(event) => {
            // Clicking inside the list keeps the widget open; anything else closes it.
            const next = event.relatedTarget;
            if (
              !(next instanceof Node) ||
              !event.currentTarget.closest('.quick-input-widget')?.contains(next)
            ) {
              hideQuickInput();
            }
          }}
        />
      </div>
      <div
        ref={listRef}
        id="quick-input-list"
        className="quick-input-list"
        role="listbox"
        tabIndex={-1}
        style={{ maxHeight: MAX_VISIBLE_ROWS * ROW_HEIGHT }}
        onMouseDown={(event) => {
          // Keep focus in the input box.
          event.preventDefault();
        }}
      >
        {items.length === 0 ? (
          <div
            className={`quick-input-message${
              provider?.validate?.(filter) === undefined ? '' : ' invalid'
            }`}
            role={provider?.validate?.(filter) === undefined ? undefined : 'alert'}
          >
            {provider?.message?.(filter) ?? provider?.noResultsText ?? 'No matching results'}
          </div>
        ) : (
          items.map((item, index) => {
            const showGroup = item.group !== undefined && items[index - 1]?.group !== item.group;
            return (
              <div
                key={item.id}
                id={`quick-input-item-${item.id}`}
                role="option"
                aria-selected={index === activeIndex}
                className={`quick-input-row${index === activeIndex ? ' focused' : ''}${
                  showGroup && index > 0 ? ' separator' : ''
                }`}
                onMouseMove={() => {
                  if (index !== activeIndex) setQuickInputActiveIndex(index);
                }}
                onClick={() => {
                  acceptQuickInput(item);
                }}
              >
                {item.icon === undefined ? null : (
                  <Codicon name={item.icon} className="quick-input-icon" />
                )}
                <HighlightedLabel
                  className="quick-input-label"
                  text={item.label}
                  highlights={item.highlights}
                />
                {item.description === undefined ? null : (
                  <span className="quick-input-description">{item.description}</span>
                )}
                <span className="quick-input-row-right">
                  {showGroup ? <span className="quick-input-group">{item.group}</span> : null}
                  {item.keybinding === undefined ? null : (
                    <KeybindingLabel label={item.keybinding} />
                  )}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
