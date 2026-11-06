import { waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { fakeHandlerDependencies } from '../../../../test/helpers/fake-handlers';
import {
  installWorkbenchHarness,
  resetWorkbenchState,
} from '../../../../test/helpers/workbench-harness';
import type { ExtensionInfo } from '../../../shared/extensions/models';
import { useNotifications } from '../../platform/notifications';

import { MAX_ENRICH_VALUES, extensionCellMenu, useEnrichment } from './enrichment';
import { setExtensionsSnapshot } from './extensions-store';

const IPINFO: ExtensionInfo = {
  id: 'raml.ipinfo-enricher',
  publisher: 'raml',
  name: 'ipinfo-enricher',
  displayName: 'IPinfo Enricher',
  version: '1.0.0',
  enabled: true,
  state: 'inactive',
  source: { type: 'file', name: 'ipinfo-enricher.rkqlx' },
  sha256: '0'.repeat(64),
  installedAt: '2026-10-12T00:00:00.000Z',
  permissions: [],
  contributes: { enrichers: [{ id: 'ipinfo', title: 'IPinfo', entityTypes: ['ip'] }] },
  verified: false,
};

afterEach(() => {
  resetWorkbenchState();
  useEnrichment.setState({ byRun: {} });
});

function setup() {
  const enrich = vi.fn(
    (_extensionId: string, _enricherId: string, _runId: unknown, entities: { value: string }[]) =>
      Promise.resolve(
        entities.map((entity) => ({
          entity: { type: 'ip' as const, value: entity.value },
          fields: { country: 'Woodgrove' },
        })),
      ),
  );
  installWorkbenchHarness({
    extensions: { ...fakeHandlerDependencies().extensions, enrich },
  });
  setExtensionsSnapshot({ extensions: [IPINFO], grants: [], problems: [] });
  return { enrich };
}

function enrichColumnItem(columnValues: () => Promise<unknown[]>) {
  const entries = extensionCellMenu({
    runId: 'run-1',
    column: 3,
    columnName: 'IPAddress',
    value: '203.0.113.7',
    columnValues,
  });
  const item = entries.find(
    (entry) => entry.kind === 'item' && entry.label === 'Enrich Column with IPinfo',
  );
  if (item?.kind !== 'item') throw new Error('Enrich Column is missing from the menu');
  return item;
}

describe('Enrich Column', () => {
  it('sends the distinct addresses of the whole column, in the order given', async () => {
    const { enrich } = setup();
    enrichColumnItem(() =>
      Promise.resolve(['203.0.113.9', 'not an ip', '203.0.113.7', '203.0.113.9', null]),
    ).run();
    await waitFor(() => {
      expect(enrich).toHaveBeenCalledTimes(1);
    });
    expect(enrich.mock.calls[0]?.[3]).toEqual([
      { type: 'ip', value: '203.0.113.9' },
      { type: 'ip', value: '203.0.113.7' },
    ]);
    await waitFor(() => {
      expect(useEnrichment.getState().byRun['run-1']?.[0]?.fields).toEqual(['country']);
    });
  });

  it('caps a large column at the host limit and says so', async () => {
    const { enrich } = setup();
    const many = Array.from(
      { length: 600 },
      (_, i) => `198.51.${String(Math.floor(i / 256))}.${String(i % 256)}`,
    );
    enrichColumnItem(() => Promise.resolve(many)).run();
    await waitFor(() => {
      expect(enrich).toHaveBeenCalledTimes(1);
    });
    expect(enrich.mock.calls[0]?.[3]).toHaveLength(MAX_ENRICH_VALUES);
    expect(
      useNotifications.getState().notifications.some((n) => /600 different/.test(n.message)),
    ).toBe(true);
  });

  it('reports a failure to read the column instead of failing silently', async () => {
    const { enrich } = setup();
    enrichColumnItem(() => Promise.reject(new Error('The run is gone.'))).run();
    await waitFor(() => {
      expect(useNotifications.getState().notifications.length).toBeGreaterThan(0);
    });
    expect(enrich).not.toHaveBeenCalled();
  });
});
