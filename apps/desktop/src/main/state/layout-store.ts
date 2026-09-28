import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import {
  DEFAULT_LAYOUT_STATE,
  LayoutStateSchema,
  type LayoutState,
} from '../../shared/layout/layout-state';
import { readTextFile, writeTextFileAtomic } from '../config/jsonc';

/** Machine-local workbench layout in `<config>/state/ui-layout.json`. */
export class LayoutStore {
  constructor(private readonly filePath: string) {}

  /** The stored layout, or the defaults if missing or invalid. */
  async read(): Promise<LayoutState> {
    try {
      const text = await readTextFile(this.filePath);
      if (text === undefined) return DEFAULT_LAYOUT_STATE;
      const parsed = LayoutStateSchema.safeParse(JSON.parse(text));
      return parsed.success ? parsed.data : DEFAULT_LAYOUT_STATE;
    } catch {
      return DEFAULT_LAYOUT_STATE;
    }
  }

  async write(state: LayoutState): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeTextFileAtomic(this.filePath, JSON.stringify(state, null, 2) + '\n');
  }
}
