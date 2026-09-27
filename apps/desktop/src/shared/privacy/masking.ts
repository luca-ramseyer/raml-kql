import { z } from 'zod';

/**
 * Custom masking rules for result cell values (spec 03, `privacy.maskingRules`): while
 * presentation mode is on, matching text in result cells is replaced on screen, in search,
 * charts and aliased exports. Like aliasing, it is a render-layer transform: the data itself
 * is untouched.
 */
export const MaskingRuleSchema = z
  .object({
    match: z.string().min(1).max(500),
    isRegex: z.boolean().optional(),
    replace: z.string().max(500),
    caseSensitive: z.boolean().optional(),
  })
  .strict();
export type MaskingRule = z.infer<typeof MaskingRuleSchema>;

export const MaskingRulesSchema = z.array(MaskingRuleSchema).max(200);

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Rules that compile (an invalid regex is skipped rather than breaking every cell). */
export function compileMaskingRules(
  rules: readonly MaskingRule[],
): { pattern: RegExp; replace: string }[] {
  return rules.flatMap((rule) => {
    try {
      const source = rule.isRegex === true ? rule.match : escapeRegex(rule.match);
      const pattern = new RegExp(source, rule.caseSensitive === true ? 'gu' : 'giu');
      // A pattern matching the empty string would insert text everywhere.
      if (pattern.test('')) return [];
      pattern.lastIndex = 0;
      return [{ pattern, replace: rule.replace }];
    } catch {
      return [];
    }
  });
}

/**
 * A function masking a cell value: strings are rewritten, `dynamic` values (objects, arrays)
 * are rewritten in their string leaves and keys, anything else is returned as is.
 */
export function maskingFunction(rules: readonly MaskingRule[]): (value: unknown) => unknown {
  const compiled = compileMaskingRules(rules);
  if (compiled.length === 0) return (value) => value;
  const maskText = (text: string): string =>
    compiled.reduce((out, { pattern, replace }) => {
      pattern.lastIndex = 0;
      // A function replacement: `$1` or `$&` in the user's text stays literal.
      return out.replace(pattern, () => replace);
    }, text);
  const mask = (value: unknown, depth: number): unknown => {
    if (typeof value === 'string') return maskText(value);
    if (depth > 20 || value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map((item) => mask(item, depth + 1));
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        maskText(key),
        mask(item, depth + 1),
      ]),
    );
  };
  return (value) => mask(value, 0);
}

/** Rules generated from tenant domains: `fabrikam.com` → `customer02.example`. */
export function rulesFromDomains(
  tenants: readonly { domains: readonly string[]; alias: string }[],
  existing: readonly MaskingRule[],
): MaskingRule[] {
  const known = new Set(existing.map((r) => r.match.toLowerCase()));
  const out: MaskingRule[] = [];
  for (const tenant of tenants) {
    const slug = tenant.alias.toLowerCase().replace(/[^a-z0-9]+/g, '');
    for (const domain of tenant.domains) {
      const lower = domain.toLowerCase();
      if (lower === '' || known.has(lower) || lower.endsWith('.onmicrosoft.com')) continue;
      known.add(lower);
      out.push({ match: lower, replace: `${slug}.example` });
    }
  }
  return out;
}
