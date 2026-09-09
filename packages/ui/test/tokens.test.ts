import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CONTRAST_MINIMUMS, CONTRAST_PAIRS, brand, dark, neutral, semantic } from '../src/tokens/index.js';
import { contrastRatio } from '../../../scripts/lib/contrast.mjs';

const TOKENS_CSS = readFileSync(resolve(import.meta.dirname, '../src/tokens/tokens.css'), 'utf8');

describe('the contrast budget', () => {
  it.each(CONTRAST_PAIRS.map((pair) => [pair.name, pair] as const))(
    'meets WCAG 2.2 AA: %s',
    (_name, pair) => {
      const ratio = contrastRatio(pair.foreground, pair.background);
      expect(ratio).toBeGreaterThanOrEqual(CONTRAST_MINIMUMS[pair.use]);
    },
  );

  // The rule that keeps error states from being mistaken for brand moments.
  it('keeps danger clearly distinct from brand crimson', () => {
    expect(semantic.danger).not.toBe(brand[600]);
    expect(contrastRatio(semantic.danger, brand[600])).toBeGreaterThan(1.2);
  });

  it('moves brand actions up the scale on dark, where 600 fails', () => {
    expect(contrastRatio(brand[600], dark.surface)).toBeLessThan(4.5);
    expect(contrastRatio(dark.brandAction, dark.surface)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('the generated stylesheet', () => {
  it('is regenerated from the palette, not hand-edited', () => {
    expect(TOKENS_CSS).toContain('GENERATED FILE');
    expect(TOKENS_CSS).toContain(`--mx-brand-600: ${brand[600]}`);
    expect(TOKENS_CSS).toContain(`--mx-canvas: ${neutral.canvas}`);
    expect(TOKENS_CSS).toContain(`--mx-danger-text: ${semantic.dangerText}`);
  });

  it('defines light on bare :root and only redefines what changes on dark', () => {
    expect(TOKENS_CSS).toMatch(/^:root \{/m);
    expect(TOKENS_CSS).toContain('@media (prefers-color-scheme: dark)');
    expect(TOKENS_CSS).toContain(':root:not([data-theme="light"])');
    // An explicit toggle has to win in both directions.
    expect(TOKENS_CSS).toContain(':root[data-theme="dark"]');
  });

  it('collapses motion durations under prefers-reduced-motion', () => {
    expect(TOKENS_CSS).toContain('@media (prefers-reduced-motion: reduce)');
    expect(TOKENS_CSS).toMatch(/--mx-motion-fast: 1ms/);
  });

  it('ships the brand-anchored dataviz palette rather than a rainbow', () => {
    expect(TOKENS_CSS).toContain(`--mx-viz-1: ${brand[600]}`);
    expect(TOKENS_CSS).toContain('--mx-viz-seq-1');
  });
});
