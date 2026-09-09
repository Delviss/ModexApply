#!/usr/bin/env node
/**
 * Generates src/tokens/tokens.css from src/tokens/palette.ts.
 *
 * The CSS is generated rather than hand-written so the TypeScript palette stays
 * the only place a colour is decided. The vendor-hex CI gate depends on that:
 * any hex it finds outside palette.ts is, by construction, a colour somebody
 * pasted in from elsewhere.
 *
 * Theme strategy (Phase 0 §1.4): light is defined on bare `:root`; dark
 * redefines only the tokens that change, once under `prefers-color-scheme`
 * guarded as `:root:not([data-theme="light"])` and again under
 * `:root[data-theme="dark"]` so an explicit toggle wins in both directions.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const paletteSource = resolve(here, '../src/tokens/palette.ts');
const outFile = resolve(here, '../src/tokens/tokens.css');

// palette.ts is plain `export const x = {...} as const` — evaluate it without a
// TypeScript toolchain so token generation stays a zero-dependency build step.
const source = readFileSync(paletteSource, 'utf8');
const stripped = source
  .replace(/^import[\s\S]*?;$/gm, '')
  .replace(/\bexport const\b/g, 'const')
  .replace(/ as const/g, '');
const names = [...source.matchAll(/export const (\w+)\s*=/g)].map((m) => m[1]);
const evaluate = new Function(`${stripped}\nreturn { ${names.join(', ')} };`);
const { brand, neutral, semantic, dark, dataviz, typography, space, radius, elevation, motion, focus } =
  evaluate();

const lines = [];
const push = (line = '') => lines.push(line);

push('/*');
push(' * GENERATED FILE — do not edit.');
push(' * Source: packages/ui/src/tokens/palette.ts');
push(' * Regenerate: pnpm --filter @modex/ui build:tokens');
push(' */');
push();
push(':root {');
push('  color-scheme: light;');
push();
push('  /* Brand — Red Velvet. An accent for action and identity, never a wash. */');
for (const [step, hex] of Object.entries(brand)) push(`  --mx-brand-${step}: ${hex};`);
push();
push('  /* Neutrals — the "white" half, warm-tinted on purpose. */');
push(`  --mx-surface: ${neutral.surface};`);
push(`  --mx-canvas: ${neutral.canvas};`);
push(`  --mx-subtle: ${neutral.subtle};`);
push(`  --mx-border: ${neutral.border};`);
push(`  --mx-border-strong: ${neutral.borderStrong};`);
push(`  --mx-border-input: ${neutral.borderInput};`);
push(`  --mx-ink-500: ${neutral.ink500};`);
push(`  --mx-ink-600: ${neutral.ink600};`);
push(`  --mx-ink-800: ${neutral.ink800};`);
push(`  --mx-ink-900: ${neutral.ink900};`);
push();
push('  /* Semantics. Brand red never signals an error; danger is orange-shifted. */');
push(`  --mx-success: ${semantic.success};`);
push(`  --mx-success-text: ${semantic.successText};`);
push(`  --mx-warning: ${semantic.warning};`);
push(`  --mx-warning-text: ${semantic.warningText};`);
push(`  --mx-danger: ${semantic.danger};`);
push(`  --mx-danger-text: ${semantic.dangerText};`);
push(`  --mx-info: ${semantic.info};`);
push(`  --mx-info-text: ${semantic.infoText};`);
push();
push('  /* Roles — what components actually reference. */');
push('  --mx-action: var(--mx-brand-600);');
push('  --mx-action-hover: var(--mx-brand-700);');
push('  --mx-action-fg: var(--mx-surface);');
push('  --mx-action-subtle: var(--mx-brand-50);');
push('  --mx-action-subtle-fg: var(--mx-brand-700);');
push('  --mx-link: var(--mx-brand-600);');
push('  --mx-text: var(--mx-ink-900);');
push('  --mx-text-muted: var(--mx-ink-600);');
push('  --mx-text-disabled: var(--mx-ink-500);');
push('  --mx-text-heading: var(--mx-ink-800);');
push('  --mx-placeholder: var(--mx-ink-600);');
push();
push('  /* Data visualisation — brand-anchored, not a rainbow. */');
dataviz.categorical.forEach((hex, i) => push(`  --mx-viz-${i + 1}: ${hex};`));
dataviz.sequential.forEach((hex, i) => push(`  --mx-viz-seq-${i + 1}: ${hex};`));
push();
push('  /* Type */');
push(`  --mx-font-sans: ${typography.fontSans};`);
push(`  --mx-font-display: ${typography.fontDisplay};`);
push(`  --mx-font-mono: ${typography.fontMono};`);
for (const [key, value] of Object.entries(typography.size)) push(`  --mx-text-${key}: ${value};`);
for (const [key, value] of Object.entries(typography.lineHeight)) push(`  --mx-leading-${key}: ${value};`);
for (const [key, value] of Object.entries(typography.weight)) push(`  --mx-weight-${key}: ${value};`);
push();
push('  /* Space — 4px base grid */');
for (const [key, value] of Object.entries(space)) push(`  --mx-space-${key}: ${value};`);
push();
push('  /* Radius */');
for (const [key, value] of Object.entries(radius)) push(`  --mx-radius-${key}: ${value};`);
push();
push('  /* Elevation — three levels, warm-tinted shadows */');
for (const [key, value] of Object.entries(elevation)) push(`  --mx-shadow-${key}: ${value};`);
push();
push('  /* Motion */');
push(`  --mx-motion-fast: ${motion.fast};`);
push(`  --mx-motion-surface: ${motion.surface};`);
push(`  --mx-motion-easing: ${motion.easing};`);
push();
push('  /* Focus — never removed */');
push(`  --mx-focus-width: ${focus.width};`);
push(`  --mx-focus-offset: ${focus.offset};`);
push('  --mx-focus-color: var(--mx-brand-600);');
push('}');
push();

const darkBlock = [
  '  color-scheme: dark;',
  '',
  `  --mx-canvas: ${dark.ground};`,
  `  --mx-surface: ${dark.surface};`,
  `  --mx-subtle: ${dark.subtle};`,
  `  --mx-elevated: ${dark.elevated};`,
  `  --mx-border: ${dark.border};`,
  `  --mx-border-strong: ${dark.borderStrong};`,
  `  --mx-border-input: ${dark.borderInput};`,
  `  --mx-ink-500: ${dark.ink500};`,
  `  --mx-ink-600: ${dark.ink600};`,
  `  --mx-ink-800: ${dark.ink800};`,
  `  --mx-ink-900: ${dark.ink900};`,
  '',
  `  --mx-success: ${dark.success};`,
  `  --mx-success-text: ${dark.success};`,
  `  --mx-warning: ${dark.warning};`,
  `  --mx-warning-text: ${dark.warning};`,
  `  --mx-danger: ${dark.danger};`,
  `  --mx-danger-text: ${dark.danger};`,
  `  --mx-info: ${dark.info};`,
  `  --mx-info-text: ${dark.info};`,
  '',
  '  /* brand-600 fails contrast on dark ground, so actions move up the scale. */',
  `  --mx-action: ${dark.brandAction};`,
  `  --mx-action-hover: ${dark.brandLink};`,
  `  --mx-action-fg: ${dark.ground};`,
  `  --mx-action-subtle: ${dark.brandGround};`,
  `  --mx-action-subtle-fg: ${dark.brandLink};`,
  `  --mx-link: ${dark.brandLink};`,
  `  --mx-focus-color: ${dark.brandAction};`,
  '',
  ...dataviz.categoricalDark.map((hex, i) => `  --mx-viz-${i + 1}: ${hex};`),
  '',
  '  --mx-shadow-1: 0 1px 2px rgba(0, 0, 0, 0.4);',
  '  --mx-shadow-2: 0 4px 12px rgba(0, 0, 0, 0.5);',
  '  --mx-shadow-3: 0 16px 40px rgba(0, 0, 0, 0.6);',
].join('\n');

push('@media (prefers-color-scheme: dark) {');
push('  :root:not([data-theme="light"]) {');
push(darkBlock.replace(/^/gm, '  '));
push('  }');
push('}');
push();
push('/* An explicit choice wins over the system preference, in both directions. */');
push(':root[data-theme="dark"] {');
push(darkBlock);
push('}');
push();
push('/* Reduced motion is honoured globally — several sourced blocks animate. */');
push('@media (prefers-reduced-motion: reduce) {');
push('  :root {');
push('    --mx-motion-fast: 1ms;');
push('    --mx-motion-surface: 1ms;');
push('  }');
push('}');
push();
push('/* The focus ring is a platform guarantee, not a component decision. */');
push('.mx-focusable:focus-visible,');
push('.mx-focusable :focus-visible {');
push('  outline: var(--mx-focus-width) solid var(--mx-focus-color);');
push('  outline-offset: var(--mx-focus-offset);');
push('}');
push();

writeFileSync(outFile, lines.join('\n'), 'utf8');
console.warn(`tokens.css written (${lines.length} lines)`);
