// vite.config.ts
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import federation from '@originjs/vite-plugin-federation';

export default defineConfig({
  plugins: [
    vue(),
    federation({
      name: 'anki_remote', // Имя твоего модуля (без пробелов и тире)
      filename: 'remoteEntry.js', // Файл-манифест
      // Что мы "выставляем" наружу для Хост-приложения
      exposes: {
        './AnkiApp': './src/components/AnkiWidget.vue',
      },
      // Общие зависимости. Если у Хоста есть vue, модуль не будет грузить его заново
      shared: ['vue', 'pinia']
    })
  ],
  build: {
    // Для Module Federation нужен современный таргет, 
    // так как он использует top-level await и ES-модули
    target: 'esnext',
    minify: false,
    cssCodeSplit: false // Чтобы CSS паковался вместе с JS, так проще встраивать
  }
});