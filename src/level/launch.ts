import { idbGet, idbSet } from '../store';

// Запуск рівня за id (для подорожі по ребру карти): знаходить рівень у сховищі
// редактора (IDB zag_levels → опублікований level-layouts.json), збирає той самий
// LevelDoc, що й «Зберегти рівень у гру» в редакторі (з ассетами по використанню),
// і кладе в IDB 'zag_level' — GameScene читає його першим.

interface EdLevel {
  id?: string; name: string; placed: { asset: string }[]; collider: string[];
  enemySpawns: string[]; neutralSpawns: string[]; spawn: { x: number; y: number };
  spawns: { x: number; y: number }[]; start: number; end: number; grid: number;
  parallax: Record<string, number>; atmosphere?: unknown; camZones?: unknown[];
}
interface EdAsset { id: string; cat: string; name: string; url: string }
interface LevelStore { levels: EdLevel[]; cur: number }

const PARALLAX_DEFAULTS: Record<string, number> = { sky: 0.85, clouds: 0.7, bg: 0.5, frontbg: 0.25, foreground: 0.35 };

async function loadStore(): Promise<LevelStore | null> {
  const local = await idbGet<LevelStore>('zag_levels').catch(() => null);
  if (local?.levels?.length) return local;
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}studio-data/level-layouts.json`);
    if (r.ok) return await r.json() as LevelStore;
  } catch { /* ignore */ }
  return local;
}

async function loadAssets(): Promise<EdAsset[]> {
  const local = await idbGet<EdAsset[]>('zag_assets').catch(() => null);
  if (local?.length) return local;
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}studio-data/level-assets.json`);
    if (r.ok) return await r.json() as EdAsset[];
  } catch { /* ignore */ }
  return local ?? [];
}

// Готує рівень levelId у слот гри. Повертає true якщо знайшли й підклали;
// false → рівня нема, GameScene зіграє те, що вже лежить у zag_level (тест-рівень).
export async function stageLevelById(levelId: string | undefined | null): Promise<boolean> {
  if (!levelId) return false;
  const store = await loadStore();
  const lv = store?.levels?.find((l) => l.id === levelId || 'L:' + l.name === levelId);
  if (!lv) return false;
  const assets = await loadAssets();
  const used = assets.filter((a) => lv.placed.some((p) => p.asset === a.id));
  const doc: Record<string, unknown> = {
    name: lv.name, placed: lv.placed, collider: lv.collider,
    enemySpawns: lv.enemySpawns ?? [], neutralSpawns: lv.neutralSpawns ?? [],
    grid: lv.grid ?? 32, spawn: lv.spawns?.[0] ?? lv.spawn, spawns: lv.spawns ?? [lv.spawn],
    start: lv.start, end: lv.end, parallax: lv.parallax ?? { ...PARALLAX_DEFAULTS }, assets: used,
  };
  if (lv.atmosphere) doc.atmosphere = lv.atmosphere;
  if (lv.camZones?.length) doc.camZones = lv.camZones;
  await idbSet('zag_level', doc);
  return true;
}
