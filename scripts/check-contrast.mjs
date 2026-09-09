#!/usr/bin/env node
/**
 * Contrast gate (Phase 0 acceptance criteria).
 *
 * Every approved colour pairing in `packages/ui/src/tokens/contrast.ts` is
 * measured against the WCAG 2.2 minimum for its declared use. Any violation
 * fails the build. Adding a pairing to the registry is how a designer asks for
 * a new combination — and the gate is what answers.
 */
import { contrastRatio, round } from './lib/contrast.mjs';
import { loadContrastRegistry } from './lib/load-tokens.mjs';

const { CONTRAST_PAIRS, CONTRAST_MINIMUMS, CONTRAST_EXCLUSIONS } = await loadContrastRegistry();

let failures = 0;
const rows = [];

for (const pair of CONTRAST_PAIRS) {
  const ratio = round(contrastRatio(pair.foreground, pair.background));
  const minimum = CONTRAST_MINIMUMS[pair.use];
  const ok = ratio >= minimum;
  if (!ok) failures += 1;
  rows.push({ ok, ratio, minimum, use: pair.use, name: pair.name });
}

const width = Math.max(...rows.map((r) => r.name.length));
for (const row of rows) {
  const mark = row.ok ? 'PASS' : 'FAIL';
  console.log(
    `${mark}  ${row.name.padEnd(width)}  ${row.ratio.toFixed(2).padStart(6)}:1  ` +
      `(${row.use}, needs ${row.minimum.toFixed(1)}:1)`,
  );
}

console.log(`\n${CONTRAST_PAIRS.length} approved pairings checked.`);
if (CONTRAST_EXCLUSIONS.length > 0) {
  console.log('Documented exclusions:');
  for (const exclusion of CONTRAST_EXCLUSIONS) {
    console.log(`  - ${exclusion.name}: ${exclusion.reason}`);
  }
}

if (failures > 0) {
  console.error(`\n${failures} pairing(s) below the WCAG 2.2 AA minimum. Failing the build.`);
  process.exit(1);
}
console.log('\nContrast budget holds.');
