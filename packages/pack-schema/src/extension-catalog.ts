import { z } from 'zod';

/**
 * The extension catalog (D-058): a small JSON file that lists extensions people can browse and
 * install from inside Raml KQL. The catalog is only a list of pointers. Nothing in it is trusted:
 * what an extension may do is decided by the package's own manifest, shown before installing,
 * and "Verified" comes from the package's signature, never from the catalog.
 */
const NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
const HTTPS = z
  .string()
  .max(2000)
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && url.username === '' && url.password === '';
    } catch {
      return false;
    }
  }, 'must be an https:// URL without credentials');

export const CatalogEntrySchema = z
  .object({
    /** `publisher.name`, the same id the package's `package.json` yields. Checked on install. */
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}\.[a-z0-9][a-z0-9-]{0,63}$/, 'publisher.name'),
    displayName: z.string().min(1).max(100),
    publisher: z.string().regex(NAME, 'lowercase letters, digits and dashes'),
    description: z.string().min(1).max(300),
    /** Short labels such as "Enrichment", "Visualization", "Theme". */
    categories: z.array(z.string().min(1).max(30)).max(5).default([]),
    /** Direct link to the `.rkqlx` package; may be a "latest release" URL. */
    package: HTTPS,
    /** Where the source code lives, for people who want to read it first. */
    repository: HTTPS.optional(),
    /** The newest version at the time the entry was written (informational). */
    version: z
      .string()
      .regex(/^\d+\.\d+\.\d+$/)
      .optional(),
    license: z.string().max(100).optional(),
  })
  .strict();
export type CatalogEntry = z.infer<typeof CatalogEntrySchema>;

export const ExtensionCatalogSchema = z
  .object({
    $schema: z.string().max(500).optional(),
    schemaVersion: z.literal(1),
    name: z.string().min(1).max(100),
    extensions: z
      .array(z.unknown())
      .max(2000)
      .describe('Entries are validated one by one, so one bad entry never hides the others.'),
  })
  .strict();

/** The strict file schema, for the JSON Schema file and for validating a catalog repository. */
export const ExtensionCatalogFileSchema = z
  .object({
    $schema: z.string().max(500).optional(),
    schemaVersion: z.literal(1),
    name: z.string().min(1).max(100),
    extensions: z.array(CatalogEntrySchema).max(2000),
  })
  .strict()
  .refine(
    (catalog) => new Set(catalog.extensions.map((e) => e.id)).size === catalog.extensions.length,
    { message: 'Every extension id must appear only once.', path: ['extensions'] },
  );
export type ExtensionCatalogFile = z.infer<typeof ExtensionCatalogFileSchema>;

export interface ParsedCatalog {
  name: string;
  entries: CatalogEntry[];
  /** Entries that were skipped, with the reason. */
  problems: string[];
}

/**
 * Read catalog JSON leniently: a bad entry is skipped (and reported), so the rest still shows.
 * Throws only when the file as a whole is not a catalog.
 */
export function parseCatalog(raw: unknown): ParsedCatalog {
  const head = ExtensionCatalogSchema.safeParse(raw);
  if (!head.success) throw new Error('This is not an extension catalog.');
  const entries: CatalogEntry[] = [];
  const problems: string[] = [];
  const seen = new Set<string>();
  head.data.extensions.forEach((item, index) => {
    const parsed = CatalogEntrySchema.safeParse(item);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      problems.push(
        `Entry ${String(index + 1)}: ${issue === undefined ? 'invalid' : `${issue.path.join('.')} ${issue.message}`}`,
      );
    } else if (seen.has(parsed.data.id)) {
      problems.push(`Entry ${String(index + 1)}: ${parsed.data.id} is listed twice.`);
    } else {
      seen.add(parsed.data.id);
      entries.push(parsed.data);
    }
  });
  return { name: head.data.name, entries, problems };
}
