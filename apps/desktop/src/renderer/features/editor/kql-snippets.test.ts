import { describe, expect, it } from 'vitest';

import { KQL_SNIPPETS, snippetPreview } from './kql-snippets';

describe('KQL snippets', () => {
  it('use TimeGenerated and never Timestamp', () => {
    for (const snippet of KQL_SNIPPETS) {
      expect(snippet.body).toContain('TimeGenerated');
      expect(snippet.body).not.toMatch(/\bTimestamp\b/);
    }
  });

  it('have unique prefixes', () => {
    const prefixes = KQL_SNIPPETS.map((s) => s.prefix);
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });

  it('preview with defaults filled in, including mirrored placeholders and choices', () => {
    expect(
      snippetPreview(
        '${1:T}\n| where TimeGenerated > ago(${2:1d})\n| join kind=${3|inner,leftouter|} (X | where TimeGenerated > ago($2))',
      ),
    ).toBe(
      'T\n| where TimeGenerated > ago(1d)\n| join kind=inner (X | where TimeGenerated > ago(1d))',
    );
    for (const snippet of KQL_SNIPPETS) {
      expect(snippetPreview(snippet.body)).not.toMatch(/\$\{|\$\d/);
    }
  });
});
