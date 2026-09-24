import { describe, expect, it, vi } from 'vitest';

import { fakeHandlerDependencies } from '../../../test/helpers/fake-handlers';
import { AppError } from '../../shared/errors';

import { createIpcHandlers } from './handlers';

const ctx = { senderUrl: 'raml-kql://app/index.html' };

describe('createIpcHandlers', () => {
  it('opens only allowlisted external URLs', async () => {
    const deps = fakeHandlerDependencies();
    const handlers = createIpcHandlers(deps);
    await handlers.shell.openExternal({ url: 'https://github.com/x' }, ctx);
    expect(deps.shell.openExternal).toHaveBeenCalledWith('https://github.com/x');
    await expect(
      handlers.shell.openExternal({ url: 'https://evil.example/' }, ctx),
    ).rejects.toBeInstanceOf(AppError);
    expect(deps.shell.openExternal).toHaveBeenCalledTimes(1);
  });

  it('delegates window operations and returns the zoom level', () => {
    const deps = fakeHandlerDependencies();
    vi.mocked(deps.window.zoom).mockReturnValue(2);
    const handlers = createIpcHandlers(deps);
    expect(handlers.window.zoom({ action: 'in' }, ctx)).toEqual({ level: 2 });
    void handlers.window.runEditRole({ role: 'paste' }, ctx);
    expect(deps.window.runEditRole).toHaveBeenCalledWith('paste');
  });

  it('passes settings updates to the settings service', async () => {
    const deps = fakeHandlerDependencies();
    const handlers = createIpcHandlers(deps);
    await handlers.settings.update({ action: 'reset', key: 'workbench.colorTheme' }, ctx);
    expect(deps.settings.update).toHaveBeenCalledWith({
      action: 'reset',
      key: 'workbench.colorTheme',
    });
  });

  it('relaunches with the requested demo mode', () => {
    const deps = fakeHandlerDependencies();
    void createIpcHandlers(deps).app.relaunch({ demo: true }, ctx);
    expect(deps.relaunch).toHaveBeenCalledWith({ demo: true });
  });
});
