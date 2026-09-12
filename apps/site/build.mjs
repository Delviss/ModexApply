/**
 * Builds the public site into `docs/`, which is what GitHub Pages serves at
 * https://delviss.github.io/ModexApply/.
 *
 * Two decisions are worth reading before changing this.
 *
 * **1. The site imports the platform's real logic, not a copy of it.** The
 * anti-scam scanner, the guide matching weights, the eligibility evaluators and
 * the verdict roll-up are pulled straight out of `packages/contracts` and
 * `apps/api/src/eligibility/rules.ts`. A demo that reimplements those rules
 * would drift from the product within a week and would be worth nothing as a
 * demonstration of them. The `.js` → `.ts` resolver plugin below exists only so
 * TypeScript's mandatory `.js` import specifiers resolve against the sources.
 *
 * **2. Output is committed.** GitHub Pages serves the branch directly, so
 * `docs/` has to hold built files. `--check` rebuilds into a temporary directory
 * and fails if the committed output differs, which is the CI gate that stops
 * the published site drifting from the source in `apps/site/src`.
 */
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const src = join(here, 'src');
const dataDir = join(repo, 'data');

const checkOnly = process.argv.includes('--check');

/**
 * TypeScript sources import each other as `./thing.js` (NodeNext). esbuild
 * takes that literally, so the file on disk — `./thing.ts` — is never found.
 */
const typescriptSources = {
  name: 'ts-source-resolver',
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: /^\.{1,2}\/.*\.js$/ }, (args) => {
      const candidate = resolve(args.resolveDir, args.path).replace(/\.js$/, '.ts');
      return existsSync(candidate) ? { path: candidate } : null;
    });
  },
};

/** The workspace package has no `dist/` in a fresh clone; use its source. */
const contractsAlias = {
  '@modex/contracts': join(repo, 'packages/contracts/src/index.ts'),
};

async function buildInto(outDir) {
  await mkdir(join(outDir, 'assets'), { recursive: true });
  await mkdir(join(outDir, 'data'), { recursive: true });

  await build({
    entryPoints: [join(src, 'main.js')],
    bundle: true,
    format: 'esm',
    target: ['es2022'],
    minify: true,
    sourcemap: false,
    legalComments: 'none',
    alias: contractsAlias,
    plugins: [typescriptSources],
    outfile: join(outDir, 'assets/app.js'),
    logLevel: 'warning',
  });

  // The page shell is hand-written; only the asset names are injected, so a
  // stale bundle can never be served from a cache after a deploy.
  const bundle = await readFile(join(outDir, 'assets/app.js'));
  const styles = await readFile(join(outDir, 'assets/app.css'));
  const stamp = (buffer) => createHash('sha256').update(buffer).digest('hex').slice(0, 8);
  const shell = (await readFile(join(src, 'index.html'), 'utf8'))
    .replace('assets/app.css', `assets/app.css?v=${stamp(styles)}`)
    .replace('assets/app.js', `assets/app.js?v=${stamp(bundle)}`);
  await writeFile(join(outDir, 'index.html'), shell);

  // A deep link that arrives as a real path (someone typed it, or an old link
  // survives) is bounced to the hash route rather than to a 404 page.
  await writeFile(join(outDir, '404.html'), await readFile(join(src, '404.html')));
  await writeFile(join(outDir, '.nojekyll'), '');

  await writeFile(join(outDir, 'data/platform.json'), await platformData());
}

/**
 * One payload for the browser, assembled from the files a human edits.
 *
 * `data/institution-register.json` is the real admin work — universities
 * entered by staff, carrying publicly verifiable identity facts only. The other
 * two files are the sample catalogue that lets the journey be walked end to
 * end. They stay separate on disk precisely so nobody can quietly promote a
 * sample tuition figure into the register.
 */
async function platformData() {
  const read = async (name) => JSON.parse(await readFile(join(dataDir, name), 'utf8'));
  const register = await read('institution-register.json');
  const catalogue = await read('catalogue.json');
  const network = await read('network.json');

  return `${JSON.stringify(
    {
      builtAt: new Date().toISOString().slice(0, 10),
      register: { policy: register.register, institutions: register.institutions },
      institutions: catalogue.institutions,
      programmes: catalogue.programmes,
      guides: network.guides,
      offers: network.offers,
      questions: network.questions,
      demoStudent: network.demoStudent,
    },
    null,
    0,
  )}\n`;
}

async function filesUnder(root) {
  const found = new Map();
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else found.set(relative(root, full), await readFile(full));
    }
  }
  await walk(root);
  return found;
}

const docs = join(repo, 'docs');

if (checkOnly) {
  const scratch = await mkdtemp(join(tmpdir(), 'modex-site-'));
  await buildInto(scratch);
  const fresh = await filesUnder(scratch);
  const drifted = [];
  for (const [name, content] of fresh) {
    // The build stamp is a date, so it changes without the source changing.
    if (name === 'data/platform.json') {
      const committed = existsSync(join(docs, name))
        ? JSON.parse(await readFile(join(docs, name), 'utf8'))
        : null;
      const built = JSON.parse(content.toString());
      if (committed === null) drifted.push(name);
      else {
        delete committed.builtAt;
        delete built.builtAt;
        if (JSON.stringify(committed) !== JSON.stringify(built)) drifted.push(name);
      }
      continue;
    }
    const target = join(docs, name);
    if (!existsSync(target) || !(await readFile(target)).equals(content)) drifted.push(name);
  }
  await rm(scratch, { recursive: true, force: true });
  if (drifted.length > 0) {
    console.error(
      `The published site is out of date with apps/site/src:\n  ${drifted.join('\n  ')}\n` +
        'Run `pnpm site:build` and commit the result.',
    );
    process.exit(1);
  }
  console.warn('The published site matches its source.');
} else {
  await buildInto(docs);
  const size = (await stat(join(docs, 'assets/app.js'))).size;
  console.warn(`Built docs/ — bundle ${(size / 1024).toFixed(0)} kB.`);
}

export { buildInto };
