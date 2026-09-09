#!/usr/bin/env node
/**
 * Vendor-colour gate (Phase 0 acceptance criteria).
 *
 * Every block sourced from 21st.dev arrives carrying its author's palette. The
 * re-theming rule is easy to state and easy to half-do, so this gate greps the
 * design system and the web app for literal colours and fails on anything that
 * is not a `var(--mx-*)` reference.
 *
 * `packages/ui/src/tokens/palette.ts` is the one file allowed to contain hex —
 * it is the source of truth — plus the generated stylesheet it produces.
 */
import { readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { extname, join, relative, resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '..');

const SCAN_ROOTS = ['packages/ui/src', 'apps/web/src'];

/** The only places a literal colour may legally appear. */
const ALLOWED = new Set([
  'packages/ui/src/tokens/palette.ts',
  'packages/ui/src/tokens/tokens.css',
  // The contrast registry re-exports palette values by reference, never literals,
  // but keep it listed so a future inline test value is a deliberate edit here.
  'packages/ui/src/tokens/contrast.ts',
]);

const SCANNED_EXTENSIONS = new Set(['.ts', '.tsx', '.css', '.js', '.jsx', '.mjs']);
const SKIP_DIRS = new Set(['node_modules', 'dist', '.next', 'coverage', 'storybook-static']);

/** 3-, 4-, 6- and 8-digit hex, plus the colour functions blocks tend to ship with. */
const PATTERNS = [
  { label: 'hex colour', regex: /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/g },
  { label: 'rgb()/rgba()', regex: /\brgba?\(\s*\d+[\s,]/g },
  { label: 'hsl()/hsla()', regex: /\bhsla?\(\s*[\d.]+(deg)?[\s,]/g },
  { label: 'oklch()', regex: /\boklch\(/g },
  {
    label: 'Tailwind vendor colour class',
    regex:
      /\b(?:bg|text|border|ring|from|to|via|fill|stroke|shadow|decoration|outline|accent|caret|divide|placeholder)-(?:slate|gray|grey|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/g,
  },
];

/** A line carrying this marker is exempt, and must say why on the same line. */
const EXEMPTION = /mx-allow-literal-colour:/;

async function* walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      yield* walk(join(dir, entry.name));
    } else if (SCANNED_EXTENSIONS.has(extname(entry.name))) {
      yield join(dir, entry.name);
    }
  }
}

const violations = [];
let filesScanned = 0;

for (const root of SCAN_ROOTS) {
  for await (const file of walk(resolve(REPO_ROOT, root))) {
    const rel = relative(REPO_ROOT, file);
    if (ALLOWED.has(rel)) continue;
    filesScanned += 1;
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, index) => {
      if (EXEMPTION.test(line)) return;
      for (const { label, regex } of PATTERNS) {
        regex.lastIndex = 0;
        const match = regex.exec(line);
        if (match) {
          violations.push({ file: rel, line: index + 1, label, text: match[0], source: line.trim() });
        }
      }
    });
  }
}

console.log(`Scanned ${filesScanned} files across ${SCAN_ROOTS.join(', ')}.`);

if (violations.length > 0) {
  console.error(`\n${violations.length} literal colour(s) found outside the token layer:\n`);
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  ${v.label} "${v.text}"`);
    console.error(`    ${v.source.slice(0, 120)}`);
  }
  console.error(
    '\nRebind these to a Red Velvet token (var(--mx-*)) from packages/ui/src/tokens/palette.ts.',
  );
  console.error(
    'If a literal is genuinely unavoidable, add "mx-allow-literal-colour: <reason>" on the line.',
  );
  process.exit(1);
}

console.log('No vendor colours outside the token layer.');
