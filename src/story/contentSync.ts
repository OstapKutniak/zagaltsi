// Живий шар контенту у Firebase — щоб правки редактора історії (студія) і
// зовнішнього застосунку «Літопис» ОДРАЗУ бачила гра, і навпаки, без ручного
// «Оновити гру» (той лишається як JSON-знімок для офлайн/першого завантаження).
//
// Пілот — КВЕСТИ. Сховище: content/quests/{questId} = Quest із updatedAt.
// Мердж — по КОЖНОМУ квесту (LWW за updatedAt), тож паралельні правки різних
// квестів не затирають одна одну. Видалення = тумбстоун {id, deleted, updatedAt},
// щоб «видалено» перемагало старіші копії у published JSON / IDB.
//
// Firebase у пісочниці недоступний (ERR_TUNNEL) — усі шляхи no-op-стійкі
// (catch/ігнор), верифікація живого циклу — на реальних пристроях.

import { ref, onValue, get, update, type DataSnapshot } from 'firebase/database';
import { db } from '../firebase';
import type { Quest } from './quests';

const QUESTS_PATH = 'content/quests';

// Запис у Firebase може містити тумбстоун видаленого квесту.
export type QuestNode = (Quest & { deleted?: false }) | { id: string; deleted: true; updatedAt: number };
const isTombstone = (n: QuestNode): n is { id: string; deleted: true; updatedAt: number } =>
  (n as { deleted?: boolean }).deleted === true;

// ── Публікація (студія / Літопис пишуть сюди на кожну правку) ──────────────────

// Записати/оновити один квест (LWW-нода). undefined-поля не пишемо (Firebase не любить).
export function pushQuest(q: Quest): void {
  const node: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(q)) if (v !== undefined) node[k] = v;
  node.updatedAt = q.updatedAt ?? Date.now();
  void update(ref(db, `${QUESTS_PATH}/${q.id}`), node).catch(() => { /* ignore */ });
}

// Синхронізувати весь стор: апсертнути наявні + тумбстоуни на зниклі.
export function pushQuestStore(quests: Quest[], removedIds: string[] = []): void {
  const patch: Record<string, unknown> = {};
  for (const q of quests) {
    const node: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(q)) if (v !== undefined) node[k] = v;
    node.updatedAt = q.updatedAt ?? Date.now();
    patch[q.id] = node;
  }
  for (const id of removedIds) patch[id] = { id, deleted: true, updatedAt: Date.now() };
  if (Object.keys(patch).length) void update(ref(db, QUESTS_PATH), patch).catch(() => { /* ignore */ });
}

// Позначити квест видаленим (тумбстоун).
export function tombstoneQuest(id: string): void {
  void update(ref(db, `${QUESTS_PATH}/${id}`), { id, deleted: true, updatedAt: Date.now() }).catch(() => { /* ignore */ });
}

// ── Читання ────────────────────────────────────────────────────────────────────

function parseNodes(snap: DataSnapshot): QuestNode[] {
  const val = snap.val() as Record<string, QuestNode> | null;
  if (!val) return [];
  return Object.values(val).filter((n): n is QuestNode => !!n && typeof n === 'object');
}

// Разове читання живого контенту (для стартового мерджу в loadQuests).
export async function fetchQuestNodes(): Promise<QuestNode[]> {
  try { return parseNodes(await get(ref(db, QUESTS_PATH))); } catch { return []; }
}

// Підписка на живі зміни. cb отримує повний список нод (включно з тумбстоунами).
export function watchQuestNodes(cb: (nodes: QuestNode[]) => void): () => void {
  const r = ref(db, QUESTS_PATH);
  const off = onValue(r, (snap) => cb(parseNodes(snap)), () => { /* ignore */ });
  return () => off();
}

// ── Мердж трьох джерел по КОЖНОМУ квесту (LWW) ────────────────────────────────
// published/local — списки квестів; firebase — ноди (можуть бути тумбстоуни).
// Повертає фінальний список (тумбстоуни-переможці прибирають квест).
export function mergeQuests(published: Quest[], local: Quest[], nodes: QuestNode[]): Quest[] {
  type Cand = { at: number; q?: Quest; dead?: boolean };
  const best = new Map<string, Cand>();
  const consider = (id: string, at: number, q?: Quest, dead?: boolean): void => {
    const cur = best.get(id);
    if (!cur || at >= cur.at) best.set(id, { at, q, dead });
  };
  for (const q of published) consider(q.id, q.updatedAt ?? 0, q);
  for (const q of local) consider(q.id, q.updatedAt ?? 0, q);
  for (const n of nodes) {
    if (isTombstone(n)) consider(n.id, n.updatedAt ?? 0, undefined, true);
    else consider(n.id, n.updatedAt ?? 0, n as Quest);
  }
  const out: Quest[] = [];
  for (const c of best.values()) if (!c.dead && c.q) out.push(c.q);
  return out;
}
