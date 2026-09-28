import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { PackQueryMetaSchema } from '@raml-kql/pack-schema/schemas';

import type { ImportResult } from '../../shared/packs/models';
import { parseQueryFile } from '../../shared/queries/front-matter';
import type { QueryFile, SaveQueryRequest } from '../../shared/queries/models';
import type { PacksOperations } from '../ipc/handlers';

import { PACK_LIMITS, readFolderFiles, readZipFiles, sourceError } from './pack-files';
import type { PacksService } from './packs-service';

/**
 * The IPC side of packs (spec 08, "Import from file"): the OS dialog picks a `.rkqlpack`, a
 * pack folder, or loose `.kql` files (those become My Queries).
 */
export interface PacksOperationsOptions {
  service: PacksService;
  saveQuery: (request: SaveQueryRequest) => Promise<QueryFile>;
  /** Show the OS open dialog; undefined when cancelled. */
  pick: (kind: 'file' | 'folder') => Promise<string[] | undefined>;
}

async function readLimited(file: string, maxBytes: number): Promise<Buffer> {
  const info = await stat(file);
  if (info.size > maxBytes) throw sourceError(`${path.basename(file)} is too large to import.`);
  return readFile(file);
}

export function createPacksOperations(options: PacksOperationsOptions): PacksOperations {
  const { service } = options;

  const importQueries = async (files: string[]): Promise<ImportResult> => {
    const paths: string[] = [];
    for (const file of files) {
      const text = (await readLimited(file, PACK_LIMITS.maxFileBytes)).toString('utf8');
      const { meta, body } = parseQueryFile(text);
      const known = PackQueryMetaSchema.partial().safeParse(meta);
      const saved = await options.saveQuery({
        name: meta.name ?? path.basename(file).replace(/\.kql$/i, ''),
        body,
        ...(known.success ? { meta: known.data } : {}),
      });
      paths.push(saved.path);
    }
    return { type: 'queries', paths };
  };

  return {
    snapshot: () => service.snapshot(),
    readQuery: (ref) => service.readQuery(ref),
    previewGit: (request) => service.previewGit(request),
    importFile: async (kind) => {
      const picked = await options.pick(kind);
      if (picked === undefined || picked.length === 0) return { type: 'cancelled' };
      if (kind === 'folder') {
        const [folder = ''] = picked;
        const preview = await service.previewFiles(
          await readFolderFiles(folder),
          path.basename(folder),
        );
        return { type: 'pack', preview };
      }
      const archives = picked.filter((file) => /\.(rkqlpack|zip)$/i.test(file));
      if (archives.length > 0) {
        if (picked.length > 1) throw sourceError('Import one .rkqlpack at a time.');
        const [archive = ''] = archives;
        const files = readZipFiles(await readLimited(archive, PACK_LIMITS.maxTotalBytes));
        return { type: 'pack', preview: await service.previewFiles(files, path.basename(archive)) };
      }
      if (picked.every((file) => /\.kql$/i.test(file))) return importQueries(picked);
      throw sourceError('Choose a .rkqlpack file or .kql files.');
    },
    add: (previewId) => service.add(previewId),
    cancelPreview: (previewId) => service.cancelPreview(previewId),
    remove: (sourceId) => service.remove(sourceId),
    checkUpdates: (request) => service.checkUpdates(request),
    updatePreview: (sourceId) => service.updatePreview(sourceId),
    applyUpdate: (sourceId, sha) => service.applyUpdate(sourceId, sha),
  };
}
