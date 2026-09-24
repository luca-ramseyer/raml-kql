import { describe, expect, it } from 'vitest';

import { AppError } from '../../shared/errors';

import { unwrap } from './ipc';

describe('unwrap', () => {
  it('returns the value of an ok envelope', async () => {
    await expect(unwrap(Promise.resolve({ ok: true, value: 42 }))).resolves.toBe(42);
  });

  it('throws an AppError carrying the error data', async () => {
    const pending = unwrap(
      Promise.resolve({
        ok: false,
        error: {
          code: 'IPC_INVALID_REQUEST',
          message: 'bad',
          detail: 'message: too long',
          retryable: false,
          source: 'preload',
        },
      } as const),
    );
    await expect(pending).rejects.toBeInstanceOf(AppError);
    await expect(pending).rejects.toMatchObject({
      code: 'IPC_INVALID_REQUEST',
      message: 'bad',
      detail: 'message: too long',
      source: 'preload',
    });
  });
});
