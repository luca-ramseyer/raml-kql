import { z } from 'zod';

import type { TenantRelation } from '../../shared/auth/models';
import type { CloudProfile } from '../auth/cloud';

/** Tenants API version, verified against the REST reference (2026-09). */
export const TENANTS_API_VERSION = '2022-12-01';

const TenantListSchema = z.object({
  value: z.array(
    z.object({
      tenantId: z.string(),
      displayName: z.string().optional(),
      defaultDomain: z.string().optional(),
      tenantCategory: z.string().optional(),
    }),
  ),
  nextLink: z.string().optional(),
});

export interface DirectoryTenant {
  tenantId: string;
  displayName?: string | undefined;
  defaultDomain?: string | undefined;
  relation: TenantRelation;
}

export class ArmRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ArmRequestError';
  }
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/**
 * `GET /tenants` (spec 02, "Tenant enumeration per account"): tenants the account is a member
 * or guest of. `nextLink` is only followed on the ARM origin, so a response can't redirect our
 * bearer token to another host.
 */
export async function listTenants(options: {
  cloud: CloudProfile;
  token: string;
  homeTenantId: string;
  fetch?: FetchLike;
  signal?: AbortSignal;
}): Promise<DirectoryTenant[]> {
  const doFetch = options.fetch ?? fetch;
  const origin = new URL(options.cloud.armEndpoint).origin;
  const tenants: DirectoryTenant[] = [];
  let url: string | undefined = `${origin}/tenants?api-version=${TENANTS_API_VERSION}`;

  for (let page = 0; url !== undefined && page < 50; page++) {
    const response = await doFetch(url, {
      headers: { Authorization: `Bearer ${options.token}`, Accept: 'application/json' },
      signal: options.signal ?? AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      throw new ArmRequestError(
        `ARM /tenants returned HTTP ${String(response.status)}`,
        response.status,
      );
    }
    const body = TenantListSchema.parse(await response.json());
    for (const tenant of body.value) {
      const tenantId = tenant.tenantId.toLowerCase();
      tenants.push({
        tenantId,
        displayName: tenant.displayName,
        defaultDomain: tenant.defaultDomain,
        relation:
          tenantId === options.homeTenantId.toLowerCase()
            ? 'home'
            : tenant.tenantCategory === 'ProjectedBy' || tenant.tenantCategory === 'ManagedBy'
              ? 'lighthouse'
              : 'guest',
      });
    }
    const next: string | undefined = body.nextLink;
    url = next !== undefined && new URL(next).origin === origin ? next : undefined;
  }
  return tenants;
}
