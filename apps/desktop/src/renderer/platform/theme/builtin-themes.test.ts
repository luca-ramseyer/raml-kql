import { describe, expect, it } from 'vitest';

import { BUILTIN_THEMES } from './builtin-themes';
import { Color } from './color';
import { ColorResolver } from './color-registry';

describe('Raml brand themes', () => {
  const raml = BUILTIN_THEMES.filter((theme) => theme.label.startsWith('Raml '));

  it('ship in a light and a dark variant', () => {
    expect(raml.map((theme) => [theme.label, theme.uiTheme])).toEqual([
      ['Raml Dark', 'vs-dark'],
      ['Raml Light', 'vs'],
    ]);
  });

  it('use the brand paper and ink for the editor', () => {
    const background = (label: string) =>
      raml.find((theme) => theme.label === label)?.colors['editor.background'];
    expect(background('Raml Light')).toBe('#F4EFE4');
    expect(background('Raml Dark')).toBe('#211F1C');
  });

  // VS Code's registry defaults are blue; a key the palette forgets shows up as a blue accent.
  it('leave no saturated blue from VS Code defaults', () => {
    for (const theme of raml) {
      const blue = Object.entries(new ColorResolver(theme).resolveAll()).filter(([, value]) => {
        const hsla = Color.fromHex(value)?.hsla;
        return hsla !== undefined && hsla.h >= 180 && hsla.h <= 260 && hsla.s > 0.45;
      });
      expect(blue, theme.label).toEqual([]);
    }
  });
});
