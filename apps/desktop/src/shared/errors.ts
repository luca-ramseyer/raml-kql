import { z } from 'zod';

/**
 * Stable error codes. Codes are part of the contract between processes (and later with
 * extensions), so never rename one; add a new code instead.
 */
export const AppErrorCodeSchema = z.enum([
  'INTERNAL',
  'IPC_INVALID_REQUEST',
  'IPC_INVALID_RESPONSE',
  'IPC_UNTRUSTED_SENDER',
]);
export type AppErrorCode = z.infer<typeof AppErrorCodeSchema>;

/** Which part of the app produced the error. */
export const AppErrorSourceSchema = z.enum(['main', 'preload', 'renderer']);
export type AppErrorSource = z.infer<typeof AppErrorSourceSchema>;

/** Plain-data error shape that is safe to send across process boundaries. */
export const AppErrorDataSchema = z.object({
  code: AppErrorCodeSchema,
  /** Short, user-facing message. */
  message: z.string(),
  /** Optional technical detail, shown behind "Show details". Must already be redacted. */
  detail: z.string().optional(),
  retryable: z.boolean(),
  source: AppErrorSourceSchema,
});
export type AppErrorData = z.infer<typeof AppErrorDataSchema>;

/** Throwable wrapper around {@link AppErrorData}, used inside a single process. */
export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly detail: string | undefined;
  readonly retryable: boolean;
  readonly source: AppErrorSource;

  constructor(data: AppErrorData) {
    super(data.message);
    this.name = 'AppError';
    this.code = data.code;
    this.detail = data.detail;
    this.retryable = data.retryable;
    this.source = data.source;
  }

  toData(): AppErrorData {
    return {
      code: this.code,
      message: this.message,
      ...(this.detail === undefined ? {} : { detail: this.detail }),
      retryable: this.retryable,
      source: this.source,
    };
  }
}
