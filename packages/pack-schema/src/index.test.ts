import { describe, expect, it } from 'vitest';

import { PACK_FORMAT_VERSION } from './index';

describe('pack-schema', () => {
  it('declares the pack format version', () => {
    expect(PACK_FORMAT_VERSION).toBe(1);
  });
});
