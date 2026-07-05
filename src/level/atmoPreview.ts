// Canvas2D-прев'ю атмосфери для редакторів (локації/меню): дощ, per-layer туман,
// віньєтка, кольоровий баланс. Та сама математика, що в грі (GameScene) і у вьюпорті
// редактора рівнів — щоб редактор показував те, що буде в грі.

import { type WeatherPhase, type FogLayer, type AtmVignette, type AtmColorBalance, type LayerTint } from './atmosphere';
import { buildFogNoiseCanvas } from './fogTexture';

// ── Туман: тайлована нойз-текстура, тонована в колір шару ────────────────────
let _fogBase: HTMLCanvasElement | null = null;
const _fogTinted = new Map<string, HTMLCanvasElement>();
function fogTintedCanvas(color: string): HTMLCanvasElement {
  let c = _fogTinted.get(color);
  if (c) return c;
  if (!_fogBase) _fogBase = buildFogNoiseCanvas();
  c = document.createElement('canvas'); c.width = _fogBase.width; c.height = _fogBase.height;
  const cx = c.getContext('2d')!;
  cx.drawImage(_fogBase, 0, 0);
  cx.globalCompositeOperation = 'source-in'; // лишити alpha нойзу, залити кольором
  cx.fillStyle = color; cx.fillRect(0, 0, c.width, c.height);
  _fogTinted.set(color, c);
  return c;
}

// Малює туман одного шару на весь канвас. t — секунди, viewScale — зум редактора.
export function drawFogLayerCanvas(ctx: CanvasRenderingContext2D, W: number, H: number, fl: FogLayer, viewScale: number, t: number): void {
  if ((fl.alpha ?? 0) <= 0.004) return;
  const pat = ctx.createPattern(fogTintedCanvas(fl.color ?? '#c2ccd6'), 'repeat');
  if (!pat || !_fogBase) return;
  const scale = Math.max(0.3, fl.scale ?? 1) * viewScale;
  const rad = (fl.dir ?? 0) * Math.PI / 180;
  const off = (fl.seed ?? 0) * 37.13;
  // дрейф патерна (аналог tilePosition у грі): base-зсув від seed + рух за напрямком
  const tx = -(off + Math.cos(rad) * (fl.speed ?? 12) * t) * scale;
  const ty = -(off * 0.7 + Math.sin(rad) * (fl.speed ?? 12) * t) * scale;
  const m = new DOMMatrix([scale, 0, 0, scale, tx % (_fogBase.width * scale), ty % (_fogBase.height * scale)]);
  pat.setTransform(m);
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, fl.alpha ?? 0.4));
  ctx.fillStyle = pat;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

// ── Дощ: три паралакс-шари штрихів (як у грі) ────────────────────────────────
function rainPalette(hex: string): string[] {
  const h = hex.replace('#', '').padStart(6, '0');
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  const cl = (v: number): number => Math.max(0, Math.min(255, Math.round(v)));
  const mk = (mr: number, mg: number, mb: number): string => `rgb(${cl(r * mr)},${cl(g * mg)},${cl(b * mb)})`;
  return [mk(0.72, 0.78, 0.92), mk(0.9, 0.95, 1), mk(1, 1, 1), mk(1.12, 1.12, 1.18)];
}

export function drawRainCanvas(ctx: CanvasRenderingContext2D, W: number, H: number, ph: WeatherPhase, viewScale: number, t: number): void {
  const rainOn = ph.rain !== undefined ? ph.rain : ph.type === 'rain';
  if (!rainOn) return;
  const hash = (n: number): number => { const s = Math.sin(n * 127.1) * 43758.5453; return s - Math.floor(s); };
  const angle = Math.tan((ph.rainDir ?? 15) * Math.PI / 180);
  const spd = (ph.rainSpeed ?? 600) * viewScale, baseLen = (ph.rainDropLen ?? 16) * viewScale;
  const palette = rainPalette(ph.rainColor ?? '#aaddff');
  const dropMul = Math.max(0.1, (ph.rainDrops ?? 100) / 100);
  // [speedMul, lenMul, widthPx, alpha, count, blurPx, seed] — як у грі
  const layers = [
    { sm: 0.7, lm: 0.5, w: 1.0, a: ph.rainFar  ?? 0.35, n: Math.round(70 * dropMul), blur: 2.5, seed: 11 },
    { sm: 1.0, lm: 1.0, w: 1.6, a: ph.rainMid  ?? 0.7,  n: Math.round(90 * dropMul), blur: 0,   seed: 53 },
    { sm: 2.4, lm: 3.2, w: 3.0, a: ph.rainNear ?? 1.0,  n: Math.round(26 * dropMul), blur: 3.5, seed: 97 },
  ];
  for (const l of layers) {
    if (l.a < 0.01) continue;
    const speed = spd * l.sm;
    ctx.save();
    ctx.lineWidth = l.w;
    ctx.lineCap = 'round';
    if (l.blur > 0) ctx.filter = `blur(${l.blur}px)`;
    for (let i = 0; i < l.n; i++) {
      const rx   = (i + 0.5 + (hash(i + l.seed) - 0.5) * 0.5) / l.n;
      const rlen = 0.6 + hash(i + l.seed + 7) * 0.9;
      const ra   = 0.55 + hash(i + l.seed + 13) * 0.45;
      const rph  = hash(i + l.seed + 23);
      const len   = baseLen * l.lm * rlen;
      const drift = Math.abs(angle) * (H + len);
      const OW    = W + drift + 80;
      const OH    = H + len + 60;
      const baseX = -40 - (angle > 0 ? drift : 0) + rx * OW;
      const phase = ((rph * OH) + t * speed) % OH;
      const sy    = -40 + phase;
      const sx    = baseX + phase * angle;
      ctx.globalAlpha = Math.min(1, l.a * ra);
      ctx.strokeStyle = palette[(i + l.seed) % palette.length];
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + len * angle, sy + len); ctx.stroke();
    }
    ctx.restore();
  }
}

// ── Віньєтка: овал-градієнт у нижній смузі кадру (fx/fy/fw/fh — рамка кадру) ──
export function drawVignetteCanvas(ctx: CanvasRenderingContext2D, fx: number, fy: number, fw: number, fh: number, vig: AtmVignette): void {
  const str = Math.max(0, Math.min(1, vig.strength ?? 0.6));
  if (str <= 0.001) return;
  const topF = Math.max(0, Math.min(0.98, vig.top ?? 0.5));
  const by0 = fy + topF * fh;
  const groundH = fy + fh - by0;
  if (groundH <= 4) return;
  const col = vig.color ?? '#000000';
  const [er, eg, eb] = [parseInt(col.slice(1, 3), 16), parseInt(col.slice(3, 5), 16), parseInt(col.slice(5, 7), 16)];
  const cx = fx + fw / 2, rx = fw / 2, ry = groundH / 2;
  ctx.save();
  ctx.globalCompositeOperation = (vig.blend as GlobalCompositeOperation) || 'multiply';
  ctx.beginPath(); ctx.rect(fx, by0, fw, groundH); ctx.clip();
  ctx.scale(1, ry / rx); // радіальний градієнт → еліпс
  const cyS = (by0 + ry) * rx / ry;
  const grd = ctx.createRadialGradient(cx, cyS, 0, cx, cyS, rx);
  grd.addColorStop(0, 'rgba(0,0,0,0)');
  grd.addColorStop(0.45, 'rgba(0,0,0,0)');
  grd.addColorStop(1, `rgba(${er},${eg},${eb},${str})`);
  ctx.fillStyle = grd;
  ctx.fillRect(fx, by0 * rx / ry, fw, groundH * rx / ry);
  ctx.restore();
}

// ── Кольоровий баланс: знімок + CSS filter + shadow/mid/highlight по luma ────
export function applyColorBalanceCanvas(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, cb: AtmColorBalance): void {
  const br = Math.round((cb.brightness ?? 1) * 100);
  const co = Math.round(((cb.contrast ?? 1) + (cb.cavity ?? 0) * 0.5) * 100);
  const sa = Math.round((cb.saturation ?? 1) * 100);
  const hu = cb.hue ?? 0;
  const W = canvas.width, H = canvas.height;
  const snap = document.createElement('canvas');
  snap.width = W; snap.height = H;
  snap.getContext('2d')!.drawImage(canvas, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.filter = `brightness(${br}%) contrast(${co}%) saturate(${sa}%) hue-rotate(${hu}deg)`;
  ctx.drawImage(snap, 0, 0);
  ctx.filter = 'none';
  const sStr = Math.min(1, cb.shadowStrength    ?? 0);
  const mStr = Math.min(1, cb.midStrength       ?? 0);
  const hStr = Math.min(1, cb.highlightStrength ?? 0);
  if (sStr > 0.005 || mStr > 0.005 || hStr > 0.005) {
    const imgData = ctx.getImageData(0, 0, W, H);
    const d = imgData.data;
    const phex = (hex: string, o: number): number => parseInt((hex.replace('#', '').padStart(6, '0')).slice(o, o + 2), 16);
    const pc = (h: string): [number, number, number] => [phex(h, 0), phex(h, 2), phex(h, 4)];
    const [sr, sg, sb] = pc(cb.shadowColor    ?? '#000033');
    const [mr, mg, mb] = pc(cb.midColor       ?? '#003300');
    const [hr2, hg2, hb2] = pc(cb.highlightColor ?? '#ffffee');
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;
      let r = d[i], g = d[i + 1], b = d[i + 2];
      const luma = (r * 0.299 + g * 0.587 + b * 0.114) / 255;
      if (sStr > 0.005) { const w = Math.max(0, 1 - luma * 2) * sStr; r = (r + (sr - r) * w) | 0; g = (g + (sg - g) * w) | 0; b = (b + (sb - b) * w) | 0; }
      if (mStr > 0.005) { const w = Math.max(0, 1 - Math.abs(luma - 0.5) * 4) * mStr; r = (r + (mr - r) * w) | 0; g = (g + (mg - g) * w) | 0; b = (b + (mb - b) * w) | 0; }
      if (hStr > 0.005) { const w = Math.max(0, (luma - 0.35) / 0.65) * hStr; r = (r + (hr2 - r) * w) | 0; g = (g + (hg2 - g) * w) | 0; b = (b + (hb2 - b) * w) | 0; }
      d[i] = r; d[i + 1] = g; d[i + 2] = b;
    }
    ctx.putImageData(imgData, 0, 0);
  }
}

// ── Per-layer тінт: намалювати шар offscreen, тонувати формою, композитнути ──
// drawFn малює вміст шару на переданий контекст; tint лягає тільки на пікселі шару.
export function drawLayerTinted(mainCtx: CanvasRenderingContext2D, W: number, H: number, lt: LayerTint | undefined, drawFn: (ctx: CanvasRenderingContext2D) => void): void {
  if (!lt || lt.alpha <= 0.005) { drawFn(mainCtx); return; }
  const off = document.createElement('canvas');
  off.width = W; off.height = H;
  const octx = off.getContext('2d')!;
  drawFn(octx);
  const tintCv = document.createElement('canvas'); tintCv.width = W; tintCv.height = H;
  const tc = tintCv.getContext('2d')!;
  tc.fillStyle = lt.color; tc.fillRect(0, 0, W, H);
  tc.globalCompositeOperation = 'destination-in';
  tc.drawImage(off, 0, 0);
  octx.globalCompositeOperation = (lt.blend as GlobalCompositeOperation) || 'multiply';
  octx.globalAlpha = Math.min(1, lt.alpha);
  octx.drawImage(tintCv, 0, 0);
  octx.globalCompositeOperation = 'source-over'; octx.globalAlpha = 1;
  mainCtx.drawImage(off, 0, 0);
}
