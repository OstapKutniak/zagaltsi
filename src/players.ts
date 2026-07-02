import { ref, set, get } from 'firebase/database';
import { db } from './firebase';
import { getPlayerId, getPlayerName } from './multiplayer/lobby';

// Реєстр гравців у Firebase (players/{id}): хто будь-коли відкривав гру.
// Пишеться при старті застосунку; читається сторінкою «Досягнення».
// УВАГА: реєстр почав наповнюватись лише з моменту цього релізу — минулі заходи
// (до реєстру) відновити нема звідки.

export interface RegPlayer { id: string; name: string; username?: string; lastSeen: number }

export function registerPlayer(): void {
  try {
    const tg = (window as unknown as { Telegram?: { WebApp?: { initDataUnsafe?: { user?: { username?: string } } } } }).Telegram?.WebApp;
    const p: RegPlayer = {
      id: getPlayerId(),
      name: getPlayerName(),
      username: tg?.initDataUnsafe?.user?.username ?? '',
      lastSeen: Date.now(),
    };
    void set(ref(db, `players/${p.id}`), p).catch(() => { /* офлайн — не критично */ });
  } catch { /* ignore */ }
}

export async function listPlayers(): Promise<RegPlayer[]> {
  try {
    const { withTimeout } = await import('./khorugva');
    const snap = await withTimeout(get(ref(db, 'players')));
    const v = snap.val() as Record<string, RegPlayer> | null;
    if (!v) return [];
    return Object.values(v).sort((a, b) => (b.lastSeen ?? 0) - (a.lastSeen ?? 0));
  } catch { return []; }
}
