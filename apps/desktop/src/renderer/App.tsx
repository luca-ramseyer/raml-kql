import { useEffect, useState } from 'react';

import type { AppInfo } from '../shared/ipc/contracts';

import { getAppInfo } from './services/app-service';
import { startWorkbench } from './workbench/bootstrap';
import { Workbench } from './workbench/Workbench';

type StartupState =
  { phase: 'loading' } | { phase: 'ready'; info: AppInfo } | { phase: 'failed'; message: string };

/** Root component: starts the workbench services, then renders the workbench. */
export function App(): React.JSX.Element {
  const [state, setState] = useState<StartupState>({ phase: 'loading' });
  const [fullScreen, setFullScreen] = useState(false);

  useEffect(() => {
    let dispose: (() => void) | undefined;
    // An object, so the async closure reads the current value (StrictMode mounts twice).
    const lifecycle = { cancelled: false };
    void (async () => {
      try {
        const info = await getAppInfo();
        const stop = await startWorkbench({ info, onFullScreenChange: setFullScreen });
        if (lifecycle.cancelled) {
          stop();
          return;
        }
        dispose = stop;
        setState({ phase: 'ready', info });
      } catch (error) {
        console.error('Workbench failed to start', error);
        if (!lifecycle.cancelled) {
          setState({
            phase: 'failed',
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    })();
    return () => {
      lifecycle.cancelled = true;
      dispose?.();
    };
  }, []);

  switch (state.phase) {
    case 'loading':
      return <div className="workbench-loading" data-testid="workbench-loading" />;
    case 'failed':
      return (
        <div className="workbench-failed" role="alert">
          <p>Raml KQL failed to start: {state.message}</p>
        </div>
      );
    case 'ready':
      return (
        <div className="workbench-root" data-demo-mode={String(state.info.demoMode)}>
          <Workbench platform={state.info.platform} fullScreen={fullScreen} />
        </div>
      );
  }
}
