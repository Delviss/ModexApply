// Loads the design-system token modules for the CI gates.
//
// The gates need the *TypeScript* token files (palette.ts is the single source
// of truth), so transpile them with the real compiler and import the result
// rather than regex-stripping types — a hand-rolled stripper silently produces
// wrong values the moment somebody adds a type annotation.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import ts from 'typescript';

const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(here, '../..');
export const UI_TOKENS_DIR = resolve(REPO_ROOT, 'packages/ui/src/tokens');
const CACHE_DIR = resolve(REPO_ROOT, 'node_modules/.cache/modex-tokens');

function transpileToCache(name) {
  const source = readFileSync(resolve(UI_TOKENS_DIR, `${name}.ts`), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2023 },
    fileName: `${name}.ts`,
  });
  mkdirSync(CACHE_DIR, { recursive: true });
  // `.js` + a `type: module` marker, because the token modules import each
  // other with explicit `./palette.js` specifiers.
  writeFileSync(resolve(CACHE_DIR, 'package.json'), '{"type":"module"}', 'utf8');
  const outPath = resolve(CACHE_DIR, `${name}.js`);
  writeFileSync(outPath, outputText, 'utf8');
  return outPath;
}

/** Cache-busted so a token edit is picked up within a single CI run. */
function importFresh(path) {
  return import(`${pathToFileURL(path).href}?t=${Date.now()}`);
}

export async function loadPalette() {
  return importFresh(transpileToCache('palette'));
}

export async function loadContrastRegistry() {
  transpileToCache('palette');
  return importFresh(transpileToCache('contrast'));
}
