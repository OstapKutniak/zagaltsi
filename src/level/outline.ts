// Обводка/обрізка ассета по альфа-контуру. Працює і в редакторі (canvas), і в грі
// (бейкаємо в текстуру). Два взаємовиключні режими:
//   'stroke' — обводка «з центру» (як у Photoshop Stroke: Center): чорна смуга
//              шириною width, що лягає по контуру в ОБИДВА боки (всередину і назовні).
//   'erode'  — навпаки, зрізає width пікселів зовнішнього краю (додає прозорість по контуру).

export interface OutlineMod {
  mode: 'stroke' | 'erode';
  width: number;
  color?: string;      // stroke: колір обводки; erode: цільовий колір, який зрізаємо
  threshold?: number;  // erode: поріг схожості кольору (0..255 евклідова відстань у RGB)
}

function parseHex(hex: string): [number, number, number] {
  const h = (hex || '#000000').replace('#', '').padStart(6, '0');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

type Drawable = HTMLImageElement | HTMLCanvasElement;

function mkCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas'); c.width = Math.max(1, w); c.height = Math.max(1, h); return c;
}

const NEIGH: Array<[number, number]> = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];

// Нарощує непрозору область на n пікселів (8-зв'язно), зберігаючи кольори стемпінгом.
function dilate(src: HTMLCanvasElement, n: number): HTMLCanvasElement {
  let cur = src;
  for (let k = 0; k < n; k++) {
    const c = mkCanvas(cur.width, cur.height); const x = c.getContext('2d')!;
    x.drawImage(cur, 0, 0);
    for (const [dx, dy] of NEIGH) x.drawImage(cur, dx, dy);
    cur = c;
  }
  return cur;
}

// Стискає непрозору область на n пікселів: лишає піксель, лише якщо всі сусіди теж непрозорі.
function erode(src: HTMLCanvasElement, n: number): HTMLCanvasElement {
  let cur = src;
  for (let k = 0; k < n; k++) {
    const c = mkCanvas(cur.width, cur.height); const x = c.getContext('2d')!;
    x.drawImage(cur, 0, 0);
    x.globalCompositeOperation = 'destination-in';
    for (const [dx, dy] of NEIGH) x.drawImage(cur, dx, dy);
    cur = c;
  }
  return cur;
}

// Силует одним кольором (альфа з src, колір суцільний).
function silhouette(src: Drawable, w: number, h: number, color: string): HTMLCanvasElement {
  const c = mkCanvas(w, h); const x = c.getContext('2d')!;
  x.drawImage(src, 0, 0);
  x.globalCompositeOperation = 'source-in';
  x.fillStyle = color; x.fillRect(0, 0, w, h);
  return c;
}

// Повертає НОВИЙ канвас із застосованою обводкою/обрізкою. Для 'stroke' канвас більший
// (симетричний паддінг), але центр збігається з оригіналом — тож при центрованому
// рендері (origin 0.5) обводка лягає рівно навколо.
export function bakeOutline(src: Drawable, mod: OutlineMod): HTMLCanvasElement {
  const w = src.width, h = src.height;
  const width = Math.max(0, mod.width);
  const color = mod.color ?? '#000000';
  if (width <= 0) { const c = mkCanvas(w, h); c.getContext('2d')!.drawImage(src, 0, 0); return c; }

  if (mod.mode === 'stroke') {
    const half = Math.max(1, Math.round(width / 2));
    const pad = half + 2;
    const PW = w + pad * 2, PH = h + pad * 2;
    const base = mkCanvas(PW, PH); base.getContext('2d')!.drawImage(src, pad, pad);
    const sil = silhouette(base, PW, PH, color);
    const outer = dilate(sil, half);        // чорний, нарощений назовні на half (і покриває нутро)
    const inner = erode(base, half);        // оригінал, стиснутий на half
    const out = mkCanvas(PW, PH); const x = out.getContext('2d')!;
    x.drawImage(outer, 0, 0);
    x.drawImage(inner, 0, 0);
    return out;
  }
  // erode: зрізаємо зовнішні пікселі, але ЛИШЕ ті, що збігаються з цільовим кольором у межах
  // порога. Пошарове «обчищення» країв: матч-пікселі на краю стають прозорими, інші (трава тощо)
  // зупиняють обчищення й захищають усе за ними. Так зрізається жирна чорна обводка, а не трава.
  const W = w, H = h;
  const c = mkCanvas(W, H); const x = c.getContext('2d')!;
  x.drawImage(src, 0, 0);
  const id = x.getImageData(0, 0, W, H); const d = id.data;
  const [tr, tg, tb] = parseHex(color);
  const thr = Math.max(0, mod.threshold ?? 60);
  const thr2 = thr * thr;
  const aOf = (px: number, py: number): number => (px < 0 || px >= W || py < 0 || py >= H) ? 0 : d[(py * W + px) * 4 + 3];
  const iters = Math.max(1, Math.round(width));
  for (let it = 0; it < iters; it++) {
    const clear: number[] = [];
    for (let py = 0; py < H; py++) {
      for (let px = 0; px < W; px++) {
        const o = (py * W + px) * 4;
        if (d[o + 3] <= 16) continue;                       // вже прозорий
        // край = має прозорого 4-сусіда
        if (aOf(px - 1, py) > 16 && aOf(px + 1, py) > 16 && aOf(px, py - 1) > 16 && aOf(px, py + 1) > 16) continue;
        const dr = d[o] - tr, dg = d[o + 1] - tg, db = d[o + 2] - tb;
        if (dr * dr + dg * dg + db * db <= thr2) clear.push(o);
      }
    }
    if (!clear.length) break;
    for (const o of clear) d[o + 3] = 0;
  }
  // Антиаліас нового краю: зменшуємо альфу пропорційно кількості прозорих сусідів,
  // щоб зріз був м'яким, а не «сходинками».
  const a0 = new Uint8ClampedArray(W * H);
  for (let i = 0; i < W * H; i++) a0[i] = d[i * 4 + 3];
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const i = py * W + px; if (a0[i] <= 16) continue;
      let tc = 0, tot = 0;
      for (let ny = -1; ny <= 1; ny++) for (let nx = -1; nx <= 1; nx++) {
        if (!nx && !ny) continue; const qx = px + nx, qy = py + ny;
        if (qx < 0 || qx >= W || qy < 0 || qy >= H) continue;
        tot++; if (a0[qy * W + qx] <= 16) tc++;
      }
      if (tc > 0) d[i * 4 + 3] = Math.round(a0[i] * (1 - 0.55 * (tc / Math.max(1, tot))));
    }
  }
  x.putImageData(id, 0, 0);
  return c;
}

// Ключ кешу/текстури за модифікатором.
export function outlineKey(mod: OutlineMod): string {
  return `o_${mod.mode}_${Math.round(mod.width)}_${(mod.color ?? '#000000').replace('#', '')}_${Math.round(mod.threshold ?? 60)}`;
}
