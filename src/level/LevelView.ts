import Phaser from 'phaser';
import { footprintWorldCells, footprintFrontEditorY } from './footprint';
import type { Atmosphere } from './atmosphere';

// Малює рівень (з редактора рівнів) у грі: тайли/фон/небо/декор як спрайти у світі.
// Координати рівня: x — уздовж рівня, y — від лінії землі (0 = підлога, де ноги).

// Проста анімація розміщеного ассета (вітряк крутиться, хмара пливе тощо).
export interface PlacedAnim {
  type: 'rotate' | 'move';
  speed: number;        // обертання — град/с; переміщення — од/с
  range?: number;       // обертання: діапазон кута (град). >=360 → безперервне; менше → туди-сюди 0..range
  dx?: number; dy?: number; // переміщення: напрям (нормалізований вектор із лінії)
  dist?: number;        // переміщення: діапазон туди-сюди (од). 0 → постійний дрейф (constant)
  constant?: boolean;   // переміщення: постійний рух в один бік (інакше — туди-сюди в межах dist)
}

// Деформація ассета як модифікатор (накидається поверх геометрії; анімація крутить готову деформацію).
export interface PlacedDeform {
  type: 'persp' | 'ffd';
  // persp: зсуви кутів від дефолтної позиції, у пікселях зображення
  // порядок: [dx_TL,dy_TL, dx_TR,dy_TR, dx_BR,dy_BR, dx_BL,dy_BL]
  corners?: number[];
  // ffd: кількість поділів по горизонталі та вертикалі
  cols?: number;
  rows?: number;
  // ffd: зсуви опорних точок (cols+1)*(rows+1)*2, рядковий порядок, кожна пара (dx,dy) у пікселях
  pts?: number[];
  // якість рендеру: N×N квадів на все зображення (за замовчуванням 12)
  subdiv?: number;
}

// Бінарний біліній від UV (t,s)∈[0,1]² до деформованої локальної позиції (пікселі зображення, центр 0,0).
export function deformImgPt(deform: PlacedDeform, W: number, H: number, t: number, s: number): { x: number; y: number } {
  const lerp = (a: number, b: number, f: number) => a + (b - a) * f;
  if (deform.type === 'persp') {
    const c = deform.corners ?? [0, 0, 0, 0, 0, 0, 0, 0];
    const tlx = -W / 2 + (c[0] ?? 0), tly = -H / 2 + (c[1] ?? 0);
    const trx = W / 2 + (c[2] ?? 0), tryy = -H / 2 + (c[3] ?? 0);
    const brx = W / 2 + (c[4] ?? 0), bry = H / 2 + (c[5] ?? 0);
    const blx = -W / 2 + (c[6] ?? 0), bly = H / 2 + (c[7] ?? 0);
    return {
      x: lerp(lerp(tlx, trx, t), lerp(blx, brx, t), s),
      y: lerp(lerp(tly, tryy, t), lerp(bly, bry, t), s),
    };
  }
  // FFD: розбивка на (cols+1)×(rows+1) опорних точок
  const cols = deform.cols ?? 2, rows = deform.rows ?? 2;
  const pts = deform.pts;
  const gci = Math.min(Math.floor(t * cols), cols - 1);
  const gcj = Math.min(Math.floor(s * rows), rows - 1);
  const lt = t * cols - gci, ls = s * rows - gcj;
  const cp = (ci: number, cj: number): { x: number; y: number } => {
    const pi = (cj * (cols + 1) + ci) * 2;
    return { x: -W / 2 + ci * W / cols + (pts?.[pi] ?? 0), y: -H / 2 + cj * H / rows + (pts?.[pi + 1] ?? 0) };
  };
  const tl = cp(gci, gcj), tr = cp(gci + 1, gcj), bl = cp(gci, gcj + 1), br = cp(gci + 1, gcj + 1);
  return {
    x: lerp(lerp(tl.x, tr.x, lt), lerp(bl.x, br.x, lt), ls),
    y: lerp(lerp(tl.y, tr.y, lt), lerp(bl.y, br.y, lt), ls),
  };
}

// Зсув анімації в момент t (секунди). rot — у градусах; dx/dy — у світових одиницях.
// Спільна для гри й живого прев'ю редактора, щоб рух збігався.
export function animOffset(anim: PlacedAnim, t: number): { rot: number; dx: number; dy: number } {
  const tri = (ph: number, period: number, amp: number): number => {
    const half = period / 2; const x = ((ph % period) + period) % period;
    return x < half ? (x / half) * amp : amp - ((x - half) / half) * amp; // 0→amp→0
  };
  if (anim.type === 'rotate') {
    const range = anim.range ?? 360;
    const spd = Math.max(0.0001, anim.speed);
    if (range >= 360) return { rot: (spd * t) % 360, dx: 0, dy: 0 };
    return { rot: tri(spd * t, 2 * range, range), dx: 0, dy: 0 }; // коливання 0..range
  }
  const dx = anim.dx ?? 1, dy = anim.dy ?? 0;
  const spd = Math.max(0.0001, anim.speed);
  if (anim.constant || !anim.dist) { const off = spd * t; return { rot: 0, dx: dx * off, dy: dy * off }; }
  const d = tri(spd * t, 2 * anim.dist, anim.dist); // туди-сюди в межах dist
  return { rot: 0, dx: dx * d, dy: dy * d };
}

export interface LevelPlaced { cat: string; asset: string; x: number; y: number; rot: number; scale: number; flip: number; plan?: number; anim?: PlacedAnim; deform?: PlacedDeform }
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
  atmosphere?: Atmosphere;
}

// Шари (depth) ззаду→наперед. Небо/хмари/задній фон/перед.фон/карта — позаду персонажа;
// ассети (decor/...) — біля карти; передній план — поверх усього (але під HUD ~10000).
const LAYER: Record<string, number> = {
  sky: -1400, clouds: -1300, bg: -1200, frontbg: -1100, map: -1000,
  decor: -300, collider: -300, interactive: -250, trap: -250, foreground: 5000,
};
// Дефолтна «дальність» паралакса, якщо рівень її не задає.
const PARALLAX_FALLBACK: Record<string, number> = { sky: 0.85, clouds: 0.7, bg: 0.5, frontbg: 0.25, foreground: 0.35 };
// Крок дальності на одиницю поассетної планарності (±). Має бути спільним із редактором.
export const PLAN_DIST_STEP = 0.04;
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
    // Деформований ассет — Phaser Mesh для довільної форми у WebGL.
    let go: Phaser.GameObjects.Image;
    if (p.deform) {
      const frame = scene.textures.get(key).get();
      const W = frame.realWidth, H = frame.realHeight;
      const N = p.deform.subdiv ?? 12;
      const verts: number[] = [], uvs: number[] = [], idx: number[] = [];
      for (let row = 0; row <= N; row++) {
        for (let col = 0; col <= N; col++) {
          const t = col / N, s = row / N;
          const pos = deformImgPt(p.deform, W, H, t, s);
          // Негуємо y: image-space (y↓) → OpenGL/Phaser Mesh (y↑)
          verts.push(pos.x * p.scale * p.flip, -pos.y * p.scale);
          uvs.push(t, s);
        }
      }
      for (let row = 0; row < N; row++) {
        for (let col = 0; col < N; col++) {
          const i = row * (N + 1) + col;
          idx.push(i, i + 1, i + N + 1, i + 1, i + N + 2, i + N + 1);
        }
      }
      const mesh = scene.add.mesh(p.x, floorY + p.y, key);
      mesh.hideCCW = false;
      mesh.setOrtho(mesh.width, mesh.height); // вершини 1:1 до піксельних координат
      mesh.setRotation((p.rot * Math.PI) / 180);
      mesh.addVertices(verts, uvs, idx, false);
      go = mesh as unknown as Phaser.GameObjects.Image;
    } else {
      const im = scene.add.image(p.x, floorY + p.y, key).setOrigin(0.5, 0.5);
      im.setRotation((p.rot * Math.PI) / 180);
      im.setScale(p.scale * p.flip, p.scale);
      go = im;
    }
    const isBackdrop = p.cat === 'sky' || p.cat === 'clouds' || p.cat === 'bg' || p.cat === 'frontbg' || p.cat === 'map';
    let depth = LAYER[p.cat] ?? -500;
    const fpp = fpMap.get(p.asset);
    if (fpp && !isBackdrop) { // футпринт-глибина лише для ассетів (декор тощо), не для фонів/карти
      const cells = footprintWorldCells(fpp, { x: p.x, y: p.y, scale: p.scale, flip: p.flip, rot: p.rot }, p.x, p.y, gs);
      if (cells.length) depth = floorY + footprintFrontEditorY(cells, gs); // = gameY переднього краю
    }
    // Поассетна планарність: у межах шару ассет із більшим plan — ближче (вище в стосі).
    if (p.plan) go.setDepth(depth + p.plan * 0.5);
    else go.setDepth(depth);
    // Паралакс для шарів зі швидкістю, відмінною від карти (небо/хмари/задній/перед.фон/перед.план).
    if (p.cat in PARALLAX_FALLBACK) {
      let dist = doc.parallax?.[p.cat] ?? PARALLAX_FALLBACK[p.cat];
      if (p.plan) dist += (p.cat === 'foreground' ? +1 : -1) * p.plan * PLAN_DIST_STEP;
      dist = Math.max(0, Math.min(0.98, dist));
      const sf = layerScrollFactor(p.cat, dist);
      go.setScrollFactor(sf, 1);
      go.setData('plxSf', sf);
      go.setData('plxBaseX', p.x);
    }
    if (p.anim) go.setData('lvlAnim', p.anim); // GameScene програє ці анімації в update()
  }
}
