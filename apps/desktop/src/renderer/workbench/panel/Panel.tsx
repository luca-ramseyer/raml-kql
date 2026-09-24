import { executeCommand } from '../../platform/commands';
import { showPanelTab, togglePanel, useLayout } from '../../platform/layout';
import { Codicon } from '../common/Codicon';

import './Panel.css';

/** Bottom panel tabs (spec 05). Their contents arrive with the query engine and results. */
const PANEL_TABS = [
  {
    id: 'results',
    title: 'Results',
    empty: 'Run a query to see merged results from all selected workspaces.',
  },
  {
    id: 'chart',
    title: 'Chart',
    empty: 'Queries that use the render operator, or charts you build from results, appear here.',
  },
  { id: 'run', title: 'Run', empty: 'Per-workspace status of the latest run appears here.' },
  { id: 'audit', title: 'Audit', empty: 'The local audit log of queries you ran appears here.' },
] as const;

export function Panel(): React.JSX.Element {
  const { activeTab, maximized } = useLayout((state) => state.panel);
  const tab = PANEL_TABS.find((t) => t.id === activeTab) ?? PANEL_TABS[0];

  return (
    <section className="part panel" aria-label="Panel">
      <div className="panel-title">
        <div className="panel-tabs" role="tablist">
          {PANEL_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={t.id === tab.id}
              className={`panel-tab${t.id === tab.id ? ' checked' : ''}`}
              onClick={() => {
                showPanelTab(t.id);
              }}
            >
              {t.title}
            </button>
          ))}
        </div>
        <div className="panel-actions">
          <button
            type="button"
            className="action-item"
            title={maximized ? 'Restore Panel Size' : 'Maximize Panel Size'}
            aria-label={maximized ? 'Restore Panel Size' : 'Maximize Panel Size'}
            onClick={() => void executeCommand('workbench.action.toggleMaximizedPanel')}
          >
            <Codicon name={maximized ? 'chevron-down' : 'chevron-up'} />
          </button>
          <button
            type="button"
            className="action-item"
            title="Hide Panel"
            aria-label="Hide Panel"
            onClick={() => {
              togglePanel(false);
            }}
          >
            <Codicon name="close" />
          </button>
        </div>
      </div>
      <div className="panel-content" role="tabpanel" aria-label={tab.title}>
        <p className="panel-empty">{tab.empty}</p>
      </div>
    </section>
  );
}
