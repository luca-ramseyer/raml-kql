import type { KqlType, SchemaTable } from '../../shared/schema/models';
import type { Workspace } from '../../shared/workspaces/models';
import { DEMO_TENANTS } from '../auth/demo-provider';
import { QueryFailure, type QueryResponse, type RawTable } from '../azure/log-analytics-query';
import type { DataSource } from '../query/query-engine';
import { sleep } from '../query/retry';

import {
  DEMO_EXTRA_TENANTS,
  DEMO_WORKSPACES,
  demoResourceId,
  type DemoWorkspace,
} from './demo-inventory';
import { demoSchemaFor } from './demo-schema';

/**
 * Demo query results (spec 04, "Demo mode"). Not a KQL engine: it finds the source table,
 * honours `take`/`limit` and `count`, answers the sample query, and otherwise returns a
 * deterministic sample of the table from a seeded PRNG. Workspace behaviours drive the fake
 * failures: one workspace always returns 403, one is slow and one is throttled once.
 */

const DEFAULT_ROWS = 25;
const SLOW_MS = 2500;

/** mulberry32 seeded from a string hash: the same query gives the same data. */
function prng(seedText: string): () => number {
  let seed = 2166136261;
  for (let i = 0; i < seedText.length; i++)
    seed = Math.imul(seed ^ seedText.charCodeAt(i), 16777619);
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DOMAINS: Record<string, string> = Object.fromEntries(
  [...Object.values(DEMO_TENANTS), ...Object.values(DEMO_EXTRA_TENANTS)].map((t) => [
    t.tenantId,
    t.defaultDomain,
  ]),
);

const pick = <T>(random: () => number, items: readonly T[]): T =>
  items[Math.floor(random() * items.length)] as T;

const APPS = ['Office 365 Exchange Online', 'Azure Portal', 'Microsoft Teams', 'SharePoint Online'];
const LOCATIONS = ['CH', 'DE', 'US', 'GB', 'NL'];
const RESULT_TYPES = ['0', '0', '0', '0', '50126', '50074', '53003'];
const PROCESSES = ['powershell.exe', 'cmd.exe', 'svchost.exe', 'rundll32.exe', 'msedge.exe'];

function value(
  column: string,
  type: KqlType,
  random: () => number,
  domain: string,
  timeMs: number,
): unknown {
  const n = 1 + Math.floor(random() * 20);
  switch (type) {
    case 'datetime':
      return new Date(timeMs).toISOString();
    case 'int':
    case 'long':
      return column === 'EventID'
        ? pick(random, [4624, 4625, 4688, 4720])
        : Math.floor(random() * 1000);
    case 'real':
      return Math.round(random() * 10_000) / 100;
    case 'bool':
      return random() > 0.2;
    case 'guid':
      return `00000000-0000-0000-0000-${Math.floor(random() * 1e12)
        .toString()
        .padStart(12, '0')}`;
    case 'dynamic':
      return JSON.stringify({ demo: true, n });
    case 'timespan':
      return `00:00:${String(n).padStart(2, '0')}`;
    default:
      break;
  }
  if (/UserPrincipalName|UserId|Caller|Account$|AccountName|Owner/.test(column)) {
    return `user${String(n).padStart(2, '0')}@${domain}`;
  }
  if (/IP|IpAddress|ClientIP/.test(column)) return `203.0.113.${String(n * 7)}`;
  if (/Computer|DeviceName/.test(column)) return `ws-${String(n).padStart(3, '0')}.${domain}`;
  if (column === 'ResultType') return pick(random, RESULT_TYPES);
  if (column === 'AppDisplayName') return pick(random, APPS);
  if (column === 'Location') return pick(random, LOCATIONS);
  if (/FileName$/.test(column)) return pick(random, PROCESSES);
  if (/Severity|RiskLevel/.test(column)) return pick(random, ['Low', 'Medium', 'High']);
  if (column === 'Type') return 'Demo';
  if (column === 'TenantId') return '00000000-0000-0000-0000-000000000000';
  return `${column}-${String(n)}`;
}

function sampleTable(
  table: SchemaTable,
  workspace: DemoWorkspace,
  rows: number,
  seed: string,
  nowMs: number,
): RawTable {
  const random = prng(`${seed}|${workspace.name}|${table.name}`);
  const domain = DOMAINS[workspace.tenantId] ?? 'contoso.example';
  const times = Array.from({ length: rows }, () => nowMs - Math.floor(random() * 86_400_000)).sort(
    (a, b) => b - a,
  );
  return {
    name: 'PrimaryResult',
    columns: table.columns.map((c) => ({ name: c.name, type: c.type })),
    rows: times.map((time) =>
      table.columns.map((c) => value(c.name, c.type, random, domain, time)),
    ),
  };
}

/** The sample query (spec 05 starter): failed sign-ins per user. */
function signInSummary(workspace: DemoWorkspace, rows: number, seed: string): RawTable {
  const random = prng(`${seed}|${workspace.name}|summary`);
  const domain = DOMAINS[workspace.tenantId] ?? 'contoso.example';
  const users = Array.from({ length: Math.min(rows, 8 + Math.floor(random() * 12)) }, (_, i) => {
    const signIns = 5 + Math.floor(random() * 200);
    return [
      `user${String(i + 1).padStart(2, '0')}@${domain}`,
      signIns,
      Math.floor(random() * signIns * 0.3),
    ];
  });
  users.sort((a, b) => (b[2] as number) - (a[2] as number));
  return {
    name: 'PrimaryResult',
    columns: [
      { name: 'UserPrincipalName', type: 'string' },
      { name: 'SignIns', type: 'long' },
      { name: 'FailedSignIns', type: 'long' },
    ],
    rows: users,
  };
}

/** Strip comments and string literals so table detection doesn't match inside them. */
function code(query: string): string {
  return query.replace(/\/\/[^\n]*/g, ' ').replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""');
}

export interface DemoQueryPlan {
  table: string | undefined;
  limit: number | undefined;
  count: boolean;
  signInSummary: boolean;
}

/** What the demo understands of a query (exported for tests). */
export function planDemoQuery(query: string, knownTables: readonly string[]): DemoQueryPlan {
  const text = code(query);
  const words = [...text.matchAll(/[A-Za-z_][\w]*/g)].map((m) => m[0]);
  const table = words.find((word) => knownTables.includes(word));
  const limits = [...text.matchAll(/\|\s*(?:take|limit)\s+(\d+)/gi)].map((m) => Number(m[1]));
  const tops = [...text.matchAll(/\|\s*top\s+(\d+)/gi)].map((m) => Number(m[1]));
  return {
    table,
    limit: [...limits, ...tops].at(-1),
    count: /\|\s*count\s*($|\|)/im.test(text),
    signInSummary:
      table === 'SigninLogs' && /summarize[\s\S]*countif\s*\(\s*ResultType/i.test(text),
  };
}

export const ALL_DEMO_TABLES = [
  ...new Set(DEMO_WORKSPACES.flatMap((w) => demoSchemaFor(w).tables.map((t) => t.name))),
];

export class DemoDataSource implements DataSource {
  private throttled = new Set<string>();

  constructor(private readonly now: () => number = Date.now) {}

  async execute(request: {
    workspace: Workspace;
    query: string;
    signal: AbortSignal;
  }): Promise<QueryResponse> {
    const demo = DEMO_WORKSPACES.find((w) => demoResourceId(w) === request.workspace.resourceId);
    if (demo === undefined) throw new QueryFailure('notFound', 'NotFound: Workspace not found.');

    // Look busy, like a real round trip.
    await abortable(
      demo.behaviour === 'slow' ? SLOW_MS : 150 + (demo.name.length % 5) * 60,
      request.signal,
    );

    if (demo.behaviour === 'alwaysForbidden') {
      throw new QueryFailure(
        'forbidden',
        'InsufficientAccessError: The provided credentials have insufficient access to perform the requested operation (demo).',
        { status: 403, code: 'InsufficientAccessError' },
      );
    }
    if (demo.behaviour === 'throttleOnce' && !this.throttled.has(demo.name)) {
      this.throttled.add(demo.name);
      throw new QueryFailure('throttled', 'ThrottledError: Too many requests (demo).', {
        status: 429,
        retryAfterMs: 1000,
      });
    }

    const schema = demoSchemaFor(demo);
    const plan = planDemoQuery(request.query, ALL_DEMO_TABLES);
    if (plan.table === undefined) {
      return {
        tables: [
          {
            name: 'PrimaryResult',
            columns: [{ name: 'Message', type: 'string' }],
            rows: [
              ['Demo data: the demo understands table queries only (e.g. "SigninLogs | take 10").'],
            ],
          },
        ],
      };
    }
    const table = schema.tables.find((t) => t.name === plan.table);
    if (table === undefined) {
      throw new QueryFailure(
        'badRequest',
        `SemanticError: 'where' operator: Failed to resolve table or column expression named '${plan.table}'`,
        { status: 400, code: 'SemanticError' },
      );
    }
    if (plan.count) {
      const random = prng(`${request.query}|${demo.name}|count`);
      return {
        tables: [
          {
            name: 'PrimaryResult',
            columns: [{ name: 'Count', type: 'long' }],
            rows: [[100 + Math.floor(random() * 5000)]],
          },
        ],
      };
    }
    const rows = Math.min(plan.limit ?? DEFAULT_ROWS, 5000);
    return {
      tables: [
        plan.signInSummary
          ? signInSummary(demo, rows, request.query)
          : sampleTable(table, demo, rows, request.query, this.now()),
      ],
      statistics: { cpuMs: 12 + (demo.name.length % 7) * 5, dataScannedMb: 1.5 },
    };
  }
}

async function abortable(ms: number, signal: AbortSignal): Promise<void> {
  try {
    await sleep(ms, signal);
  } catch {
    throw new QueryFailure('cancelled', 'Cancelled.');
  }
}
