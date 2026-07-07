// Синхронізація НАЗВ локацій між трьома місцями:
//   1) вузол карти світу (WorldNode.label — Редактор Карт + мапа гри);
//   2) документ локації (LocationDoc.name — Редактор Локацій + сцена локації);
//   3) локація Літопису (content/litopys/world/{nodeId}.name).
// Ренейм у будь-якому з них має розлетітися в решту. Вузол ↔ документ пов'язані
// node.locationId або збігом назви (locationForNode) — тому ренейм МУСИТЬ бути
// парним, інакше зв'язок за назвою рветься. Ехо давимо міткою node.labelAt:
// назву з Літопису застосовуємо лише якщо lit.updatedAt новіший за labelAt.
//
// У студії редактори тримають власні in-memory копії (worlds у Редакторі Карт,
// locs у Редакторі Локацій) — тож крос-оновлення йде подією 'zag-name-sync' на
// window: кожен редактор править СВІЙ стан і сам зберігає. У грі редакторів нема —
// syncNamesFromLitopys() застосовує ренейми до IDB-копій перед малюванням мапи.

import { ref, get, onValue, update } from 'firebase/database';
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

// ── Шар Літопису ───────────────────────────────────────────────────────────────
export interface LitName { name?: string; updatedAt?: number; deleted?: boolean }

// PATCH назви в локацію Літопису. update() мерджиться в наявний об'єкт; якщо
// локації там нема — з'явиться огризок без id, який пул Літопису ігнорує.
export function pushNameToLitopys(nodeId: string, name: string): void {
  void update(ref(db, `content/litopys/world/${nodeId}`), { name, updatedAt: Date.now() }).catch(() => { /* ignore */ });
}

export async function fetchLitopysNames(): Promise<Record<string, LitName> | null> {
  try {
    const snap = await get(ref(db, 'content/litopys/world'));
    return (snap.val() ?? {}) as Record<string, LitName>;
  } catch { return null; }
}

export function watchLitopysNames(cb: (names: Record<string, LitName>) => void): () => void {
  const r = ref(db, 'content/litopys/world');
  const off = onValue(r, (snap) => cb((snap.val() ?? {}) as Record<string, LitName>), () => { /* ignore */ });
  return () => off();
}

// ── Парний ренейм ──────────────────────────────────────────────────────────────
// Документ локації для вузла: закріплений locationId, інакше збіг СТАРОЇ назви.
export function locDocForNode(node: WorldNode, oldLabel: string, locations: LocationDoc[]): LocationDoc | null {
  if (node.locationId) { const d = locations.find((l) => l.id === node.locationId); if (d) return d; }
  const key = oldLabel.trim().toLowerCase();
  return locations.find((l) => l.name.trim().toLowerCase() === key) ?? null;
}

// Застосувати назви Літопису до вузлів + документів (мутує). Повертає ренейми.
export function applyLitopysNames(
  names: Record<string, LitName>, worlds: WorldDoc[], locations: LocationDoc[],
): { node: WorldNode; oldName: string; newName: string; locId?: string }[] {
  const out: { node: WorldNode; oldName: string; newName: string; locId?: string }[] = [];
  for (const w of worlds) {
    for (const n of w.nodes) {
      const lit = names[n.id];
      if (!lit || lit.deleted || !lit.name) continue;
      const at = lit.updatedAt ?? 0;
      if (at <= (n.labelAt ?? 0) || lit.name === n.label) continue;
      const oldName = n.label;
      n.label = lit.name; n.labelAt = at;
      w.updatedAt = Date.now();
      const doc = locDocForNode(n, oldName, locations);
      if (doc) { doc.name = lit.name; doc.updatedAt = Date.now(); n.locationId = doc.id; }
      out.push({ node: n, oldName, newName: lit.name, locId: doc?.id });
    }
  }
  return out;
}

// ── Гра: разовий синк назв у IDB-копії (перед малюванням мапи) ────────────────
// Ренейми осідають у zag_worlds/zag_locations із свіжим updatedAt — LWW-мердж
// із published їх не відкотить, і всі loadXxxForGame бачать актуальні назви.
export async function syncNamesFromLitopys(): Promise<void> {
  try {
    const names = await fetchLitopysNames();
    if (!names || !Object.keys(names).length) return;
    const [worlds, locations] = await Promise.all([loadWorldsForGame(), loadLocationsForGame()]);
    if (!applyLitopysNames(names, worlds, locations).length) return;
    await idbSet('zag_worlds', worlds);
    await idbSet('zag_locations', locations);
  } catch { /* Firebase недоступний — назви лишаються як є */ }
}
