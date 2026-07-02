// Тонка обгортка над Telegram Mini App SDK.
// У звичайному браузері (дев-режим) усе деградує до localStorage —
// гра повноцінно працює без Telegram.

type TgUser = { id: number; first_name?: string; username?: string };

interface TelegramWebApp {
  ready(): void;
  expand(): void;
  isVersionAtLeast?(version: string): boolean;
  requestFullscreen?(): void; // Bot API 8.0+
  disableVerticalSwipes?(): void; // Bot API 7.7+
  initDataUnsafe?: { user?: TgUser; start_param?: string };
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
  // Версійно-гейтнуті методи: викликаємо лише якщо клієнт достатньо новий, інакше SDK
  // сам пише console.error «not supported in version X» (виключення не кидає, try/catch не
  // глушить). На старих клієнтах / у браузері просто залишаємось на expand().
  const atLeast = (v: string): boolean => w.isVersionAtLeast?.(v) ?? false;
  if (atLeast('8.0')) try { w.requestFullscreen?.(); } catch { /* ignore */ }
  if (atLeast('7.7')) try { w.disableVerticalSwipes?.(); } catch { /* ignore */ }
}

export function getUser(): TgUser | null {
  return tg()?.initDataUnsafe?.user ?? null;
}

// Deep-link параметр Mini App (t.me/<bot>/<app>?startapp=XXX). Поза Telegram —
// підтримуємо і ?startapp=XXX у URL (для тестів у браузері).
export function getStartParam(): string | null {
  const p = tg()?.initDataUnsafe?.start_param;
  if (p) return p;
  try { return new URLSearchParams(location.search).get('startapp'); } catch { return null; }
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
