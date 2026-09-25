import {
  hostAllowed,
  networkHosts,
  permissionRisk,
  type PermissionDeclaration,
} from '@raml-kql/pack-schema/extension-manifest';
import { z } from 'zod';

import type { Grant, GrantScope } from '../../shared/extensions/models';
import type { ListStore } from '../config/jsonc-list-store';

/**
 * The permission broker (spec 07, "Permissions"): every permission-gated extension call is
 * checked here, in main. Low-risk permissions are granted by declaring them; medium and high
 * ones are asked for at use time, per query run by default, with session and always scopes.
 * "Always" grants persist in `permissions.jsonc`.
 */
export const PersistedGrantSchema = z.object({
  extension: z.string(),
  permission: z.string(),
  hosts: z.array(z.string()).optional(),
  grantedAt: z.string(),
});
export type PersistedGrant = z.infer<typeof PersistedGrantSchema>;

export type PromptAnswer = GrantScope | 'deny';

export interface PermissionPrompt {
  extensionId: string;
  permission: string;
  risk: 'high' | 'medium' | 'low';
  detail: string;
  reason: string;
  hosts?: string[];
  hasRun: boolean;
}

export interface BrokerAuditEvent {
  event: 'grant' | 'deny' | 'revoke';
  extension: string;
  permission: string;
  scope?: GrantScope;
  hosts?: string[];
}

export interface PermissionBrokerOptions {
  store: ListStore<PersistedGrant>;
  /** Ask the user; undefined when nobody answered (window closed). */
  prompt: (request: PermissionPrompt) => Promise<PromptAnswer | undefined>;
  audit: (event: BrokerAuditEvent) => void;
  now?: () => Date;
}

export interface PermissionCheck {
  extensionId: string;
  permission: string;
  /** From the extension's manifest; undefined when it wasn't declared (always refused). */
  declared: PermissionDeclaration | undefined;
  /** The query run the call belongs to ("per query run" grants). */
  runId?: string | undefined;
  /** Without a run: the invocation, so "Allow for this run" means "this time". */
  invocationId?: string | undefined;
  /** `network`: the host being contacted. */
  host?: string | undefined;
  /** Shown in the prompt: what exactly will happen. */
  detail: string;
}

export class PermissionBroker {
  private persisted: PersistedGrant[] | undefined;
  private readonly session: Grant[] = [];
  private readonly runs: Grant[] = [];
  private readonly denied = new Set<string>();
  private readonly pending = new Map<string, Promise<boolean>>();

  constructor(private readonly options: PermissionBrokerOptions) {}

  private now(): string {
    return (this.options.now?.() ?? new Date()).toISOString();
  }

  private async loadPersisted(): Promise<PersistedGrant[]> {
    this.persisted ??= (await this.options.store.read()).items;
    return this.persisted;
  }

  /** Re-read `permissions.jsonc` (edited outside the app). */
  async reload(): Promise<void> {
    this.persisted = (await this.options.store.read()).items;
  }

  async grants(): Promise<Grant[]> {
    const always = (await this.loadPersisted()).map((g): Grant => ({
      extensionId: g.extension,
      permission: g.permission,
      scope: 'always',
      ...(g.hosts === undefined ? {} : { hosts: g.hosts }),
      grantedAt: g.grantedAt,
    }));
    return [...always, ...this.session];
  }

  private covers(grant: Pick<Grant, 'hosts'>, host: string | undefined): boolean {
    return host === undefined || grant.hosts === undefined || hostAllowed(host, grant.hosts);
  }

  /** Whether the call may go ahead: granted already, or the user allows it now. */
  async check(request: PermissionCheck): Promise<boolean> {
    const { extensionId, permission, declared } = request;
    if (declared === undefined) return false;
    if (permission === 'network') {
      const hosts = networkHosts(declared);
      if (request.host === undefined || hosts === undefined) return false;
      if (!hostAllowed(request.host, hosts)) return false;
    }
    const risk = permissionRisk(permission);
    if (risk === 'low') return true;

    if (await this.granted(request)) return true;
    const runKey = this.runKeyOf(request);
    const key = `${extensionId}|${permission}|${runKey ?? ''}|${request.host ?? ''}`;
    if (this.denied.has(key)) return false;
    const inFlight = this.pending.get(key);
    if (inFlight !== undefined) return inFlight;
    const asked = this.ask(request, runKey, key);
    this.pending.set(key, asked);
    try {
      return await asked;
    } finally {
      this.pending.delete(key);
    }
  }

  private runKeyOf(request: PermissionCheck): string | undefined {
    return (
      request.runId ??
      (request.invocationId === undefined ? undefined : `invocation:${request.invocationId}`)
    );
  }

  /** Granted already (low risk, always, session, or this run)? */
  private async granted(request: PermissionCheck): Promise<boolean> {
    const { extensionId, permission } = request;
    if (permissionRisk(permission) === 'low') return true;
    const matches = (g: Pick<Grant, 'extensionId' | 'permission' | 'hosts'>): boolean =>
      g.extensionId === extensionId && g.permission === permission && this.covers(g, request.host);
    const persisted = await this.loadPersisted();
    if (
      persisted.some((g) =>
        matches({ extensionId: g.extension, permission: g.permission, hosts: g.hosts }),
      )
    ) {
      return true;
    }
    if (this.session.some(matches)) return true;
    const runKey = this.runKeyOf(request);
    return runKey !== undefined && this.runs.some((g) => matches(g) && g.runId === runKey);
  }

  private async record(
    request: PermissionCheck,
    answer: GrantScope,
    runKey: string | undefined,
  ): Promise<void> {
    const { extensionId, permission } = request;
    const hosts = permission === 'network' ? networkHosts(request.declared) : undefined;
    const grant: Grant = {
      extensionId,
      permission,
      scope: answer,
      ...(hosts === undefined ? {} : { hosts }),
      grantedAt: this.now(),
    };
    if (answer === 'run') {
      this.runs.push({ ...grant, ...(runKey === undefined ? {} : { runId: runKey }) });
    } else if (answer === 'session') {
      this.session.push(grant);
    } else {
      const persisted = await this.loadPersisted();
      const next = [
        ...persisted.filter((g) => !(g.extension === extensionId && g.permission === permission)),
        {
          extension: extensionId,
          permission,
          ...(hosts === undefined ? {} : { hosts }),
          grantedAt: grant.grantedAt,
        },
      ];
      await this.options.store.write(next);
      this.persisted = next;
    }
    this.options.audit({
      event: 'grant',
      extension: extensionId,
      permission,
      scope: answer,
      ...(hosts === undefined ? {} : { hosts }),
    });
  }

  private async ask(
    request: PermissionCheck,
    runKey: string | undefined,
    key: string,
  ): Promise<boolean> {
    const { extensionId, permission, declared } = request;
    const hosts = networkHosts(declared);
    const answer = await this.options.prompt({
      extensionId,
      permission,
      risk: permissionRisk(permission),
      detail: request.detail,
      reason: declared?.reason ?? '',
      ...(hosts === undefined ? {} : { hosts }),
      hasRun: request.runId !== undefined,
    });
    if (answer === undefined || answer === 'deny') {
      this.denied.add(key);
      this.options.audit({ event: 'deny', extension: extensionId, permission });
      return false;
    }
    await this.record(request, answer, runKey);
    return true;
  }

  /**
   * Several permissions for one action (e.g. enrichment: read the selected values and send
   * them to a host): one prompt for everything not granted yet, and the answer applies to all.
   */
  async checkMany(requests: PermissionCheck[], detail: string): Promise<boolean> {
    const missing: PermissionCheck[] = [];
    for (const request of requests) {
      if (request.declared === undefined) return false;
      if (await this.granted(request)) continue;
      missing.push(request);
    }
    if (missing.length === 0) return true;
    const [first] = missing;
    if (first === undefined) return true;
    const runKey = this.runKeyOf(first);
    const key = `${first.extensionId}|${missing.map((m) => m.permission).join('+')}|${runKey ?? ''}`;
    if (this.denied.has(key)) return false;
    const hosts = missing.flatMap((m) => networkHosts(m.declared) ?? []);
    const risks = missing.map((m) => permissionRisk(m.permission));
    const answer = await this.options.prompt({
      extensionId: first.extensionId,
      permission: missing.map((m) => m.permission).join(' + '),
      risk: risks.includes('high') ? 'high' : risks.includes('medium') ? 'medium' : 'low',
      detail,
      reason: missing
        .map((m) => m.declared?.reason ?? '')
        .filter((r) => r !== '')
        .join(' · '),
      ...(hosts.length === 0 ? {} : { hosts }),
      hasRun: first.runId !== undefined,
    });
    if (answer === undefined || answer === 'deny') {
      this.denied.add(key);
      for (const m of missing)
        this.options.audit({ event: 'deny', extension: m.extensionId, permission: m.permission });
      return false;
    }
    for (const m of missing) await this.record(m, answer, runKey);
    return true;
  }

  /** Revoke session and persisted grants (Extensions view). */
  async revoke(extensionId: string, permission?: string): Promise<void> {
    const hit = (g: { extensionId: string; permission: string }) =>
      g.extensionId === extensionId && (permission === undefined || g.permission === permission);
    const persisted = await this.loadPersisted();
    const kept = persisted.filter(
      (g) => !hit({ extensionId: g.extension, permission: g.permission }),
    );
    if (kept.length !== persisted.length) {
      await this.options.store.write(kept);
      this.persisted = kept;
    }
    for (const list of [this.session, this.runs]) {
      for (let i = list.length - 1; i >= 0; i--) {
        const grant = list[i];
        if (grant !== undefined && hit(grant)) list.splice(i, 1);
      }
    }
    for (const key of [...this.denied])
      if (key.startsWith(`${extensionId}|`)) this.denied.delete(key);
    this.options.audit({ event: 'revoke', extension: extensionId, permission: permission ?? '*' });
  }

  /**
   * An extension update: persisted grants for permissions that are new or wider in the new
   * version are dropped (spec 07: never carried over), the rest stay.
   */
  async retainFor(extensionId: string, declared: readonly PermissionDeclaration[]): Promise<void> {
    const persisted = await this.loadPersisted();
    const kept = persisted.filter((g) => {
      if (g.extension !== extensionId) return true;
      const now = declared.find((d) => d.id === g.permission);
      if (now === undefined) return false;
      const hosts = networkHosts(now);
      if (hosts !== undefined)
        return g.hosts !== undefined && hosts.every((h) => g.hosts?.includes(h));
      return true;
    });
    if (kept.length !== persisted.length) {
      await this.options.store.write(kept);
      this.persisted = kept;
    }
    for (let i = this.session.length - 1; i >= 0; i--) {
      if (this.session[i]?.extensionId === extensionId) this.session.splice(i, 1);
    }
  }

  /** Invocation grants end with the invocation. */
  endInvocation(invocationId: string): void {
    const key = `invocation:${invocationId}`;
    for (let i = this.runs.length - 1; i >= 0; i--)
      if (this.runs[i]?.runId === key) this.runs.splice(i, 1);
    for (const denied of [...this.denied])
      if (denied.includes(`|${key}|`)) this.denied.delete(denied);
  }
}
