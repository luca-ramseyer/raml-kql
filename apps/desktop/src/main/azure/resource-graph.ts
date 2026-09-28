import { z } from 'zod';

import type { CloudProfile } from '../auth/cloud';

import { ArmRequestError, type FetchLike } from './arm-tenants';

/** Verified against the REST reference (2026-09); spec 03 listed the older 2022-10-01. */
export const RESOURCE_GRAPH_API_VERSION = '2024-04-01';

const ResponseSchema = z.object({
  data: z.array(z.record(z.string(), z.unknown())),
  $skipToken: z.string().optional(),
  resultTruncated: z.union([z.string(), z.boolean()]).optional(),
});

/**
 * Run an Azure Resource Graph query across everything the token can see (including
 * Lighthouse-delegated subscriptions) and return all rows, following `$skipToken`.
 */
export async function queryResourceGraph(options: {
  cloud: CloudProfile;
  token: string;
  query: string;
  fetch?: FetchLike;
  /** Safety valve for runaway paging. */
  maxRows?: number;
}): Promise<Record<string, unknown>[]> {
  const doFetch = options.fetch ?? fetch;
  const url = `${new URL(options.cloud.armEndpoint).origin}/providers/Microsoft.ResourceGraph/resources?api-version=${RESOURCE_GRAPH_API_VERSION}`;
  const rows: Record<string, unknown>[] = [];
  let skipToken: string | undefined;
  const maxRows = options.maxRows ?? 50_000;

  do {
    const response = await doFetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${options.token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        query: options.query,
        options: {
          $top: 1000,
          resultFormat: 'objectArray',
          ...(skipToken === undefined ? {} : { $skipToken: skipToken }),
        },
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) {
      throw new ArmRequestError(
        `Resource Graph returned HTTP ${String(response.status)}`,
        response.status,
      );
    }
    const body = ResponseSchema.parse(await response.json());
    rows.push(...body.data);
    skipToken = body.$skipToken;
  } while (skipToken !== undefined && rows.length < maxRows);

  return rows;
}

/** Spec 03 discovery queries. */
export const DISCOVERY_QUERIES = {
  workspaces: `resources
| where type =~ 'microsoft.operationalinsights/workspaces'
| project id, name, location, tenantId, subscriptionId, resourceGroup,
          customerId = tostring(properties.customerId),
          retentionInDays = toint(properties.retentionInDays),
          sku = tostring(properties.sku.name)`,
  subscriptions: `resourcecontainers
| where type =~ 'microsoft.resources/subscriptions'
| project subscriptionId, subscriptionName = name, tenantId`,
  sentinel: `resources
| where type =~ 'microsoft.operationsmanagement/solutions' and name startswith 'SecurityInsights('
| project workspaceResourceId = tolower(tostring(properties.workspaceResourceId))`,
} as const;

export type DiscoveryQueryKind = keyof typeof DISCOVERY_QUERIES;

/** Sentinel onboarding states API version, verified against the REST reference (2026-09). */
export const SENTINEL_ONBOARDING_API_VERSION = '2025-09-01';

/**
 * Spec 03 fallback when the legacy solution query didn't flag a workspace: an existing
 * `onboardingStates/default` means Microsoft Sentinel is enabled. Any failure means "no".
 */
export async function hasSentinelOnboarding(options: {
  cloud: CloudProfile;
  token: string;
  workspaceResourceId: string;
  fetch?: FetchLike;
}): Promise<boolean> {
  const doFetch = options.fetch ?? fetch;
  const origin = new URL(options.cloud.armEndpoint).origin;
  try {
    const response = await doFetch(
      `${origin}${options.workspaceResourceId}/providers/Microsoft.SecurityInsights/onboardingStates/default?api-version=${SENTINEL_ONBOARDING_API_VERSION}`,
      {
        headers: { Authorization: `Bearer ${options.token}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(30_000),
      },
    );
    return response.ok;
  } catch {
    return false;
  }
}
