import Phaser from 'phaser';
import { footprintWorldCells, footprintFrontEditorY } from './footprint';

// Малює рівень (з редактора рівнів) у грі: тайли/фон/небо/декор як спрайти у світі.
// Координати рівня: x — уздовж рівня, y — від лінії землі (0 = підлога, де ноги).

export interface LevelPlaced { cat: string; asset: string; x: number; y: number; rot: number; scale: number; flip: number }
export interface LevelDoc {
  name?: string;
  placed: LevelPlaced[];
  assets: { id: string; url: string; footprint?: { cells: { dx: number; dy: number }[] } }[];
  spawn: { x: number; y: number };
  spawns?: { x: number; y: number }[]; // до 5 точок спавна (кооп); spawn = spawns[0] для сумісності
  start: number;
  end: number;
  collider?: string[];
  enemySpawns?: string[]; // зони спавна ворогів: "cx,cy" — кут 3×3 підлогових клітинок
  grid?: number;
  parallax?: Record<string, number>; // «Дальність» 0..1 per-шар
}

// Шари (depth) ззаду→наперед. Небо/хмари/задній фон/перед.фон/карта — позаду персонажа;
// ассети (decor/...) — біля карти; передній план — поверх усього (але під HUD ~10000).
const LAYER: Record<string, number> = {
  sky: -1400, clouds: -1300, bg: -1200, frontbg: -1100, map: -1000,
  decor: -300, collider: -300, interactive: -250, trap: -250, foreground: 5000,
};
// Дефолтна «дальність» паралакса, якщо рівень її не задає.
const PARALLAX_FALLBACK: Record<string, number> = { sky: 0.85, clouds: 0.7, bg: 0.5, frontbg: 0.25, foreground: 0.35 };
// scrollFactor шару: фонові повільніше карти (1−дальність), передній план швидше (1+дальність).
function layerScrollFactor(cat: string, dist: number): number {
  return cat === 'foreground' ? 1 + dist : Math.max(0, 1 - dist);
}

function loadTex(scene: Phaser.Scene, key: string, url: string): Promise<void> {
  return new Promise((res) => {
    if (scene.textures.exists(key)) { res(); return; }
    const img = new Image();
    img.onload = () => { if (!scene.textures.exists(key)) scene.textures.addImage(key, img); res(); };
    img.onerror = () => res();
    img.src = url;
  });
}

// Будує спрайти рівня. floorY — світова Y лінії підлоги (де стоять ноги).
export async function buildLevelView(scene: Phaser.Scene, doc: LevelDoc, floorY: number): Promise<void> {
  await Promise.all(doc.assets.map((a) => loadTex(scene, 'lvl_' + a.id, a.url)));
  const gs = doc.grid ?? 48;
  // Футпринти ассетів: глибина декору = передній край футпринта (а не фіксований шар),
  // щоб персонаж за деревом малювався позаду, а перед — попереду. Та сама ізо-математика.
  const fpMap = new Map<string, { cells: { dx: number; dy: number }[] }>();
  for (const a of doc.assets) if (a.footprint?.cells?.length) fpMap.set(a.id, a.footprint);
  for (const p of doc.placed) {
    const key = 'lvl_' + p.asset;
    if (!scene.textures.exists(key)) continue;
    const im = scene.add.image(p.x, floorY + p.y, key).setOrigin(0.5, 0.5);
    im.setRotation((p.rot * Math.PI) / 180);
    im.setScale(p.scale * p.flip, p.scale);
    const isBackdrop = p.cat === 'sky' || p.cat === 'clouds' || p.cat === 'bg' || p.cat === 'frontbg' || p.cat === 'map';
    let depth = LAYER[p.cat] ?? -500;
    const fpp = fpMap.get(p.asset);
    if (fpp && !isBackdrop) { // футпринт-глибина лише для ассетів (декор тощо), не для фонів/карти
      const cells = footprintWorldCells(fpp, { x: p.x, y: p.y, scale: p.scale, flip: p.flip, rot: p.rot }, p.x, p.y, gs);
      if (cells.length) depth = floorY + footprintFrontEditorY(cells, gs); // = gameY переднього краю
    }
    im.setDepth(depth);
    // Паралакс для шарів зі швидкістю, відмінною від карти (небо/хмари/задній/перед.фон/перед.план).
    // Анкер (зсув) застосовує GameScene після стабілізації камери — до ФАКТИЧНОЇ scrollX стартового
    // кадру (камера стоїть там, куди її ставить спавн+зум, не обов'язково на lv.start). Тут лише
    // тегаємо шар його sf і базовою X, щоб GameScene знав, що і як зсувати.
    if (p.cat in PARALLAX_FALLBACK) {
      const dist = doc.parallax?.[p.cat] ?? PARALLAX_FALLBACK[p.cat];
      const sf = layerScrollFactor(p.cat, dist);
      im.setScrollFactor(sf, 1);
      im.setData('plxSf', sf);
      im.setData('plxBaseX', p.x);
    }
  }
}
