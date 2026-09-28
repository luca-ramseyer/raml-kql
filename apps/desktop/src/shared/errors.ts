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
  /** A config file has syntax errors, so it can't be edited programmatically. */
  'CONFIG_INVALID',
  /** A config file couldn't be read or written. */
  'CONFIG_IO',
  'SETTING_UNKNOWN',
  'SETTING_INVALID_VALUE',
  'URL_NOT_ALLOWED',
  /** MFA, Conditional Access or consent needs the user: "Sign in again". */
  'AUTH_INTERACTION_REQUIRED',
  /** The account has no access to this tenant or resource. */
  'AUTH_NO_ACCESS',
  /** The user closed or abandoned the sign-in. */
  'AUTH_CANCELLED',
  /** Sign-in isn't possible here (no client ID, no OS keyring, Azure CLI missing). */
  'AUTH_UNAVAILABLE',
  'AUTH_FAILED',
  'ACCOUNT_NOT_FOUND',
  /** No network connection. */
  'NET_OFFLINE',
  /** Azure Resource Manager returned an error. */
  'ARM_ERROR',
  /** A file operation the user asked for failed (My Queries, import); the message says why. */
  'FILE_OPERATION_FAILED',
  /** A query parameter value doesn't fit its type. */
  'PARAMETER_INVALID',
  /** A pack source couldn't be reached, read or validated. */
  'SOURCE_ERROR',
  /** A git source needs a token (private repository) or the token was refused. */
  'SOURCE_AUTH_REQUIRED',
  /** An extension couldn't be installed, started or run; the message says why. */
  'EXTENSION_ERROR',
  /** The user (or a missing declaration) refused an extension permission. */
  'PERMISSION_DENIED',
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
