import type { CapacitorConfig } from '@capacitor/cli';

// Обгортка веб-застосунку в Android APK через Capacitor.
// webDir — папка зі зібраним сайтом (vite build → dist). Точка входу — index.html (гра);
// зі сторінки гри/редактора можна переходити на studio.html / level.html звичайною навігацією.
const config: CapacitorConfig = {
  appId: 'com.zagaltsi.horugva',
  appName: 'Хоругва',
  webDir: 'dist',
  android: {
    // Дозволяємо мікс http/https (фетч рівнів із GitHub raw тощо)
    allowMixedContent: true,
  },
};

export default config;
