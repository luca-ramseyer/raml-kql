import { z } from 'zod';

import { AppErrorDataSchema, type AppErrorData } from '../errors';

/**
 * One request/response IPC channel. Both sides validate with the same schemas:
 * the preload validates before sending and after receiving, the main process validates
 * what it receives and what its handler returns.
 */
export interface Channel<Req extends z.ZodType, Res extends z.ZodType> {
  readonly name: string;
  readonly request: Req;
  readonly response: Res;
}

export function defineChannel<Req extends z.ZodType, Res extends z.ZodType>(
  name: string,
  request: Req,
  response: Res,
): Channel<Req, Res> {
  return { name, request, response };
}

/** Any channel, for code that iterates over the contract table. */
export type AnyChannel = Channel<z.ZodType, z.ZodType>;

/**
 * Every IPC response is wrapped in this envelope. Errors cross the boundary as plain data
 * (Error objects lose their fields when cloned between processes and through contextBridge).
 */
export type IpcResult<T> = { ok: true; value: T } | { ok: false; error: AppErrorData };

export const IpcResultEnvelopeSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), value: z.unknown() }),
  z.object({ ok: z.literal(false), error: AppErrorDataSchema }),
]);

export function ok<T>(value: T): IpcResult<T> {
  return { ok: true, value };
}

export function fail(error: AppErrorData): IpcResult<never> {
  return { ok: false, error };
}

/** Summarise zod issues without echoing input values (they may contain sensitive text). */
export function describeIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.length > 0 ? issue.path.join('.') : '(root)'}: ${issue.message}`)
    .join('; ');
}
