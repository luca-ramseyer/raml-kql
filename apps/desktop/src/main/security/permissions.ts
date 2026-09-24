/** The subset of Electron's `Session` the permission lockdown needs. */
export interface SessionLike {
  setPermissionRequestHandler(
    handler: (
      webContents: unknown,
      permission: string,
      callback: (granted: boolean) => void,
    ) => void,
  ): void;
  setPermissionCheckHandler(handler: (...args: unknown[]) => boolean): void;
}

/**
 * Deny every web permission (camera, microphone, geolocation, notifications, clipboard-read,
 * ...). The app never needs one; clipboard writes go through the main process.
 */
export function denyAllPermissions(session: SessionLike): void {
  session.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  session.setPermissionCheckHandler(() => false);
}
