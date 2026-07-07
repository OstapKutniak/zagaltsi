// Синхронізація СТРУКТУРИ СВІТУ між Літописом, студією і грою:
//   — назви локацій: вузол карти (WorldNode.label) ↔ документ (LocationDoc.name)
//     ↔ локація Літопису (content/litopys/world/{nodeId}.name);
//   — назви країв: регіон Літопису (content/litopys/meta.regions) ↔ region-вузол
//     глобальної карти ↔ назва вкладеної карти (WorldDoc.name);
//   — нові локації, створені в Літописі, зʼявляються вузлами на карті студії/гри
//     (у своєму краї, з тими ж координатами) разом зі своїми шляхами-ребрами;
//   — нові location-вузли, створені в студії, отримують кістяк локації в Літописі
//     (щоб одразу наповнювати НПС/діалогами/дошками з телефона).
// Ехо давимо міткою node.labelAt: назву з Літопису застосовуємо лише якщо її
// updatedAt новіший. У студії редактори тримають власні in-memory копії — крос-
// оновлення йде подією 'zag-name-sync' на window: кожен править СВІЙ стан і сам
// зберігає. У грі редакторів нема — syncNamesFromLitopys() застосовує все до
// IDB-копій перед малюванням мапи (свіжий updatedAt → LWW не відкочує).

import { ref, get, onValue, update, set } from 'firebase/database';
import { db } from '../firebase';
import { idbSet } from '../store';
import {
  type WorldDoc, type WorldNode, type LocationDoc,
  loadWorldsForGame, loadLocationsForGame,
} from './worldData';

export interface NameSyncDetail {
  source: 'world' | 'location' | 'litopys';
  nodeId?: string;   // вузол, що перейменовано (source world/litopys)
  locId?: string;    // документ локації, якщо відомий (закріплений зв'язок)
  oldName: string;
  newName: string;
}
export const NAME_SYNC_EVENT = 'zag-name-sync';
export function emitNameSync(detail: NameSyncDetail): void {
  window.dispatchEvent(new CustomEvent<NameSyncDetail>(NAME_SYNC_EVENT, { detail }));
}

// ── Дані Літопису ──────────────────────────────────────────────────────────────
export interface LitLoc {
  id?: string; name?: string; updatedAt?: number; deleted?: boolean;
  x?: number; y?: number; regionId?: string;
  paths?: { to?: string }[];
}
export interface LitRegion { id?: string; name?: string; desc?: string; x?: number; y?: number }
export interface LitMeta { title?: string; regions?: LitRegion[] | Record<string, LitRegion>; updatedAt?: number }
export interface LitData { world: Record<string, LitLoc>; meta: LitMeta | null }

function parseLit(v: unknown): LitData {
  const o = (v ?? {}) as { world?: Record<string, LitLoc>; meta?: LitMeta };
  return { world: o.world ?? {}, meta: o.meta ?? null };
}
export async function fetchLitopys(): Promise<LitData | null> {
  try { return parseLit((await get(ref(db, 'content/litopys'))).val()); } catch { return null; }
}
export function watchLitopys(cb: (d: LitData) => void): () => void {
  const r = ref(db, 'content/litopys');
  const off = onValue(r, (snap) => cb(parseLit(snap.val())), () => { /* ignore */ });
  return () => off();
}
const metaRegions = (meta: LitMeta | null): LitRegion[] =>
  !meta?.regions ? [] : Array.isArray(meta.regions) ? meta.regions : Object.values(meta.regions);

// ── Студія → Літопис ───────────────────────────────────────────────────────────
// Пуш назви location-вузла. Якщо локації в Літописі ще нема — створюємо КІСТЯК
// (з координатами вузла і краєм), щоб її одразу можна було наповнювати в Літописі.
export function pushNodeToLitopys(node: WorldNode, worlds: WorldDoc[]): void {
  if (node.type !== 'location') { if (node.type === 'region') pushRegionNameToLitopys(node.id, node.label); return; }
  void (async () => {
    try {
      const cur = await get(ref(db, `content/litopys/world/${node.id}/id`));
      if (cur.exists()) {
        await update(ref(db, `content/litopys/world/${node.id}`), { name: node.label, updatedAt: Date.now() });
      } else {
        const w = worlds.find((x) => x.nodes.some((n) => n.id === node.id));
        let regionId = '';
        for (const g of worlds) {
          const rn = g.nodes.find((n) => n.type === 'region' && n.regionId === w?.id);
          if (rn) { regionId = rn.id; break; }
        }
        await set(ref(db, `content/litopys/world/${node.id}`), {
          id: node.id, name: node.label, desc: '',
          x: Math.round(node.x), y: Math.round(node.y), ...(regionId ? { regionId } : {}),
          updatedAt: Date.now(),
        });
      }
    } catch { /* ignore */ }
  })();
}

// Видалення локації зі студії — тумбстоун у Літописі (щоб зникла скрізь і не воскресала).
export function tombstoneLitopysLoc(id: string): void {
  void set(ref(db, `content/litopys/world/${id}`), { id, deleted: true, updatedAt: Date.now() }).catch(() => { /* ignore */ });
}

// Пуш назви краю: читаємо meta, правимо регіон за id, пишемо назад.
export function pushRegionNameToLitopys(regionNodeId: string, name: string): void {
  void (async () => {
    try {
      const snap = await get(ref(db, 'content/litopys/meta'));
      const meta = (snap.val() ?? null) as LitMeta | null;
      const regs = metaRegions(meta);
      const r = regs.find((g) => g?.id === regionNodeId);
      if (!r || r.name === name) return;
      r.name = name;
      await update(ref(db, 'content/litopys/meta'), { regions: regs, updatedAt: Date.now() });
    } catch { /* ignore */ }
  })();
}

// ── Літопис → студія/гра ───────────────────────────────────────────────────────
// Документ локації для вузла: закріплений locationId, інакше збіг СТАРОЇ назви.
export function locDocForNode(node: WorldNode, oldLabel: string, locations: LocationDoc[]): LocationDoc | null {
  if (node.locationId) { const d = locations.find((l) => l.id === node.locationId); if (d) return d; }
  const key = oldLabel.trim().toLowerCase();
  return locations.find((l) => l.name.trim().toLowerCase() === key) ?? null;
}

export interface AppliedRename { node: WorldNode; oldName: string; newName: string; locId?: string }

// Застосувати стан Літопису до карт (+документів, якщо передані). Мутує. Повертає
// ренейми (для подій у студії) і прапорець «щось змінилось» (для збереження).
export function applyLitopys(d: LitData, worlds: WorldDoc[], locations: LocationDoc[] | null): { renames: AppliedRename[]; changed: boolean } {
  const renames: AppliedRename[] = [];
  let changed = false;

  // 0) Видалення: тумбстоун Літопису прибирає вузол (і його ребра) з карти.
  for (const lit of Object.values(d.world)) {
    if (!lit?.id || !lit.deleted) continue;
    const at = lit.updatedAt ?? 0;
    for (const w of worlds) {
      const idx = w.nodes.findIndex((n) => n.id === lit.id && n.type === 'location');
      if (idx < 0 || at <= (w.nodes[idx].labelAt ?? 0)) continue;
      w.nodes.splice(idx, 1);
      w.edges = w.edges.filter((e) => e.from !== lit.id && e.to !== lit.id);
      w.updatedAt = Date.now();
      changed = true;
    }
  }

  // 1) Ренейми локацій (вузол + документ) — ехо-гейт по labelAt.
  for (const w of worlds) {
    for (const n of w.nodes) {
      if (n.type !== 'location') continue;
      const lit = d.world[n.id];
      if (!lit || lit.deleted || !lit.name) continue;
      const at = lit.updatedAt ?? 0;
      if (at <= (n.labelAt ?? 0) || lit.name === n.label) continue;
      const oldName = n.label;
      n.label = lit.name; n.labelAt = at;
      w.updatedAt = Date.now();
      let locId: string | undefined;
      if (locations) {
        const doc = locDocForNode(n, oldName, locations);
        if (doc) { doc.name = lit.name; doc.updatedAt = Date.now(); n.locationId = doc.id; locId = doc.id; }
      } else locId = n.locationId;
      renames.push({ node: n, oldName, newName: lit.name, locId });
      changed = true;
    }
  }

  // 2) Ренейми країв: region-вузол глобальної карти + назва вкладеної карти.
  const metaAt = d.meta?.updatedAt ?? 0;
  for (const reg of metaRegions(d.meta)) {
    if (!reg?.id || !reg.name) continue;
    for (const w of worlds) {
      const n = w.nodes.find((x) => x.id === reg.id && x.type === 'region');
      if (!n) continue;
      if (metaAt > (n.labelAt ?? 0) && reg.name !== n.label) {
        n.label = reg.name; n.labelAt = metaAt;
        w.updatedAt = Date.now();
        changed = true;
      }
      // Назва вкладеної карти краю завжди слідує за label region-вузла.
      const sub = n.regionId ? worlds.find((x) => x.id === n.regionId) : null;
      if (sub && sub.name !== n.label) { sub.name = n.label; sub.updatedAt = Date.now(); changed = true; }
    }
  }

  // 3) Нові локації Літопису → вузли карти свого краю (+ їхні шляхи-ребра).
  const nodeExists = (id: string): boolean => worlds.some((w) => w.nodes.some((n) => n.id === id));
  const worldOfRegion = (regionId?: string): WorldDoc | null => {
    if (!regionId) return null;
    for (const g of worlds) {
      const rn = g.nodes.find((n) => n.type === 'region' && n.id === regionId);
      if (rn?.regionId) return worlds.find((w) => w.id === rn.regionId) ?? null;
    }
    return null;
  };
  const added: LitLoc[] = [];
  for (const lit of Object.values(d.world)) {
    if (!lit?.id || lit.deleted || !lit.name || nodeExists(lit.id)) continue;
    const w = worldOfRegion(lit.regionId);
    if (!w) continue;
    w.nodes.push({
      id: lit.id, label: lit.name, x: lit.x ?? 0, y: lit.y ?? 0,
      type: 'location', labelAt: lit.updatedAt ?? Date.now(),
    });
    w.updatedAt = Date.now();
    added.push(lit);
    changed = true;
  }
  // Ребра лише для щойно доданих вузлів (наявний граф студії не чіпаємо).
  for (const lit of added) {
    const w = worlds.find((x) => x.nodes.some((n) => n.id === lit.id));
    if (!w) continue;
    for (const p of lit.paths ?? []) {
      if (!p?.to || !w.nodes.some((n) => n.id === p.to)) continue;
      if (w.edges.some((e) => (e.from === lit.id && e.to === p.to) || (e.from === p.to && e.to === lit.id))) continue;
      w.edges.push({ id: 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), from: lit.id!, to: p.to, levelId: '', twoWay: true });
    }
  }

  return { renames, changed };
}

// ── Гра: разовий синк у IDB-копії (перед малюванням мапи) ─────────────────────
export async function syncNamesFromLitopys(): Promise<void> {
  try {
    const d = await fetchLitopys();
    if (!d || (!Object.keys(d.world).length && !d.meta)) return;
    const [worlds, locations] = await Promise.all([loadWorldsForGame(), loadLocationsForGame()]);
    if (!applyLitopys(d, worlds, locations).changed) return;
    await idbSet('zag_worlds', worlds);
    await idbSet('zag_locations', locations);
  } catch { /* Firebase недоступний — лишаємось як є */ }
}
