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
// ---- анімації (таймлайн) ----
interface KeyPose { rot: number; dx: number; dy: number; scale: number; flip: number; bend: number }
interface Keyframe { t: number; interp: 'linear' | 'smooth'; pose: Record<string, KeyPose> }
interface Clip { duration: number; keys: Keyframe[] }

// Порядок = шари ззаду наперед. Передня нога ПІД торсом (сорочка її перекриває).
const SLOT_DEFS = [
  { key: 'arm_back', label: 'Рука зад', len: 'arms', piv: [0.5, 0.08] },
  { key: 'leg_back', label: 'Нога зад', len: 'legs', piv: [0.5, 0.06] },
  { key: 'leg_front', label: 'Нога перед', len: 'legs', piv: [0.5, 0.06] },
  { key: 'torso', label: 'Торс', len: 'torso', piv: [0.5, 0.94] },
  { key: 'neck', label: 'Шия', len: 'neck', piv: [0.5, 0.9] },
  { key: 'head', label: 'Голова', len: 'head', piv: [0.5, 0.94] },
  { key: 'arm_front', label: 'Рука перед', len: 'arms', piv: [0.5, 0.08] },
] as const;
const def = (key: string) => SLOT_DEFS.find((d) => d.key === key)!;
const BASE = { torso: 105, head: 86, arms: 116, legs: 140, neck: 26 };

// Ієрархія кісток: торс — корінь; шия/руки/ноги — діти торса; голова — дитя шиї.
// Дитина обертається/рухається разом із батьком -> нічого не "відривається".
const PARENT: Record<string, string | null> = {
  torso: null, neck: 'torso', head: 'neck', arm_back: 'torso', arm_front: 'torso', leg_back: 'torso', leg_front: 'torso',
};
// Точка кріплення дитини в ЛОКАЛЬНІЙ системі батька (одиниці). Збережено стару
// геометрію: при bind (усі rot=0) позиції ті самі, що були (нічого не з'їжджає).
function conn(sel: string): { x: number; y: number } {
  const t = BASE.torso * state.prop.torso;
  switch (sel) {
    case 'neck': return { x: 0, y: -t };
    case 'head': return { x: 0, y: 0 };
    case 'arm_back': return { x: -7, y: -t + 12 };
    case 'arm_front': return { x: 7, y: -t + 12 };
    case 'leg_back': return { x: -9, y: -4 };
    case 'leg_front': return { x: 9, y: -4 };
    default: return { x: 0, y: 0 };
  }
}

const canvas = $<HTMLCanvasElement>('stage');
const ctx = canvas.getContext('2d')!;

const state = {
  images: new Map<string, HTMLCanvasElement>(),
  imageNames: [] as string[],
  ref: { canvas: null, rot: 0, scale: 1, dx: 0, dy: 0, flip: 1 } as Ref,
  showRef: true,
  anim: null as null | string, // активний кліп (редагується)
  animT: 0, // час на таймлайні
  clips: {} as Record<string, Clip>, // авторські анімації
  playing: false,
  selKeys: [] as number[], // вибрані ключі (для звʼязування)
  setup: null as Record<string, Slot> | null, // bind-поза, поки редагуємо кліп
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

const lenOf = (key: string): number => { const w = def(key).len as keyof typeof BASE; return BASE[w] * ((state.prop as Record<string, number>)[w] ?? 1); };
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
// Світовий трансформ слота з урахуванням ієрархії (рекурсивно по батьках).
function worldOf(sel: string): { x: number; y: number; rot: number } {
  const t = eff(sel);
  const p = PARENT[sel];
  if (!p) {
    return { x: state.origin.x + t.dx * s(), y: state.origin.y + t.dy * s(), rot: rad(t.rot) };
  }
  const pw = worldOf(p);
  const c = conn(sel);
  const lx = c.x + t.dx;
  const ly = c.y + t.dy;
  const cos = Math.cos(pw.rot), sin = Math.sin(pw.rot);
  return {
    x: pw.x + (lx * cos - ly * sin) * s(),
    y: pw.y + (lx * sin + ly * cos) * s(),
    rot: pw.rot + rad(t.rot),
  };
}
function anchorPx(sel: string): { x: number; y: number } {
  if (sel === 'ref') {
    const top = -(BASE.torso * state.prop.torso + BASE.head * state.prop.head);
    const bottom = BASE.legs * state.prop.legs;
    const cy = (top + bottom) / 2;
    return { x: state.origin.x + state.ref.dx * s(), y: state.origin.y + (cy + state.ref.dy) * s() };
  }
  return worldOf(sel);
}
// сумарний кут повороту слота (для рендеру/інверсії), 'ref' — власний
function worldRot(sel: string): number {
  return sel === 'ref' ? rad(state.ref.rot) : worldOf(sel).rot;
}
// дзеркалення X курсора у "несвічений" світ (бо сцену малюємо дзеркально при facing<0)
const mirrorX = (x: number): number => (state.facing < 0 ? 2 * state.origin.x - x : x);

// Ефективний трансформ = база + СПІЛЬНИЙ рух кореня (усе тіло) + ЛОКАЛЬНИЙ догин кістки.
// Завдяки спільному кореню частини не "відриваються" (фікс стрибка).
// Слоти — джерело істини для пози (таймлайн пише в них семпл кліпу). Тому eff = слот.
function eff(sel: string): Tf { return tf(sel); }

// Рух усього тіла (корінь) — однаковий для всіх частин: підскок, погойдування.
function animRoot(name: string, t: number): { ddx: number; ddy: number } {
  if (name === 'walk') return { ddx: 0, ddy: -Math.abs(Math.sin(t * 5.5)) * 3 };
  if (name === 'run') return { ddx: 0, ddy: -Math.abs(Math.sin(t * 9)) * 5 };
  if (name === 'jump') {
    const ph = (t % 1.6) / 1.6; let ddy: number;
    if (ph < 0.16) ddy = (ph / 0.16) * 10;
    else if (ph < 0.35) ddy = 10 - ((ph - 0.16) / 0.19) * 48;
    else if (ph < 0.6) ddy = -38;
    else if (ph < 0.85) ddy = -38 + ((ph - 0.6) / 0.25) * 48;
    else ddy = 10 - ((ph - 0.85) / 0.15) * 10;
    return { ddx: 0, ddy };
  }
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
    const ph = (t % 1.6) / 1.6;
    const air = ph >= 0.16 && ph < 0.85 ? Math.sin(((ph - 0.16) / 0.69) * Math.PI) : 0;
    if (key.startsWith('leg')) return { drot: -air * 26 + (key.includes('front') ? 6 : -6), ddx: 0, ddy: 0 };
    if (key.startsWith('arm')) return { drot: -air * 28, ddx: 0, ddy: 0 };
    return z;
  }
  if (name === 'attack') {
    const ap = (t % 0.7) / 0.7;
    let af: number;
    if (ap < 0.45) af = (ap / 0.45) * 30; else if (ap < 0.6) af = 30 - ((ap - 0.45) / 0.15) * 70; else af = -40 + ((ap - 0.6) / 0.4) * 40;
    if (key === 'arm_front') return { drot: af, ddx: 0, ddy: 0 };
    if (key === 'torso') return { drot: ap < 0.45 ? (ap / 0.45) * 4 : -4 + ((ap - 0.45) / 0.55) * 4, ddx: 0, ddy: 0 };
    return z;
  }
  if (name === 'hurt') {
    const r = Math.sin(Math.min(1, (t % 0.6) / 0.6) * Math.PI);
    if (key === 'torso') return { drot: r * 6, ddx: 0, ddy: 0 };
    if (key === 'head') return { drot: r * 7, ddx: 0, ddy: 0 };
    if (key.startsWith('arm')) return { drot: -r * 8, ddx: 0, ddy: 0 };
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
    const crouch = ph < 0.16 ? ph / 0.16 : ph > 0.85 ? 1 - (ph - 0.85) / 0.15 : 0;
    const air = ph >= 0.16 && ph < 0.85 ? Math.sin(((ph - 0.16) / 0.69) * Math.PI) : 0;
    if (key.startsWith('leg')) return -(crouch * 28 + air * 50);
    if (key.startsWith('arm')) return -air * 30;
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
const snapshot = (): string => JSON.stringify({ prop: state.prop, slots: state.slots, ref: { rot: state.ref.rot, scale: state.ref.scale, dx: state.ref.dx, dy: state.ref.dy, flip: state.ref.flip }, sel: state.selected, clips: state.clips });
function pushUndo(): void { undoStack.push(snapshot()); if (undoStack.length > 80) undoStack.shift(); }
function undo(): void {
  const s0 = undoStack.pop(); if (!s0) { status('Нема що відміняти'); return; }
  const o = JSON.parse(s0);
  Object.assign(state.prop, o.prop);
  for (const k of Object.keys(state.slots)) if (o.slots[k]) Object.assign(state.slots[k], o.slots[k]);
  Object.assign(state.ref, o.ref);
  if (o.clips) state.clips = o.clips;
  if (o.sel) state.selected = o.sel;
  if (state.anim) { refreshTimeline(); }
  refreshUI();
}

// автозбереження збірки (без картинок — їх перетягнеш знову, релінк збереже позиції)
function saveLocal(): void {
  try { localStorage.setItem('ostap_char', JSON.stringify({ prop: state.prop, slots: rigSlots(), facing: state.facing, clips: state.clips })); } catch { /* ignore */ }
}
function restoreLocal(): void {
  try {
    const o = JSON.parse(localStorage.getItem('ostap_char') || 'null');
    if (!o) return;
    if (o.prop) Object.assign(state.prop, o.prop);
    if (typeof o.facing === 'number') state.facing = o.facing;
    if (o.clips) state.clips = o.clips;
    if (o.slots) for (const k of Object.keys(state.slots)) if (o.slots[k]) Object.assign(state.slots[k], o.slots[k]);
  } catch { /* ignore */ }
}

// ---- рендер ----
function applyOrigin(): void {
  state.origin.x = canvas.width * 0.5 + state.pan.x;
  state.origin.y = canvas.height * 0.55 + state.pan.y; // стегно ~центр -> скелет по центру
}
function resize(): void {
  canvas.width = canvas.clientWidth; canvas.height = canvas.clientHeight;
  applyOrigin();
  state.viewScale = (Math.min(canvas.width, canvas.height) / 470) * state.zoom; // ввесь персонаж влазить
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
  ctx.rotate(worldRot(sel)); // сумарний кут (з урахуванням батьків)
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
    // нижня частина — обертається на bend навколо суглоба (інверсія при дзеркаленні)
    ctx.save();
    ctx.translate(jx, cutY); ctx.rotate(rad(slot.bend * (slot.flip < 0 ? -1 : 1))); ctx.translate(-jx, -cutY);
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
  // лінія землі — де мають стояти ноги
  const groundY = toPx(0, -4 + BASE.legs * state.prop.legs).y;
  ctx.strokeStyle = 'rgba(255,255,255,0.16)'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(0, groundY); ctx.lineTo(canvas.width, groundY); ctx.stroke();
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
  const ang = -worldRot(sel); const dx = sx - a.x, dy = sy - a.y;
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
  if (/neck|шия|шиї/.test(n)) return 'neck';
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
  if (state.mode === 'G') {
    const pr = state.selected !== 'ref' && PARENT[state.selected] ? worldOf(PARENT[state.selected]!).rot : 0;
    const wdx = mx - state.startMx, wdy = my - state.startMy;
    const c = Math.cos(-pr), s2 = Math.sin(-pr);
    t.dx = state.orig.dx + (wdx * c - wdy * s2) / s();
    t.dy = state.orig.dy + (wdx * s2 + wdy * c) / s();
  } else if (state.mode === 'R') { const ang = Math.atan2(my - a.y, mx - a.x); t.rot = state.orig.rot + ((ang - state.startAng) * 180) / Math.PI; }
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
  else if (drag) {
    const wx = mirrorX(state.mouse.x);
    const pr = drag.key !== 'ref' && PARENT[drag.key] ? worldOf(PARENT[drag.key]!).rot : 0;
    const wdx = wx - drag.sx, wdy = state.mouse.y - drag.sy;
    const c = Math.cos(-pr), s2 = Math.sin(-pr);
    tf(drag.key).dx = drag.dx + (wdx * c - wdy * s2) / s();
    tf(drag.key).dy = drag.dy + (wdx * s2 + wdy * c) / s();
    draw();
  }
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
  else if (ev.code === 'KeyK') { ev.preventDefault(); if (state.anim) setKey(); }
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
function buildDoc(): { version: number; proportions: typeof state.prop; slots: Record<string, Slot>; images: Record<string, string>; facing: number; clips: Record<string, Clip> } {
  const rig = rigSlots();
  const used = new Set(Object.values(rig).map((sl) => sl.image).filter(Boolean) as string[]);
  const images: Record<string, string> = {};
  for (const n of used) { const cv = state.images.get(n); if (cv) images[n] = cv.toDataURL('image/png'); }
  return { version: 4, proportions: { ...state.prop }, slots: JSON.parse(JSON.stringify(rig)), images, facing: state.facing, clips: JSON.parse(JSON.stringify(state.clips)) };
}
function loadCharFromDoc(doc: { proportions?: typeof state.prop; slots?: Record<string, Slot>; images?: Record<string, string>; facing?: number; clips?: Record<string, Clip> }): void {
  state.anim = null; exitClip(); // вийти з режиму анімації перед завантаженням
  if (typeof doc.facing === 'number') state.facing = doc.facing;
  if (doc.proportions) Object.assign(state.prop, doc.proportions);
  if (doc.clips) state.clips = doc.clips;
  if (doc.slots) for (const k of Object.keys(state.slots)) if (doc.slots[k]) Object.assign(state.slots[k], doc.slots[k]);
  if (doc.images) for (const [name, data] of Object.entries(doc.images)) {
    const im = new Image();
    im.onload = () => { state.images.set(name, imageToCanvas(im)); if (!state.imageNames.includes(name)) state.imageNames.push(name); refreshUI(); };
    im.src = data;
  }
  refreshUI();
}
// мініатюра для бібліотеки (bind-поза, ієрархія, цілі кінцівки)
function composeThumb(w: number, h: number): string {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const cx = c.getContext('2d')!; const us = (h * 0.8) / 430; const ox = w / 2, oy = h * 0.46;
  const cache: Record<string, { x: number; y: number; rot: number }> = {};
  const wof = (sel: string): { x: number; y: number; rot: number } => {
    if (cache[sel]) return cache[sel];
    const sl = state.slots[sel]; const p = PARENT[sel];
    let r: { x: number; y: number; rot: number };
    if (!p) r = { x: ox + sl.dx * us, y: oy + sl.dy * us, rot: rad(sl.rot) };
    else {
      const pw = wof(p); const cn = conn(sel); const lx = cn.x + sl.dx, ly = cn.y + sl.dy;
      const co = Math.cos(pw.rot), si = Math.sin(pw.rot);
      r = { x: pw.x + (lx * co - ly * si) * us, y: pw.y + (lx * si + ly * co) * us, rot: pw.rot + rad(sl.rot) };
    }
    cache[sel] = r; return r;
  };
  for (const d of SLOT_DEFS) {
    const sl = state.slots[d.key]; const img = sl.image ? state.images.get(sl.image) : undefined; if (!img) continue;
    const wt = wof(d.key);
    cx.save();
    cx.translate(wt.x, wt.y);
    cx.rotate(wt.rot); const sc = sl.scale * us; cx.scale(sl.flip * sc, sc);
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
// Export у гру: пишемо в localStorage (той самий домен, що й гра) — гра підхопить
// при наступному відкритті. Працює на ЦЬОМУ браузері/пристрої без git і без мене.
$<HTMLButtonElement>('toGameBtn').addEventListener('click', () => {
  try { localStorage.setItem('zag_game_char', JSON.stringify(buildDoc())); status('✔ Відправлено в гру. Онови/відкрий вкладку гри.'); }
  catch { status('Не вдалося — переповнення сховища браузера'); }
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

// ---- таймлайн / авторські анімації ----
const SMOOTH = (f: number): number => f * f * (3 - 2 * f);
function curClip(): Clip | null { return state.anim ? (state.clips[state.anim] ??= { duration: 1, keys: [] }) : null; }
function rigSlots(): Record<string, Slot> { return state.setup ?? state.slots; } // bind-поза
function enterClip(): void { if (!state.setup) state.setup = JSON.parse(JSON.stringify(state.slots)) as Record<string, Slot>; }
function exitClip(): void { if (state.setup) { for (const k of Object.keys(state.slots)) Object.assign(state.slots[k], state.setup[k]); state.setup = null; } }

function sampleClip(clip: Clip, t: number, sel: string): KeyPose {
  const su = rigSlots()[sel];
  const base: KeyPose = { rot: su.rot, dx: su.dx, dy: su.dy, scale: su.scale, flip: su.flip, bend: su.bend };
  const ks = clip.keys;
  if (!ks.length) return base;
  if (t <= ks[0].t) return ks[0].pose[sel] ?? base;
  const last = ks[ks.length - 1];
  if (t >= last.t) return last.pose[sel] ?? base;
  for (let i = 0; i < ks.length - 1; i++) {
    const a = ks[i], b = ks[i + 1];
    if (t >= a.t && t <= b.t) {
      let f = (t - a.t) / ((b.t - a.t) || 1);
      if (a.interp === 'smooth') f = SMOOTH(f);
      const pa = a.pose[sel] ?? base, pb = b.pose[sel] ?? base;
      const L = (x: number, y: number): number => x + (y - x) * f;
      return { rot: L(pa.rot, pb.rot), dx: L(pa.dx, pb.dx), dy: L(pa.dy, pb.dy), scale: L(pa.scale, pb.scale), flip: pa.flip, bend: L(pa.bend, pb.bend) };
    }
  }
  return base;
}
function loadFrame(t: number): void {
  state.animT = t;
  const clip = curClip();
  if (clip) for (const d of SLOT_DEFS) {
    const sp = sampleClip(clip, t, d.key); const sl = state.slots[d.key];
    sl.rot = sp.rot; sl.dx = sp.dx; sl.dy = sp.dy; sl.scale = sp.scale; sl.bend = sp.bend;
  }
}
function snapPose(): Record<string, KeyPose> {
  const pose: Record<string, KeyPose> = {};
  for (const d of SLOT_DEFS) { const sl = state.slots[d.key]; pose[d.key] = { rot: sl.rot, dx: sl.dx, dy: sl.dy, scale: sl.scale, flip: sl.flip, bend: sl.bend }; }
  return pose;
}
function setKey(): void {
  const clip = curClip(); if (!clip) { status('Вибери кліп у таймлайні'); return; }
  pushUndo();
  const t = state.animT; const i = clip.keys.findIndex((k) => Math.abs(k.t - t) < 0.02);
  if (i >= 0) clip.keys[i].pose = snapPose();
  else { clip.keys.push({ t, interp: 'linear', pose: snapPose() }); clip.keys.sort((a, b) => a.t - b.t); }
  refreshTimeline(); status('⬤ Ключ поставлено');
}
function delKey(): void {
  const clip = curClip(); if (!clip) return;
  pushUndo(); clip.keys = clip.keys.filter((k) => Math.abs(k.t - state.animT) >= 0.02);
  state.selKeys = []; refreshTimeline();
}
function resetAnim(): void {
  const clip = curClip(); if (!clip) return;
  pushUndo(); clip.keys = []; state.selKeys = [];
  loadFrame(state.animT); refreshTimeline(); refreshUI(); status('↺ Анімацію очищено');
}
function bakeProcedural(): void {
  const clip = curClip(); if (!clip || !state.anim) return;
  pushUndo();
  const N = 8; const dur = clip.duration; clip.keys = [];
  for (let i = 0; i <= N; i++) {
    const t = (i / N) * dur; const pose: Record<string, KeyPose> = {};
    for (const d of SLOT_DEFS) {
      const sl = rigSlots()[d.key];
      const o = animOff(state.anim, t, d.key);
      let dx = sl.dx + o.ddx, dy = sl.dy + o.ddy;
      if (d.key === 'torso') { const r = animRoot(state.anim, t); dx += r.ddx; dy += r.ddy; }
      pose[d.key] = { rot: sl.rot + o.drot * state.animDir, dx, dy, scale: sl.scale, flip: sl.flip, bend: sl.bend + animBend(state.anim, t, d.key) * state.animDir };
    }
    clip.keys.push({ t, interp: 'linear', pose });
  }
  loadFrame(state.animT); refreshTimeline(); refreshUI(); status('⚙ Запечено базову — далі редагуй ключі');
}
function setInterp(mode: 'linear' | 'smooth'): void {
  const clip = curClip(); if (!clip || !state.selKeys.length) { status('Виділи ключі (Shift-клік по точках)'); return; }
  pushUndo(); for (const i of state.selKeys) if (clip.keys[i]) clip.keys[i].interp = mode;
  refreshTimeline(); status(mode === 'smooth' ? 'Звʼязано: згладжено' : 'Звʼязано: лінійно');
}
function refreshTimeline(): void {
  const clip = curClip(); const dur = clip ? clip.duration : 1;
  const tl = $<HTMLInputElement>('timeline'); tl.max = String(dur); tl.value = String(Math.min(state.animT, dur));
  $('tlTime').textContent = state.animT.toFixed(2);
  $<HTMLInputElement>('dur').value = String(dur);
  $<HTMLButtonElement>('playBtn').textContent = state.playing ? '⏸' : '▶';
  $<HTMLSelectElement>('anim').value = state.anim ?? '';
  const track = $('keyTrack'); track.innerHTML = '';
  if (clip) for (let i = 0; i < clip.keys.length; i++) {
    const k = clip.keys[i];
    const dot = document.createElement('div');
    dot.className = 'keyDot' + (state.selKeys.includes(i) ? ' sel' : '') + (k.interp === 'smooth' ? ' smooth' : '');
    dot.style.left = `${(k.t / dur) * 100}%`;
    dot.onclick = (e) => {
      if (e.shiftKey) { const j = state.selKeys.indexOf(i); if (j >= 0) state.selKeys.splice(j, 1); else state.selKeys.push(i); }
      else state.selKeys = [i];
      loadFrame(k.t); refreshTimeline(); refreshUI();
    };
    track.appendChild(dot);
  }
}
let raf = 0;
let lastTs = 0;
function tick(ts: number): void {
  if (!state.playing) return;
  const dt = (ts - lastTs) / 1000 || 0; lastTs = ts;
  const clip = curClip();
  if (clip) { state.animT += dt; if (state.animT > clip.duration) state.animT %= clip.duration; loadFrame(state.animT); }
  draw();
  $('tlTime').textContent = state.animT.toFixed(2);
  $<HTMLInputElement>('timeline').value = String(state.animT);
  raf = requestAnimationFrame(tick);
}
function play(on: boolean): void {
  state.playing = on && !!state.anim;
  cancelAnimationFrame(raf);
  if (state.playing) { lastTs = performance.now(); raf = requestAnimationFrame(tick); }
  refreshTimeline();
}
$<HTMLSelectElement>('anim').addEventListener('change', (e) => {
  play(false);
  const v = (e.target as HTMLSelectElement).value;
  if (v) { state.anim = v; enterClip(); state.animT = 0; state.selKeys = []; loadFrame(0); }
  else { state.anim = null; exitClip(); }
  refreshTimeline(); refreshUI();
});
$<HTMLButtonElement>('playBtn').addEventListener('click', () => play(!state.playing));
$<HTMLInputElement>('timeline').addEventListener('input', (e) => { play(false); loadFrame(Number((e.target as HTMLInputElement).value)); refreshTimeline(); refreshUI(); });
$<HTMLInputElement>('dur').addEventListener('input', (e) => { const c = curClip(); if (c) { c.duration = Math.max(0.2, Number((e.target as HTMLInputElement).value)); refreshTimeline(); } });
$<HTMLButtonElement>('keyBtn').addEventListener('click', setKey);
$<HTMLButtonElement>('delKeyBtn').addEventListener('click', delKey);
$<HTMLButtonElement>('bakeBtn').addEventListener('click', bakeProcedural);
$<HTMLButtonElement>('linkLin').addEventListener('click', () => setInterp('linear'));
$<HTMLButtonElement>('linkSmooth').addEventListener('click', () => setInterp('smooth'));
$<HTMLButtonElement>('resetAnim').addEventListener('click', resetAnim);

window.addEventListener('resize', () => { resize(); draw(); });
restoreLocal();
resize(); refreshUI();
renderLibrary();
refreshTimeline();
status('Завантаж орієнтир-силует і частини. G/R/S — рух/поворот/розмір, Q — півот, Ctrl+Z — відміна.');
