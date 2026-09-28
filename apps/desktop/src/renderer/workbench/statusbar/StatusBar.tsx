import { executeCommand } from '../../platform/commands';
import { sortStatusBarItems, useStatusBar, type StatusBarItem } from '../../platform/statusbar';
import { LabelWithIcons } from '../common/Codicon';

import './StatusBar.css';

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
      aria-label={item.ariaLabel ?? item.tooltip}
      id={item.id}
      onClick={() => void executeCommand(item.command ?? '')}
    >
      {content}
    </button>
  );
}

export function StatusBar(): React.JSX.Element {
  const items = Object.values(useStatusBar((state) => state.items));
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
