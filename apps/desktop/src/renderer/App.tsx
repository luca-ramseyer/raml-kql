import { useEffect, useState } from 'react';

import type { AppInfo } from '../shared/ipc/contracts';

import { getAppInfo } from './services/app-service';

/** Root component. Phase 0: an empty workbench; the VS Code-style shell arrives in Phase 1. */
export function App(): React.JSX.Element {
  const [info, setInfo] = useState<AppInfo | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    getAppInfo()
      .then((value) => {
        if (!cancelled) setInfo(value);
      })
      .catch((error: unknown) => {
        console.error('Failed to load app info', error);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div
      className="workbench"
      data-testid="workbench"
      data-demo-mode={info === undefined ? undefined : String(info.demoMode)}
    />
  );
}
