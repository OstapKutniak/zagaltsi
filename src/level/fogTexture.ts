import Phaser from 'phaser';

// Процедурна ТАЙЛОВАНА текстура туману: смуги + нойз + м'які краї. «Блюр» вбудований
// через багатооктавний value-noise з білінійною інтерполяцією (без пост-блюру, тож
// текстура лишається безшовно тайлованою). Один base-текстур; варіації для шарів —
// через tilePosition/tileScale у TileSprite (див. GameScene). Малюємо білим із alpha,
// колір шару накидається tint-ом.

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function lattice(nx: number, ny: number, rnd: () => number): number[] {
  const arr = new Array<number>(nx * ny);
  for (let i = 0; i < arr.length; i++) arr[i] = rnd();
  return arr;
}
const smooth = (t: number): number => t * t * (3 - 2 * t);

// Тайлований value-noise: решітка nx×ny, обгортка по модулю → безшовний край.
function sampleNoise(u: number, v: number, nx: number, ny: number, grid: number[]): number {
  const x = u * nx, y = v * ny;
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = smooth(x - x0), fy = smooth(y - y0);
  const i00 = (y0 % ny) * nx + (x0 % nx);
  const i10 = (y0 % ny) * nx + ((x0 + 1) % nx);
  const i01 = ((y0 + 1) % ny) * nx + (x0 % nx);
  const i11 = ((y0 + 1) % ny) * nx + ((x0 + 1) % nx);
  const a = grid[i00] + (grid[i10] - grid[i00]) * fx;
  const b = grid[i01] + (grid[i11] - grid[i01]) * fx;
  return a + (b - a) * fy;
}

// Реєструє текстуру туману в Phaser (один раз). w×h — степені 2 для чистого тайлу.
export function ensureFogTexture(scene: Phaser.Scene, key = 'fog_noise', w = 512, h = 256): void {
  if (scene.textures.exists(key)) return;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  const rnd = mulberry32(1337);
  // X-решітки МЕНШІ за Y → горизонтально витягнуті «клуби»/смуги. Числа — дільники
  // текстури (тайл лишається безшовним).
  const octaves = [
    { nx: 2,  ny: 6,  amp: 0.55 },
    { nx: 4,  ny: 12, amp: 0.28 },
    { nx: 8,  ny: 24, amp: 0.13 },
    { nx: 16, ny: 48, amp: 0.06 },
  ];
  const grids = octaves.map((o) => lattice(o.nx, o.ny, rnd));
  for (let y = 0; y < h; y++) {
    const v = y / h;
    for (let x = 0; x < w; x++) {
      const u = x / w;
      let n = 0;
      for (let o = 0; o < octaves.length; o++) n += sampleNoise(u, v, octaves[o].nx, octaves[o].ny, grids[o]) * octaves[o].amp;
      // Поріг + розмах + smoothstep → «клуби» туману з прозорими розривами (форма, не суцільна пелена).
      let a = (n - 0.42) / 0.4;
      a = Math.max(0, Math.min(1, a));
      a = a * a * (3 - 2 * a);
      const idx = (y * w + x) * 4;
      img.data[idx] = 255; img.data[idx + 1] = 255; img.data[idx + 2] = 255;
      img.data[idx + 3] = Math.round(a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  scene.textures.addCanvas(key, canvas);
}
