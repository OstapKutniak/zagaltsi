// Обводка/обрізка ассета по альфа-контуру. Працює і в редакторі (canvas), і в грі
// (бейкаємо в текстуру). Два взаємовиключні режими:
//   'stroke' — обводка «з центру» (як у Photoshop Stroke: Center): чорна смуга
//              шириною width, що лягає по контуру в ОБИДВА боки (всередину і назовні).
//   'erode'  — навпаки, зрізає width пікселів зовнішнього краю (додає прозорість по контуру).

export interface OutlineMod { mode: 'stroke' | 'erode'; width: number; color?: string }

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
  // erode: зрізаємо зовнішні width px
  return erode((() => { const c = mkCanvas(w, h); c.getContext('2d')!.drawImage(src, 0, 0); return c; })(), Math.max(1, Math.round(width)));
}

// Ключ кешу/текстури за модифікатором.
export function outlineKey(mod: OutlineMod): string {
  return `o_${mod.mode}_${Math.round(mod.width)}_${(mod.color ?? '#000000').replace('#', '')}`;
}
