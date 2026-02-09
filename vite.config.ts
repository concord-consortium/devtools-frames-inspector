import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { copyFileSync, mkdirSync, existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Plugin to copy static files to dist
function copyStaticFiles() {
  return {
    name: 'copy-static-files',
    writeBundle() {
      // Ensure dist directories exist
      if (!existsSync('dist')) {
        mkdirSync('dist', { recursive: true });
      }
      if (!existsSync('dist/panel')) {
        mkdirSync('dist/panel', { recursive: true });
      }

      // Copy manifest and devtools.html
      copyFileSync('manifest.json', 'dist/manifest.json');
      copyFileSync('devtools.html', 'dist/devtools.html');

      // Copy panel HTML and CSS
      copyFileSync('src/panel/panel.html', 'dist/panel/index.html');
      copyFileSync('src/panel/panel.css', 'dist/panel/panel.css');
    }
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), copyStaticFiles()],

  build: {
    outDir: 'dist',
    emptyDirBeforeWrite: true,
    rollupOptions: {
      input: {
        // Panel scripts
        'panel/panel': resolve(__dirname, 'src/panel/panel.tsx'),
        'panel/field-info': resolve(__dirname, 'src/panel/field-info.ts'),
        // Standalone scripts
        'background': resolve(__dirname, 'src/background.ts'),
        'content': resolve(__dirname, 'src/content.ts'),
        'devtools': resolve(__dirname, 'src/devtools.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: '[name].js',
        assetFileNames: '[name].[ext]',
        // ES modules format - Chrome extensions support this
        format: 'es',
      },
    },
    // Don't minify for easier debugging during development
    minify: mode === 'production',
    sourcemap: mode !== 'production',
  },

  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
  },

  // Dev server configuration (for future HMR with React)
  server: {
    port: 5173,
    strictPort: true,
    hmr: {
      port: 5173,
    },
  },
}));
