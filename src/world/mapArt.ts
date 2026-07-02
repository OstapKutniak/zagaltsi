// Процедурний арт «старої мапи» — пергамент, чорнильні іконки локацій, гори/ліси,
// компас. Стиль під DD1/гру: товсті нерівні чорні контури + штриховка, вицвілий
// пергамент. Малюємо Canvas2D і віддаємо канви — сцена реєструє їх як текстури.

const INK = '#231a12';       // основне чорнило
const INK_SOFT = '#3a2d20';  // світліше чорнило для штриховки

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Пергамент ─────────────────────────────────────────────────────────────────
export function parchmentCanvas(w: number, h: number, seed = 7): HTMLCanvasElement {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d')!;
  const r = rng(seed);
  // База — теплий пергамент з легким вертикальним градієнтом
  const g = x.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#cfbd97'); g.addColorStop(0.5, '#d6c6a2'); g.addColorStop(1, '#c4b088');
  x.fillStyle = g; x.fillRect(0, 0, w, h);
  // Великі бліді плями (вода/вік)
  for (let i = 0; i < 26; i++) {
    const px = r() * w, py = r() * h, pr = 40 + r() * 160;
    const grad = x.createRadialGradient(px, py, 0, px, py, pr);
    const dark = r() < 0.5;
    grad.addColorStop(0, dark ? 'rgba(120,95,60,0.10)' : 'rgba(255,244,214,0.10)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = grad; x.fillRect(px - pr, py - pr, pr * 2, pr * 2);
  }
  // Дрібне зерно
  const img = x.getImageData(0, 0, w, h);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (r() - 0.5) * 14;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  x.putImageData(img, 0, 0);
  // Темні цятки-крапки (мушки віку)
  x.fillStyle = 'rgba(70,50,30,0.35)';
  for (let i = 0; i < 90; i++) { const s = r() * 1.8 + 0.4; x.fillRect(r() * w, r() * h, s, s); }
  // Віньєтка — потемніння до країв
  const vg = x.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.36, w / 2, h / 2, Math.max(w, h) * 0.72);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(60,40,20,0.42)');
  x.fillStyle = vg; x.fillRect(0, 0, w, h);
  // Обпалений нерівний край: темна кайма з шумом
  x.strokeStyle = 'rgba(45,30,15,0.55)'; x.lineWidth = 10;
  x.beginPath();
  const step = 26;
  const edge = (fx: (t: number) => number, fy: (t: number) => number): void => {
    for (let t = 0; t <= 1.0001; t += step / (2 * (w + h))) {
      const px = fx(t) + (r() - 0.5) * 7, py = fy(t) + (r() - 0.5) * 7;
      if (t === 0) x.moveTo(px, py); else x.lineTo(px, py);
    }
  };
  edge((t) => t * w, () => 3); edge(() => w - 3, (t) => t * h);
  edge((t) => w - t * w, () => h - 3); edge(() => 3, (t) => h - t * h);
  x.stroke();
  return c;
}

// ── Хелпери чорнила ───────────────────────────────────────────────────────────
type Ctx = CanvasRenderingContext2D;
function inkStroke(x: Ctx, wPx = 2.6): void {
  x.strokeStyle = INK; x.lineWidth = wPx; x.lineCap = 'round'; x.lineJoin = 'round';
}
// Штриховка області: похилі короткі лінії всередині clip-контуру (виклик між save/restore)
function hatch(x: Ctx, x0: number, y0: number, x1: number, y1: number, gap = 5, ang = -0.6): void {
  x.strokeStyle = INK_SOFT; x.lineWidth = 1.1;
  const dx = Math.cos(ang), dy = Math.sin(ang);
  const diag = Math.hypot(x1 - x0, y1 - y0);
  for (let o = -diag; o < diag; o += gap) {
    x.beginPath();
    x.moveTo(x0 + o * dy, y0 - o * dx);
    x.lineTo(x0 + o * dy + dx * diag * 2, y0 - o * dx + dy * diag * 2);
    x.stroke();
  }
}

// Хатка з двосхилим дахом (використовують village/tavern/mill/sunken)
function hut(x: Ctx, cx: number, groundY: number, w: number, h: number): void {
  const x0 = cx - w / 2, y0 = groundY - h;
  // стіни
  x.save();
  x.beginPath(); x.rect(x0, y0, w, h); x.clip();
  hatch(x, x0, y0, x0 + w, y0 + h, 6, -0.5);
  x.restore();
  inkStroke(x); x.strokeRect(x0, y0, w, h);
  // дах (виступає)
  x.fillStyle = INK;
  x.beginPath();
  x.moveTo(x0 - w * 0.14, y0);
  x.lineTo(cx, y0 - h * 0.72);
  x.lineTo(x0 + w * 1.14, y0);
  x.closePath();
  x.stroke();
  x.save(); x.clip();
  hatch(x, x0 - w * 0.2, y0 - h, x0 + w * 1.2, y0, 4, 0.65);
  x.restore();
  // двері
  x.strokeRect(cx - w * 0.12, groundY - h * 0.45, w * 0.24, h * 0.45);
}

// ── Іконки локацій (канва size×size, прозорий фон) ────────────────────────────
export type MapIconKind =
  | 'village' | 'mill' | 'oak' | 'well' | 'tavern' | 'hives'
  | 'reeds' | 'sunken' | 'chapel' | 'bog' | 'mound' | 'spot';

export function locationIcon(kind: MapIconKind, size = 108, seed = 3): HTMLCanvasElement {
  const c = document.createElement('canvas'); c.width = size; c.height = size;
  const x = c.getContext('2d')!;
  const r = rng(seed + kind.length * 17);
  const G = size * 0.86; // лінія землі
  const M = size / 2;
  inkStroke(x);
  // земля — нерівна лінія
  x.beginPath();
  x.moveTo(size * 0.06, G);
  for (let i = 1; i <= 8; i++) x.lineTo(size * 0.06 + (i / 8) * size * 0.88, G + (r() - 0.5) * 3);
  x.stroke();

  switch (kind) {
    case 'village': {
      hut(x, M - size * 0.2, G, size * 0.3, size * 0.26);
      hut(x, M + size * 0.22, G, size * 0.36, size * 0.32);
      // тин
      inkStroke(x, 1.6);
      for (let i = 0; i < 4; i++) { const fx = size * 0.08 + i * size * 0.055; x.beginPath(); x.moveTo(fx, G); x.lineTo(fx, G - size * 0.09); x.stroke(); }
      x.beginPath(); x.moveTo(size * 0.06, G - size * 0.05); x.lineTo(size * 0.28, G - size * 0.07); x.stroke();
      break;
    }
    case 'mill': {
      hut(x, M, G, size * 0.3, size * 0.34);
      // крила вітряка
      inkStroke(x, 2.8);
      const hy = G - size * 0.58;
      for (const a of [0.6, 2.17, 3.74, 5.31]) {
        x.beginPath(); x.moveTo(M, hy);
        x.lineTo(M + Math.cos(a) * size * 0.3, hy + Math.sin(a) * size * 0.3);
        x.stroke();
      }
      x.beginPath(); x.arc(M, hy, size * 0.035, 0, Math.PI * 2); x.fillStyle = INK; x.fill();
      break;
    }
    case 'oak': {
      // стовбур з дуплом
      inkStroke(x, 3);
      x.beginPath(); x.moveTo(M - size * 0.07, G); x.quadraticCurveTo(M - size * 0.09, G - size * 0.3, M - size * 0.13, G - size * 0.44); x.stroke();
      x.beginPath(); x.moveTo(M + size * 0.07, G); x.quadraticCurveTo(M + size * 0.09, G - size * 0.3, M + size * 0.13, G - size * 0.44); x.stroke();
      // крона — купа горбиків
      x.beginPath();
      const cy = G - size * 0.56;
      x.arc(M - size * 0.2, cy + size * 0.06, size * 0.14, Math.PI * 0.4, Math.PI * 1.5);
      x.arc(M, cy - size * 0.1, size * 0.17, Math.PI * 0.8, Math.PI * 2.15);
      x.arc(M + size * 0.2, cy + size * 0.06, size * 0.14, Math.PI * 1.5, Math.PI * 0.7);
      x.closePath(); x.stroke();
      x.save(); x.clip();
      hatch(x, M - size * 0.42, cy - size * 0.32, M + size * 0.42, cy + size * 0.24, 5, -0.5);
      x.restore();
      // дупло
      x.fillStyle = INK;
      x.beginPath(); x.ellipse(M, G - size * 0.22, size * 0.045, size * 0.07, 0, 0, Math.PI * 2); x.fill();
      break;
    }
    case 'well': {
      // зруб
      inkStroke(x);
      x.strokeRect(M - size * 0.16, G - size * 0.18, size * 0.32, size * 0.18);
      x.save(); x.beginPath(); x.rect(M - size * 0.16, G - size * 0.18, size * 0.32, size * 0.18); x.clip();
      hatch(x, M - size * 0.2, G - size * 0.2, M + size * 0.2, G, 5, 0);
      x.restore();
      // журавель
      inkStroke(x, 2.6);
      x.beginPath(); x.moveTo(M + size * 0.26, G); x.lineTo(M + size * 0.26, G - size * 0.5); x.stroke();
      x.beginPath(); x.moveTo(M + size * 0.4, G - size * 0.34); x.lineTo(M - size * 0.14, G - size * 0.62); x.stroke();
      x.beginPath(); x.moveTo(M - size * 0.1, G - size * 0.6); x.lineTo(M - size * 0.1, G - size * 0.3); x.stroke();
      x.strokeRect(M - size * 0.14, G - size * 0.3, size * 0.08, size * 0.08);
      break;
    }
    case 'tavern': {
      hut(x, M, G, size * 0.44, size * 0.34);
      // вивіска-кухоль на кронштейні
      inkStroke(x, 2);
      x.beginPath(); x.moveTo(M + size * 0.28, G - size * 0.5); x.lineTo(M + size * 0.42, G - size * 0.5); x.stroke();
      x.strokeRect(M + size * 0.33, G - size * 0.48, size * 0.09, size * 0.11);
      break;
    }
    case 'hives': {
      // дві колоди-вулики + летючі бджоли-крапки
      for (const [dx, s] of [[-0.18, 0.24], [0.16, 0.3]] as const) {
        const bx = M + size * dx, bw = size * s, bh = size * s * 1.15;
        inkStroke(x);
        x.beginPath();
        x.moveTo(bx - bw / 2, G);
        x.quadraticCurveTo(bx - bw / 2, G - bh, bx, G - bh);
        x.quadraticCurveTo(bx + bw / 2, G - bh, bx + bw / 2, G);
        x.stroke();
        x.beginPath(); x.moveTo(bx - bw / 2, G - bh * 0.4); x.lineTo(bx + bw / 2, G - bh * 0.4); x.stroke();
        x.fillStyle = INK; x.beginPath(); x.arc(bx, G - bh * 0.22, size * 0.02, 0, Math.PI * 2); x.fill();
      }
      x.fillStyle = INK;
      for (let i = 0; i < 5; i++) x.fillRect(M - size * 0.3 + r() * size * 0.6, G - size * 0.75 + r() * size * 0.25, 2, 2);
      break;
    }
    case 'reeds': {
      inkStroke(x, 2);
      for (let i = 0; i < 7; i++) {
        const bx = size * 0.2 + i * size * 0.1, bh = size * (0.3 + r() * 0.25);
        const sway = (r() - 0.5) * size * 0.1;
        x.beginPath(); x.moveTo(bx, G); x.quadraticCurveTo(bx + sway, G - bh * 0.6, bx + sway * 1.6, G - bh); x.stroke();
        if (i % 2 === 0) { x.fillStyle = INK; x.beginPath(); x.ellipse(bx + sway * 1.6, G - bh, size * 0.02, size * 0.06, sway * 0.02, 0, Math.PI * 2); x.fill(); }
      }
      // вода
      inkStroke(x, 1.4);
      for (let i = 0; i < 3; i++) { x.beginPath(); x.moveTo(size * (0.15 + i * 0.2), G + 5 + i); x.lineTo(size * (0.3 + i * 0.2), G + 5 + i); x.stroke(); }
      break;
    }
    case 'sunken': {
      // хата по вікна у воді, похилена
      x.save(); x.translate(M, G); x.rotate(-0.08);
      hut(x, 0, 6, size * 0.4, size * 0.34);
      x.restore();
      // вода поверх низу
      x.fillStyle = 'rgba(35,26,18,0.28)';
      x.fillRect(size * 0.06, G - size * 0.07, size * 0.88, size * 0.1);
      inkStroke(x, 1.6);
      for (let i = 0; i < 4; i++) { x.beginPath(); x.moveTo(size * (0.1 + i * 0.22), G - 2 + (i % 2) * 3); x.lineTo(size * (0.22 + i * 0.22), G - 2 + (i % 2) * 3); x.stroke(); }
      break;
    }
    case 'chapel': {
      // банька на палях
      inkStroke(x, 2.4);
      for (const dx of [-0.16, 0, 0.16]) { x.beginPath(); x.moveTo(M + size * dx, G); x.lineTo(M + size * dx, G - size * 0.14); x.stroke(); }
      inkStroke(x);
      x.strokeRect(M - size * 0.2, G - size * 0.42, size * 0.4, size * 0.28);
      x.save(); x.beginPath(); x.rect(M - size * 0.2, G - size * 0.42, size * 0.4, size * 0.28); x.clip();
      hatch(x, M - size * 0.24, G - size * 0.46, M + size * 0.24, G - size * 0.1, 6, -0.55);
      x.restore();
      // банька-цибулина + хрест
      x.beginPath();
      x.moveTo(M - size * 0.1, G - size * 0.42);
      x.quadraticCurveTo(M - size * 0.13, G - size * 0.58, M, G - size * 0.64);
      x.quadraticCurveTo(M + size * 0.13, G - size * 0.58, M + size * 0.1, G - size * 0.42);
      x.stroke();
      inkStroke(x, 2);
      x.beginPath(); x.moveTo(M, G - size * 0.64); x.lineTo(M, G - size * 0.78); x.stroke();
      x.beginPath(); x.moveTo(M - size * 0.05, G - size * 0.73); x.lineTo(M + size * 0.05, G - size * 0.73); x.stroke();
      break;
    }
    case 'bog': {
      // купини + коряга + бульбашки
      inkStroke(x, 2);
      for (const [dx, s] of [[-0.28, 0.1], [-0.02, 0.13], [0.26, 0.09]] as const) {
        x.beginPath(); x.arc(M + size * dx, G, size * s, Math.PI, 0); x.stroke();
        // трава на купині
        for (let i = -1; i <= 1; i++) {
          x.beginPath(); x.moveTo(M + size * dx + i * 4, G - size * s);
          x.lineTo(M + size * dx + i * 6, G - size * s - size * 0.07); x.stroke();
        }
      }
      inkStroke(x, 2.6);
      x.beginPath(); x.moveTo(size * 0.14, G - size * 0.05); x.quadraticCurveTo(size * 0.3, G - size * 0.3, size * 0.22, G - size * 0.4); x.stroke();
      inkStroke(x, 1.3);
      for (let i = 0; i < 3; i++) { x.beginPath(); x.arc(M + size * (0.1 + i * 0.08), G + 4, 2 + i, 0, Math.PI * 2); x.stroke(); }
      break;
    }
    case 'mound': {
      // курган зі стовпом-дідом
      inkStroke(x);
      x.beginPath(); x.arc(M, G, size * 0.3, Math.PI, 0); x.stroke();
      x.save(); x.beginPath(); x.arc(M, G, size * 0.3, Math.PI, 0); x.lineTo(M + size * 0.3, G); x.clip();
      hatch(x, M - size * 0.32, G - size * 0.32, M + size * 0.32, G, 5.5, -0.5);
      x.restore();
      inkStroke(x, 3);
      x.beginPath(); x.moveTo(M, G - size * 0.3); x.lineTo(M, G - size * 0.62); x.stroke();
      // «плечі» стовпа-діда і зарубка-обличчя
      inkStroke(x, 2.2);
      x.beginPath(); x.moveTo(M - size * 0.08, G - size * 0.52); x.lineTo(M + size * 0.08, G - size * 0.52); x.stroke();
      x.beginPath(); x.arc(M, G - size * 0.58, size * 0.035, 0, Math.PI * 2); x.stroke();
      break;
    }
    default: { // 'spot' — просто позначка-хрестик
      inkStroke(x, 2.6);
      x.beginPath(); x.moveTo(M - 7, G - 14); x.lineTo(M + 7, G); x.stroke();
      x.beginPath(); x.moveTo(M + 7, G - 14); x.lineTo(M - 7, G); x.stroke();
    }
  }
  return c;
}

// Евристика: іконка з назви вузла (коли поле icon не задане).
export function iconFromLabel(label: string): MapIconKind {
  const l = label.toLowerCase();
  if (/(млин|гребл)/.test(l)) return 'mill';
  if (/дуб/.test(l)) return 'oak';
  if (/криниц/.test(l)) return 'well';
  if (/корчм/.test(l)) return 'tavern';
  if (/(пасік|борть|вулик)/.test(l)) return 'hives';
  if (/(заводь|очерет)/.test(l)) return 'reeds';
  if (/брод/.test(l)) return 'sunken';
  if (/(каплич|церк)/.test(l)) return 'chapel';
  if (/(багно|болот)/.test(l)) return 'bog';
  if (/(балка|курган|дід)/.test(l)) return 'mound';
  return 'village';
}

// ── Регіон-медальйон для глобальної мапи (печатка з горами) ───────────────────
export function regionSeal(size = 120, locked = false, seed = 5): HTMLCanvasElement {
  const c = document.createElement('canvas'); c.width = size; c.height = size;
  const x = c.getContext('2d')!;
  const M = size / 2, R = size * 0.42;
  const r = rng(seed * 31);
  x.globalAlpha = locked ? 0.45 : 1;
  // подвійне кільце печатки
  inkStroke(x, 3); x.beginPath(); x.arc(M, M, R, 0, Math.PI * 2); x.stroke();
  inkStroke(x, 1.4); x.beginPath(); x.arc(M, M, R * 0.86, 0, Math.PI * 2); x.stroke();
  // гори всередині
  x.save();
  x.beginPath(); x.arc(M, M, R * 0.84, 0, Math.PI * 2); x.clip();
  inkStroke(x, 2.2);
  const gY = M + R * 0.42;
  x.beginPath(); x.moveTo(M - R, gY); x.lineTo(M + R, gY); x.stroke();
  const peaks: Array<[number, number]> = [[-0.5, 0.5], [0, 0.85], [0.45, 0.6]];
  for (const [px, ph] of peaks) {
    const bx = M + R * px, apex = gY - R * ph;
    x.beginPath(); x.moveTo(bx - R * 0.42, gY); x.lineTo(bx, apex); x.lineTo(bx + R * 0.42, gY); x.stroke();
    // штрих правого схилу
    x.strokeStyle = INK_SOFT; x.lineWidth = 1;
    for (let i = 1; i < 5; i++) {
      const t = i / 5;
      x.beginPath();
      x.moveTo(bx + R * 0.42 * t, gY - (1 - t) * (gY - apex) * 0.0 - (gY - apex) * (1 - t));
      x.lineTo(bx + R * 0.42 * t * 0.6 + R * 0.12, gY);
      x.stroke();
    }
    inkStroke(x, 2.2);
  }
  // пара ялинок
  for (const dx of [-0.62, 0.66]) {
    const tx = M + R * dx, ty = gY;
    inkStroke(x, 1.6);
    x.beginPath(); x.moveTo(tx - 5, ty); x.lineTo(tx, ty - 12 - r() * 4); x.lineTo(tx + 5, ty); x.closePath(); x.stroke();
  }
  x.restore();
  if (locked) {
    // замок чорнилом
    x.globalAlpha = 0.9;
    inkStroke(x, 2.4);
    const ly = M + R * 0.02;
    x.strokeRect(M - 9, ly, 18, 14);
    x.beginPath(); x.arc(M, ly, 7, Math.PI, 0); x.stroke();
  }
  return c;
}

// ── Декор мапи: пасмо гір і річка (для тла) ───────────────────────────────────
export function drawInkDecor(c: HTMLCanvasElement, seed = 11): void {
  const x = c.getContext('2d')!;
  const w = c.width, h = c.height;
  const r = rng(seed);
  x.save();
  x.globalAlpha = 0.5;
  // річка — звивиста подвійна лінія через мапу
  inkStroke(x, 1.6);
  x.strokeStyle = INK_SOFT;
  for (const off of [0, 4]) {
    x.beginPath();
    let px = -10, py = h * (0.62 + r() * 0.1) + off;
    x.moveTo(px, py);
    while (px < w + 10) { px += 46 + r() * 40; py += (r() - 0.5) * 44; x.quadraticCurveTo(px - 24, py + (r() - 0.5) * 22, px, py); }
    x.stroke();
  }
  // розсип дрібних ялинок краями
  for (let i = 0; i < 26; i++) {
    const tx = r() * w, ty = h * 0.12 + r() * h * 0.76;
    // не малюємо в центрі, де вузли
    if (tx > w * 0.2 && tx < w * 0.8 && ty > h * 0.22 && ty < h * 0.78) continue;
    const s = 6 + r() * 7;
    x.strokeStyle = INK_SOFT; x.lineWidth = 1.3;
    x.beginPath(); x.moveTo(tx - s * 0.5, ty); x.lineTo(tx, ty - s); x.lineTo(tx + s * 0.5, ty); x.closePath(); x.stroke();
    x.beginPath(); x.moveTo(tx, ty); x.lineTo(tx, ty + s * 0.4); x.stroke();
  }
  x.restore();
}

// ── Компас-роза ───────────────────────────────────────────────────────────────
export function compassRose(size = 96): HTMLCanvasElement {
  const c = document.createElement('canvas'); c.width = size; c.height = size;
  const x = c.getContext('2d')!;
  const M = size / 2, R = size * 0.4;
  inkStroke(x, 1.6);
  x.beginPath(); x.arc(M, M, R, 0, Math.PI * 2); x.stroke();
  x.beginPath(); x.arc(M, M, R * 0.66, 0, Math.PI * 2); x.stroke();
  // 8 променів, N/S/E/W довші
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
    const long = i % 2 === 0;
    const rr = long ? R : R * 0.6;
    x.fillStyle = INK;
    x.beginPath();
    x.moveTo(M + Math.cos(a) * rr, M + Math.sin(a) * rr);
    x.lineTo(M + Math.cos(a + 0.16) * R * 0.16, M + Math.sin(a + 0.16) * R * 0.16);
    x.lineTo(M + Math.cos(a - 0.16) * R * 0.16, M + Math.sin(a - 0.16) * R * 0.16);
    x.closePath(); x.fill();
  }
  x.fillStyle = INK; x.font = `700 ${Math.round(size * 0.14)}px Georgia, serif`; x.textAlign = 'center';
  x.fillText('Пн', M, M - R - 3);
  return c;
}
