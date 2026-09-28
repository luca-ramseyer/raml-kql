import { createHash } from 'node:crypto';
import { mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

import { WorkspaceSchemaDataSchema, type WorkspaceSchemaData } from '../../shared/schema/models';
import { writeTextFileAtomic } from '../config/jsonc';

/** Large Sentinel workspaces have a few thousand tables; far below this. */
const MAX_SCHEMA_FILE_BYTES = 32 * 1024 * 1024;

const SchemaCacheFileSchema = z.object({
  version: z.literal(1),
  fetchedAt: z.iso.datetime(),
  schema: WorkspaceSchemaDataSchema,
});

export interface CachedSchema {
  fetchedAt: Date;
  schema: WorkspaceSchemaData;
}

export interface SchemaCacheStore {
  read(resourceId: string): Promise<CachedSchema | undefined>;
  write(resourceId: string, schema: WorkspaceSchemaData, fetchedAt: Date): Promise<void>;
}

/**
 * `state/schema-cache/<hash>.json` (spec 05): one file per workspace, metadata only. File names
 * are a hash of the resource ID so no workspace or subscription name ends up in a path.
 */
export class FileSchemaCache implements SchemaCacheStore {
  constructor(private readonly dir: string) {}

  private fileFor(resourceId: string): string {
    const hash = createHash('sha256').update(resourceId.toLowerCase()).digest('hex').slice(0, 32);
    return path.join(this.dir, `${hash}.json`);
  }

  async read(resourceId: string): Promise<CachedSchema | undefined> {
    const file = this.fileFor(resourceId);
    try {
      const buffer = await readFile(file);
      if (buffer.byteLength > MAX_SCHEMA_FILE_BYTES) return undefined;
      const parsed = SchemaCacheFileSchema.safeParse(JSON.parse(buffer.toString('utf8')));
      if (!parsed.success) {
        await rm(file, { force: true });
        return undefined;
      }
      return { fetchedAt: new Date(parsed.data.fetchedAt), schema: parsed.data.schema };
    } catch {
      return undefined;
    }
  }

  async write(resourceId: string, schema: WorkspaceSchemaData, fetchedAt: Date): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await writeTextFileAtomic(
      this.fileFor(resourceId),
      JSON.stringify({ version: 1, fetchedAt: fetchedAt.toISOString(), schema }),
    );
  }
}

export class MemorySchemaCache implements SchemaCacheStore {
  private readonly entries = new Map<string, CachedSchema>();

  read(resourceId: string): Promise<CachedSchema | undefined> {
    return Promise.resolve(this.entries.get(resourceId.toLowerCase()));
  }

  write(resourceId: string, schema: WorkspaceSchemaData, fetchedAt: Date): Promise<void> {
    this.entries.set(resourceId.toLowerCase(), { schema, fetchedAt });
    return Promise.resolve();
  }
}
