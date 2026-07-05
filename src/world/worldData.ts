// Дані мандрів — СПІЛЬНІ типи карти світу/локацій для гри і редакторів.
// Джерело те саме, що в редакторів: IDB (zag_worlds / zag_locations) + опубліковані
// studio-data/worlds.json / locations.json, злиті LWW — тож усе, що ти правиш у
// редакторі Карти/Локацій, гра бачить одразу (локально) або після публікації (всюди).

import { idbGet } from '../store';
import { mergeByIdLWW } from '../sync';
import type { Atmosphere } from '../level/atmosphere';

// Опубліковане читаємо з ВЛАСНОГО деплою (BASE_URL), а не raw.githubusercontent:
// у dev це локальний public/ (бачиш сид одразу), на Pages — файли цього ж деплою.
async function fetchPublished<T>(file: string, field: string): Promise<T[]> {
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}studio-data/${file}?t=${Date.now()}`);
    if (!r.ok) return [];
    const j = await r.json() as Record<string, unknown>;
    const arr = j[field];
    return Array.isArray(arr) ? (arr as T[]) : [];
  } catch { return []; }
}

export interface WorldNode {
  id: string;
  label: string;
  x: number; y: number;
  type: 'location' | 'region' | 'stop';
  regionId?: string;    // type=region → id дочірньої карти (WorldDoc)
  locationId?: string;  // type=location → id LocationDoc (нема — шукаємо за назвою)
  desc?: string;        // короткий опис для прапорця на мапі
  icon?: string;        // MapIconKind для чорнильної іконки (нема — з назви)
  img?: string;         // своя картинка-іконка (dataURL) — перекриває icon
  iconScale?: number;   // множник розміру іконки/картинки на мапі
}

export interface WorldEdge {
  id: string;
  from: string; to: string;
  levelId: string; // бітемап-рівень переходу ('' = поки скіп)
  twoWay: boolean;
}

export interface WorldDoc {
  id: string;
  name: string;
  bg: string; // dataURL намальованого фону ('' = темна підкладка)
  nodes: WorldNode[];
  edges: WorldEdge[];
  updatedAt?: number;
}

export interface PlacedAsset {
  id: string; url: string; name: string;
  x: number; y: number; rot: number; scale: number; flip: number;
}
export interface ActionZone {
  id: string; x: number; y: number; w: number; h: number;
  action: string; label: string;
}
// Шар туману локації (Редактор Локацій → LocationScene): смуга шуму, що повзе.
// y/h — у світових координатах локації (як placed); speed px/с (знак = напрямок);
// front=true — поверх будівель (передній план), інакше між фоном і будівлями.
export interface FogLayer {
  id: string; y: number; h: number;
  alpha: number; tint: string; speed: number; front: boolean;
}
export interface LocationDoc {
  id: string; name: string; bg: string;
  placed: PlacedAsset[];
  zones: ActionZone[];
  fogs?: FogLayer[];        // legacy смуги туману (мігруються в atmosphere.weather.fogLayers)
  atmosphere?: Atmosphere;  // плановість/погода/віньєтка/баланс кольору — як у Редакторі Мандр
  updatedAt?: number;
}

// Вписування арту локації в логічний кадр гри 1280×576 — ЄДИНА математика для
// LocationScene (рендер) і Редактора Локацій (рамка 20:9 показує саме цей кроп).
// Повертає масштаб s і зсув (ox,oy) у логічних координатах кадру: screen = world·s + o.
export function locationFit(doc: LocationDoc, bgW: number, bgH: number, logicalW: number, logicalH: number): { s: number; ox: number; oy: number } {
  let minX = -400, minY = -220, maxX = 400, maxY = 220;
  if (doc.bg && bgW > 0) { minX = 0; minY = 0; maxX = bgW; maxY = bgH; }
  else if (doc.placed.length) {
    minX = Infinity; minY = Infinity; maxX = -Infinity; maxY = -Infinity;
    for (const p of doc.placed) {
      minX = Math.min(minX, p.x - 150); maxX = Math.max(maxX, p.x + 150);
      minY = Math.min(minY, p.y - 150); maxY = Math.max(maxY, p.y + 150);
    }
  }
  const availW = logicalW - 80, availH = logicalH - 210; // низ — під слоти Хоругви
  const s = Math.min(availW / (maxX - minX), availH / (maxY - minY));
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const ox = logicalW / 2 - cx * s;
  const oy = (logicalH / 2 - 30) - cy * s;
  return { s, ox, oy };
}

// ── Завантаження (гра): IDB-локальне + опубліковане, LWW по id ────────────────
export async function loadWorldsForGame(): Promise<WorldDoc[]> {
  let local: WorldDoc[] = [];
  try { const l = await idbGet<WorldDoc[]>('zag_worlds'); if (Array.isArray(l)) local = l; } catch { /* ignore */ }
  const remote = await fetchPublished<WorldDoc>('worlds.json', 'worlds');
  return mergeByIdLWW(local, remote).merged;
}

export async function loadLocationsForGame(): Promise<LocationDoc[]> {
  let local: LocationDoc[] = [];
  try { const l = await idbGet<LocationDoc[]>('zag_locations'); if (Array.isArray(l)) local = l; } catch { /* ignore */ }
  const remote = await fetchPublished<LocationDoc>('locations.json', 'locations');
  return mergeByIdLWW(local, remote).merged;
}

// LocationDoc для вузла карти: явний locationId, інакше збіг назви (label == name).
export function locationForNode(node: WorldNode, locs: LocationDoc[]): LocationDoc | null {
  if (node.locationId) { const d = locs.find((l) => l.id === node.locationId); if (d) return d; }
  const byName = locs.find((l) => l.name.trim().toLowerCase() === node.label.trim().toLowerCase());
  return byName ?? null;
}

// ── Позиція мандрів (де стоїть герой) — локально на пристрої ─────────────────
export interface TravelPos { worldId: string; nodeId: string }
const TRAVEL_KEY = 'zag_travel';

export function loadTravel(): TravelPos | null {
  try { const s = localStorage.getItem(TRAVEL_KEY); if (s) return JSON.parse(s) as TravelPos; } catch { /* ignore */ }
  return null;
}
export function saveTravel(p: TravelPos): void {
  try { localStorage.setItem(TRAVEL_KEY, JSON.stringify(p)); } catch { /* ignore */ }
}

// Глобальна карта = та, на яку не посилається жоден region-вузол інших карт
// (корінь дерева). Фолбек — перша в списку.
export function findGlobalWorld(worlds: WorldDoc[]): WorldDoc | null {
  if (!worlds.length) return null;
  const referenced = new Set<string>();
  for (const w of worlds) for (const n of w.nodes) if (n.type === 'region' && n.regionId) referenced.add(n.regionId);
  return worlds.find((w) => !referenced.has(w.id)) ?? worlds[0];
}
