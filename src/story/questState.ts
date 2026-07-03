// Стан квестів ГРАВЦЯ: які взяті (дошка «Завдання» показує саме їх).
// Локально — localStorage zag_taken_quests; дзеркало у Firebase
// player_quests/{playerId}/{questId} — його читає бот-воркер для нагадувань
// (у Telegram playerId = tg user id = chat_id приватного чату).

import { ref, set } from 'firebase/database';
import { db } from '../firebase';
import { getPlayerId } from '../multiplayer/lobby';
import type { Quest } from './quests';

const LS = 'zag_taken_quests';

export interface TakenQuest { takenAt: number }

export function takenQuests(): Record<string, TakenQuest> {
  try { return JSON.parse(localStorage.getItem(LS) ?? '{}') as Record<string, TakenQuest>; } catch { return {}; }
}

export function isTaken(questId: string): boolean { return !!takenQuests()[questId]; }

export function acceptQuest(q: Quest): void {
  const all = takenQuests();
  if (all[q.id]) return;
  all[q.id] = { takenAt: Date.now() };
  try { localStorage.setItem(LS, JSON.stringify(all)); } catch { /* ignore */ }
  // Дзеркало для воркера-нагадувача (офлайн — не критично, доллється наступним разом)
  void set(ref(db, `player_quests/${getPlayerId()}/${q.id}`), {
    title: q.title, takenAt: Date.now(), lastRemind: Date.now(),
  }).catch(() => { /* ignore */ });
}
