import {
  mergeSchemas,
  type MergedSchema,
  type SchemaRequest,
  type WorkspaceSchemaData,
} from '../../shared/schema/models';
import type { Workspace } from '../../shared/workspaces/models';

import type { SchemaCacheStore } from './schema-cache';

export interface SchemaServiceOptions {
  /** Current inventory workspaces, by lowercase resource ID. */
  workspace: (resourceId: string) => Workspace | undefined;
  /** Fetch one workspace's schema (trying its access paths); throws when it can't. */
  fetchSchema: (workspace: Workspace) => Promise<WorkspaceSchemaData>;
  cache: SchemaCacheStore;
  cacheHours: () => number;
  now?: () => Date;
  /** Parallel metadata requests. */
  concurrency?: number;
}

/**
 * Schema-aware IntelliSense (spec 05): per-workspace schemas from the disk cache or the
 * metadata API, merged for the active tab's targets with availability counts.
 */
export class SchemaService {
  private readonly inFlight = new Map<string, Promise<WorkspaceSchemaData | undefined>>();
  private readonly now: () => Date;

  constructor(private readonly options: SchemaServiceOptions) {
    this.now = options.now ?? (() => new Date());
  }

  async get(request: SchemaRequest): Promise<MergedSchema> {
    const ids = [...new Set(request.resourceIds.map((id) => id.toLowerCase()))];
    const results = await mapLimit(ids, this.options.concurrency ?? 4, (id) =>
      this.load(id, request.refresh === true),
    );
    const schemas = results.filter((s): s is WorkspaceSchemaData => s !== undefined);
    return mergeSchemas(schemas, results.length - schemas.length);
  }

  private load(resourceId: string, refresh: boolean): Promise<WorkspaceSchemaData | undefined> {
    const key = `${resourceId}|${String(refresh)}`;
    let promise = this.inFlight.get(key);
    if (promise === undefined) {
      promise = this.loadUncoalesced(resourceId, refresh).finally(() => {
        this.inFlight.delete(key);
      });
      this.inFlight.set(key, promise);
    }
    return promise;
  }

  private async loadUncoalesced(
    resourceId: string,
    refresh: boolean,
  ): Promise<WorkspaceSchemaData | undefined> {
    const workspace = this.options.workspace(resourceId);
    if (workspace === undefined) return undefined;
    const cached = await this.options.cache.read(resourceId);
    const ttlMs = this.options.cacheHours() * 3_600_000;
    if (
      !refresh &&
      cached !== undefined &&
      this.now().getTime() - cached.fetchedAt.getTime() < ttlMs
    ) {
      return cached.schema;
    }
    try {
      const schema = await this.options.fetchSchema(workspace);
      await this.options.cache.write(resourceId, schema, this.now()).catch(() => undefined);
      return schema;
    } catch {
      // A stale schema beats none: IntelliSense is a hint, never authoritative.
      return cached?.schema;
    }
  }
}

async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
