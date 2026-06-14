import { defineConfig } from 'vite';

// base: './' — щоб гра працювала з будь-якого підшляху на хостингу/в Telegram.
export default defineConfig({
  base: './',
  server: { host: true },
});
