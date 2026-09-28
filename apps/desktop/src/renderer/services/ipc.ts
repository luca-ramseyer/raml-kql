import { AppError } from '../../shared/errors';
import type { IpcResult } from '../../shared/ipc/channel';
import type { RamlKqlApi } from '../../shared/ipc/contracts';

/**
 * Service layer over `window.ramlKql`. Components call services, never the bridge directly,
 * so tests can swap the bridge and IPC details stay in one place.
 */
export function getBridge(): RamlKqlApi {
  return window.ramlKql;
}

/** Turn an IPC envelope into a value, throwing an {@link AppError} on failure. */
export async function unwrap<T>(pending: Promise<IpcResult<T>>): Promise<T> {
  const result = await pending;
  if (!result.ok) {
    throw new AppError(result.error);
  }
  return result.value;
}
