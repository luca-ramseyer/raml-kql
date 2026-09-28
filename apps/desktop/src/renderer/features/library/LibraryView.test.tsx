import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  installWorkbenchHarness,
  resetWorkbenchState,
} from '../../../../test/helpers/workbench-harness';
import type { PacksSnapshot, PackQueryData, UpdatePreview } from '../../../shared/packs/models';
import { App } from '../../App';
import { useEditors } from '../../platform/editors';
import { resetPacks } from '../packs/packs-store';
import { useQueryDocs } from '../query/query-docs';

// Monaco (the query editor and the update diff) doesn't run in jsdom; e2e covers it.
vi.mock('../editor/editor-preload', () => ({
  loadQueryEditor: () => new Promise(() => undefined),
  loadedQueryEditor: () => undefined,
  preloadQueryEditorWhenIdle: () => () => undefined,
}));
vi.mock('../editor/monaco-loader', () => ({
  loadMonaco: () => Promise.reject(new Error('No Monaco in jsdom')),
}));

const SOURCE = 'git-0123456789ab';

const SIGNINS: PackQueryData = {
  id: 'failed-signins',
  name: 'Failed sign-ins by user',
  description: 'Users with many failed sign-ins.',
  category: 'hunting',
  tables: ['SigninLogs'],
  mitre: ['T1110.003'],
  tags: ['identity'],
  timespan: 'P7D',
  parameters: [{ name: 'MinFailures', type: 'long', default: 10 }],
  file: 'queries/failed-signins.kql',
  body: 'let MinFailures = 10;\nSigninLogs | where TimeGenerated > ago(7d)',
};

const HEARTBEAT: PackQueryData = {
  id: 'silent-agents',
  name: 'Agents that stopped reporting',
  description: 'Silent agents.',
  category: 'health',
  tables: ['Heartbeat'],
  file: 'queries/silent-agents.kql',
  body: 'Heartbeat | take 1',
};

const SNAPSHOT: PacksSnapshot = {
  sources: [
    {
      id: SOURCE,
      type: 'git',
      label: 'https://github.com/contoso/kql-packs',
      sha: 'a'.repeat(40),
      addedAt: '2026-01-01T00:00:00.000Z',
      hasCredential: false,
      problems: [],
      update: { sha: 'b'.repeat(40), commits: 2 },
    },
  ],
  packs: [
    {
      sourceId: SOURCE,
      id: 'contoso.identity',
      name: 'Contoso Hunting',
      version: '1.2.0',
      description: 'Test pack.',
      queries: [SIGNINS, HEARTBEAT].map(({ body: _body, ...info }) => info),
      problems: [],
    },
  ],
  problems: [],
};

const UPDATE: UpdatePreview = {
  sourceId: SOURCE,
  label: 'https://github.com/contoso/kql-packs',
  fromSha: 'a'.repeat(40),
  toSha: 'b'.repeat(40),
  commits: [
    {
      oid: 'b'.repeat(40),
      message: 'Tune thresholds',
      author: 'Contoso',
      date: '2026-01-02T00:00:00.000Z',
    },
  ],
  moreCommits: false,
  packs: [
    { id: 'contoso.identity', name: 'Contoso Hunting', fromVersion: '1.2.0', toVersion: '1.3.0' },
  ],
  changes: [
    {
      packId: 'contoso.identity',
      packName: 'Contoso Hunting',
      queryId: 'failed-signins',
      name: 'Failed sign-ins by user',
      change: 'changed',
      before: 'a',
      after: 'b',
    },
  ],
  problems: [],
};

async function renderLibrary() {
  const harness = installWorkbenchHarness({
    packs: {
      ...installWorkbenchHarness().deps.packs,
      snapshot: vi.fn(() => Promise.resolve(SNAPSHOT)),
      readQuery: vi.fn((ref: { queryId: string }) =>
        ref.queryId === SIGNINS.id ? SIGNINS : HEARTBEAT,
      ),
      updatePreview: vi.fn(() => Promise.resolve(UPDATE)),
    },
  });
  render(<App />);
  await screen.findByTestId('workbench');
  await userEvent.click(screen.getByRole('tab', { name: 'Library' }));
  const tree = await screen.findByRole('tree', { name: 'Packs' });
  return { harness, tree };
}

describe('Library: packs', () => {
  afterEach(() => {
    resetPacks();
    useQueryDocs.setState({ docs: {} });
    resetWorkbenchState();
  });

  it('lists packs by category and opens a query with its parameters and time range', async () => {
    const { tree } = await renderLibrary();
    await within(tree).findByText('Contoso Hunting');
    expect(within(tree).getByText('Hunting')).toBeInTheDocument();
    expect(within(tree).getByText('Health')).toBeInTheDocument();
    await userEvent.dblClick(within(tree).getByText('Failed sign-ins by user'));
    await waitFor(() => {
      expect(useEditors.getState().editors.map((e) => e.title)).toContain(
        'Failed sign-ins by user',
      );
    });
    const tab = useEditors.getState().editors.find((e) => e.title === 'Failed sign-ins by user');
    const doc = useQueryDocs.getState().docs[tab?.id ?? ''];
    expect(doc?.text).toBe(SIGNINS.body);
    expect(doc?.timeRange).toEqual({ kind: 'preset', preset: '7d' });
    expect(doc?.parameters).toEqual({
      definitions: SIGNINS.parameters,
      inputs: { MinFailures: '10' },
    });
  });

  it('filters by MITRE technique, table and text', async () => {
    const { tree } = await renderLibrary();
    await within(tree).findByText('Contoso Hunting');
    const search = screen.getByRole('searchbox', { name: 'Search the Library' });
    await userEvent.type(search, 'mitre:T1110');
    expect(within(tree).getByText('Failed sign-ins by user')).toBeInTheDocument();
    expect(within(tree).queryByText('Agents that stopped reporting')).not.toBeInTheDocument();
    await userEvent.clear(search);
    await userEvent.type(search, 'table:heartbeat');
    expect(within(tree).getByText('Agents that stopped reporting')).toBeInTheDocument();
    expect(within(tree).queryByText('Failed sign-ins by user')).not.toBeInTheDocument();
    await userEvent.clear(search);
    await userEvent.type(search, 'nothing-matches');
    expect(within(tree).queryByText('Contoso Hunting')).not.toBeInTheDocument();
  });

  it('duplicates a pack query to My Queries with its metadata', async () => {
    const { harness, tree } = await renderLibrary();
    fireEvent.contextMenu(await within(tree).findByText('Failed sign-ins by user'));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Duplicate to My Queries' }));
    await waitFor(() => {
      expect(harness.deps.queries.save).toHaveBeenCalled();
    });
    const [request] = vi.mocked(harness.deps.queries.save).mock.calls[0] ?? [];
    expect(request).toMatchObject({
      name: 'Failed sign-ins by user',
      body: SIGNINS.body,
      meta: { tables: ['SigninLogs'], mitre: ['T1110.003'], parameters: SIGNINS.parameters },
    });
    expect(request?.meta).not.toHaveProperty('file');
  });

  it('shows an available update and opens its review', async () => {
    const { tree } = await renderLibrary();
    await userEvent.click(await within(tree).findByRole('button', { name: 'Update' }));
    expect(await screen.findByText('Tune thresholds')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Failed sign-ins by user/ })).toBeInTheDocument();
    expect(screen.getByText(/Contoso Hunting 1.2.0 → 1.3.0/)).toBeInTheDocument();
    expect(useEditors.getState().editors.some((e) => e.kind === 'packUpdate')).toBe(true);
  });
});
