import { describe, expect, it } from 'vitest';

import { descriptionParts, humanize, settingTitle } from './setting-labels';

describe('setting labels', () => {
  it('humanizes camelCase', () => {
    expect(humanize('autoDetectColorScheme')).toBe('Auto Detect Color Scheme');
    expect(humanize('colorTheme')).toBe('Color Theme');
  });

  it('builds VS Code-style titles', () => {
    expect(settingTitle('workbench.colorTheme')).toEqual({
      category: 'Workbench',
      label: 'Color Theme',
    });
    expect(settingTitle('workbench.statusBar.visible')).toEqual({
      category: 'Workbench › Status Bar',
      label: 'Visible',
    });
  });

  it('splits `code` spans out of descriptions', () => {
    expect(descriptionParts('Used when `window.autoDetectColorScheme` is off.')).toEqual([
      { text: 'Used when ', code: false },
      { text: 'window.autoDetectColorScheme', code: true },
      { text: ' is off.', code: false },
    ]);
  });
});
