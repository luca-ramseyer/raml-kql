import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  installWorkbenchHarness,
  resetWorkbenchState,
} from '../../../../test/helpers/workbench-harness';
import type { CatalogResult } from '../../../shared/extensions/models';

import { useCatalog } from './catalog-store';
import { setExtensionsSnapshot } from './extensions-store';
import { ExtensionsView } from './ExtensionsView';

const ENTRY = {
  id: 'raml.virustotal-enricher',
  displayName: 'VirusTotal Enricher',
  publisher: 'raml',
  description: 'Look up IPs, domains and hashes on VirusTotal.',
  categories: ['Enrichment'],
  package: 'https://example.com/virustotal-enricher.rkqlx',
  version: '1.0.0',
};
const OTHER = {
  ...ENTRY,
  id: 'raml.country-map',
  displayName: 'Country Map',
  description: 'Draws results as a world map.',
  categories: ['Visualization'],
};

const catalog = (overrides: Partial<CatalogResult> = {}): CatalogResult => ({
  enabled: true,
  demo: false,
  entries: [ENTRY, OTHER],
  fetchedAt: new Date().toISOString(),
  fromCache: false,
  problems: [],
  ...overrides,
});

afterEach(() => {
  resetWorkbenchState();
  useCatalog.setState({
    tab: 'installed',
    search: '',
    result: undefined,
    loading: false,
    error: undefined,
  });
});

function open(result: CatalogResult | Error) {
  const load = vi.fn(() =>
    result instanceof Error ? Promise.reject(result) : Promise.resolve(result),
  );
  const install = vi.fn(() => Promise.resolve({ type: 'cancelled' as const }));
  const harness = installWorkbenchHarness({
    extensions: {
      ...installWorkbenchHarnessDefaults(),
      catalog: load,
      installFromCatalog: install,
    },
  } as never);
  setExtensionsSnapshot({ extensions: [], grants: [], problems: [] });
  render(<ExtensionsView />);
  return { harness, load, install };
}

/** The harness fills the other extension operations with fakes; spread them in tests. */
function installWorkbenchHarnessDefaults() {
  return {
    snapshot: () => Promise.resolve({ extensions: [], grants: [], problems: [] }),
    installFromFile: () => Promise.resolve({ type: 'cancelled' as const }),
    installFromGit: () => Promise.resolve({ type: 'cancelled' as const }),
    checkUpdates: () => Promise.resolve({ updates: 0, errors: [] }),
    update: () => Promise.resolve({ type: 'cancelled' as const }),
    confirmInstall: () => Promise.resolve({ extensions: [], grants: [], problems: [] }),
    cancelInstall: vi.fn(),
    uninstall: () => Promise.resolve({ extensions: [], grants: [], problems: [] }),
    setEnabled: () => Promise.resolve({ extensions: [], grants: [], problems: [] }),
    executeCommand: () => Promise.resolve(undefined),
    respond: vi.fn(),
    revoke: () => Promise.resolve({ extensions: [], grants: [], problems: [] }),
    enrich: () => Promise.resolve([]),
    resultsAccess: () => Promise.resolve(false),
  };
}

describe('Browse extensions', () => {
  it('fetches nothing until the Browse tab is opened', async () => {
    const { load } = open(catalog());
    expect(load).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('tab', { name: 'Browse' }));
    expect(await screen.findByText('VirusTotal Enricher')).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith(false);
  });

  it('searches names, descriptions and categories', async () => {
    open(catalog());
    fireEvent.click(screen.getByRole('tab', { name: 'Browse' }));
    await screen.findByText('Country Map');
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search extensions' }), {
      target: { value: 'visualization' },
    });
    expect(screen.getByText('Country Map')).toBeInTheDocument();
    expect(screen.queryByText('VirusTotal Enricher')).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search extensions' }), {
      target: { value: 'nothing like this' },
    });
    expect(screen.getByText(/No extensions match/)).toBeInTheDocument();
  });

  it('installs an entry through the catalog and marks installed ones', async () => {
    const { install } = open(catalog());
    fireEvent.click(screen.getByRole('tab', { name: 'Browse' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Install VirusTotal Enricher' }));
    await waitFor(() => {
      expect(install).toHaveBeenCalledWith('raml.virustotal-enricher');
    });
  });

  it('explains when the catalog is turned off, and when it cannot be loaded', async () => {
    open(catalog({ enabled: false, entries: [] }));
    fireEvent.click(screen.getByRole('tab', { name: 'Browse' }));
    expect(await screen.findByText(/turned off/)).toBeInTheDocument();
    expect(screen.getByText('extensions.catalog.enabled')).toBeInTheDocument();
  });

  it('shows an error with Try again when the request fails', async () => {
    open(new Error('The catalog could not be loaded.'));
    fireEvent.click(screen.getByRole('tab', { name: 'Browse' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('says when the list is a saved copy and in demo mode', async () => {
    open(catalog({ fromCache: true }));
    fireEvent.click(screen.getByRole('tab', { name: 'Browse' }));
    expect(await screen.findByText(/Saved list/)).toBeInTheDocument();
  });

  it('labels the demo catalog and disables Refresh', async () => {
    open(catalog({ demo: true, fetchedAt: undefined }));
    fireEvent.click(screen.getByRole('tab', { name: 'Browse' }));
    expect(await screen.findByText(/Demo catalog/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh the catalog' })).toBeDisabled();
  });
});
