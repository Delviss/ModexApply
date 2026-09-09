import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  // NestJS relies on `emitDecoratorMetadata`, which esbuild does not emit.
  // SWC does, so dependency injection behaves in tests exactly as at runtime.
  plugins: [swc.vite({ module: { type: 'es6' } })],
  resolve: {
    alias: {
      '@modex/contracts': fileURLToPath(new URL('../../packages/contracts/src/index.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['test/**/*.test.ts'],
    exclude: ['test/integration/**'],
  },
});
