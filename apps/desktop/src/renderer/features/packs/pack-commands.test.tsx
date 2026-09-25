import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  findQuickInputBox,
  installWorkbenchHarness,
  resetWorkbenchState,
} from '../../../../test/helpers/workbench-harness';
import { AppError } from '../../../shared/errors';
import type { PacksSnapshot, SourcePreview } from '../../../shared/packs/models';
import { App } from '../../App';
import { executeCommand } from '../../platform/commands';

import { resetPacks, usePacks } from './packs-store';

vi.mock('../editor/editor-preload', () => ({
  loadQueryEditor: () => new Promise(() => undefined),
  loadedQueryEditor: () => undefined,
  preloadQueryEditorWhenIdle: () => () => undefined,
}));

const PREVIEW: SourcePreview = {
  previewId: 'preview-1',
  type: 'git',
  label: 'https://github.com/contoso/private-packs',
  sha: 'c'.repeat(40),
  packs: [
    {
      id: 'contoso.identity',
      name: 'Contoso Hunting',
      version: '1.0.0',
      queries: 12,
      problems: [],
      conflict: false,
    },
  ],
  problems: [{ file: 'queries/broken.kql', message: 'tables: Required' }],
  alreadyAdded: false,
};

const ADDED: PacksSnapshot = {
  sources: [
    {
      id: 'git-0123456789ab',
      type: 'git',
      label: PREVIEW.label,
      sha: 'c'.repeat(40),
      addedAt: '2026-01-01T00:00:00.000Z',
      hasCredential: true,
      problems: [],
    },
  ],
  packs: [],
  problems: [],
};

describe('Library: Add Pack Source', () => {
  afterEach(() => {
    resetPacks();
    resetWorkbenchState();
  });

  it('asks for a token when the repository is private, previews it and adds it', async () => {
    const authRequired = new AppError({
      code: 'SOURCE_AUTH_REQUIRED',
      message: 'needs a token',
      retryable: false,
      source: 'main',
    });
    const previewGit = vi.fn().mockRejectedValueOnce(authRequired).mockResolvedValueOnce(PREVIEW);
    const add = vi.fn(() => Promise.resolve(ADDED));
    const harness = installWorkbenchHarness();
    installWorkbenchHarness({ packs: { ...harness.deps.packs, previewGit, add } });
    render(<App />);
    await screen.findByTestId('workbench');

    void executeCommand('library.addPackSource');
    const input = await findQuickInputBox();
    await userEvent.type(input, 'https://github.com/contoso/private-packs#main{Enter}');
    const token = await findQuickInputBox();
    await waitFor(() => {
      expect(token).toHaveAttribute('type', 'password');
    });
    await userEvent.type(token, 'not-a-real-token{Enter}');

    await screen.findByRole('option', { name: /Contoso Hunting 1.0.0/ });
    expect(screen.getByRole('option', { name: /tables: Required/ })).toBeInTheDocument();
    expect(previewGit).toHaveBeenLastCalledWith({
      url: 'https://github.com/contoso/private-packs',
      ref: 'main',
      token: 'not-a-real-token',
    });
    await userEvent.click(screen.getByRole('option', { name: /Add Source/ }));
    await waitFor(() => {
      expect(add).toHaveBeenCalledWith('preview-1');
    });
    expect(usePacks.getState().snapshot.sources[0]?.hasCredential).toBe(true);
  });

  it('cancelling the preview discards the clone', async () => {
    const cancelPreview = vi.fn(() => Promise.resolve());
    const harness = installWorkbenchHarness();
    installWorkbenchHarness({
      packs: {
        ...harness.deps.packs,
        previewGit: vi.fn(() => Promise.resolve(PREVIEW)),
        cancelPreview,
      },
    });
    render(<App />);
    await screen.findByTestId('workbench');
    void executeCommand('library.addPackSource');
    await userEvent.type(await findQuickInputBox(), 'https://github.com/contoso/packs{Enter}');
    await screen.findByRole('option', { name: /Contoso Hunting/ });
    await userEvent.keyboard('{Escape}');
    await waitFor(() => {
      expect(cancelPreview).toHaveBeenCalledWith('preview-1');
    });
  });
});
