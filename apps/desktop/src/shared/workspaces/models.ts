import { z } from 'zod';

import { GuidSchema } from '../auth/models';

/**
 * Workspaces, tenants and access paths (spec 03). Everything here is metadata: names, IDs and
 * flags. No query results and no tokens.
 */

/** How an account reaches a workspace. */
export const AccessViaSchema = z.enum(['home', 'lighthouse', 'guest', 'azureCli']);
export type AccessVia = z.infer<typeof AccessViaSchema>;

export const AccessPathSchema = z.object({
  accountId: z.string().min(1).max(300),
  /** The tenant whose token is used (Lighthouse: the managing/home tenant). */
  authorityTenantId: GuidSchema,
  via: AccessViaSchema,
});
export type AccessPath = z.infer<typeof AccessPathSchema>;

export function accessPathKey(path: Pick<AccessPath, 'accountId' | 'authorityTenantId'>): string {
  return `${path.accountId}|${path.authorityTenantId.toLowerCase()}`;
}

export const WorkspaceSchema = z.object({
  /** Workspace key: the lowercase ARM resource ID. */
  resourceId: z.string().min(1).max(1000),
  name: z.string().max(300),
  /** The GUID used by the Log Analytics Query API. */
  customerId: z.string().max(100),
  location: z.string().max(100),
  tenantId: GuidSchema,
  subscriptionId: z.string().max(100),
  subscriptionName: z.string().max(300).optional(),
  resourceGroup: z.string().max(300),
  /** Microsoft Sentinel is enabled on this workspace (a badge only). */
  sentinel: z.boolean(),
  retentionInDays: z.number().int().optional(),
  sku: z.string().max(100).optional(),
  /** Every account/tenant route to this workspace, in discovery order. */
  paths: z.array(AccessPathSchema),
  /** Not found by the latest discovery (kept, greyed out, until the user removes it). */
  missing: z.boolean(),
  // From workspaces.jsonc:
  enabled: z.boolean(),
  alias: z.string().max(200).optional(),
  tags: z.array(z.string().max(100)),
  /** accessPathKey of the user's preferred path. */
  preferredPath: z.string().max(400).optional(),
});
export type Workspace = z.infer<typeof WorkspaceSchema>;

export const InventoryTenantSchema = z.object({
  tenantId: GuidSchema,
  displayName: z.string().max(300).optional(),
  defaultDomain: z.string().max(300).optional(),
  alias: z.string().max(200).optional(),
  tags: z.array(z.string().max(100)),
  /** Stable number for automatic aliases ("Customer 07"), assigned once. */
  aliasNumber: z.number().int().positive(),
});
export type InventoryTenant = z.infer<typeof InventoryTenantSchema>;

export const InventorySchema = z.object({
  workspaces: z.array(WorkspaceSchema),
  tenants: z.array(InventoryTenantSchema),
  refreshedAt: z.iso.datetime().optional(),
  refreshing: z.boolean(),
  /** Short, redacted problems from the last discovery (per account/tenant). */
  problems: z.array(z.string().max(500)),
});
export type Inventory = z.infer<typeof InventorySchema>;

export const WorkspaceUpdateSchema = z
  .object({
    resourceIds: z.array(z.string().min(1).max(1000)).min(1).max(5000),
    enabled: z.boolean().optional(),
    /** `null` removes the alias. Only valid for a single workspace. */
    alias: z.string().max(200).nullable().optional(),
    tags: z.array(z.string().min(1).max(100)).max(50).optional(),
    preferredPath: z.string().max(400).nullable().optional(),
    /** Forget workspaces marked missing. */
    remove: z.boolean().optional(),
  })
  .strict();
export type WorkspaceUpdate = z.infer<typeof WorkspaceUpdateSchema>;

export const TenantUpdateSchema = z
  .object({
    tenantId: GuidSchema,
    alias: z.string().max(200).nullable().optional(),
    tags: z.array(z.string().min(1).max(100)).max(50).optional(),
  })
  .strict();
export type TenantUpdate = z.infer<typeof TenantUpdateSchema>;
