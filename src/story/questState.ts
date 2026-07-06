// Стан квестів ГРАВЦЯ: взяті/виконані/провалені + прогрес по цілях.
// Локально — localStorage zag_taken_quests; дзеркало у Firebase
// player_quests/{playerId}/{questId} — його читає бот-воркер для нагадувань
// (у Telegram playerId = tg user id = chat_id приватного чату). Виконаний квест
// прибираємо з дзеркала (нагадування більше не треба).

import { ref, set } from 'firebase/database';
import { db } from '../firebase';
import { getPlayerId } from '../multiplayer/lobby';
import { loadQuests, type Quest, type QuestObjective, type QuestAcq } from './quests';
import { watchQuestNodes } from './contentSync';
import { grantReward } from './profile';

const LS = 'zag_taken_quests';

export interface PlayerQuest {
  status: 'active' | 'done' | 'failed';
  takenAt: number;
  progress: Record<string, number>; // objId → зроблено
  doneAt?: number;
}

// Кеш ВИЗНАЧЕНЬ квестів (щоб оцінювати цілі в рантаймі без async у гарячому шляху).
let defs: Quest[] = [];
export function primeQuests(): void {
  void loadQuests().then((s) => { defs = s.quests; autoAcceptAuto(); }).catch(() => { /* ignore */ });
}
primeQuests();

// Живі правки визначень квестів (студія/Літопис) — оновлюємо кеш defs по кожній
// ноді (LWW за updatedAt), нові 'auto'-квести одразу стають активними.
let _watching = false;
export function watchQuestDefs(): void {
  if (_watching) return; _watching = true;
  watchQuestNodes((nodes) => {
    for (const n of nodes) {
      const idx = defs.findIndex((q) => q.id === n.id);
      const localAt = idx >= 0 ? (defs[idx].updatedAt ?? 0) : -1;
      const nodeAt = n.updatedAt ?? 0;
      if ((n as { deleted?: boolean }).deleted) {
        if (idx >= 0 && nodeAt > localAt) defs.splice(idx, 1);
      } else if (nodeAt > localAt) {
        if (idx >= 0) defs[idx] = n as Quest; else defs.push(n as Quest);
      }
    }
    autoAcceptAuto();
  });
}
watchQuestDefs();
const questDef = (id: string): Quest | undefined => defs.find((q) => q.id === id);

// Спосіб отримання з дефолтом (сумісність зі старими квестами).
export const acqOf = (q: Quest): QuestAcq => q.acq ?? (q.giver ? 'tg_encounter' : 'auto');

// Квести певного способу отримання, ЩЕ НЕ взяті (для дошки/НПС локації тощо).
export function questsForAcq(acq: QuestAcq, match?: (q: Quest) => boolean): Quest[] {
  const taken = readAll();
  return defs.filter((q) => acqOf(q) === acq && !taken[q.id] && (!match || match(q)));
}

// «Одразу відомі» квести стають активними самі (щоб цілі трекались із старту гри).
export function autoAcceptAuto(): void {
  for (const q of defs) if (acqOf(q) === 'auto') acceptQuest(q);
}

function readAll(): Record<string, PlayerQuest> {
  let raw: Record<string, unknown> = {};
  try { raw = JSON.parse(localStorage.getItem(LS) ?? '{}') as Record<string, unknown>; } catch { raw = {}; }
  const out: Record<string, PlayerQuest> = {};
  for (const [id, v] of Object.entries(raw)) {
    const o = v as Partial<PlayerQuest> & { takenAt?: number };
    if (o && typeof o === 'object' && 'status' in o) {
      out[id] = { status: o.status!, takenAt: o.takenAt ?? Date.now(), progress: o.progress ?? {}, doneAt: o.doneAt };
    } else {
      // Міграція старого формату {takenAt} → активний без прогресу.
      out[id] = { status: 'active', takenAt: o?.takenAt ?? Date.now(), progress: {} };
    }
  }
  return out;
}
function writeAll(all: Record<string, PlayerQuest>): void {
  try { localStorage.setItem(LS, JSON.stringify(all)); } catch { /* ignore */ }
}

export function takenQuests(): Record<string, PlayerQuest> { return readAll(); }
export function isTaken(id: string): boolean { const q = readAll()[id]; return !!q && q.status !== 'failed'; }
export function questStatus(id: string): PlayerQuest['status'] | null { return readAll()[id]?.status ?? null; }

export function acceptQuest(q: Quest): void {
  const all = readAll();
  if (all[q.id]) return;
  startQuest(q, all);
  writeAll(all);
}

const need = (o: QuestObjective): number => Math.max(1, o.count ?? 1);
export function objectiveDone(o: QuestObjective, pq: PlayerQuest): boolean {
  return (pq.progress[o.id] ?? 0) >= need(o);
}
function allObjectivesDone(q: Quest, pq: PlayerQuest): boolean {
  const objs = q.objectives ?? [];
  if (!objs.length) return false; // без цілей автозавершення нема (здача діалогом/скриптом)
  return objs.every((o) => objectiveDone(o, pq));
}

function startQuest(q: Quest, all: Record<string, PlayerQuest>): void {
  if (all[q.id]) return;
  const progress: Record<string, number> = {};
  for (const o of q.objectives ?? []) progress[o.id] = 0;
  all[q.id] = { status: 'active', takenAt: Date.now(), progress };
  void set(ref(db, `player_quests/${getPlayerId()}/${q.id}`), { title: q.title, takenAt: Date.now(), lastRemind: Date.now() }).catch(() => { /* ignore */ });
}

function finish(id: string, q: Quest, all: Record<string, PlayerQuest>): void {
  all[id].status = 'done'; all[id].doneAt = Date.now();
  grantReward(q.reward);
  void set(ref(db, `player_quests/${getPlayerId()}/${id}`), null).catch(() => { /* ignore */ });
  // Ланцюг: активуємо наступні квести, що чекали на завершення цього.
  for (const nx of defs) if (acqOf(nx) === 'chain' && nx.prevQuestId === id) startQuest(nx, all);
}

// Просунути прогрес усіх АКТИВНИХ квестів за подією (kind + target). Ціль без
// target у визначенні = «будь-хто/будь-де» (напр. «здолати 3 ворогів»).
// Повертає щойно ВИКОНАНІ квести — сцена показує тост + нагороду.
export function reportProgress(kind: QuestObjective['kind'], target?: string, amount = 1): Quest[] {
  const all = readAll();
  const completed: Quest[] = [];
  let changed = false;
  for (const [id, pq] of Object.entries(all)) {
    if (pq.status !== 'active') continue;
    const q = questDef(id); if (!q?.objectives?.length) continue;
    for (const o of q.objectives) {
      if (o.kind !== kind) continue;
      if (o.target && o.target !== target) continue; // конкретна ціль — потрібен збіг (порожня = будь-хто)
      const cur = pq.progress[o.id] ?? 0;
      if (cur >= need(o)) continue;
      pq.progress[o.id] = Math.min(need(o), cur + amount);
      changed = true;
    }
    const success = q.successOn ?? 'objectives';
    if ((success === 'objectives' || success === 'reach') && allObjectivesDone(q, pq)) {
      finish(id, q, all); completed.push(q); changed = true;
    }
  }
  if (changed) writeAll(all);
  return completed;
}

// Явне завершення (діалог-здача / успіх 'dialog_positive' / 'custom').
export function completeQuest(id: string): Quest | null {
  const all = readAll(); const pq = all[id]; if (!pq || pq.status !== 'active') return null;
  const q = questDef(id); if (!q) return null;
  finish(id, q, all); writeAll(all);
  return q;
}
export function failQuest(id: string): void {
  const all = readAll(); const pq = all[id]; if (!pq || pq.status !== 'active') return;
  pq.status = 'failed'; writeAll(all);
  void set(ref(db, `player_quests/${getPlayerId()}/${id}`), null).catch(() => { /* ignore */ });
}

// Здача квестів «по діалогу»: активні квести цього НПС з успіхом 'dialog_positive',
// у яких цілі виконано (або цілей нема) — завершуємо. Повертає щойно виконані.
export function turnInWithGiver(giverCharId: string): Quest[] {
  const all = readAll(); const done: Quest[] = []; let changed = false;
  for (const [id, pq] of Object.entries(all)) {
    if (pq.status !== 'active') continue;
    const q = questDef(id); if (!q || q.giver !== giverCharId) continue;
    if ((q.successOn ?? 'objectives') !== 'dialog_positive') continue;
    const objs = q.objectives ?? [];
    if (objs.length && !objs.every((o) => objectiveDone(o, pq))) continue;
    finish(id, q, all); done.push(q); changed = true;
  }
  if (changed) writeAll(all);
  return done;
}

// Dev-only: доступ до квест-логіки з консолі (у проді не активний).
if (import.meta.env.DEV) {
  (window as unknown as { __quest?: unknown }).__quest = { reportProgress, completeQuest, failQuest, acceptQuest, takenQuests, primeQuests, questsForAcq, turnInWithGiver, autoAcceptAuto };
}
