import { describe, expect, it } from 'vitest';

import { TITLE_BAR_HEIGHT, titleBarOptions } from './title-bar';

describe('titleBarOptions', () => {
  const colors = { color: '#181818', symbolColor: '#cccccc' };

  it('uses inset traffic lights on macOS', () => {
    expect(titleBarOptions('darwin', colors)).toMatchObject({ titleBarStyle: 'hiddenInset' });
  });

  it.each(['win32', 'linux'] as const)(
    'uses a frameless window with overlay controls on %s',
    (platform) => {
      expect(titleBarOptions(platform, colors)).toEqual({
        titleBarStyle: 'hidden',
        titleBarOverlay: { ...colors, height: TITLE_BAR_HEIGHT },
      });
    },
  );
});
