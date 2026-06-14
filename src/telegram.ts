// Тонка обгортка над Telegram Mini App SDK.
// У звичайному браузері (дев-режим) усе деградує до localStorage —
// гра повноцінно працює без Telegram.

type TgUser = { id: number; first_name?: string; username?: string };

interface TelegramWebApp {
  ready(): void;
  expand(): void;
  requestFullscreen?(): void; // Bot API 8.0+
  disableVerticalSwipes?(): void;
  initDataUnsafe?: { user?: TgUser };
  CloudStorage?: {
    setItem(key: string, value: string, cb?: (err: unknown, ok: boolean) => void): void;
    getItem(key: string, cb: (err: unknown, value: string | null) => void): void;
  };
}

function tg(): TelegramWebApp | undefined {
  return (window as unknown as { Telegram?: { WebApp?: TelegramWebApp } }).Telegram?.WebApp;
}

export function initTelegram(): void {
  const w = tg();
  if (!w) return;
  w.ready();
  w.expand(); // на весь доступний экран по висоті (мобілка)
  // На нових клієнтах — справжній повноекранний режим; на старих просто немає методу.
  try { w.requestFullscreen?.(); } catch { /* не підтримується — ок */ }
  // Щоб свайп донизу не закривав гру випадково під час гри.
  try { w.disableVerticalSwipes?.(); } catch { /* ignore */ }
}

export function getUser(): TgUser | null {
  return tg()?.initDataUnsafe?.user ?? null;
}

const LS_PREFIX = 'zagaltsi:';

export function saveValue(key: string, value: string): Promise<void> {
  const w = tg();
  return new Promise((resolve) => {
    if (w?.CloudStorage) {
      w.CloudStorage.setItem(key, value, () => resolve());
    } else {
      localStorage.setItem(LS_PREFIX + key, value);
      resolve();
    }
  });
}

export function loadValue(key: string): Promise<string | null> {
  const w = tg();
  return new Promise((resolve) => {
    if (w?.CloudStorage) {
      w.CloudStorage.getItem(key, (_err, value) => resolve(value ?? null));
    } else {
      resolve(localStorage.getItem(LS_PREFIX + key));
    }
  });
}
