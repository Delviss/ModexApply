import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/**
 * The search latency budget (Phase 2 §3: p95 < 500 ms, with the test in CI).
 *
 * Split from the functional integration run for two reasons: a p95 breach and a
 * broken cascade are different failures and deserve different red crosses, and
 * seeding two thousand search documents should not be paid for on every
 * correctness run.
 */
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  resolve: {
    alias: {
      '@modex/contracts': fileURLToPath(new URL('../../packages/contracts/src/index.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['test/integration/search-latency.test.ts'],
    testTimeout: 300_000,
    hookTimeout: 300_000,
    fileParallelism: false,
  },
});
