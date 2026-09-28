/**
 * Tests must never reach the real network (spec 11). This guard makes any outbound request
 * to a non-loopback host fail loudly. Loopback stays allowed for the fake Azure server and
 * local git fixtures used by integration tests.
 */
import http from 'node:http';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
import net from 'node:net';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function assertLoopback(host: string | undefined | null, what: string): void {
  const normalized = (host ?? 'localhost').toLowerCase();
  if (!LOOPBACK_HOSTS.has(normalized)) {
    throw new Error(`Blocked real network access in a test: ${what} to "${normalized}"`);
  }
}

function hostFromArgs(args: unknown[]): string | undefined {
  const [first, second] = args;
  if (typeof first === 'string') return new URL(first).hostname;
  if (first instanceof URL) return first.hostname;
  const options = (typeof first === 'object' ? first : second) as
    { hostname?: string | null; host?: string | null } | undefined;
  return options?.hostname ?? options?.host ?? undefined;
}

const originalFetch = globalThis.fetch;
globalThis.fetch = (input: string | URL | Request, init?: RequestInit) => {
  const url =
    typeof input === 'string' ? new URL(input) : input instanceof URL ? input : new URL(input.url);
  assertLoopback(url.hostname, 'fetch');
  return originalFetch(input, init);
};

for (const [name, mod] of [
  ['http', http],
  ['https', https],
] as const) {
  const originalRequest = mod.request.bind(mod) as (...args: unknown[]) => http.ClientRequest;
  const originalGet = mod.get.bind(mod) as (...args: unknown[]) => http.ClientRequest;
  (mod as { request: unknown }).request = (...args: unknown[]) => {
    assertLoopback(hostFromArgs(args), `${name}.request`);
    return originalRequest(...args);
  };
  (mod as { get: unknown }).get = (...args: unknown[]) => {
    assertLoopback(hostFromArgs(args), `${name}.get`);
    return originalGet(...args);
  };
}

/** Host of a `socket.connect(...)` call, or `null` for local IPC (unix socket / named pipe). */
function socketTarget(args: unknown[]): string | undefined | null {
  // `net.connect()` pre-normalises its arguments into a single `[options, callback]` array.
  const first = Array.isArray(args[0]) ? (args[0] as unknown[])[0] : args[0];
  const second = Array.isArray(args[0]) ? undefined : args[1];
  if (typeof first === 'object' && first !== null) {
    const options = first as { path?: unknown; host?: string };
    return typeof options.path === 'string' ? null : options.host;
  }
  if (typeof first === 'number' || (typeof first === 'string' && /^\d+$/.test(first))) {
    return typeof second === 'string' ? second : undefined;
  }
  return null; // connect(path)
}

const originalConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (this: net.Socket, ...args: unknown[]) {
  const host = socketTarget(args);
  if (host !== null) {
    assertLoopback(host, 'socket.connect');
  }
  return (originalConnect as (...a: unknown[]) => net.Socket).apply(this, args);
};

// Propagate the patched functions to ESM named imports (`import { request } from 'node:http'`).
syncBuiltinESMExports();
