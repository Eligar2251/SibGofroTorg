import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Standalone-обвязка. Ядро (src/core) и UI (src/ui) ничего не знают про vite,
// поэтому копируются в чужой проект как есть.
export default defineConfig({
  plugins: [react()],
  server: { host: '0.0.0.0', port: 5173, allowedHosts: true },
  build: { outDir: 'dist', target: 'es2020' },
  // родительский postcss.config.js (Tailwind из основного репозитория) здесь не нужен
  css: { postcss: { plugins: [] } },
});
