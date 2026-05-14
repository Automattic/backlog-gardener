import { builtinModules } from 'node:module';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    server: {
      deps: {
        external: [...builtinModules, ...builtinModules.map((mod) => `node:${mod}`)],
      },
    },
  },
});
