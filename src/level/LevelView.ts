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
  parallax?: { bg: number; sky: number }; // «Дальність» 0..1: 0 = разом з картою, 1 = нерухоме
}

// шари: небо/фон/карта — позаду персонажа; декор/інтерактив/пастки — теж позаду (поки)
const LAYER: Record<string, number> = { sky: -1200, bg: -1100, map: -1000, decor: -300, interactive: -250, trap: -250 };
// Дефолтна дальність паралакса, якщо рівень її не задає: фон повільніше карти, небо ще повільніше.
const PARALLAX_FALLBACK: Record<string, number> = { bg: 0.5, sky: 0.8 };

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
    let depth = LAYER[p.cat] ?? -500;
    const fpp = fpMap.get(p.asset);
    if (fpp && p.cat !== 'sky' && p.cat !== 'bg' && p.cat !== 'map') {
      const cells = footprintWorldCells(fpp, { x: p.x, y: p.y, scale: p.scale, flip: p.flip, rot: p.rot }, p.x, p.y, gs);
      if (cells.length) depth = floorY + footprintFrontEditorY(cells, gs); // = gameY переднього краю
    }
    im.setDepth(depth);
    // Паралакс лише для неба й фону: scrollFactor < 1 → шар скролиться повільніше за камеру.
    if (p.cat === 'bg' || p.cat === 'sky') {
      const dist = doc.parallax?.[p.cat] ?? PARALLAX_FALLBACK[p.cat];
      im.setScrollFactor(Math.max(0, 1 - dist), 1);
    }
  }
}
