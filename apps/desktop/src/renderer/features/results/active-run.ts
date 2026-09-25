import type { RunSnapshot } from '../../../shared/query/models';
import { useEditors } from '../../platform/editors';
import { useRuns } from '../query/run-store';

/** The run of the active query tab (results and status follow the tab, spec 05). */
export function useActiveRun(): { tabId: string | undefined; run: RunSnapshot | undefined } {
  const tabId = useEditors((s) =>
    s.editors.find((e) => e.id === s.activeId)?.kind === 'query' ? s.activeId : undefined,
  );
  const run = useRuns((s) => (tabId === undefined ? undefined : s.byTab[tabId]));
  return { tabId, run };
}
