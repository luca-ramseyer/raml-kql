import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { DEFAULT_LAYOUT_STATE } from '../../shared/layout/layout-state';

import { LayoutStore } from './layout-store';

describe('LayoutStore', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  });

  it('returns defaults when missing or invalid', async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'rk-layout-'));
    const file = path.join(dir, 'state', 'ui-layout.json');
    expect(await new LayoutStore(file).read()).toEqual(DEFAULT_LAYOUT_STATE);
    writeFileSync(path.join(dir, 'bad.json'), '{ "sidebar": { "width": -5 } }');
    expect(await new LayoutStore(path.join(dir, 'bad.json')).read()).toEqual(DEFAULT_LAYOUT_STATE);
  });

  it('round-trips the layout, creating the state folder', async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'rk-layout-'));
    const store = new LayoutStore(path.join(dir, 'state', 'ui-layout.json'));
    const layout = {
      sidebar: { visible: false, width: 420, activeView: 'workbench.view.history' },
      panel: { visible: true, height: 200, maximized: true, activeTab: 'run' },
    };
    await store.write(layout);
    expect(await store.read()).toEqual(layout);
  });
});
