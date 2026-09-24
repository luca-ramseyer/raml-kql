import { describe, expect, it, vi } from 'vitest';

import { denyAllPermissions, type SessionLike } from '../../src/main/security/permissions';

describe('denyAllPermissions', () => {
  it('denies every permission request and check', () => {
    let requestHandler: Parameters<SessionLike['setPermissionRequestHandler']>[0] | undefined;
    let checkHandler: ((...args: unknown[]) => boolean) | undefined;
    denyAllPermissions({
      setPermissionRequestHandler: (handler) => {
        requestHandler = handler;
      },
      setPermissionCheckHandler: (handler) => {
        checkHandler = handler;
      },
    });

    for (const permission of ['media', 'geolocation', 'notifications', 'clipboard-read']) {
      const callback = vi.fn();
      requestHandler?.({}, permission, callback);
      expect(callback).toHaveBeenCalledWith(false);
    }
    expect(checkHandler?.({}, 'media')).toBe(false);
  });
});
