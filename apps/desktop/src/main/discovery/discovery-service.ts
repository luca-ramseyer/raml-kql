import { z } from 'zod';

import type { AccountsSnapshot } from '../../shared/auth/models';
import {
  accessPathKey,
  type AccessPath,
  type Inventory,
  type TenantUpdate,
  type WorkspaceUpdate,
} from '../../shared/workspaces/models';
import type { TokenRequest } from '../auth/auth-service';
import type { AccessToken } from '../auth/token-cache';
import type { DiscoveryQueryKind } from '../azure/resource-graph';
import type {
  WorkspacesConfig,
  WorkspacesConfigPatch,
  WorkspacesConfigStore,
  TenantSettings,
  WorkspaceSettings,
} from '../config/workspaces-config';
import { describeError } from '../logging/redact';

import type {
  DiscoveredTenant,
  DiscoveredWorkspace,
  InventoryCache,
  InventoryCacheStore,
} from './inventory-cache';

/** Runs one discovery query with one (account, tenant) token: Resource Graph, or demo data. */
export interface DiscoverySource {
  query(
    kind: DiscoveryQueryKind,
    context: { accountId: string; tenantId: string; token: string },
  ): Promise<Record<string, unknown>[]>;
  /** Tenant names the source knows beyond `/tenants` (demo mode). */
  tenantNames?(): DiscoveredTenant[];
  /** Spec 03 fallback Sentinel check for workspaces the solution query didn't flag. */
  hasSentinel?(workspaceResourceId: string, token: string): Promise<boolean>;
}

/** Run `task` over `items` with at most `limit` in flight. */
async function forEachLimited<T>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      if (item !== undefined) await task(item);
    }
  });
  await Promise.all(workers);
}

export interface DiscoveryAuth {
  snapshot(): AccountsSnapshot;
  getToken(request: TokenRequest): Promise<AccessToken>;
}

export interface DiscoveryServiceOptions {
  auth: DiscoveryAuth;
  source: DiscoverySource;
  config: WorkspacesConfigStore;
  cache: InventoryCacheStore;
  /** `workspaces.newWorkspaceDefault`. */
  newWorkspaceDefault: () => 'enabled' | 'disabled';
  onChange: (inventory: Inventory) => void;
  /** Called after a refresh that found workspaces not seen before. */
  onNewWorkspaces: (count: number) => void;
  now?: () => Date;
}

const WorkspaceRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  location: z.string().default(''),
  tenantId: z.string(),
  subscriptionId: z.string(),
  resourceGroup: z.string().default(''),
  customerId: z.string().default(''),
  retentionInDays: z.number().int().nullish(),
  sku: z.string().nullish(),
});
const SubscriptionRowSchema = z.object({
  subscriptionId: z.string(),
  subscriptionName: z.string(),
});
const SentinelRowSchema = z.object({ workspaceResourceId: z.string() });

function rows<T>(schema: z.ZodType<T>, data: Record<string, unknown>[]): T[] {
  return data.flatMap((row) => {
    const parsed = schema.safeParse(row);
    return parsed.success ? [parsed.data] : [];
  });
}

/**
 * Workspace discovery and management (spec 03). Discovery runs per account and per signed-in
 * tenant through Resource Graph (which includes Lighthouse delegations), dedupes by the
 * lowercase resource ID and keeps every access path.
 */
export class DiscoveryService {
  private cache: InventoryCache = { version: 1, workspaces: [], tenants: [] };
  private config: WorkspacesConfig = { workspaces: {}, tenants: {} };
  private problems: string[] = [];
  private running: Promise<Inventory> | undefined;

  constructor(private readonly options: DiscoveryServiceOptions) {}

  /** Load the cached inventory and preferences (instant startup). */
  async init(): Promise<Inventory> {
    this.cache = (await this.options.cache.read()) ?? this.cache;
    await this.reloadConfig(false);
    this.emit();
    return this.snapshot();
  }

  async reloadConfig(emit = true): Promise<void> {
    const { config, problems } = await this.options.config.read();
    this.config = config;
    this.problems = this.problems
      .filter((p) => !p.startsWith('workspaces.jsonc'))
      .concat(problems.map((p) => `workspaces.jsonc: ${p.message}`));
    if (emit) this.emit();
  }

  get refreshing(): boolean {
    return this.running !== undefined;
  }

  snapshot(): Inventory {
    const tenants = this.cache.tenants.map((tenant) => {
      const settings = this.config.tenants[tenant.tenantId] ?? {};
      return {
        tenantId: tenant.tenantId,
        ...(tenant.displayName === undefined ? {} : { displayName: tenant.displayName }),
        ...(tenant.defaultDomain === undefined ? {} : { defaultDomain: tenant.defaultDomain }),
        ...(settings.alias === undefined ? {} : { alias: settings.alias }),
        tags: settings.tags ?? [],
        aliasNumber: settings.aliasNumber ?? 1,
      };
    });
    const defaultEnabled = this.options.newWorkspaceDefault() === 'enabled';
    const workspaces = this.cache.workspaces.map((workspace) => {
      const settings: WorkspaceSettings = this.config.workspaces[workspace.resourceId] ?? {};
      return {
        ...workspace,
        enabled: settings.enabled ?? defaultEnabled,
        ...(settings.alias === undefined ? {} : { alias: settings.alias }),
        tags: settings.tags ?? [],
        ...(settings.preferredPath === undefined ? {} : { preferredPath: settings.preferredPath }),
      };
    });
    return {
      workspaces,
      tenants,
      ...(this.cache.refreshedAt === undefined ? {} : { refreshedAt: this.cache.refreshedAt }),
      refreshing: this.refreshing,
      problems: this.problems,
    };
  }

  private emit(): void {
    this.options.onChange(this.snapshot());
  }

  /**
   * Add tenants the accounts know about but the inventory doesn't yet, and give them alias
   * numbers right away, so an aliased name exists before the first discovery finishes.
   * Emits synchronously; the new alias numbers are persisted in the background.
   */
  syncTenants(snapshot: AccountsSnapshot): void {
    const known = new Set(this.cache.tenants.map((t) => t.tenantId));
    const added: DiscoveredTenant[] = [];
    for (const account of snapshot.accounts) {
      for (const tenant of account.tenants) {
        if (known.has(tenant.tenantId)) continue;
        known.add(tenant.tenantId);
        added.push({
          tenantId: tenant.tenantId,
          ...(tenant.displayName === undefined ? {} : { displayName: tenant.displayName }),
          ...(tenant.defaultDomain === undefined ? {} : { defaultDomain: tenant.defaultDomain }),
        });
      }
    }
    if (added.length === 0) return;
    this.cache = {
      ...this.cache,
      tenants: [...this.cache.tenants, ...added].sort((a, b) =>
        a.tenantId.localeCompare(b.tenantId),
      ),
    };
    let next =
      Math.max(0, ...Object.values(this.config.tenants).map((t) => t.aliasNumber ?? 0)) + 1;
    const patch: Record<string, TenantSettings> = {};
    for (const tenant of added.sort((a, b) => a.tenantId.localeCompare(b.tenantId))) {
      if (this.config.tenants[tenant.tenantId]?.aliasNumber !== undefined) continue;
      patch[tenant.tenantId] = { ...this.config.tenants[tenant.tenantId], aliasNumber: next++ };
    }
    this.config = { ...this.config, tenants: { ...this.config.tenants, ...patch } };
    this.emit();
    void this.options.config.patch({ tenants: patch }).catch(() => undefined);
  }

  /** Run discovery for every signed-in account. Concurrent calls share one run. */
  refresh(): Promise<Inventory> {
    this.running ??= this.discover().finally(() => {
      this.running = undefined;
      this.emit();
    });
    this.emit();
    return this.running;
  }

  private async discover(): Promise<Inventory> {
    const { auth, source } = this.options;
    const problems: string[] = [];
    const found = new Map<string, DiscoveredWorkspace>();
    const subscriptionNames = new Map<string, string>();
    const sentinel = new Set<string>();
    const tenantNames = new Map<string, DiscoveredTenant>();

    const tokens = new Map<string, string>(); // accessPathKey → ARM token
    const snapshot = auth.snapshot();
    for (const account of snapshot.accounts) {
      for (const tenant of account.tenants) {
        tenantNames.set(tenant.tenantId, {
          tenantId: tenant.tenantId,
          ...(tenant.displayName === undefined ? {} : { displayName: tenant.displayName }),
          ...(tenant.defaultDomain === undefined ? {} : { defaultDomain: tenant.defaultDomain }),
        });
      }
      const authorities = account.tenants.filter(
        (t) => t.state === 'ok' && (t.relation === 'home' || t.relation === 'guest'),
      );
      for (const tenant of authorities) {
        const label = `${account.username} / ${tenant.displayName ?? tenant.tenantId}`;
        let token: string;
        try {
          token = (
            await auth.getToken({
              accountId: account.id,
              tenantId: tenant.tenantId,
              resource: 'arm',
            })
          ).token;
        } catch (error) {
          problems.push(`${label}: ${describeError(error)}`);
          continue;
        }
        tokens.set(
          accessPathKey({ accountId: account.id, authorityTenantId: tenant.tenantId }),
          token,
        );
        const context = { accountId: account.id, tenantId: tenant.tenantId, token };
        let results: [
          Record<string, unknown>[],
          Record<string, unknown>[],
          Record<string, unknown>[],
        ];
        try {
          results = await Promise.all([
            source.query('workspaces', context),
            source.query('subscriptions', context),
            source.query('sentinel', context),
          ]);
        } catch (error) {
          problems.push(`${label}: ${describeError(error)}`);
          continue;
        }
        const [workspaceRows, subscriptionRows, sentinelRows] = results;
        for (const row of rows(SubscriptionRowSchema, subscriptionRows)) {
          subscriptionNames.set(row.subscriptionId.toLowerCase(), row.subscriptionName);
        }
        for (const row of rows(SentinelRowSchema, sentinelRows))
          sentinel.add(row.workspaceResourceId.toLowerCase());

        for (const row of rows(WorkspaceRowSchema, workspaceRows)) {
          const resourceId = row.id.toLowerCase();
          const workspaceTenant = row.tenantId.toLowerCase();
          const path: AccessPath = {
            accountId: account.id,
            authorityTenantId: tenant.tenantId,
            via:
              account.provider === 'azureCli'
                ? 'azureCli'
                : tenant.relation === 'guest'
                  ? 'guest'
                  : workspaceTenant === tenant.tenantId
                    ? 'home'
                    : 'lighthouse',
          };
          const existing = found.get(resourceId);
          if (existing !== undefined) {
            if (!existing.paths.some((p) => accessPathKey(p) === accessPathKey(path)))
              existing.paths.push(path);
            continue;
          }
          found.set(resourceId, {
            resourceId,
            name: row.name,
            customerId: row.customerId,
            location: row.location,
            tenantId: workspaceTenant,
            subscriptionId: row.subscriptionId.toLowerCase(),
            resourceGroup: row.resourceGroup,
            sentinel: false,
            ...(row.retentionInDays == null ? {} : { retentionInDays: row.retentionInDays }),
            ...(row.sku == null || row.sku === '' ? {} : { sku: row.sku }),
            paths: [path],
            missing: false,
          });
          if (!tenantNames.has(workspaceTenant))
            tenantNames.set(workspaceTenant, { tenantId: workspaceTenant });
        }
      }
    }
    for (const name of source.tenantNames?.() ?? []) {
      tenantNames.set(name.tenantId, { ...tenantNames.get(name.tenantId), ...name });
    }

    const hasSentinel = source.hasSentinel?.bind(source);
    if (hasSentinel !== undefined) {
      const unflagged = [...found.values()].filter((w) => !sentinel.has(w.resourceId));
      await forEachLimited(unflagged, 8, async (workspace) => {
        const path = workspace.paths[0];
        const token = path === undefined ? undefined : tokens.get(accessPathKey(path));
        if (token !== undefined && (await hasSentinel(workspace.resourceId, token))) {
          sentinel.add(workspace.resourceId);
        }
      });
    }
    for (const workspace of found.values()) {
      workspace.sentinel = sentinel.has(workspace.resourceId);
      const subscriptionName = subscriptionNames.get(workspace.subscriptionId);
      if (subscriptionName !== undefined) workspace.subscriptionName = subscriptionName;
    }

    // Workspaces not found any more are kept and marked missing, but only after a complete
    // discovery: a failing account must not make its workspaces look deleted.
    const previous = new Map(this.cache.workspaces.map((w) => [w.resourceId, w]));
    const complete = problems.length === 0;
    const kept = [...previous.values()]
      .filter((w) => !found.has(w.resourceId))
      .map((w) => ({ ...w, missing: complete ? true : w.missing }));
    const newIds = [...found.keys()].filter((id) => !previous.has(id));

    // Every tenant an account knows (plus Lighthouse customers seen in workspaces) is listed,
    // so each gets a stable alias number even before it has workspaces.
    const tenants = [...tenantNames.values()].sort((a, b) => a.tenantId.localeCompare(b.tenantId));

    this.cache = {
      version: 1,
      workspaces: [...found.values(), ...kept],
      tenants,
      refreshedAt: (this.options.now ?? (() => new Date()))().toISOString(),
    };
    await this.options.cache.write(this.cache);
    await this.persistNewEntries(newIds, tenants);
    this.problems = problems;
    if (newIds.length > 0) this.options.onNewWorkspaces(newIds.length);
    return this.snapshot();
  }

  /** New workspaces get their enabled state once; new tenants get a stable alias number. */
  private async persistNewEntries(newIds: string[], tenants: DiscoveredTenant[]): Promise<void> {
    const workspaces: NonNullable<WorkspacesConfigPatch['workspaces']> = {};
    const tenantPatch: NonNullable<WorkspacesConfigPatch['tenants']> = {};
    const enabled = this.options.newWorkspaceDefault() === 'enabled';
    for (const id of newIds) {
      if (this.config.workspaces[id]?.enabled === undefined) {
        workspaces[id] = { ...this.config.workspaces[id], enabled };
      }
    }
    let next =
      Math.max(0, ...Object.values(this.config.tenants).map((t) => t.aliasNumber ?? 0)) + 1;
    for (const tenant of tenants) {
      if (this.config.tenants[tenant.tenantId]?.aliasNumber === undefined) {
        tenantPatch[tenant.tenantId] = {
          ...this.config.tenants[tenant.tenantId],
          aliasNumber: next++,
        };
      }
    }
    if (Object.keys(workspaces).length + Object.keys(tenantPatch).length === 0) return;
    await this.options.config.patch({ workspaces, tenants: tenantPatch });
    await this.reloadConfig(false);
  }

  async updateWorkspaces(update: WorkspaceUpdate): Promise<Inventory> {
    const ids = update.resourceIds.map((id) => id.toLowerCase());
    const patch: Record<string, WorkspaceSettings | undefined> = {};
    for (const id of ids) {
      if (update.remove === true) {
        patch[id] = undefined;
        continue;
      }
      const current: WorkspaceSettings = { ...this.config.workspaces[id] };
      if (update.enabled !== undefined) current.enabled = update.enabled;
      if (update.alias !== undefined) {
        if (update.alias === null || update.alias.trim() === '') delete current.alias;
        else current.alias = update.alias.trim();
      }
      if (update.tags !== undefined) current.tags = update.tags;
      if (update.preferredPath !== undefined) {
        if (update.preferredPath === null) delete current.preferredPath;
        else current.preferredPath = update.preferredPath;
      }
      patch[id] = current;
    }
    await this.options.config.patch({ workspaces: patch });
    if (update.remove === true) {
      // Only missing workspaces can be forgotten; present ones would reappear anyway.
      const removable = new Set(ids);
      this.cache = {
        ...this.cache,
        workspaces: this.cache.workspaces.filter(
          (w) => !(w.missing && removable.has(w.resourceId)),
        ),
      };
      await this.options.cache.write(this.cache);
    }
    await this.reloadConfig();
    return this.snapshot();
  }

  async updateTenant(update: TenantUpdate): Promise<Inventory> {
    const id = update.tenantId.toLowerCase();
    const current = { ...this.config.tenants[id] };
    if (update.alias !== undefined) {
      if (update.alias === null || update.alias.trim() === '') delete current.alias;
      else current.alias = update.alias.trim();
    }
    if (update.tags !== undefined) current.tags = update.tags;
    await this.options.config.patch({ tenants: { [id]: current } });
    await this.reloadConfig();
    return this.snapshot();
  }
}
