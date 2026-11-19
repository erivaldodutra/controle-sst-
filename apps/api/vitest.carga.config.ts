import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/** Teste de carga (fora da suíte normal): `pnpm --filter @sst/api carga`. */
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: { include: ['carga/**/*.carga.ts'], fileParallelism: false, testTimeout: 600_000, hookTimeout: 900_000 },
});
