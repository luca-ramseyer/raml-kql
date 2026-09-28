import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

import { AccessPathSchema } from '../../shared/workspaces/models';
import { readTextFile, writeTextFileAtomic } from '../config/jsonc';

/** A workspace as discovery found it (before workspaces.jsonc preferences are applied). */
export const DiscoveredWorkspaceSchema = z.object({
  resourceId: z.string(),
  name: z.string(),
  customerId: z.string(),
  location: z.string(),
  tenantId: z.string(),
  subscriptionId: z.string(),
  subscriptionName: z.string().optional(),
  resourceGroup: z.string(),
  sentinel: z.boolean(),
  retentionInDays: z.number().int().optional(),
  sku: z.string().optional(),
  paths: z.array(AccessPathSchema),
  missing: z.boolean(),
});
export type DiscoveredWorkspace = z.infer<typeof DiscoveredWorkspaceSchema>;

export const DiscoveredTenantSchema = z.object({
  tenantId: z.string(),
  displayName: z.string().optional(),
  defaultDomain: z.string().optional(),
});
export type DiscoveredTenant = z.infer<typeof DiscoveredTenantSchema>;

export const InventoryCacheSchema = z.object({
  version: z.literal(1),
  workspaces: z.array(DiscoveredWorkspaceSchema),
  tenants: z.array(DiscoveredTenantSchema),
  refreshedAt: z.string().optional(),
});
export type InventoryCache = z.infer<typeof InventoryCacheSchema>;

export interface InventoryCacheStore {
  read(): Promise<InventoryCache | undefined>;
  write(cache: InventoryCache): Promise<void>;
}

/**
 * `state/inventory.json` (spec 03, "Discovery lifecycle"): metadata only, so startup shows the
 * last known workspaces instantly while a background refresh runs.
 */
export class FileInventoryCache implements InventoryCacheStore {
  constructor(private readonly file: string) {}

  async read(): Promise<InventoryCache | undefined> {
    try {
      const text = await readTextFile(this.file);
      if (text === undefined) return undefined;
      const parsed = InventoryCacheSchema.safeParse(JSON.parse(text));
      return parsed.success ? parsed.data : undefined;
    } catch {
      return undefined;
    }
  }

  async write(cache: InventoryCache): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true });
    await writeTextFileAtomic(this.file, JSON.stringify(cache, null, 2) + '\n');
  }
}

export class MemoryInventoryCache implements InventoryCacheStore {
  private cache: InventoryCache | undefined;

  read(): Promise<InventoryCache | undefined> {
    return Promise.resolve(this.cache);
  }

  write(cache: InventoryCache): Promise<void> {
    this.cache = cache;
    return Promise.resolve();
  }
}
