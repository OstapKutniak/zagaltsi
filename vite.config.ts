import { defineConfig } from 'vite';

// base: './' — щоб усе працювало з будь-якого підшляху на хостингу/в Telegram.
// Сторінки: гра (index.html), студія-оболонка (studio.html) + окремі тулзи
// (rig.html, level.html) — студія вбудовує їх як секції через iframe.
export default defineConfig({
  base: './',
  server: { host: true },
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        studio: 'studio.html',
        rig: 'rig.html',
        level: 'level.html',
      },
    },
  },
});
