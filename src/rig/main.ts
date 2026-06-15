import { keyImage, hasSolidBackground, imageToCanvas } from './keyer';

// ---- Конструктор персонажа, керування у стилі Blender ----
// Слоти під PNG (цілі кінцівки) + орієнтир-силует (теж трансформовний).
// Гарячі клавіші за ФІЗИЧНОЮ клавішею (ev.code) — працюють за будь-якої розкладки:
// G рух · R поворот · S розмір · Q півот · Ctrl+Z відміна. Клік — підтвердити, Esc — скасувати.

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const rad = (d: number): number => (d * Math.PI) / 180;

interface Tf { rot: number; scale: number; dx: number; dy: number; flip: number }
interface Slot extends Tf { image: string | null; pivotX: number; pivotY: number; cut: number | null; bend: number }
interface Ref extends Tf { canvas: HTMLCanvasElement | null }

// Порядок = шари ззаду наперед. Передня нога ПІД торсом (сорочка її перекриває).
const SLOT_DEFS = [
  { key: 'leg_back', label: 'Нога зад', joint: 'hipBack', len: 'legs', piv: [0.5, 0.06] },
  { key: 'arm_back', label: 'Рука зад', joint: 'shBack', len: 'arms', piv: [0.5, 0.08] },
  { key: 'leg_front', label: 'Нога перед', joint: 'hipFront', len: 'legs', piv: [0.5, 0.06] },
  { key: 'torso', label: 'Торс', joint: 'hip', len: 'torso', piv: [0.5, 0.94] },
  { key: 'head', label: 'Голова', joint: 'neck', len: 'head', piv: [0.5, 0.94] },
  { key: 'arm_front', label: 'Рука перед', joint: 'shFront', len: 'arms', piv: [0.5, 0.08] },
] as const;
const def = (key: string) => SLOT_DEFS.find((d) => d.key === key)!;
const BASE = { torso: 105, head: 86, arms: 116, legs: 140 };

const canvas = $<HTMLCanvasElement>('stage');
const ctx = canvas.getContext('2d')!;

const state = {
  images: new Map<string, HTMLCanvasElement>(),
  imageNames: [] as string[],
  ref: { canvas: null, rot: 0, scale: 1, dx: 0, dy: 0, flip: 1 } as Ref,
  showRef: true,
  anim: null as null | string,
  animT: 0,
  prop: { overall: 1, head: 1.4, torso: 0.95, arms: 1.1, legs: 1.3 },
  slots: {} as Record<string, Slot>,
  selected: 'torso',
  showPivots: true,
  pivotMode: false,
  cutMode: false,
  zoom: 1,
  pan: { x: 0, y: 0 },
  facing: 1, // 1 праворуч, -1 ліворуч — ДЗЕРКАЛИТЬ АРТ (кнопка «Лицем»)
  animDir: 1, // напрям анімації кісток (НЕ чіпає арт; гнеться в інший бік)
  origin: { x: 0, y: 0 },
  viewScale: 1,
  mouse: { x: 0, y: 0 },
  mode: null as null | 'R' | 'S' | 'G',
  orig: null as null | Tf,
  startAng: 0,
  startDist: 1,
  startMx: 0,
  startMy: 0,
};
for (const d of SLOT_DEFS) state.slots[d.key] = { image: null, pivotX: d.piv[0], pivotY: d.piv[1], rot: 0, scale: 1, dx: 0, dy: 0, flip: 1, cut: null, bend: 0 };

const lenOf = (key: string): number => { const w = def(key).len as keyof typeof BASE; return BASE[w] * state.prop[w]; };
function joints(): Record<string, { x: number; y: number }> {
  const t = BASE.torso * state.prop.torso;
  return { hip: { x: 0, y: 0 }, neck: { x: 0, y: -t }, shBack: { x: -7, y: -t + 12 }, shFront: { x: 7, y: -t + 12 }, hipBack: { x: -9, y: -4 }, hipFront: { x: 9, y: -4 } };
}
const s = (): number => state.viewScale * state.prop.overall;
const toPx = (ux: number, uy: number): { x: number; y: number } => ({ x: state.origin.x + ux * s(), y: state.origin.y + uy * s() });

// ---- цільові аксесори (слот або 'ref') ----
const tf = (sel: string): Tf => (sel === 'ref' ? state.ref : state.slots[sel]);
const imgOf = (sel: string): HTMLCanvasElement | null => {
  if (sel === 'ref') return state.ref.canvas;
  const sl = state.slots[sel];
  return sl.image ? state.images.get(sl.image) ?? null : null;
};
const pivotOf = (sel: string): { x: number; y: number } => (sel === 'ref' ? { x: 0.5, y: 0.5 } : { x: state.slots[sel].pivotX, y: state.slots[sel].pivotY });
function baseUnit(sel: string): { x: number; y: number } {
  if (sel === 'ref') {
    const top = -(BASE.torso * state.prop.torso + BASE.head * state.prop.head);
    const bottom = BASE.legs * state.prop.legs;
    return { x: 0, y: (top + bottom) / 2 };
  }
  return joints()[def(sel).joint];
}
function anchorPx(sel: string): { x: number; y: number } {
  const b = baseUnit(sel); const t = eff(sel); const j = toPx(b.x, b.y);
  return { x: j.x + t.dx * s(), y: j.y + t.dy * s() };
}
// дзеркалення X курсора у "несвічений" світ (бо сцену малюємо дзеркально при facing<0)
const mirrorX = (x: number): number => (state.facing < 0 ? 2 * state.origin.x - x : x);

// Ефективний трансформ = база + СПІЛЬНИЙ рух кореня (усе тіло) + ЛОКАЛЬНИЙ догин кістки.
// Завдяки спільному кореню частини не "відриваються" (фікс стрибка).
function eff(sel: string): Tf {
  const t = tf(sel);
  if (!state.anim || sel === 'ref') return t;
  const o = animOff(state.anim, state.animT, sel);
  const r = animRoot(state.anim, state.animT);
  return { rot: t.rot + o.drot * state.animDir, scale: t.scale, dx: t.dx + o.ddx + r.ddx, dy: t.dy + o.ddy + r.ddy, flip: t.flip };
}

// Рух усього тіла (корінь) — однаковий для всіх частин: підскок, погойдування.
function animRoot(name: string, t: number): { ddx: number; ddy: number } {
  if (name === 'walk') return { ddx: 0, ddy: -Math.abs(Math.sin(t * 5.5)) * 3 };
  if (name === 'run') return { ddx: 0, ddy: -Math.abs(Math.sin(t * 9)) * 5 };
  if (name === 'jump') { const ph = (t % 1.6) / 1.6; const ddy = ph < 0.16 ? (ph / 0.16) * 10 : 10 - Math.sin(((ph - 0.16) / 0.84) * Math.PI) * 48; return { ddx: 0, ddy }; }
  if (name === 'attack') { const ap = (t % 0.7) / 0.7; return { ddx: 0, ddy: ap < 0.45 ? (ap / 0.45) * 6 : 6 * (1 - (ap - 0.45) / 0.55) }; }
  if (name === 'hurt') { const r = Math.sin(Math.min(1, (t % 0.6) / 0.6) * Math.PI); return { ddx: -r * 12, ddy: -r * 3 }; }
  if (name === 'idle') return { ddx: 0, ddy: Math.sin(t * 1.8) * 1.2 };
  return { ddx: 0, ddy: 0 };
}

// Локальний догин кістки (лише ОБЕРТАННЯ) — поверх руху кореня. Пропорційно-незалежно.
function animOff(name: string, t: number, key: string): { drot: number; ddx: number; ddy: number } {
  const z = { drot: 0, ddx: 0, ddy: 0 };
  if (name === 'idle') {
    if (key === 'head') return { drot: Math.sin(t * 1.8) * 2, ddx: 0, ddy: 0 };
    if (key.startsWith('arm')) return { drot: Math.sin(t * 1.8) * 3, ddx: 0, ddy: 0 };
    return z;
  }
  if (name === 'walk' || name === 'run') {
    const spd = name === 'run' ? 9 : 5.5;
    const amp = name === 'run' ? 34 : 24;
    const aArm = name === 'run' ? 32 : 20;
    const ph = t * spd;
    const back = Math.sin(ph);
    const front = Math.sin(ph + Math.PI);
    if (key === 'leg_front') return { drot: front * amp, ddx: 0, ddy: 0 };
    if (key === 'leg_back') return { drot: back * amp, ddx: 0, ddy: 0 };
    if (key === 'arm_front') return { drot: back * aArm, ddx: 0, ddy: 0 };
    if (key === 'arm_back') return { drot: front * aArm, ddx: 0, ddy: 0 };
    if (key === 'torso') return { drot: Math.sin(ph) * 2, ddx: 0, ddy: 0 };
    return z;
  }
  if (name === 'jump') {
    const ph = (t % 1.6) / 1.6; const air = ph < 0.16 ? 0 : Math.sin(((ph - 0.16) / 0.84) * Math.PI);
    if (key.startsWith('leg')) return { drot: -air * 26 + (key.includes('front') ? 6 : -6), ddx: 0, ddy: 0 };
    if (key.startsWith('arm')) return { drot: -air * 28, ddx: 0, ddy: 0 };
    return z;
  }
  if (name === 'attack') {
    const ap = (t % 0.7) / 0.7;
    let af: number;
    if (ap < 0.45) af = (ap / 0.45) * 40; else if (ap < 0.6) af = 40 - ((ap - 0.45) / 0.15) * 95; else af = -55 + ((ap - 0.6) / 0.4) * 55;
    if (key === 'arm_front') return { drot: af, ddx: 0, ddy: 0 };
    if (key === 'arm_back') return { drot: -af * 0.3, ddx: 0, ddy: 0 };
    if (key === 'torso') return { drot: ap < 0.45 ? (ap / 0.45) * 6 : -6 + ((ap - 0.45) / 0.55) * 6, ddx: 0, ddy: 0 };
    return z;
  }
  if (name === 'hurt') {
    const r = Math.sin(Math.min(1, (t % 0.6) / 0.6) * Math.PI);
    if (key === 'torso') return { drot: r * 12, ddx: 0, ddy: 0 };
    if (key === 'head') return { drot: r * 8, ddx: 0, ddy: 0 };
    if (key.startsWith('arm')) return { drot: -r * 20, ddx: 0, ddy: 0 };
    return z;
  }
  return z;
}

// Згин у суглобі (коліно/лікоть) для розрізаних кінцівок — градуси, поверх slot.bend.
// Знак від'ємний — коліно/лікоть гнуться "назад" (природно).
function animBend(name: string, t: number, key: string): number {
  if (name === 'walk' || name === 'run') {
    const spd = name === 'run' ? 9 : 5.5; const ph = t * spd;
    const legAmp = name === 'run' ? 46 : 28, armAmp = name === 'run' ? 50 : 34;
    if (key === 'leg_front') return -Math.max(0, Math.sin(ph + Math.PI)) * legAmp;
    if (key === 'leg_back') return -Math.max(0, Math.sin(ph)) * legAmp;
    if (key === 'arm_front') return -(0.4 + 0.6 * Math.abs(Math.sin(ph))) * armAmp;
    if (key === 'arm_back') return -(0.4 + 0.6 * Math.abs(Math.sin(ph + Math.PI))) * armAmp;
    return 0;
  }
  if (name === 'jump') {
    const ph = (t % 1.6) / 1.6;
    const crouch = ph < 0.16 ? (ph / 0.16) : 0; const air = ph < 0.16 ? 0 : Math.sin(((ph - 0.16) / 0.84) * Math.PI);
    if (key.startsWith('leg')) return -(crouch * 30 + air * 54);
    if (key.startsWith('arm')) return -air * 34;
    return 0;
  }
  if (name === 'attack') {
    const ap = (t % 0.7) / 0.7;
    // лікоть передньої руки: зігнутий на замаху, розпрямляється на ударі
    if (key === 'arm_front') return ap < 0.45 ? -(ap / 0.45) * 70 : ap < 0.6 ? -70 + ((ap - 0.45) / 0.15) * 70 : 0;
    if (key.startsWith('leg')) return -(ap < 0.45 ? (ap / 0.45) * 18 : 18 * (1 - (ap - 0.45) / 0.55)); // легке присідання
    return 0;
  }
  if (name === 'hurt') { const r = Math.sin(Math.min(1, (t % 0.6) / 0.6) * Math.PI); if (key.startsWith('arm')) return -r * 25; return 0; }
  if (name === 'idle') { if (key.startsWith('arm')) return -(0.3 + 0.3 * Math.sin(t * 1.8)) * 10; return 0; }
  return 0;
}

// ---- undo ----
const undoStack: string[] = [];
const snapshot = (): string => JSON.stringify({ prop: state.prop, slots: state.slots, ref: { rot: state.ref.rot, scale: state.ref.scale, dx: state.ref.dx, dy: state.ref.dy, flip: state.ref.flip }, sel: state.selected });
function pushUndo(): void { undoStack.push(snapshot()); if (undoStack.length > 80) undoStack.shift(); }
function undo(): void {
  const s0 = undoStack.pop(); if (!s0) { status('Нема що відміняти'); return; }
  const o = JSON.parse(s0);
  Object.assign(state.prop, o.prop);
  for (const k of Object.keys(state.slots)) if (o.slots[k]) Object.assign(state.slots[k], o.slots[k]);
  Object.assign(state.ref, o.ref);
  if (o.sel) state.selected = o.sel;
  refreshUI();
}

// автозбереження збірки (без картинок — їх перетягнеш знову, релінк збереже позиції)
function saveLocal(): void {
  try { localStorage.setItem('ostap_char', JSON.stringify({ prop: state.prop, slots: state.slots, facing: state.facing })); } catch { /* ignore */ }
}
function restoreLocal(): void {
  try {
    const o = JSON.parse(localStorage.getItem('ostap_char') || 'null');
    if (!o) return;
    if (o.prop) Object.assign(state.prop, o.prop);
    if (typeof o.facing === 'number') state.facing = o.facing;
    if (o.slots) for (const k of Object.keys(state.slots)) if (o.slots[k]) Object.assign(state.slots[k], o.slots[k]);
  } catch { /* ignore */ }
}

// ---- рендер ----
function applyOrigin(): void {
  state.origin.x = canvas.width * 0.5 + state.pan.x;
  state.origin.y = canvas.height * 0.58 + state.pan.y;
}
function resize(): void {
  canvas.width = canvas.clientWidth; canvas.height = canvas.clientHeight;
  applyOrigin();
  state.viewScale = (Math.min(canvas.width, canvas.height) / 360) * state.zoom;
}
function drawImageAt(sel: string, alpha: number): void {
  const img = imgOf(sel); if (!img) return;
  const t = eff(sel); const p = pivotOf(sel); const a = anchorPx(sel);
  const slot = sel === 'ref' ? null : state.slots[sel];
  const w = img.width, h = img.height;
  const ox = -p.x * w, oy = -p.y * h;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(a.x, a.y);
  ctx.rotate(rad(t.rot));
  const sc = t.scale * s();
  ctx.scale(t.flip * sc, sc); // flip<0 — дзеркало по X навколо півота

  if (slot && slot.cut != null) {
    const cutY = oy + slot.cut * h; // лінія розрізу в локальних координатах
    const jx = ox + 0.5 * w; // суглоб згину — по центру вздовж кістки
    // верхня частина
    ctx.save();
    ctx.beginPath(); ctx.rect(ox - 2, oy - 2, w + 4, slot.cut * h + 4); ctx.clip();
    ctx.drawImage(img, ox, oy);
    ctx.restore();
    // нижня частина — обертається на bend (+ анімаційний згин) навколо суглоба
    const animB = state.anim ? animBend(state.anim, state.animT, sel) * state.animDir : 0;
    ctx.save();
    ctx.translate(jx, cutY); ctx.rotate(rad(slot.bend + animB)); ctx.translate(-jx, -cutY);
    ctx.beginPath(); ctx.rect(ox - 2, cutY, w + 4, (oy + h) - cutY + 2); ctx.clip();
    ctx.drawImage(img, ox, oy);
    ctx.restore();
  } else {
    ctx.drawImage(img, ox, oy);
  }
  ctx.restore();
}
function draw(): void {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  if (state.facing < 0) { ctx.translate(state.origin.x, 0); ctx.scale(-1, 1); ctx.translate(-state.origin.x, 0); }
  if (state.showRef) drawImageAt('ref', state.selected === 'ref' ? 0.5 : 0.22);
  for (const d of SLOT_DEFS) drawImageAt(d.key, 1);

  // маркери pivot
  const drawMark = (sel: string) => {
    const a = anchorPx(sel); const on = sel === state.selected;
    ctx.strokeStyle = on ? '#ffd000' : '#5aa0ff'; ctx.fillStyle = ctx.strokeStyle;
    if (on) {
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(a.x - 9, a.y); ctx.lineTo(a.x + 9, a.y); ctx.moveTo(a.x, a.y - 9); ctx.lineTo(a.x, a.y + 9); ctx.stroke();
      ctx.beginPath(); ctx.arc(a.x, a.y, 4, 0, Math.PI * 2); ctx.stroke();
    } else { ctx.beginPath(); ctx.arc(a.x, a.y, 3, 0, Math.PI * 2); ctx.fill(); }
  };
  if (state.showPivots) for (const d of SLOT_DEFS) drawMark(d.key);
  drawMark(state.selected); // вибраний завжди

  // маркер суглоба згину (рожевий) для вибраної розрізаної частини
  const ssel = state.selected !== 'ref' ? state.slots[state.selected] : null;
  if (ssel && ssel.cut != null) {
    const img = imgOf(state.selected);
    if (img) {
      const t = eff(state.selected); const a = anchorPx(state.selected); const sc = t.scale * s();
      const lx = (0.5 - ssel.pivotX) * img.width * t.flip;
      const ly = (ssel.cut - ssel.pivotY) * img.height;
      const cr = Math.cos(rad(t.rot)), sr = Math.sin(rad(t.rot));
      ctx.fillStyle = '#ff45c0';
      ctx.beginPath(); ctx.arc(a.x + (lx * cr - ly * sr) * sc, a.y + (lx * sr + ly * cr) * sc, 5, 0, Math.PI * 2); ctx.fill();
    }
  }

  ctx.restore(); // кінець дзеркального шару (підказка нижче — нормальним текстом)

  if (state.mode || state.pivotMode || state.cutMode) {
    ctx.fillStyle = '#ffd000'; ctx.font = '14px monospace';
    const txt = state.cutMode ? 'РОЗРІЗ: клікни, де різати (лікоть/коліно)' : state.pivotMode ? 'PIVOT: клікни на частині' : `${state.mode}: рухай мишею · клік — ок, Esc — скасувати`;
    ctx.fillText(txt, 12, canvas.height - 16);
  }
}

// ---- координати картинки під курсором ----
function curLocal(sel: string, sx: number, sy: number): { lx: number; ly: number; iw: number; ih: number } | null {
  const img = imgOf(sel); if (!img) return null;
  const t = tf(sel); const p = pivotOf(sel); const a = anchorPx(sel);
  const ang = rad(-t.rot); const dx = sx - a.x, dy = sy - a.y;
  const rx = dx * Math.cos(ang) - dy * Math.sin(ang); const ry = dx * Math.sin(ang) + dy * Math.cos(ang);
  const sc = t.scale * s();
  let localX = rx / sc; if (t.flip < 0) localX = -localX; // врахувати дзеркало
  return { lx: localX + p.x * img.width, ly: ry / sc + p.y * img.height, iw: img.width, ih: img.height };
}
function hitTest(sx: number, sy: number): string | null {
  for (let i = SLOT_DEFS.length - 1; i >= 0; i--) {
    const loc = curLocal(SLOT_DEFS[i].key, sx, sy);
    if (loc && loc.lx >= 0 && loc.lx <= loc.iw && loc.ly >= 0 && loc.ly <= loc.ih) return SLOT_DEFS[i].key;
  }
  return null;
}

function assignImage(key: string, name: string | null): void {
  const slot = state.slots[key]; slot.image = name;
  if (name) {
    const img = state.images.get(name); if (img) slot.scale = lenOf(key) / img.height;
    slot.rot = 0; slot.dx = 0; slot.dy = 0; slot.pivotX = def(key).piv[0]; slot.pivotY = def(key).piv[1];
    slot.cut = null; slot.bend = 0;
  }
}

// яка частина тіла за назвою файлу
function slotForName(name: string): string | null {
  const n = name.toLowerCase();
  if (/head|голов/.test(n)) return 'head';
  if (/torso|shirt|body|тор|сороч/.test(n)) return 'torso';
  if (/arm|рук/.test(n)) return /back|зад/.test(n) ? 'arm_back' : 'arm_front';
  if (/leg|ног/.test(n)) return /back|зад/.test(n) ? 'leg_back' : 'leg_front';
  return null;
}

function toggleCut(): void {
  if (state.selected === 'ref') return;
  const slot = state.slots[state.selected];
  if (!slot.image) { status('Спершу признач картинку частині'); return; }
  pushUndo();
  if (slot.cut != null) { slot.cut = null; slot.bend = 0; state.cutMode = false; status('Розріз прибрано'); }
  else { state.cutMode = true; status('Клікни на частині, де різати (лікоть/коліно)'); }
  refreshUI();
}
function addImageFile(file: File, fallbackToSelected: boolean): void {
  const keyBg = $<HTMLInputElement>('keyBg').checked;
  const img = new Image();
  img.onload = () => {
    const cv = keyBg && hasSolidBackground(img) ? keyImage(img) : imageToCanvas(img);
    state.images.set(file.name, cv);
    if (!state.imageNames.includes(file.name)) state.imageNames.push(file.name);
    // якщо якийсь слот уже посилається на цю назву (після Import) — лише підвантажуємо
    // пікселі, НЕ чіпаючи позицію/поворот/масштаб. Інакше — призначаємо за назвою.
    const linked = Object.values(state.slots).some((sl) => sl.image === file.name);
    if (!linked) {
      const target = slotForName(file.name) ?? (fallbackToSelected && state.selected !== 'ref' ? state.selected : null);
      if (target) assignImage(target, file.name);
    }
    refreshUI();
  };
  img.src = URL.createObjectURL(file);
}

// ---- режими R/S/G ----
function startMode(m: 'R' | 'S' | 'G'): void {
  pushUndo();
  const t = tf(state.selected);
  state.mode = m; state.pivotMode = false;
  state.orig = { rot: t.rot, scale: t.scale, dx: t.dx, dy: t.dy, flip: t.flip };
  const a = anchorPx(state.selected);
  const mx = mirrorX(state.mouse.x);
  state.startMx = mx; state.startMy = state.mouse.y;
  state.startAng = Math.atan2(state.mouse.y - a.y, mx - a.x);
  state.startDist = Math.max(8, Math.hypot(mx - a.x, state.mouse.y - a.y));
  draw();
}
function applyMode(): void {
  if (!state.mode || !state.orig) return;
  const t = tf(state.selected); const a = anchorPx(state.selected);
  const mx = mirrorX(state.mouse.x); const my = state.mouse.y;
  if (state.mode === 'G') { t.dx = state.orig.dx + (mx - state.startMx) / s(); t.dy = state.orig.dy + (my - state.startMy) / s(); }
  else if (state.mode === 'R') { const ang = Math.atan2(my - a.y, mx - a.x); t.rot = state.orig.rot + ((ang - state.startAng) * 180) / Math.PI; }
  else if (state.mode === 'S') { const d = Math.hypot(mx - a.x, my - a.y); t.scale = Math.max(0.02, state.orig.scale * (d / state.startDist)); }
  draw();
}
function endMode(commit: boolean): void {
  if (!state.mode) return;
  if (!commit && state.orig) Object.assign(tf(state.selected), state.orig);
  state.mode = null; state.orig = null; refreshUI();
}

// ---- UI ----
function refreshChips(): void {
  const box = $('slotChips'); box.innerHTML = '';
  const make = (key: string, label: string, empty: boolean) => {
    const el = document.createElement('div');
    el.className = 'chip' + (key === state.selected ? ' sel' : '') + (empty ? ' empty' : '');
    el.textContent = label + (empty ? ' ○' : '');
    el.onclick = () => { state.selected = key; state.pivotMode = false; state.mode = null; refreshUI(); };
    box.appendChild(el);
  };
  for (const d of SLOT_DEFS) make(d.key, d.label, !state.slots[d.key].image);
  make('ref', '🎯 Орієнтир', !state.ref.canvas);
}
function refreshImgSel(): void {
  const sel = $<HTMLSelectElement>('imgSel'); sel.innerHTML = '<option value="">(немає)</option>';
  for (const n of state.imageNames) { const o = document.createElement('option'); o.value = n; o.textContent = n; sel.appendChild(o); }
  sel.value = state.selected === 'ref' ? '' : state.slots[state.selected].image ?? '';
  sel.disabled = state.selected === 'ref';
}
function refreshUI(): void {
  refreshChips(); refreshImgSel();
  const t = tf(state.selected);
  $<HTMLInputElement>('rot').value = String(Math.round(t.rot)); $('rotV').textContent = String(Math.round(t.rot));
  $<HTMLInputElement>('scale').value = String(t.scale); $('scaleV').textContent = t.scale < 1 ? t.scale.toFixed(2) : t.scale.toFixed(1);
  for (const k of ['overall', 'head', 'torso', 'arms', 'legs'] as const) { $<HTMLInputElement>(`p_${k}`).value = String(state.prop[k]); $(`p_${k}V`).textContent = state.prop[k].toFixed(2); }
  $<HTMLButtonElement>('setPivot').textContent = state.pivotMode ? '⌖ Клікни на частині…' : '⌖ Тицьнути півот (Q)';
  const ss = state.selected !== 'ref' ? state.slots[state.selected] : null;
  $<HTMLInputElement>('bend').value = String(ss ? ss.bend : 0);
  $('bendV').textContent = String(Math.round(ss ? ss.bend : 0));
  $<HTMLButtonElement>('cutBtn').textContent = ss && ss.cut != null ? '✕ Прибрати розріз (D)' : '✂ Розріз (D)';
  $<HTMLButtonElement>('faceBtn').textContent = '🔄 Перевернути арт: ' + (state.facing > 0 ? '→' : '←');
  $<HTMLButtonElement>('animDirBtn').textContent = '🦵 Хода в бік: ' + (state.animDir > 0 ? '→' : '←');
  saveLocal();
  draw();
}
const status = (m: string): void => { $('status').textContent = m; };

// ---- контроли ----
$<HTMLSelectElement>('imgSel').addEventListener('change', (e) => { pushUndo(); assignImage(state.selected, (e.target as HTMLSelectElement).value || null); refreshUI(); });
$<HTMLInputElement>('rot').addEventListener('pointerdown', pushUndo);
$<HTMLInputElement>('rot').addEventListener('input', (e) => { tf(state.selected).rot = Number((e.target as HTMLInputElement).value); $('rotV').textContent = (e.target as HTMLInputElement).value; draw(); });
$<HTMLInputElement>('scale').addEventListener('pointerdown', pushUndo);
$<HTMLInputElement>('scale').addEventListener('input', (e) => { tf(state.selected).scale = Number((e.target as HTMLInputElement).value); draw(); });
$<HTMLInputElement>('bend').addEventListener('pointerdown', pushUndo);
$<HTMLInputElement>('bend').addEventListener('input', (e) => { if (state.selected !== 'ref') { state.slots[state.selected].bend = Number((e.target as HTMLInputElement).value); $('bendV').textContent = (e.target as HTMLInputElement).value; draw(); } });
$<HTMLButtonElement>('cutBtn').addEventListener('click', toggleCut);
$<HTMLButtonElement>('setPivot').addEventListener('click', () => { if (state.selected !== 'ref') { state.pivotMode = !state.pivotMode; state.mode = null; refreshUI(); } });
$<HTMLButtonElement>('resetPart').addEventListener('click', () => { pushUndo(); if (state.selected === 'ref') Object.assign(state.ref, { rot: 0, scale: 1, dx: 0, dy: 0 }); else assignImage(state.selected, state.slots[state.selected].image); refreshUI(); });
for (const k of ['overall', 'head', 'torso', 'arms', 'legs'] as const) {
  $<HTMLInputElement>(`p_${k}`).addEventListener('pointerdown', pushUndo);
  $<HTMLInputElement>(`p_${k}`).addEventListener('input', (e) => { state.prop[k] = Number((e.target as HTMLInputElement).value); $(`p_${k}V`).textContent = state.prop[k].toFixed(2); draw(); });
}
$<HTMLInputElement>('showPivots').addEventListener('change', (e) => { state.showPivots = (e.target as HTMLInputElement).checked; draw(); });
$<HTMLInputElement>('showRef').addEventListener('change', (e) => { state.showRef = (e.target as HTMLInputElement).checked; draw(); });
$<HTMLButtonElement>('faceBtn').addEventListener('click', () => { state.facing *= -1; refreshUI(); });
$<HTMLButtonElement>('animDirBtn').addEventListener('click', () => { state.animDir *= -1; refreshUI(); });
$<HTMLButtonElement>('refBtn').addEventListener('click', () => $<HTMLInputElement>('refInput').click());
$<HTMLButtonElement>('refClear').addEventListener('click', () => { pushUndo(); state.ref.canvas = null; draw(); });
$<HTMLInputElement>('refInput').addEventListener('change', (ev) => {
  const f = (ev.target as HTMLInputElement).files?.[0]; if (!f) return;
  const img = new Image(); img.onload = () => { state.ref.canvas = imageToCanvas(img); state.selected = 'ref'; refreshUI(); }; img.src = URL.createObjectURL(f);
});

// ---- canvas ----
let drag: { key: string; sx: number; sy: number; dx: number; dy: number } | null = null;
let panning = false;
let panStart = { mx: 0, my: 0, px: 0, py: 0 };
canvas.addEventListener('mousedown', (ev) => {
  const raw = { x: ev.offsetX, y: ev.offsetY };
  // середня кнопка (колесо) — панорама в'юпорта (Blender-стиль), у сирих координатах
  if (ev.button === 1) { ev.preventDefault(); panning = true; panStart = { mx: raw.x, my: raw.y, px: state.pan.x, py: state.pan.y }; return; }
  const c = { x: mirrorX(raw.x), y: raw.y };
  if (state.mode) { endMode(ev.button === 0); return; }
  if (state.cutMode && state.selected !== 'ref') {
    const loc = curLocal(state.selected, c.x, c.y);
    if (loc) { state.slots[state.selected].cut = Math.max(0.05, Math.min(0.95, loc.ly / loc.ih)); pushUndo(); }
    state.cutMode = false; status('Розріз поставлено. Крути «Згин».'); refreshUI(); return;
  }
  if (state.pivotMode && state.selected !== 'ref') {
    const loc = curLocal(state.selected, c.x, c.y);
    if (loc) { state.slots[state.selected].pivotX = Math.max(0, Math.min(1, loc.lx / loc.iw)); state.slots[state.selected].pivotY = Math.max(0, Math.min(1, loc.ly / loc.ih)); }
    pushUndo(); state.pivotMode = false; refreshUI(); return;
  }
  const hit = hitTest(c.x, c.y);
  const key = hit ?? (state.selected === 'ref' && state.ref.canvas ? 'ref' : null);
  if (key) { state.selected = key; pushUndo(); const t = tf(key); drag = { key, sx: c.x, sy: c.y, dx: t.dx, dy: t.dy }; refreshUI(); }
});
window.addEventListener('mousemove', (ev) => {
  const r = canvas.getBoundingClientRect();
  state.mouse = { x: ev.clientX - r.left, y: ev.clientY - r.top };
  if (panning) { state.pan.x = panStart.px + (state.mouse.x - panStart.mx); state.pan.y = panStart.py + (state.mouse.y - panStart.my); applyOrigin(); draw(); }
  else if (state.mode) applyMode();
  else if (drag) { const wx = mirrorX(state.mouse.x); tf(drag.key).dx = drag.dx + (wx - drag.sx) / s(); tf(drag.key).dy = drag.dy + (state.mouse.y - drag.sy) / s(); draw(); }
});
window.addEventListener('mouseup', () => { drag = null; panning = false; });
canvas.addEventListener('contextmenu', (ev) => { ev.preventDefault(); if (state.mode) endMode(false); });
canvas.addEventListener('wheel', (ev) => { ev.preventDefault(); state.zoom = Math.min(3, Math.max(0.3, state.zoom * (ev.deltaY < 0 ? 1.1 : 0.9))); resize(); draw(); }, { passive: false });

// ---- клавіатура (ev.code — незалежно від розкладки) ----
window.addEventListener('keydown', (ev) => {
  const tag = (document.activeElement?.tagName ?? '').toUpperCase();
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  if (ev.ctrlKey && ev.code === 'KeyZ') { ev.preventDefault(); undo(); return; }
  if (ev.code === 'KeyG' || ev.code === 'KeyR' || ev.code === 'KeyS') { ev.preventDefault(); startMode(ev.code === 'KeyG' ? 'G' : ev.code === 'KeyR' ? 'R' : 'S'); }
  else if (ev.code === 'KeyM') { ev.preventDefault(); pushUndo(); const t = tf(state.selected); t.flip *= -1; refreshUI(); }
  else if (ev.code === 'KeyD') { ev.preventDefault(); toggleCut(); }
  else if (ev.code === 'KeyQ') { ev.preventDefault(); if (state.selected !== 'ref') { state.pivotMode = !state.pivotMode; state.mode = null; refreshUI(); } }
  else if (ev.code === 'Escape') endMode(false);
  else if (ev.code === 'Enter') endMode(true);
});

// ---- drag&drop картинок ----
const stageEl = $('stageWrap');
['dragenter', 'dragover'].forEach((e) => stageEl.addEventListener(e, (ev) => ev.preventDefault()));
stageEl.addEventListener('drop', (ev) => {
  ev.preventDefault();
  const files = Array.from((ev as DragEvent).dataTransfer?.files ?? []).filter((f) => f.type.startsWith('image/'));
  if (files.length) pushUndo();
  files.forEach((f) => addImageFile(f, files.length === 1));
  if (files.length) status(`Перетягнуто ${files.length} — розкладаю по назвах…`);
});

$<HTMLInputElement>('fileInput').addEventListener('change', (ev) => {
  const files = Array.from((ev.target as HTMLInputElement).files ?? []);
  if (files.length) pushUndo();
  files.forEach((f) => addImageFile(f, files.length === 1));
});

// ---- експорт / імпорт ----
// самодостатній doc: пропорції + слоти + вшиті картинки (base64)
function buildDoc(): { version: number; proportions: typeof state.prop; slots: Record<string, Slot>; images: Record<string, string>; facing: number } {
  const used = new Set(Object.values(state.slots).map((sl) => sl.image).filter(Boolean) as string[]);
  const images: Record<string, string> = {};
  for (const n of used) { const cv = state.images.get(n); if (cv) images[n] = cv.toDataURL('image/png'); }
  return { version: 3, proportions: { ...state.prop }, slots: JSON.parse(JSON.stringify(state.slots)), images, facing: state.facing };
}
function loadCharFromDoc(doc: { proportions?: typeof state.prop; slots?: Record<string, Slot>; images?: Record<string, string>; facing?: number }): void {
  if (typeof doc.facing === 'number') state.facing = doc.facing;
  if (doc.proportions) Object.assign(state.prop, doc.proportions);
  if (doc.slots) for (const k of Object.keys(state.slots)) if (doc.slots[k]) Object.assign(state.slots[k], doc.slots[k]);
  if (doc.images) for (const [name, data] of Object.entries(doc.images)) {
    const im = new Image();
    im.onload = () => { state.images.set(name, imageToCanvas(im)); if (!state.imageNames.includes(name)) state.imageNames.push(name); refreshUI(); };
    im.src = data;
  }
  refreshUI();
}
// мініатюра для бібліотеки (bind-поза, цілі кінцівки)
function composeThumb(w: number, h: number): string {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const cx = c.getContext('2d')!; const J = joints(); const us = (h * 0.8) / 430; const ox = w / 2, oy = h * 0.46;
  for (const d of SLOT_DEFS) {
    const sl = state.slots[d.key]; const img = sl.image ? state.images.get(sl.image) : undefined; if (!img) continue;
    const j = J[d.joint];
    cx.save();
    cx.translate(ox + (j.x + sl.dx) * us, oy + (j.y + sl.dy) * us);
    cx.rotate(rad(sl.rot)); const sc = sl.scale * us; cx.scale(sl.flip * sc, sc);
    cx.drawImage(img, -sl.pivotX * img.width, -sl.pivotY * img.height);
    cx.restore();
  }
  return c.toDataURL('image/png');
}

// ---- бібліотека персонажів (localStorage) ----
interface LibItem { id: string; name: string; cat: 'char' | 'enemy'; doc: ReturnType<typeof buildDoc>; thumb: string }
const LIB_KEY = 'ostap_library';
let libCat: 'char' | 'enemy' = 'char'; // активна вкладка бібліотеки
const loadLib = (): LibItem[] => { try { return JSON.parse(localStorage.getItem(LIB_KEY) || '[]'); } catch { return []; } };
const storeLib = (lib: LibItem[]): void => { try { localStorage.setItem(LIB_KEY, JSON.stringify(lib)); } catch { status('Не вдалося зберегти — переповнення сховища браузера'); } };
function renderLibrary(): void {
  $<HTMLButtonElement>('tabChar').classList.toggle('active', libCat === 'char');
  $<HTMLButtonElement>('tabEnemy').classList.toggle('active', libCat === 'enemy');
  const box = $('libList'); box.innerHTML = '';
  const lib = loadLib().filter((c) => (c.cat ?? 'char') === libCat);
  if (!lib.length) { box.innerHTML = '<div class="libEmpty">Порожньо. Збери й тисни «Save».</div>'; return; }
  for (const c of lib) {
    const card = document.createElement('div'); card.className = 'libCard';
    const img = document.createElement('img'); img.src = c.thumb;
    const nm = document.createElement('div'); nm.className = 'libName'; nm.textContent = c.name;
    const del = document.createElement('button'); del.className = 'libDel'; del.textContent = '✕';
    card.onclick = () => { loadCharFromDoc(c.doc); status(`Завантажено: ${c.name}`); };
    del.onclick = (e) => { e.stopPropagation(); storeLib(loadLib().filter((x) => x.id !== c.id)); renderLibrary(); };
    card.appendChild(img); card.appendChild(nm); card.appendChild(del); box.appendChild(card);
  }
}
function saveCharacter(): void {
  const what = libCat === 'enemy' ? 'ворога' : 'персонажа';
  const name = prompt(`Назва ${what}:`, libCat === 'enemy' ? 'Ворог' : 'Остап'); if (!name) return;
  const lib = loadLib();
  const item: LibItem = { id: 'c' + Date.now(), name, cat: libCat, doc: buildDoc(), thumb: composeThumb(150, 190) };
  const i = lib.findIndex((x) => x.name === name && (x.cat ?? 'char') === libCat); // та сама назва В ЦІЙ вкладці -> заміна
  if (i >= 0) { item.id = lib[i].id; lib[i] = item; status(`Оновлено: ${name}`); }
  else { lib.push(item); status(`Збережено: ${name}`); }
  storeLib(lib); renderLibrary();
}
$<HTMLButtonElement>('saveChar').addEventListener('click', saveCharacter);
$<HTMLButtonElement>('tabChar').addEventListener('click', () => { libCat = 'char'; renderLibrary(); });
$<HTMLButtonElement>('tabEnemy').addEventListener('click', () => { libCat = 'enemy'; renderLibrary(); });

$<HTMLButtonElement>('exportBtn').addEventListener('click', () => {
  const doc = buildDoc();
  const blob = new Blob([JSON.stringify(doc)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'character.json'; a.click();
  status(`Експортовано character.json (частин: ${Object.keys(doc.images).length}) — кинь у гру`);
});
$<HTMLButtonElement>('importBtn').addEventListener('click', () => $<HTMLInputElement>('importInput').click());
$<HTMLInputElement>('importInput').addEventListener('change', (ev) => {
  const file = (ev.target as HTMLInputElement).files?.[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try { loadCharFromDoc(JSON.parse(String(reader.result))); status('Імпортовано.'); }
    catch { status('Помилка читання JSON'); }
  };
  reader.readAsText(file);
});

// ---- цикл тест-анімації ----
let raf = 0;
let lastTs = 0;
function tick(ts: number): void {
  if (!state.anim) return;
  const dt = (ts - lastTs) / 1000 || 0;
  lastTs = ts;
  state.animT += dt;
  draw();
  raf = requestAnimationFrame(tick);
}
function setAnim(name: string): void {
  cancelAnimationFrame(raf);
  state.anim = name || null;
  if (state.anim) { state.animT = 0; lastTs = performance.now(); raf = requestAnimationFrame(tick); } else draw();
}
$<HTMLSelectElement>('anim').addEventListener('change', (e) => setAnim((e.target as HTMLSelectElement).value));

window.addEventListener('resize', () => { resize(); draw(); });
restoreLocal();
resize(); refreshUI();
renderLibrary();
status('Завантаж орієнтир-силует і частини. G/R/S — рух/поворот/розмір, Q — півот, Ctrl+Z — відміна.');
