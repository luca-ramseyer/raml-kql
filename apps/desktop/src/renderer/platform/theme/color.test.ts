import { describe, expect, it } from 'vitest';

import { Color } from './color';

const hex = (value: string): Color => {
  const color = Color.fromHex(value);
  if (color === undefined) throw new Error(`bad colour ${value}`);
  return color;
};

describe('Color (port of VS Code color.ts)', () => {
  it('parses every hex form and prints CSS hex', () => {
    expect(hex('#abc').toString()).toBe('#aabbcc');
    expect(hex('#abcd').toString()).toBe('#aabbccdd');
    expect(hex('#1F1F1F').toString()).toBe('#1f1f1f');
    expect(hex('#1f1f1f80').toString()).toBe('#1f1f1f80');
    expect(Color.fromHex('#12345')).toBeUndefined();
    expect(Color.fromHex('red')).toBeUndefined();
  });

  it('transparent multiplies alpha', () => {
    expect(hex('#cccccc').transparent(0.7).toString()).toBe('#ccccccb3');
    expect(hex('#cccccc80').transparent(0.5).rgba.a).toBeCloseTo(0.251, 3);
  });

  it('darken/lighten scale HSL lightness', () => {
    expect(hex('#808080').darken(1).toString()).toBe('#000000');
    expect(hex('#808080').lighten(0).toString()).toBe('#808080');
    expect(hex('#404040').lighten(1).toString()).toBe('#808080');
  });

  it('makeOpaque blends onto an opaque background', () => {
    expect(hex('#ffffff80').makeOpaque(hex('#000000')).toString()).toBe('#808080');
    expect(hex('#123456').makeOpaque(hex('#000000')).toString()).toBe('#123456');
  });

  it('compares relative luminance', () => {
    expect(hex('#000000').isDarkerThan(hex('#ffffff'))).toBe(true);
    expect(hex('#ffffff').getRelativeLuminance()).toBe(1);
  });

  it('mixes colours', () => {
    expect(hex('#000000').mix(hex('#ffffff'), 0.5).toString()).toBe('#7f7f7f');
  });
});
