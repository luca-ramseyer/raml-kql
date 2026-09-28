import http from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * A fake Azure endpoint for integration tests (spec 04 / spec 11): real HTTP on loopback, so
 * the real clients are exercised. Phase 2 implements ARM `/tenants`; later phases add Resource
 * Graph and the Log Analytics query/metadata endpoints.
 */
export interface FakeTenant {
  tenantId: string;
  displayName: string;
  defaultDomain?: string;
  tenantCategory?: 'Home' | 'ProjectedBy' | 'ManagedBy';
}

export interface FakeAzureOptions {
  /** Tenants per bearer token (the token stands in for "who is signed in"). */
  tenantsByToken: Record<string, FakeTenant[]>;
  /** Split `/tenants` into pages of this size (tests `nextLink`). */
  pageSize?: number;
  /** Resource Graph rows per bearer token, by which discovery query was sent. */
  resourceGraphByToken?: Record<
    string,
    { workspaces?: unknown[]; subscriptions?: unknown[]; sentinel?: unknown[] }
  >;
  /** Page size for Resource Graph responses (tests `$skipToken`). */
  resourceGraphPageSize?: number;
  /** Fault injection: status to return for the next N requests. */
  failNext?: { status: number; count: number };
  /** Log Analytics workspaces by customer ID (query and metadata endpoints). */
  logAnalytics?: Record<string, FakeLogAnalyticsWorkspace>;
}

/** One step of a fake workspace's behaviour; consumed one per query request. */
export type FakeQueryFault =
  | { status: number; headers?: Record<string, string>; error?: { code: string; message: string } }
  | { delayMs: number };

export interface FakeLogAnalyticsWorkspace {
  /** Tokens allowed to query this workspace (others get 403). */
  tokens: string[];
  tables: { name: string; columns: { name: string; type: string }[]; rows: unknown[][] }[];
  /** Returned with the data: a `PartialError`. */
  partialError?: { code: string; message: string };
  /** Applied to consecutive requests, in order, before the normal response. */
  faults?: FakeQueryFault[];
  /** Delay every response (tests cancellation). */
  delayMs?: number;
  metadata?: unknown;
}

export interface FakeAzure {
  /** Base URL, used as the cloud profile's ARM endpoint. */
  url: string;
  requests: {
    method: string;
    path: string;
    authorization: string | undefined;
    headers: Record<string, string | string[] | undefined>;
    body?: string;
  }[];
  options: FakeAzureOptions;
  close(): Promise<void>;
}

async function respondLogAnalytics(
  workspace: FakeLogAnalyticsWorkspace | undefined,
  metadata: boolean,
  token: string | undefined,
  res: http.ServerResponse,
  send: (status: number, body: unknown) => void,
): Promise<void> {
  const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
  if (workspace === undefined) {
    send(404, { error: { code: 'WorkspaceNotFoundError', message: 'Workspace not found' } });
    return;
  }
  if (token === undefined || token === 'expired') {
    send(401, { error: { code: 'InvalidAuthenticationToken', message: 'Token expired' } });
    return;
  }
  if (!workspace.tokens.includes(token)) {
    send(403, {
      error: { code: 'InsufficientAccessError', message: 'Insufficient access' },
    });
    return;
  }
  if (metadata) {
    send(200, workspace.metadata ?? { tables: [] });
    return;
  }
  const fault = workspace.faults?.shift();
  if (fault !== undefined && 'delayMs' in fault) await wait(fault.delayMs);
  else if (fault !== undefined) {
    if (res.destroyed) return;
    res.writeHead(fault.status, { 'content-type': 'application/json', ...fault.headers });
    res.end(
      JSON.stringify({
        error: fault.error ?? { code: 'Injected', message: `Injected ${String(fault.status)}` },
      }),
    );
    return;
  }
  if (workspace.delayMs !== undefined) await wait(workspace.delayMs);
  if (res.destroyed) return;
  send(200, {
    tables: workspace.tables,
    ...(workspace.partialError === undefined
      ? {}
      : {
          error: { code: 'PartialError', message: 'Partial', innererror: workspace.partialError },
        }),
    statistics: {
      query: { resourceUsage: { cpu: { 'total cpu': '00:00:00.0156250' } } },
    },
  });
}

export async function startFakeAzure(options: FakeAzureOptions): Promise<FakeAzure> {
  const requests: FakeAzure['requests'] = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const record: FakeAzure['requests'][number] = {
      method: req.method ?? 'GET',
      path: url.pathname + url.search,
      authorization: req.headers.authorization,
      headers: req.headers,
    };
    requests.push(record);
    const send = (status: number, body: unknown): void => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };

    if (options.failNext !== undefined && options.failNext.count > 0) {
      options.failNext.count -= 1;
      send(options.failNext.status, { error: { code: 'Injected', message: 'Injected failure' } });
      return;
    }

    const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];

    const la = /^\/v1\/workspaces\/([^/]+)\/(query|metadata)$/.exec(url.pathname);
    if (la !== null && options.logAnalytics !== undefined) {
      const workspace = options.logAnalytics[decodeURIComponent(la[1] ?? '')];
      let body = '';
      req.on('data', (chunk: Buffer) => (body += chunk.toString()));
      req.on('end', () => {
        record.body = body;
        void respondLogAnalytics(workspace, la[2] === 'metadata', token, res, send);
      });
      return;
    }

    if (token === undefined || !(token in options.tenantsByToken)) {
      send(401, { error: { code: 'InvalidAuthenticationToken', message: 'Invalid token' } });
      return;
    }

    if (url.pathname === '/tenants' && req.method === 'GET') {
      if (url.searchParams.get('api-version') !== '2022-12-01') {
        send(400, { error: { code: 'InvalidApiVersion', message: 'Bad api-version' } });
        return;
      }
      const tenants = options.tenantsByToken[token] ?? [];
      const size = options.pageSize ?? tenants.length;
      const skip = Number(url.searchParams.get('$skiptoken') ?? '0');
      const page = tenants.slice(skip, skip + size);
      const next = skip + size < tenants.length ? skip + size : undefined;
      const address = server.address() as AddressInfo;
      send(200, {
        value: page.map((t) => ({ id: `/tenants/${t.tenantId}`, ...t })),
        ...(next === undefined
          ? {}
          : {
              nextLink: `http://127.0.0.1:${String(address.port)}/tenants?api-version=2022-12-01&$skiptoken=${String(next)}`,
            }),
      });
      return;
    }

    if (url.pathname === '/providers/Microsoft.ResourceGraph/resources' && req.method === 'POST') {
      if (url.searchParams.get('api-version') !== '2024-04-01') {
        send(400, { error: { code: 'InvalidApiVersion', message: 'Bad api-version' } });
        return;
      }
      let body = '';
      req.on('data', (chunk: Buffer) => (body += chunk.toString()));
      req.on('end', () => {
        const request = JSON.parse(body) as {
          query: string;
          options?: { $skipToken?: string; $top?: number };
        };
        const data = options.resourceGraphByToken?.[token] ?? {};
        const kind = request.query.includes('operationalinsights/workspaces')
          ? 'workspaces'
          : request.query.includes('resources/subscriptions')
            ? 'subscriptions'
            : 'sentinel';
        const all = data[kind] ?? [];
        const size = options.resourceGraphPageSize ?? request.options?.$top ?? 1000;
        const skip = Number(request.options?.$skipToken ?? '0');
        const page = all.slice(skip, skip + size);
        send(200, {
          totalRecords: all.length,
          count: page.length,
          data: page,
          resultTruncated: 'false',
          ...(skip + size < all.length ? { $skipToken: String(skip + size) } : {}),
        });
      });
      return;
    }

    send(404, { error: { code: 'NotFound', message: `No fake for ${url.pathname}` } });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${String(port)}`,
    requests,
    options,
    close: () =>
      new Promise((resolve) =>
        server.close(() => {
          resolve();
        }),
      ),
  };
}
