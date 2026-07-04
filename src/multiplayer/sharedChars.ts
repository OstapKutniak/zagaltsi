// Спільні персонажі паті/присутності. Проблема: по мережі (khorugvas/presence)
// ходить лише charId, а сам арт персонажа (~1МБ base64) живе ЛИШЕ на пристрої
// власника — тож чужого героя нема з чого намалювати. Рішення: кожен публікує
// свій док у Firebase `shared_chars/{playerId}`, а інші пристрої тягнуть його раз
// і кешують. Так у сцені Хоругви й у локації видно РЕАЛЬНИЙ вигляд побратимів.

import { db } from '../firebase';
import { ref, set, get } from 'firebase/database';
import { getPlayerId, getPlayerName, getChosenChar } from './lobby';
import { loadCharLibrary, docById } from '../charlib';
import { loadEquip } from '../inventory';
import type { CharDoc } from '../anim/CutoutCharacter';

function hasImages(doc: CharDoc | null | undefined): boolean {
  return !!(doc?.slots && doc.images && Object.keys(doc.images).length > 0);
}

// Firebase get без таймауту вічно висить при відсутній мережі — обгортаємо, щоб
// збір біля вогнища не «зависав» назавжди без відповіді.
function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p.catch(() => fallback), new Promise<T>((res) => setTimeout(() => res(fallback), ms))]);
}

// Мій персонаж — той самий, що в лоббі: явно обраний (zag_chosen_char) →
// zag_game_char → бібліотечний герой → public/character.json (найсвіжіший LWW).
export async function resolveMyCharDoc(): Promise<CharDoc | null> {
  try {
    const lib = await loadCharLibrary();
    const chosen = getChosenChar();
    const mine = chosen ? docById(lib, chosen) : null;
    if (mine && hasImages(mine)) return mine;
  } catch { /* ignore */ }
  const cand: CharDoc[] = [];
  try { const s = localStorage.getItem('zag_game_char'); if (s) { const d = JSON.parse(s) as CharDoc; if (hasImages(d)) cand.push(d); } } catch { /* ignore */ }
  try {
    const lib = await loadCharLibrary();
    const hero = lib.find((x) => x.cat === 'char' && hasImages(x.doc)) ?? lib.find((x) => hasImages(x.doc));
    if (hero) cand.push(hero.doc);
  } catch { /* ignore */ }
  try { const r = await fetch(`${import.meta.env.BASE_URL}character.json`); if (r.ok) { const d = await r.json() as CharDoc; if (hasImages(d)) cand.push(d); } } catch { /* ignore */ }
  if (!cand.length) return null;
  let best = cand[0];
  for (const d of cand) if ((d.updatedAt ?? 0) > (best.updatedAt ?? 0)) best = d;
  return best;
}

// Мініатюра (для маленьких портретів у локації) — з обраного бібліотечного айтема.
export async function resolveMyThumb(): Promise<string | null> {
  try {
    const lib = await loadCharLibrary();
    const chosen = getChosenChar();
    const it = (chosen ? lib.find((x) => x.id === chosen) : null) ?? lib.find((x) => x.cat === 'char' && x.thumb);
    if (it?.thumb) return it.thumb;
  } catch { /* ignore */ }
  return null;
}

export interface EquipVis { pants?: boolean; armor?: boolean; helmet?: boolean; weapon?: boolean }
interface SharedChar { name: string; charId: string; doc: CharDoc; thumb?: string; equip?: EquipVis; at: number }

let _publishedSig: string | null = null;

// Публікуємо СВІЙ док (раз на сесію, поки не змінився). Викликаємо при вході в
// паті та в локацію — саме там побратими нас шукатимуть.
export function myEquipVis(): EquipVis {
  const e = loadEquip();
  return { pants: !!e.pants, armor: !!e.armor, helmet: !!e.helmet, weapon: !!e.weapon };
}
export async function publishMyChar(): Promise<void> {
  const doc = await resolveMyCharDoc();
  if (!doc) return;
  const pid = getPlayerId();
  const equip = myEquipVis();
  // Підпис включає спорядження — перевдягнувся → перепублікуємо (щоб побратими бачили).
  const sig = pid + ':' + (doc.updatedAt ?? 0) + ':' + (getChosenChar() ?? '') + ':' + JSON.stringify(equip);
  if (_publishedSig === sig) return;
  const thumb = await resolveMyThumb();
  const payload: SharedChar = { name: getPlayerName(), charId: getChosenChar() ?? '', doc, equip, at: Date.now(), ...(thumb ? { thumb } : {}) };
  try { await set(ref(db, `shared_chars/${pid}`), payload); _publishedSig = sig; } catch { /* офлайн — не критично */ }
}
// Спорядження учасника (для збору біля вогнища). Я → локальний інвентар.
export async function loadMemberEquip(id: string): Promise<EquipVis> {
  if (id === getPlayerId()) return myEquipVis();
  const snap = await withTimeout(get(ref(db, `shared_chars/${id}/equip`)), 3500, null);
  return (snap?.val() as EquipVis | null) ?? {};
}

const _docCache = new Map<string, CharDoc | null>();
const _thumbCache = new Map<string, string | null>();

// Док учасника паті/присутності {id=playerId, charId}. Порядок: я → локальна
// бібліотека (якщо це опублікований спільний персонаж) → shared_chars/{id}.
export async function loadMemberCharDoc(id: string, charId: string): Promise<CharDoc | null> {
  if (id === getPlayerId()) return resolveMyCharDoc();
  if (_docCache.has(id)) return _docCache.get(id) ?? null;
  try {
    const lib = await loadCharLibrary();
    const local = charId ? docById(lib, charId) : null;
    if (local && hasImages(local)) { _docCache.set(id, local); return local; }
  } catch { /* ignore */ }
  const snap = await withTimeout(get(ref(db, `shared_chars/${id}`)), 4000, null);
  const v = snap?.val() as SharedChar | null;
  const doc = v?.doc && hasImages(v.doc) ? v.doc : null;
  _docCache.set(id, doc);
  return doc;
}

// Мініатюра учасника (для портретних слотів локації).
export async function loadMemberThumb(id: string, charId: string): Promise<string | null> {
  if (id === getPlayerId()) return resolveMyThumb();
  if (_thumbCache.has(id)) return _thumbCache.get(id) ?? null;
  try {
    const lib = await loadCharLibrary();
    const it = charId ? lib.find((x) => x.id === charId) : null;
    if (it?.thumb) { _thumbCache.set(id, it.thumb); return it.thumb; }
  } catch { /* ignore */ }
  try {
    const snap = await get(ref(db, `shared_chars/${id}`));
    const v = snap.val() as SharedChar | null;
    const thumb = v?.thumb ?? null;
    _thumbCache.set(id, thumb);
    return thumb;
  } catch { _thumbCache.set(id, null); return null; }
}
