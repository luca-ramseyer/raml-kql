import { z } from 'zod';

import { normalizeKqlType, type WorkspaceSchemaData } from '../../shared/schema/models';
import type { CloudProfile } from '../auth/cloud';

import { ArmRequestError, type FetchLike } from './arm-tenants';

/*
 * `GET {logAnalyticsEndpoint}/v1/workspaces/{customerId}/metadata` (spec 05). The response also
 * carries solutions, categories, saved queries and more; only tables and functions are read,
 * and unknown fields are ignored, so additions on Microsoft's side never break parsing.
 */
const MetadataColumnSchema = z.looseObject({
  name: z.string().min(1),
  type: z.string().nullish(),
  description: z.string().nullish(),
});

const MetadataTableSchema = z.looseObject({
  name: z.string().min(1),
  description: z.string().nullish(),
  columns: z.array(MetadataColumnSchema).nullish(),
});

const MetadataFunctionSchema = z.looseObject({
  name: z.string().min(1),
  body: z.string().nullish(),
  parameters: z.string().nullish(),
  description: z.string().nullish(),
});

const MetadataResponseSchema = z.looseObject({
  tables: z.array(MetadataTableSchema).nullish(),
  functions: z.array(MetadataFunctionSchema).nullish(),
});

const clip = (text: string | null | undefined, max: number): string | undefined =>
  text === null || text === undefined || text === '' ? undefined : text.slice(0, max);

/** Parse a metadata response into the app's schema model (exported for tests). */
export function parseWorkspaceMetadata(json: unknown): WorkspaceSchemaData {
  const body = MetadataResponseSchema.parse(json);
  return {
    tables: (body.tables ?? []).map((table) => ({
      name: table.name,
      ...(clip(table.description, 2000) === undefined
        ? {}
        : { description: clip(table.description, 2000) }),
      columns: (table.columns ?? []).map((column) => ({
        name: column.name,
        type: normalizeKqlType(column.type ?? 'string'),
        ...(clip(column.description, 2000) === undefined
          ? {}
          : { description: clip(column.description, 2000) }),
      })),
    })),
    functions: (body.functions ?? []).map((fn) => ({
      name: fn.name,
      parameters: (fn.parameters ?? '').replace(/^\(|\)$/g, ''),
      body: fn.body ?? '',
      ...(clip(fn.description, 2000) === undefined
        ? {}
        : { description: clip(fn.description, 2000) }),
    })),
  };
}

export async function fetchWorkspaceMetadata(options: {
  cloud: CloudProfile;
  token: string;
  customerId: string;
  fetch?: FetchLike;
}): Promise<WorkspaceSchemaData> {
  const doFetch = options.fetch ?? fetch;
  const url = `${new URL(options.cloud.logAnalyticsEndpoint).origin}/v1/workspaces/${encodeURIComponent(options.customerId)}/metadata`;
  const response = await doFetch(url, {
    headers: { Authorization: `Bearer ${options.token}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    throw new ArmRequestError(
      `Log Analytics metadata returned HTTP ${String(response.status)}`,
      response.status,
    );
  }
  return parseWorkspaceMetadata(await response.json());
}
