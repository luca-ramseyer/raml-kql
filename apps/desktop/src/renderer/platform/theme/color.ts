/**
 * Colour maths ported from VS Code's `src/vs/base/common/color.ts`
 * (MIT License, Copyright (c) Microsoft Corporation), so derived theme colours
 * (`transparent(foreground, 0.7)` etc.) come out exactly as in VS Code.
 */

function roundFloat(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export class RGBA {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;

  constructor(r: number, g: number, b: number, a = 1) {
    this.r = Math.min(255, Math.max(0, r)) | 0;
    this.g = Math.min(255, Math.max(0, g)) | 0;
    this.b = Math.min(255, Math.max(0, b)) | 0;
    this.a = roundFloat(Math.max(Math.min(1, a), 0), 3);
  }
}

export class HSLA {
  readonly h: number;
  readonly s: number;
  readonly l: number;
  readonly a: number;

  constructor(h: number, s: number, l: number, a: number) {
    this.h = Math.max(Math.min(360, h), 0) | 0;
    this.s = roundFloat(Math.max(Math.min(1, s), 0), 3);
    this.l = roundFloat(Math.max(Math.min(1, l), 0), 3);
    this.a = roundFloat(Math.max(Math.min(1, a), 0), 3);
  }

  static fromRGBA(rgba: RGBA): HSLA {
    const r = rgba.r / 255;
    const g = rgba.g / 255;
    const b = rgba.b / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h = 0;
    let s = 0;
    const l = (min + max) / 2;
    const chroma = max - min;
    if (chroma > 0) {
      s = Math.min(l <= 0.5 ? chroma / (2 * l) : chroma / (2 - 2 * l), 1);
      switch (max) {
        case r:
          h = (g - b) / chroma + (g < b ? 6 : 0);
          break;
        case g:
          h = (b - r) / chroma + 2;
          break;
        default:
          h = (r - g) / chroma + 4;
      }
      h *= 60;
      h = Math.round(h);
    }
    return new HSLA(h, s, l, rgba.a);
  }

  private static hue2rgb(p: number, q: number, t: number): number {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  }

  static toRGBA(hsla: HSLA): RGBA {
    const h = hsla.h / 360;
    const { s, l, a } = hsla;
    let r: number;
    let g: number;
    let b: number;
    if (s === 0) {
      r = g = b = l;
    } else {
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r = HSLA.hue2rgb(p, q, h + 1 / 3);
      g = HSLA.hue2rgb(p, q, h);
      b = HSLA.hue2rgb(p, q, h - 1 / 3);
    }
    return new RGBA(Math.round(r * 255), Math.round(g * 255), Math.round(b * 255), a);
  }
}

export class Color {
  readonly rgba: RGBA;
  private hslaCache: HSLA | undefined;

  constructor(value: RGBA | HSLA) {
    if (value instanceof RGBA) {
      this.rgba = value;
    } else {
      this.hslaCache = value;
      this.rgba = HSLA.toRGBA(value);
    }
  }

  get hsla(): HSLA {
    return (this.hslaCache ??= HSLA.fromRGBA(this.rgba));
  }

  /** Parses `#RGB`, `#RGBA`, `#RRGGBB` and `#RRGGBBAA`. Returns undefined otherwise. */
  static fromHex(hex: string): Color | undefined {
    const match = /^#([0-9a-f]{3,8})$/i.exec(hex);
    const digits = match?.[1];
    if (digits === undefined || digits.length === 5 || digits.length === 7) return undefined;
    const expand = digits.length <= 4 ? digits.replace(/./g, (d) => d + d) : digits;
    const channel = (i: number): number => parseInt(expand.slice(i * 2, i * 2 + 2), 16);
    const alpha = expand.length === 8 ? channel(3) / 255 : 1;
    return new Color(new RGBA(channel(0), channel(1), channel(2), alpha));
  }

  static readonly transparentBlack = new Color(new RGBA(0, 0, 0, 0));

  getRelativeLuminance(): number {
    const component = (c: number): number => {
      const v = c / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    const luminance =
      0.2126 * component(this.rgba.r) +
      0.7152 * component(this.rgba.g) +
      0.0722 * component(this.rgba.b);
    return roundFloat(luminance, 4);
  }

  isLighterThan(other: Color): boolean {
    return this.getRelativeLuminance() > other.getRelativeLuminance();
  }

  isDarkerThan(other: Color): boolean {
    return this.getRelativeLuminance() < other.getRelativeLuminance();
  }

  lighten(factor: number): Color {
    const { h, s, l, a } = this.hsla;
    return new Color(new HSLA(h, s, l + l * factor, a));
  }

  darken(factor: number): Color {
    const { h, s, l, a } = this.hsla;
    return new Color(new HSLA(h, s, l - l * factor, a));
  }

  transparent(factor: number): Color {
    const { r, g, b, a } = this.rgba;
    return new Color(new RGBA(r, g, b, a * factor));
  }

  isOpaque(): boolean {
    return this.rgba.a === 1;
  }

  mix(other: Color, factor = 0.5): Color {
    const n = Math.min(Math.max(factor, 0), 1);
    const a = this.rgba;
    const b = other.rgba;
    return new Color(
      new RGBA(
        a.r + (b.r - a.r) * n,
        a.g + (b.g - a.g) * n,
        a.b + (b.b - a.b) * n,
        a.a + (b.a - a.a) * n,
      ),
    );
  }

  makeOpaque(background: Color): Color {
    if (this.isOpaque() || background.rgba.a !== 1) return this;
    const { r, g, b, a } = this.rgba;
    const bg = background.rgba;
    return new Color(
      new RGBA(bg.r - a * (bg.r - r), bg.g - a * (bg.g - g), bg.b - a * (bg.b - b), 1),
    );
  }

  static getLighterColor(of: Color, relative: Color, factor = 0.5): Color {
    if (of.isLighterThan(relative)) return of;
    const lum1 = of.getRelativeLuminance();
    const lum2 = relative.getRelativeLuminance();
    return of.lighten((factor * (lum2 - lum1)) / lum2);
  }

  static getDarkerColor(of: Color, relative: Color, factor = 0.5): Color {
    if (of.isDarkerThan(relative)) return of;
    const lum1 = of.getRelativeLuminance();
    const lum2 = relative.getRelativeLuminance();
    return of.darken((factor * (lum1 - lum2)) / lum1);
  }

  /** CSS hex: `#rrggbb`, or `#rrggbbaa` when not opaque. */
  toString(): string {
    const hex = (n: number): string => n.toString(16).padStart(2, '0');
    const { r, g, b, a } = this.rgba;
    return `#${hex(r)}${hex(g)}${hex(b)}${a === 1 ? '' : hex(Math.round(a * 255))}`;
  }
}
