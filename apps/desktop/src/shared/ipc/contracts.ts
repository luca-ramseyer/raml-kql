import { z } from 'zod';

import { defineChannel, type AnyChannel, type IpcResult } from './channel';

// ---------------------------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------------------------

export const AppInfoSchema = z.object({
  name: z.string(),
  version: z.string(),
  platform: z.enum(['darwin', 'win32', 'linux']),
  electronVersion: z.string(),
  /** True when running with `--demo` / `RAML_KQL_DEMO=1` (fake data, no network). */
  demoMode: z.boolean(),
});
export type AppInfo = z.infer<typeof AppInfoSchema>;

export const PingRequestSchema = z.object({ message: z.string().max(1024) }).strict();
export const PingResponseSchema = z.object({ message: z.string(), receivedAt: z.iso.datetime() });

// ---------------------------------------------------------------------------------------------
// Contract table: namespace -> method -> channel.
// The preload generates `window.ramlKql.<namespace>.<method>()` from this table and the main
// process must register a handler for every entry (enforced by the type of `IpcHandlers`).
// ---------------------------------------------------------------------------------------------

export const ipcContracts = {
  app: {
    /** Static information about the running app. */
    getInfo: defineChannel('app:getInfo', z.undefined(), AppInfoSchema),
    /** Diagnostic round trip to the main process. */
    ping: defineChannel('app:ping', PingRequestSchema, PingResponseSchema),
  },
} as const satisfies Record<string, Record<string, AnyChannel>>;

export type IpcContracts = typeof ipcContracts;

type RequestOf<C> = C extends { request: infer R extends z.ZodType } ? z.input<R> : never;
type ResponseOf<C> = C extends { response: infer R extends z.ZodType } ? z.output<R> : never;
type ParsedRequestOf<C> = C extends { request: infer R extends z.ZodType } ? z.output<R> : never;
type ResponseInputOf<C> = C extends { response: infer R extends z.ZodType } ? z.input<R> : never;

/** Methods whose request schema is `z.undefined()` take no argument. */
type ApiMethod<C> = [RequestOf<C>] extends [undefined]
  ? () => Promise<IpcResult<ResponseOf<C>>>
  : (request: RequestOf<C>) => Promise<IpcResult<ResponseOf<C>>>;

/** Shape of `window.ramlKql`, derived from the contract table. */
export type RamlKqlApi = {
  readonly [NS in keyof IpcContracts]: {
    readonly [M in keyof IpcContracts[NS]]: ApiMethod<IpcContracts[NS][M]>;
  };
};

/** Context passed to every main-process handler. */
export interface IpcHandlerContext {
  /** URL of the frame that sent the request (already verified as trusted). */
  readonly senderUrl: string;
}

/** The main process must implement exactly one handler per contract entry. */
export type IpcHandlers = {
  readonly [NS in keyof IpcContracts]: {
    readonly [M in keyof IpcContracts[NS]]: (
      request: ParsedRequestOf<IpcContracts[NS][M]>,
      context: IpcHandlerContext,
    ) => ResponseInputOf<IpcContracts[NS][M]> | Promise<ResponseInputOf<IpcContracts[NS][M]>>;
  };
};

/** Flatten the contract table for code that needs to iterate over every channel. */
export function listChannels(
  contracts: Record<string, Record<string, AnyChannel>> = ipcContracts,
): { namespace: string; method: string; channel: AnyChannel }[] {
  return Object.entries(contracts).flatMap(([namespace, methods]) =>
    Object.entries(methods).map(([method, channel]) => ({ namespace, method, channel })),
  );
}
