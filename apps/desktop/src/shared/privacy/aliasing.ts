/**
 * Presentation privacy (spec 03, "Aliasing & presentation privacy"). Aliasing is a render-layer
 * transform: the data keeps real IDs and names; only what is displayed changes, so toggling is
 * instant and never needs a re-query.
 */

export type AliasScope = 'tenant' | 'subscription' | 'workspace' | 'account';

export interface AliasOptions {
  /** Aliasing is currently on (presentation mode). */
  active: boolean;
  /** Automatic tenant alias format, e.g. "Customer {nn}". */
  format: string;
  scope: ReadonlySet<AliasScope>;
}

/** `{nn}` → 2 digits, `{nnn}` → 3 digits, `{n}` → plain number. */
export function formatAutoAlias(format: string, n: number): string {
  return format
    .replace(/\{nnn\}/g, String(n).padStart(3, '0'))
    .replace(/\{nn\}/g, String(n).padStart(2, '0'))
    .replace(/\{n\}/g, String(n));
}

export interface AliasableTenant {
  tenantId: string;
  displayName?: string | undefined;
  defaultDomain?: string | undefined;
  alias?: string | undefined;
  aliasNumber: number;
}

export interface AliasableWorkspace {
  resourceId: string;
  name: string;
  tenantId: string;
  subscriptionId: string;
  subscriptionName?: string | undefined;
  alias?: string | undefined;
}

export function realTenantName(
  tenant: Pick<AliasableTenant, 'tenantId' | 'displayName' | 'defaultDomain'>,
): string {
  return tenant.displayName ?? tenant.defaultDomain ?? tenant.tenantId;
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

/**
 * Builds the display names for one render pass. Workspaces and subscriptions get positional
 * aliases within their tenant ("Customer 03 · Workspace 02"), ordered by resource ID so they
 * stay stable while the inventory doesn't change.
 */
export class DisplayNamer {
  private readonly tenants = new Map<string, AliasableTenant>();
  private readonly workspaceIndex = new Map<string, number>();
  private readonly subscriptionIndex = new Map<string, number>();
  private readonly accountIndex = new Map<string, number>();

  constructor(
    private readonly options: AliasOptions,
    tenants: readonly AliasableTenant[],
    workspaces: readonly AliasableWorkspace[],
    accountIds: readonly string[] = [],
  ) {
    for (const tenant of tenants) this.tenants.set(tenant.tenantId.toLowerCase(), tenant);
    const byTenant = new Map<string, AliasableWorkspace[]>();
    for (const workspace of workspaces) {
      const list = byTenant.get(workspace.tenantId) ?? [];
      list.push(workspace);
      byTenant.set(workspace.tenantId, list);
    }
    for (const list of byTenant.values()) {
      list.sort((a, b) => a.resourceId.localeCompare(b.resourceId));
      list.forEach((w, i) => this.workspaceIndex.set(w.resourceId, i + 1));
      const subs = [...new Set(list.map((w) => w.subscriptionId.toLowerCase()))].sort();
      subs.forEach((s, i) => this.subscriptionIndex.set(s, i + 1));
    }
    accountIds.forEach((id, i) => this.accountIndex.set(id, i + 1));
  }

  get active(): boolean {
    return this.options.active;
  }

  private aliases(scope: AliasScope): boolean {
    return this.options.active && this.options.scope.has(scope);
  }

  tenant(
    tenantId: string,
    fallback?: { displayName?: string | undefined; defaultDomain?: string | undefined },
  ): string {
    const tenant = this.tenants.get(tenantId.toLowerCase());
    if (this.aliases('tenant')) {
      // Not in the inventory yet: never fall back to the real name.
      if (tenant === undefined) return 'Unlisted tenant';
      return tenant.alias ?? formatAutoAlias(this.options.format, tenant.aliasNumber);
    }
    return realTenantName({
      tenantId,
      displayName: tenant?.displayName ?? fallback?.displayName,
      defaultDomain: tenant?.defaultDomain ?? fallback?.defaultDomain,
    });
  }

  workspace(workspace: AliasableWorkspace): string {
    if (!this.aliases('workspace')) return workspace.name;
    return (
      workspace.alias ??
      `${this.tenant(workspace.tenantId)} · Workspace ${pad2(this.workspaceIndex.get(workspace.resourceId) ?? 0)}`
    );
  }

  subscription(
    workspace: Pick<AliasableWorkspace, 'tenantId' | 'subscriptionId' | 'subscriptionName'>,
  ): string {
    if (!this.aliases('subscription'))
      return workspace.subscriptionName ?? workspace.subscriptionId;
    return `${this.tenant(workspace.tenantId)} · Subscription ${pad2(
      this.subscriptionIndex.get(workspace.subscriptionId.toLowerCase()) ?? 0,
    )}`;
  }

  account(accountId: string, realName: string): string {
    if (!this.aliases('account')) return realName;
    return `Account ${String(this.accountIndex.get(accountId) ?? 0)}`;
  }
}
