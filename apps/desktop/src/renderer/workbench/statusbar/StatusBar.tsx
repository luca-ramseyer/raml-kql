import { executeCommand } from '../../platform/commands';
import { sortStatusBarItems, useStatusBar, type StatusBarItem } from '../../platform/statusbar';
import { LabelWithIcons } from '../common/Codicon';

import './StatusBar.css';

/** Text without `$(icon)` markers: the accessible name, as in VS Code. */
function plainText(text: string): string {
  return text.replace(/\$\([a-z0-9-]+(?:~spin)?\)/g, '').trim();
}

function Item({ item }: { item: StatusBarItem }): React.JSX.Element {
  const className = `statusbar-item kind-${item.kind ?? 'standard'}${
    item.command === undefined ? '' : ' has-command'
  }`;
  const content = <LabelWithIcons text={item.text} />;
  return item.command === undefined ? (
    <span className={className} title={item.tooltip} aria-label={item.ariaLabel} id={item.id}>
      {content}
    </span>
  ) : (
    <button
      type="button"
      className={className}
      title={item.tooltip}
      aria-label={item.ariaLabel ?? plainText(item.text)}
      id={item.id}
      onClick={() => void executeCommand(item.command ?? '')}
    >
      {content}
    </button>
  );
}

export function StatusBar(): React.JSX.Element {
  // Items with no text are hidden (e.g. a feature turned off by a setting).
  const items = Object.values(useStatusBar((state) => state.items)).filter(
    (item) => item.text !== '',
  );
  return (
    <footer className="part statusbar" aria-label="Status Bar">
      <div className="statusbar-left">
        {sortStatusBarItems(items, 'left').map((item) => (
          <Item key={item.id} item={item} />
        ))}
      </div>
      <div className="statusbar-right">
        {sortStatusBarItems(items, 'right').map((item) => (
          <Item key={item.id} item={item} />
        ))}
      </div>
    </footer>
  );
}
