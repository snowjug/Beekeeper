import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve('src/shared'),
      '@main': resolve('src/main'),
      '@renderer': resolve('src/renderer'),
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: ['tests/unit/main/**/*.test.ts', 'tests/unit/shared/**/*.test.ts'],
        },
      },
      {
        extends: true,
        plugins: [react()],
        test: {
          name: 'dom',
          environment: 'jsdom',
          include: ['tests/unit/renderer/**/*.test.{ts,tsx}'],
          setupFiles: ['tests/unit/renderer/setup.ts'],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json-summary', 'lcov'],
      include: ['src/main/commands/**/*.ts', 'src/shared/**/*.ts'],
      // Pure data modules carry no logic to cover.
      exclude: ['src/shared/constants.ts', '**/*.d.ts'],
      thresholds: {
        'src/main/commands/**': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'src/shared/**': { statements: 80, branches: 80, functions: 80, lines: 80 },
      },
    },
  },
});
