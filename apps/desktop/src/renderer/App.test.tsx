import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RamlKqlApi } from '../shared/ipc/contracts';

import { App } from './App';

function stubBridge(demoMode: boolean): void {
  const api: RamlKqlApi = {
    app: {
      getInfo: () =>
        Promise.resolve({
          ok: true,
          value: {
            name: 'Raml KQL',
            version: '0.0.0',
            platform: 'darwin',
            electronVersion: '44.0.0',
            demoMode,
          },
        }),
      ping: vi.fn(),
    },
  };
  vi.stubGlobal('ramlKql', api);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('App', () => {
  it('renders the workbench root and records demo mode from the main process', async () => {
    stubBridge(true);
    render(<App />);
    const workbench = screen.getByTestId('workbench');
    await waitFor(() => {
      expect(workbench).toHaveAttribute('data-demo-mode', 'true');
    });
  });

  it('still renders when the main process call fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal('ramlKql', {
      app: {
        getInfo: () =>
          Promise.resolve({
            ok: false,
            error: { code: 'INTERNAL', message: 'boom', retryable: false, source: 'main' },
          }),
      },
    });
    render(<App />);
    await waitFor(() => {
      expect(consoleError).toHaveBeenCalled();
    });
    expect(screen.getByTestId('workbench')).not.toHaveAttribute('data-demo-mode');
    consoleError.mockRestore();
  });
});
