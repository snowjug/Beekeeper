import { existsSync, readdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';

const alias = {
  '@shared': resolve('src/shared'),
  '@main': resolve('src/main'),
  '@renderer': resolve('src/renderer'),
};

// One renderer page per window: src/renderer/<name>/index.html
const rendererRoot = resolve('src/renderer');
const rendererInputs = Object.fromEntries(
  readdirSync(rendererRoot, { withFileTypes: true })
    .filter(
      (entry) => entry.isDirectory() && existsSync(join(rendererRoot, entry.name, 'index.html')),
    )
    .map((entry) => [entry.name, join(rendererRoot, entry.name, 'index.html')]),
);

// One preload bridge per window: src/preload/<name>.ts (files starting with "_" are helpers)
const preloadRoot = resolve('src/preload');
const preloadInputs = Object.fromEntries(
  readdirSync(preloadRoot)
    .filter((file) => file.endsWith('.ts') && !file.startsWith('_'))
    .map((file) => [basename(file, '.ts'), join(preloadRoot, file)]),
);

export default defineConfig({
  main: {
    resolve: { alias },
    build: {
      rolldownOptions: { input: { index: resolve('src/main/index.ts') } },
    },
  },
  preload: {
    resolve: { alias },
    build: {
      // Sandboxed preload scripts can only require('electron'); everything else must be bundled in.
      externalizeDeps: false,
      isolatedEntries: true,
      rolldownOptions: { input: preloadInputs },
    },
  },
  renderer: {
    root: rendererRoot,
    resolve: { alias },
    plugins: [react(), tailwindcss()],
    build: {
      rolldownOptions: { input: rendererInputs },
    },
  },
});
