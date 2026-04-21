import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import federation from '@originjs/vite-plugin-federation';

export default defineConfig({
  base: '/anki/',
  server: {
    proxy: {
      '/api': {
        target: 'https://172.20.10.3:8787',
        changeOrigin: true,
      },
    },
  },
  plugins: [
    vue(),
    federation({
      name: 'anki_remote',
      filename: 'remoteEntry.js',
      exposes: {
        './AnkiApp': './src/exposeAnki.ts',
      },
      shared: ['vue', 'pinia']
    }),
    {
      name: 'fix-federation-css-bug',
      enforce: 'post',
      // @ts-ignore
      generateBundle(options, bundle) {
        const cssFiles = Object.keys(bundle).filter(fileName => fileName.endsWith('.css'));
        const cssPaths = cssFiles.map(fileName => fileName.split('/').pop());

        for (const key in bundle) {
          const chunk = bundle[key];
          if (chunk.type === 'chunk' && chunk.code) {
            chunk.code = chunk.code.replace(
                /`__v__css__[^`]*`/g,
                JSON.stringify(cssPaths)
            );
          }
        }
      }
    }
  ],
  build: {
    target: 'esnext',
    cssCodeSplit: true,
    outDir: '../mister-dixie/public/anki',
    emptyOutDir: true
  }
});