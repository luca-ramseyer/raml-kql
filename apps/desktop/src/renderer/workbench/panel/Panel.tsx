import { useMemo } from 'react';

import { useExtensions } from '../../features/extensions/extensions-store';
import { RendererView } from '../../features/extensions/RendererView';
import { ChartView } from '../../features/results/chart/ChartView';
import { ResultsView } from '../../features/results/ResultsView';
import { RunView } from '../../features/results/RunView';
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

interface PanelTab {
  id: string;
  title: string;
  empty: string;
  renderer?: { extensionId: string; ui: string };
}

/** Result renderers from enabled extensions get a panel tab each (spec 07). */
function usePanelTabs(): PanelTab[] {
  const extensions = useExtensions((s) => s.snapshot.extensions);
  return useMemo(
    () => [
      ...PANEL_TABS,
      ...extensions
        .filter((e) => e.enabled && e.state !== 'failed')
        .flatMap((e) =>
          (e.contributes.resultRenderers ?? []).map((r) => ({
            id: `renderer:${r.id}`,
            title: r.title,
            empty: '',
            renderer: { extensionId: e.id, ui: r.ui },
          })),
        ),
    ],
    [extensions],
  );
}

export function Panel(): React.JSX.Element {
  const { activeTab, maximized } = useLayout((state) => state.panel);
  const tabs = usePanelTabs();
  const tab: PanelTab = tabs.find((t) => t.id === activeTab) ?? PANEL_TABS[0];

  return (
    <section className="part panel" aria-label="Panel">
      <div className="panel-title">
        <div className="panel-tabs" role="tablist">
          {tabs.map((t) => (
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
        {tab.renderer !== undefined ? (
          <RendererView
            key={tab.id}
            extensionId={tab.renderer.extensionId}
            title={tab.title}
            ui={tab.renderer.ui}
          />
        ) : tab.id === 'results' ? (
          <ResultsView />
        ) : tab.id === 'run' ? (
          <RunView />
        ) : tab.id === 'chart' ? (
          <ChartView />
        ) : (
          <p className="panel-empty">{tab.empty}</p>
        )}
      </div>
    </section>
  );
}
