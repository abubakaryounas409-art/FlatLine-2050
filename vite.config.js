// Vite config for FLATLINE: 2050
import { defineConfig } from 'vite';

export default defineConfig({
  base: './', // relative paths so the build runs from any folder / itch.io zip
  // Own ports, so it never clashes with other projects on this PC (5173 / 4173 are taken)
  server: { port: 5290, strictPort: true, open: false },
  preview: { port: 5291, strictPort: true },
  build: {
    target: 'es2022',
    // The main chunk includes the Rapier physics WASM (inlined) — that's expected.
    chunkSizeWarningLimit: 6000,
  },
});
