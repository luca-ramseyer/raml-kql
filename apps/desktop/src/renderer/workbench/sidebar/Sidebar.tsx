import { useLayout } from '../../platform/layout';
import { getView, VIEWS } from '../views';

import './Sidebar.css';

export function Sidebar(): React.JSX.Element {
  const activeView = useLayout((state) => state.sidebar.activeView);
  const view = getView(activeView) ?? VIEWS[0];
  if (view === undefined) return <aside className="part sidebar" />;
  const Content = view.component;
  return (
    <aside className="part sidebar" aria-label={`${view.title} view`} data-view={view.id}>
      <div className="composite-title">
        <h2 className="composite-title-label">{view.title}</h2>
      </div>
      <div className="sidebar-content">
        <Content />
      </div>
    </aside>
  );
}
