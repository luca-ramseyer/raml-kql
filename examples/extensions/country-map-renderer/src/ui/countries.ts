import codes from 'i18n-iso-countries/codes.json';

/**
 * Country column values → ISO 3166 numeric codes (the ids of the bundled Natural Earth map).
 * Accepts alpha-2 (`US`, what Entra sign-in logs use), alpha-3 (`USA`) and English names.
 */
const byAlpha = new Map<string, string>();
for (const [alpha2, alpha3, numeric] of codes as [string, string, string][]) {
  byAlpha.set(alpha2, numeric);
  byAlpha.set(alpha3, numeric);
}

export function numericCode(
  value: unknown,
  names: ReadonlyMap<string, string>,
): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  if (text === '') return undefined;
  return byAlpha.get(text.toUpperCase()) ?? names.get(text.toLowerCase());
}

/** The column holding countries: by name first, then by content. */
export function countryColumn(
  columns: readonly { name: string }[],
  rows: readonly unknown[][],
  names: ReadonlyMap<string, string>,
): number {
  const byName = columns.findIndex((c) => /country|countryorregion|^location$|geo/i.test(c.name));
  if (byName >= 0) return byName;
  let best = -1;
  let bestHits = 0;
  columns.forEach((_, index) => {
    const hits = rows
      .slice(0, 200)
      .filter((row) => numericCode(row[index], names) !== undefined).length;
    if (hits > bestHits) {
      best = index;
      bestHits = hits;
    }
  });
  return bestHits >= 3 ? best : -1;
}
