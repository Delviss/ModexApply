// WCAG 2.x relative luminance and contrast ratio.
// Shared by the CI contrast gate and the packages/ui token tests so both agree
// on the arithmetic.

export function parseHex(hex) {
  const cleaned = hex.trim().replace(/^#/, '');
  const full =
    cleaned.length === 3
      ? cleaned
          .split('')
          .map((c) => c + c)
          .join('')
      : cleaned;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) {
    throw new TypeError(`"${hex}" is not a 3- or 6-digit hex colour.`);
  }
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

function channelLuminance(value8Bit) {
  const c = value8Bit / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex) {
  const [r, g, b] = parseHex(hex).map(channelLuminance);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(foreground, background) {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  const [lighter, darker] = a > b ? [a, b] : [b, a];
  return (lighter + 0.05) / (darker + 0.05);
}

/** WCAG 2.2 minimums by usage. `ui` covers 1.4.11 non-text contrast. */
export const THRESHOLDS = {
  body: 4.5,
  large: 3.0,
  ui: 3.0,
};

export function round(ratio) {
  return Math.round(ratio * 100) / 100;
}
