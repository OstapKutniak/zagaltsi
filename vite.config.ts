import { defineConfig } from 'vite';

// base: './' — щоб усе працювало з будь-якого підшляху на хостингу/в Telegram.
// Дві сторінки: гра (index.html) і ріг-редактор (rig.html).
export default defineConfig({
  base: './',
  server: { host: true },
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        rig: 'rig.html',
      },
    },
  },
});
