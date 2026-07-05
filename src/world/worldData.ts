// Дані мандрів — СПІЛЬНІ типи карти світу/локацій для гри і редакторів.
// Джерело те саме, що в редакторів: IDB (zag_worlds / zag_locations) + опубліковані
// studio-data/worlds.json / locations.json, злиті LWW — тож усе, що ти правиш у
// редакторі Карти/Локацій, гра бачить одразу (локально) або після публікації (всюди).

import { idbGet } from '../store';
import { mergeByIdLWW } from '../sync';
import type { Atmosphere } from '../level/atmosphere';
import type { PlacedAnim, PlacedDeform } from '../level/LevelView';

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
  plan?: number;         // плановість 1..7 (3 = дефолт); більше — ближче
  anim?: PlacedAnim;     // обертання/дрейф (Редактор Локацій, як у Мандрах)
  deform?: PlacedDeform; // перспектива/FFD + кейфрейми
  transparent?: boolean; // фон-ассет редактора (у грі рендериться як звичайний)
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
