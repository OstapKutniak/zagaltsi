// Присутність у локації — хто з гравців зараз стоїть у тому самому хабі.
// Пишемо себе у RTDB `presence/<locNodeId>/<playerId>`, знімаємось при виході
// й при обриві (onDisconnect). LocationScene показує всіх у слотах Хоругви.

import { db } from '../firebase';
import { ref, set, remove, onValue, off, onDisconnect, type Unsubscribe } from 'firebase/database';
import { getPlayerId, getPlayerName, getChosenChar } from './lobby';

export interface PresenceEntry {
  id: string;
  name: string;
  charId: string;
  t: number; // час заходу — для порядку слотів
}

let curLoc: string | null = null;

export function enterLocation(locNodeId: string): void {
  leaveLocation(); // одна локація за раз
  curLoc = locNodeId;
  const pid = getPlayerId();
  const r = ref(db, `presence/${locNodeId}/${pid}`);
  const entry: PresenceEntry = { id: pid, name: getPlayerName(), charId: getChosenChar() ?? '', t: Date.now() };
  set(r, entry).catch(() => {});
  onDisconnect(r).remove().catch(() => {});
}

export function leaveLocation(): void {
  if (!curLoc) return;
  const pid = getPlayerId();
  remove(ref(db, `presence/${curLoc}/${pid}`)).catch(() => {});
  curLoc = null;
}

export function watchLocationPresence(locNodeId: string, cb: (list: PresenceEntry[]) => void): Unsubscribe {
  const r = ref(db, `presence/${locNodeId}`);
  onValue(r, (snap) => {
    const v = snap.exists() ? (snap.val() as Record<string, PresenceEntry>) : {};
    cb(Object.values(v).sort((a, b) => a.t - b.t));
  }, () => cb([])); // помилка (нема мережі/правил) → порожній список, гра не падає
  return () => off(r);
}
