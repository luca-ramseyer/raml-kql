import { describe, expect, it } from 'vitest';

import { resolveAppMode } from './app-mode';

describe('resolveAppMode', () => {
  it('defaults to live mode', () => {
    expect(resolveAppMode(['electron', '.'], {})).toEqual({ demo: false });
  });

  it('enables demo mode with --demo', () => {
    expect(resolveAppMode(['electron', '.', '--demo'], {})).toEqual({ demo: true });
  });

  it.each(['1', 'true', 'TRUE', ' yes ', 'on'])(
    'enables demo mode with RAML_KQL_DEMO=%j',
    (value) => {
      expect(resolveAppMode([], { RAML_KQL_DEMO: value })).toEqual({ demo: true });
    },
  );

  it.each(['0', 'false', '', 'demo'])('ignores RAML_KQL_DEMO=%j', (value) => {
    expect(resolveAppMode([], { RAML_KQL_DEMO: value })).toEqual({ demo: false });
  });

  it('does not treat similar flags as --demo', () => {
    expect(resolveAppMode(['--demo-data', '--no-demo'], {})).toEqual({ demo: false });
  });
});
