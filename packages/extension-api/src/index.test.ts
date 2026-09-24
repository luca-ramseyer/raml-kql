import { describe, expect, it } from 'vitest';

import { EXTENSION_API_VERSION } from './index';

describe('extension-api', () => {
  it('exposes a semver API version', () => {
    expect(EXTENSION_API_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
