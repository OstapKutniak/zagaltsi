import type { CapacitorConfig } from '@capacitor/cli';

// APK завантажує живий GitHub Pages сайт замість локального знімка.
// Переваги: оновлюється автоматично при кожному push (без перезбірки APK),
// AI-генерація працює (той самий домен що й у браузері, без CORS-блоку).
// Єдина вимога — інтернет (для редактора він і так потрібен).
const config: CapacitorConfig = {
  appId: 'com.zagaltsi.horugva',
  appName: 'Хоругва',
  webDir: 'dist',
  server: {
    url: 'https://ostapkutniak.github.io/zagaltsi/menu.html',
    cleartext: false,
  },
  android: {
    allowMixedContent: true,
  },
};

export default config;
