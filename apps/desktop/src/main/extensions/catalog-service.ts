import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  CatalogEntrySchema,
  parseCatalog,
  type ParsedCatalog,
} from '@raml-kql/pack-schema/extension-catalog';
import { z } from 'zod';

import type { CatalogResult } from '../../shared/extensions/models';

export { DEFAULT_CATALOG_URL } from '../../shared/extensions/catalog-url';

/**
 * The extension catalog (D-058): where "Browse" gets its list. The service only runs when the
 * workbench asks (the user opened Browse or pressed Refresh); nothing is fetched at startup.
 * The list is saved to disk (metadata only), so reopening Browse is instant and still works
 * offline. Nothing in a catalog is trusted: it is a list of pointers.
 */
const MAX_CATALOG_BYTES = 1024 * 1024;
const FETCH_TIMEOUT_MS = 15_000;
/** A saved list newer than this is used without asking the network again. */
const FRESH_MS = 24 * 60 * 60 * 1000;

const CacheSchema = z.object({
  fetchedAt: z.string(),
  urls: z.array(z.string()),
  entries: z.array(CatalogEntrySchema),
  problems: z.array(z.string()),
});
type Cache = z.infer<typeof CacheSchema>;

/** Entries shown in demo mode, which has no network. They point nowhere real. */
const DEMO_ENTRIES: CatalogResult['entries'] = [
  {
    id: 'contoso.whois-lookup',
    displayName: 'Contoso WHOIS Lookup',
    publisher: 'contoso',
    description: 'Look up the registrar and age of domains in your results (demo entry).',
    categories: ['Enrichment'],
    package: 'https://extensions.contoso.example/whois-lookup.rkqlx',
    version: '1.2.0',
    license: 'MIT',
  },
  {
    id: 'fabrikam.sign-in-heatmap',
    displayName: 'Fabrikam Sign-in Heatmap',
    publisher: 'fabrikam',
    description: 'Draws sign-ins as a heatmap by hour and weekday (demo entry).',
    categories: ['Visualization'],
    package: 'https://extensions.fabrikam.example/heatmap.rkqlx',
    version: '0.4.1',
  },
  {
    id: 'woodgrove.paper-theme',
    displayName: 'Woodgrove Paper',
    publisher: 'woodgrove',
    description: 'A warm light colour theme (demo entry).',
    categories: ['Theme'],
    package: 'https://extensions.woodgrove.example/paper-theme.rkqlx',
    version: '1.0.0',
  },
];

export interface CatalogServiceOptions {
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  /** Where the saved copy lives (a file in the config folder's `state/`). */
  cacheFile: string;
  /** The catalog URLs to read (`extensions.catalog.urls`). */
  urls: () => readonly string[];
  /** `extensions.catalog.enabled`. */
  enabled: () => boolean;
  demo: boolean;
  now?: () => Date;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}

export class CatalogService {
  constructor(private readonly options: CatalogServiceOptions) {}

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  /** The catalog for Browse. `refresh` skips the freshness check (the Refresh button). */
  async load(refresh: boolean): Promise<CatalogResult> {
    if (this.options.demo) {
      return {
        enabled: true,
        demo: true,
        entries: DEMO_ENTRIES,
        fromCache: false,
        problems: [],
      };
    }
    if (!this.options.enabled()) {
      return { enabled: false, demo: false, entries: [], fromCache: false, problems: [] };
    }
    const urls = [...this.options.urls()];
    const cached = await this.readCache();
    const sameSources =
      cached !== undefined &&
      cached.urls.length === urls.length &&
      cached.urls.every((url, i) => url === urls[i]);
    if (
      !refresh &&
      cached !== undefined &&
      sameSources &&
      this.now().getTime() - new Date(cached.fetchedAt).getTime() < FRESH_MS
    ) {
      return this.fromCache(cached);
    }

    const entries: CatalogResult['entries'] = [];
    const seen = new Set<string>();
    const problems: string[] = [];
    let loaded = 0;
    for (const url of urls) {
      let host = url;
      try {
        host = new URL(url).host;
        const catalog = await this.fetchCatalog(url);
        loaded += 1;
        for (const entry of catalog.entries) {
          if (seen.has(entry.id)) continue; // The first catalog that lists an id wins.
          seen.add(entry.id);
          entries.push(entry);
        }
        problems.push(...catalog.problems.map((problem) => `${host}: ${problem}`));
      } catch (error) {
        problems.push(`${host}: ${message(error)}`);
      }
    }
    if (loaded === 0) {
      // Offline or every catalog failed: show the saved copy rather than nothing.
      if (cached !== undefined) {
        return { ...this.fromCache(cached), problems, error: undefined };
      }
      return {
        enabled: true,
        demo: false,
        entries: [],
        fromCache: false,
        problems,
        error: 'The extension catalog could not be loaded.',
      };
    }
    const saved: Cache = {
      fetchedAt: this.now().toISOString(),
      urls,
      entries,
      problems,
    };
    await this.writeCache(saved);
    return {
      enabled: true,
      demo: false,
      entries,
      fetchedAt: saved.fetchedAt,
      fromCache: false,
      problems,
    };
  }

  /** One entry by id, from the saved list (never goes to the network on its own). */
  async find(id: string): Promise<CatalogResult['entries'][number] | undefined> {
    if (this.options.demo) return DEMO_ENTRIES.find((entry) => entry.id === id);
    const cached = await this.readCache();
    return cached?.entries.find((entry) => entry.id === id);
  }

  private fromCache(cache: Cache): CatalogResult {
    return {
      enabled: true,
      demo: false,
      entries: cache.entries,
      fetchedAt: cache.fetchedAt,
      fromCache: true,
      problems: cache.problems,
    };
  }

  private async fetchCatalog(url: string): Promise<ParsedCatalog> {
    if (!url.startsWith('https://')) throw new Error('only https:// catalogs are allowed');
    const response = await this.options.fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
    const length = Number(response.headers.get('content-length') ?? '0');
    if (length > MAX_CATALOG_BYTES) throw new Error('the catalog is larger than 1 MB');
    const text = await response.text();
    if (text.length > MAX_CATALOG_BYTES) throw new Error('the catalog is larger than 1 MB');
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error('the catalog is not valid JSON');
    }
    return parseCatalog(json);
  }

  private async readCache(): Promise<Cache | undefined> {
    try {
      const parsed = CacheSchema.safeParse(
        JSON.parse(await readFile(this.options.cacheFile, 'utf8')),
      );
      return parsed.success ? parsed.data : undefined;
    } catch {
      return undefined;
    }
  }

  private async writeCache(cache: Cache): Promise<void> {
    try {
      await mkdir(path.dirname(this.options.cacheFile), { recursive: true });
      await writeFile(this.options.cacheFile, `${JSON.stringify(cache)}\n`);
    } catch {
      // The list still shows; it is just not saved this time.
    }
  }
}
