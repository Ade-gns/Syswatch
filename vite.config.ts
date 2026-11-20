import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Configuration Vite pour Tauri : port fixe, pas d'ouverture de navigateur, cible WebKitGTK.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: { port: 1420, strictPort: true, watch: { ignored: ['**/src-tauri/**', '**/target/**'] } },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  build: { target: 'safari16', sourcemap: false },
});
