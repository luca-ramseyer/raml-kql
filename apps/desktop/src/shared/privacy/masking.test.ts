import { describe, expect, it } from 'vitest';

import { maskingFunction, rulesFromDomains } from './masking';

describe('masking rules', () => {
  it('replaces plain text case-insensitively by default, everywhere in the value', () => {
    const mask = maskingFunction([{ match: 'fabrikam', replace: 'customer01' }]);
    expect(mask('alice@Fabrikam.com logged in from FABRIKAM-HQ')).toBe(
      'alice@customer01.com logged in from customer01-HQ',
    );
    expect(mask(42)).toBe(42);
    expect(mask(null)).toBeNull();
  });

  it('supports regexes, case sensitivity and literal replacements', () => {
    const mask = maskingFunction([
      { match: 'ws-\\d+', isRegex: true, replace: 'ws-$&' },
      { match: 'Contoso', caseSensitive: true, replace: 'Customer' },
    ]);
    expect(mask('ws-12 contoso Contoso')).toBe('ws-$& contoso Customer');
  });

  it('masks string leaves and keys of dynamic values', () => {
    const mask = maskingFunction([{ match: 'fabrikam', replace: 'c01' }]);
    expect(mask({ 'fabrikam.com': ['bob@fabrikam.com', 3], nested: { a: 'Fabrikam' } })).toEqual({
      'c01.com': ['bob@c01.com', 3],
      nested: { a: 'c01' },
    });
  });

  it('skips invalid and empty-matching patterns', () => {
    const mask = maskingFunction([
      { match: '(', isRegex: true, replace: 'x' },
      { match: 'a*', isRegex: true, replace: 'x' },
      { match: 'b', replace: 'B' },
    ]);
    expect(mask('abc')).toBe('aBc');
  });

  it('generates rules from tenant domains without duplicates or onmicrosoft.com', () => {
    expect(
      rulesFromDomains(
        [
          { alias: 'Customer 01', domains: ['fabrikam.com', 'fabrikam.onmicrosoft.com'] },
          { alias: 'Customer 02', domains: ['Contoso.com'] },
        ],
        [{ match: 'contoso.com', replace: 'x' }],
      ),
    ).toEqual([{ match: 'fabrikam.com', replace: 'customer01.example' }]);
  });
});
