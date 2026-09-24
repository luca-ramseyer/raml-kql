import type { AppInfo } from '../../shared/ipc/contracts';

import { getBridge, unwrap } from './ipc';

export function getAppInfo(): Promise<AppInfo> {
  return unwrap(getBridge().app.getInfo());
}
