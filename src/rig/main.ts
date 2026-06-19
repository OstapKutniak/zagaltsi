import { keyImage, hasSolidBackground, imageToCanvas } from './keyer';
import { initLevelEditor } from '../level/editor';
import { idbGet, idbSet } from '../store';
import { ghCommit } from '../github';
import { pullCharLib } from '../sync';

// ---- Конструктор персонажа, керування у стилі Blender ----
// Слоти під PNG (цілі кінцівки) + орієнтир-силует (теж трансформовний).
// Гарячі клавіші за ФІЗИЧНОЮ клавішею (ev.code) — працюють за будь-якої розкладки:
// G рух · R поворот · S розмір · Q півот · Ctrl+Z відміна. Клік — підтвердити, Esc — скасувати.

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const rad = (d: number): number => (d * Math.PI) / 180;

interface Tf { rot: number; scale: number; dx: number; dy: number; flip: number; sx: number; sy: number; gscale: number }
interface Slot extends Tf { image: string | null; pivotX: number; pivotY: number; cut: number | null; bend: number; bendFlip: boolean }
interface Ref extends Tf { canvas: HTMLCanvasElement | null }
// ---- анімації (таймлайн) ----
interface KeyPose { rot: number; dx: number; dy: number; scale: number; flip: number; bend: number }
interface Keyframe { t: number; interp: 'linear' | 'smooth'; pose: Record<string, KeyPose> }
interface Clip { duration: number; keys: Keyframe[]; hotkey?: string }

// Порядок = шари ззаду наперед. Передня нога ПІД торсом (сорочка її перекриває).
// Порядок = шари ззаду наперед. Обличчя (очі/брови/рот) — діти голови, поверх неї.
const SLOT_DEFS = [
  { key: 'arm_back', label: 'Задня рука', len: 'arms', piv: [0.5, 0.08] },
  { key: 'leg_back', label: 'Задня нога', len: 'legs', piv: [0.5, 0.06] },
  { key: 'leg_front', label: 'Передня нога', len: 'legs', piv: [0.5, 0.06] },
  { key: 'torso', label: 'Торс', len: 'torso', piv: [0.5, 0.94] },
  { key: 'neck', label: 'Шия', len: 'neck', piv: [0.5, 0.9] },
  { key: 'head', label: 'Голова', len: 'head', piv: [0.5, 0.94] },
  { key: 'eye_back', label: 'Заднє око', len: 'eye', piv: [0.5, 0.5] },
  { key: 'eye_front', label: 'Переднє око', len: 'eye', piv: [0.5, 0.5] },
  { key: 'brow_back', label: 'Задня брова', len: 'brow', piv: [0.5, 0.5] },
  { key: 'brow_front', label: 'Передня брова', len: 'brow', piv: [0.5, 0.5] },
  { key: 'mouth', label: 'Рот', len: 'mouth', piv: [0.5, 0.5] },
  { key: 'arm_front', label: 'Передня рука', len: 'arms', piv: [0.5, 0.08] },
] as const;
// Рядки списку частин (порядок ВІДОБРАЖЕННЯ; пари — поруч). Не плутати зі SLOT_DEFS (шари).
// Обличчя винесено в окреме підменю «Голова» (ПКМ по кнопці Голова).
const LIST_ROWS: string[][] = [
  ['arm_front'], ['head'], ['neck'], ['torso'], ['leg_front'], ['leg_back'], ['arm_back'], ['ref'],
];
const FACE_ROWS: string[][] = [
  ['brow_front'], ['brow_back'], ['eye_front'], ['eye_back'], ['mouth'],
];
const def = (key: string) => SLOT_DEFS.find((d) => d.key === key)!;
const BASE = { torso: 105, head: 86, arms: 116, legs: 140, neck: 26, eye: 16, brow: 14, mouth: 20 };

// Ієрархія кісток: торс — корінь; шия/руки/ноги — діти торса; голова — дитя шиї.
// Дитина обертається/рухається разом із батьком -> нічого не "відривається".
const PARENT: Record<string, string | null> = {
  torso: null, neck: 'torso', head: 'neck', arm_back: 'torso', arm_front: 'torso', leg_back: 'torso', leg_front: 'torso',
  eye_back: 'head', eye_front: 'head', brow_back: 'head', brow_front: 'head', mouth: 'head',
};
// Точка кріплення дитини в ЛОКАЛЬНІЙ системі батька (одиниці). Збережено стару
// геометрію: при bind (усі rot=0) позиції ті самі, що були (нічого не з'їжджає).
function conn(sel: string): { x: number; y: number } {
  const t = BASE.torso * state.prop.torso;
  const h = BASE.head * state.prop.head; // для обличчя — відносно голови (стартові позиції, далі тягнеш G)
  switch (sel) {
    case 'neck': return { x: 0, y: -t };
    case 'head': return { x: 0, y: 0 };
    case 'arm_back': return { x: -7, y: -t + 12 };
    case 'arm_front': return { x: 7, y: -t + 12 };
    case 'leg_back': return { x: -9, y: -4 };
    case 'leg_front': return { x: 9, y: -4 };
    case 'eye_back': return { x: -h * 0.13, y: -h * 0.55 };
    case 'eye_front': return { x: h * 0.13, y: -h * 0.55 };
    case 'brow_back': return { x: -h * 0.13, y: -h * 0.66 };
    case 'brow_front': return { x: h * 0.13, y: -h * 0.66 };
    case 'mouth': return { x: 0, y: -h * 0.34 };
    default: return { x: 0, y: 0 };
  }
}

const canvas = $<HTMLCanvasElement>('stage');
const ctx = canvas.getContext('2d')!;

const state = {
  images: new Map<string, HTMLCanvasElement>(),
  imageNames: [] as string[],
  ref: { canvas: null, rot: 0, scale: 1, dx: 0, dy: 0, flip: 1, sx: 1, sy: 1, gscale: 1 } as Ref,
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
  mode: null as null | 'R' | 'S' | 'G' | 'B',
  axis: null as null | 'x' | 'z', // обмеження осі (X/Z) під час G/S, як у Blender
  orig: null as null | Tf,
  origBend: 0, // збережений bend перед режимом B
  startAng: 0,
  startDist: 1,
  startMx: 0,
  startMy: 0,
};
for (const d of SLOT_DEFS) state.slots[d.key] = { image: null, pivotX: d.piv[0], pivotY: d.piv[1], rot: 0, scale: 1, dx: 0, dy: 0, flip: 1, sx: 1, sy: 1, gscale: 1, cut: null, bend: 0, bendFlip: false };

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
// gs — накопичений МАСШТАБ (gscale) ланцюга: масштаб батька поширюється на дітей
// (позицію кріплення й власний арт), як і обертання.
function worldOf(sel: string): { x: number; y: number; rot: number; gs: number } {
  const t = eff(sel);
  const p = PARENT[sel];
  if (!p) {
    return { x: state.origin.x + t.dx * s(), y: state.origin.y + t.dy * s(), rot: rad(t.rot), gs: t.gscale };
  }
  const pw = worldOf(p);
  const c = conn(sel);
  const lx = c.x + t.dx;
  const ly = c.y + t.dy;
  const cos = Math.cos(pw.rot), sin = Math.sin(pw.rot);
  return {
    x: pw.x + (lx * cos - ly * sin) * pw.gs * s(),
    y: pw.y + (lx * sin + ly * cos) * pw.gs * s(),
    rot: pw.rot + rad(t.rot),
    gs: pw.gs * t.gscale,
  };
}
const worldGs = (sel: string): number => (sel === 'ref' ? state.ref.gscale : worldOf(sel).gs);
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
// Поза: авторські ключі (вже в слотах) / редагування -> слот; порожній кліп при ▶ -> процедурне прев'ю.
function eff(sel: string): Tf {
  if (sel === 'ref' || !state.anim) return tf(sel);
  const clip = state.clips[state.anim];
  if (clip && clip.keys.length) return tf(sel); // авторські ключі вже в слотах (loadFrame)
  const su = rigSlots()[sel]; // процедурна поза — семплимо за animT (і на ПАУЗІ теж, для скрабу)
  const o = animOff(state.anim, state.animT, sel);
  let dx = su.dx + o.ddx, dy = su.dy + o.ddy;
  if (sel === 'torso') { const r = animRoot(state.anim, state.animT); dx += r.ddx; dy += r.ddy; }
  return { rot: su.rot + o.drot * state.animDir, scale: su.scale, dx, dy, flip: su.flip, sx: su.sx, sy: su.sy, gscale: su.gscale };
}

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
    const amp = name === 'run' ? 48 : 24;
    const aArm = name === 'run' ? 46 : 20;
    const ph = t * spd;
    const back = Math.sin(ph);
    const front = Math.sin(ph + Math.PI);
    const lean = name === 'run' ? 12 : 0; // біг — нахил торса вперед
    if (key === 'leg_front') return { drot: front * amp, ddx: 0, ddy: 0 };
    if (key === 'leg_back') return { drot: back * amp, ddx: 0, ddy: 0 };
    if (key === 'arm_front') return { drot: back * aArm, ddx: 0, ddy: 0 };
    if (key === 'arm_back') return { drot: front * aArm, ddx: 0, ddy: 0 };
    if (key === 'torso') return { drot: lean + Math.sin(ph) * 2, ddx: 0, ddy: 0 };
    if (key === 'head' && name === 'run') return { drot: -lean * 0.6, ddx: 0, ddy: 0 };
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
  try { localStorage.setItem('ostap_char', JSON.stringify({ prop: state.prop, slots: rigForExport(), facing: state.facing, animDir: state.animDir, clips: state.clips })); } catch { /* ignore */ }
}
function restoreLocal(): void {
  try {
    const o = JSON.parse(localStorage.getItem('ostap_char') || 'null');
    if (!o) return;
    if (o.prop) Object.assign(state.prop, o.prop);
    if (typeof o.facing === 'number') state.facing = o.facing;
    if (typeof o.animDir === 'number') state.animDir = o.animDir;
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
  if (!canvas.offsetWidth) return; // прихований (інший розділ) — не чіпати, інакше canvas 0×0 і viewScale 0
  canvas.width = canvas.clientWidth; canvas.height = canvas.clientHeight;
  applyOrigin();
  state.viewScale = (Math.min(canvas.width, canvas.height) / 470) * state.zoom; // ввесь персонаж влазить
}
// межі персонажа в екранних px — для габаритної рамки
const charBB = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
// ФІКСОВАНА лінія маківки (одиниці) — орієнтир висоти базового персонажа: калібрується
// раз під поточного персонажа (Остапа) і зберігається, щоб під неї рівняти інших.
let headLineUY: number | null = (() => { const v = localStorage.getItem('zag_head_uy2'); return v != null ? Number(v) : null; })();
function resetBounds(): void { charBB.minX = charBB.minY = Infinity; charBB.maxX = charBB.maxY = -Infinity; }
function accumBounds(a: { x: number; y: number }, ang: number, sxv: number, syv: number, ox: number, oy: number, w: number, h: number): void {
  const cos = Math.cos(ang), sin = Math.sin(ang);
  for (const c of [[ox, oy], [ox + w, oy], [ox, oy + h], [ox + w, oy + h]]) {
    const px = a.x + cos * (sxv * c[0]) - sin * (syv * c[1]);
    const py = a.y + sin * (sxv * c[0]) + cos * (syv * c[1]);
    if (px < charBB.minX) charBB.minX = px; if (px > charBB.maxX) charBB.maxX = px;
    if (py < charBB.minY) charBB.minY = py; if (py > charBB.maxY) charBB.maxY = py;
  }
}
function drawImageAt(sel: string, alpha: number): void {
  const img = imgOf(sel); if (!img) return;
  const t = eff(sel); const p = pivotOf(sel); const a = anchorPx(sel);
  const slot = sel === 'ref' ? null : state.slots[sel];
  const w = img.width, h = img.height;
  const ox = -p.x * w, oy = -p.y * h;
  ctx.save();
  ctx.globalAlpha *= alpha; // multiplicative — works with ghost outer alpha
  ctx.translate(a.x, a.y);
  ctx.rotate(worldRot(sel)); // сумарний кут (з урахуванням батьків)
  const wgs = worldGs(sel); // накопичений масштаб ланцюга (скейл батька -> на дітей)
  const scx = t.scale * t.sx * wgs * s(), scy = t.scale * t.sy * wgs * s(); // sx/sy — неоднорідний (S X / S Z)
  ctx.scale(t.flip * scx, scy); // flip<0 — дзеркало по X навколо півота
  if (sel !== 'ref' && !_ghostDraw) accumBounds(a, worldRot(sel), t.flip * scx, scy, ox, oy, w, h);

  if (slot && slot.cut != null) {
    const cutY = oy + slot.cut * h; // лінія розрізу в локальних координатах
    const jx = ox + 0.5 * w; // суглоб згину — по центру вздовж кістки
    // верхня частина
    ctx.save();
    ctx.beginPath(); ctx.rect(ox - 2, oy - 2, w + 4, slot.cut * h + 4); ctx.clip();
    ctx.drawImage(img, ox, oy);
    ctx.restore();
    // нижня частина — обертається на bend навколо суглоба (інверсія при дзеркаленні)
    const proc = !!(state.anim && !(state.clips[state.anim]?.keys.length)); // згин процедурно — і на паузі (скраб)
    const bendVal = (slot.bend + (proc ? animBend(state.anim as string, state.animT, sel) * state.animDir : 0)) * (slot.flip < 0 ? -1 : 1) * (slot.bendFlip ? -1 : 1);
    ctx.save();
    ctx.translate(jx, cutY); ctx.rotate(rad(bendVal)); ctx.translate(-jx, -cutY);
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
  const groundUY = -4 + BASE.legs * state.prop.legs;
  const groundY = toPx(0, groundUY).y;
  ctx.strokeStyle = 'rgba(255,255,255,0.16)'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(0, groundY); ctx.lineTo(canvas.width, groundY); ctx.stroke();
  // ФІКСОВАНА лінія маківки (орієнтир висоти) — під неї рівняємо інших персонажів
  if (headLineUY != null) { const hy = toPx(0, headLineUY).y; ctx.beginPath(); ctx.moveTo(0, hy); ctx.lineTo(canvas.width, hy); ctx.stroke(); }
  // Ghost / first-frame overlays — працює і для keyframe-, і для процедурних анімацій
  if (state.anim && (ghostEnabled || firstFrameEnabled)) {
    const _gc = curClip();
    const _hasKeys = !!(_gc && _gc.keys.length);
    const _dur = _gc?.duration ?? 2;
    if (ghostEnabled) {
      if (_hasKeys) {
        // Keyframe: показуємо ключі поблизу поточного кадру
        const curF = state.animT * FPS;
        const cands = _gc!.keys.filter((k) => { const df = Math.abs(k.t * FPS - curF); return df > 0.5 && (k.t * FPS < curF ? df <= ghostBefore : df <= ghostAfter); });
        cands.sort((a, b) => Math.abs(b.t - state.animT) - Math.abs(a.t - state.animT));
        for (const k of cands) { const df = Math.abs(k.t * FPS - curF); drawGhostLayer(k.t, Math.max(0.03, 0.5 * Math.pow(0.8, Math.floor(df) - 1))); }
      } else {
        // Процедурна: показуємо кадри ±N від поточного, від далеких до ближніх
        const maxD = Math.max(ghostBefore, ghostAfter);
        for (let df = maxD; df >= 1; df--) {
          if (df <= ghostBefore) { const t = ((state.animT - df / FPS) % _dur + _dur) % _dur; drawGhostLayer(t, Math.max(0.03, 0.5 * Math.pow(0.8, df - 1))); }
          if (df <= ghostAfter)  { const t = (state.animT + df / FPS) % _dur; drawGhostLayer(t, Math.max(0.03, 0.5 * Math.pow(0.8, df - 1))); }
        }
      }
    }
    if (firstFrameEnabled) {
      const firstT = _hasKeys ? _gc!.keys[0].t : 0;
      if (Math.abs(firstT - state.animT) > 0.01) drawGhostLayer(firstT, 0.5);
    }
  }

  resetBounds(); // межі персонажа збираються під час малювання частин
  ctx.save();
  if (state.facing < 0) { ctx.translate(state.origin.x, 0); ctx.scale(-1, 1); ctx.translate(-state.origin.x, 0); }
  if (state.showRef) drawImageAt('ref', state.selected === 'ref' ? 0.5 : 0.22);
  for (const d of SLOT_DEFS) drawImageAt(d.key, 1);

  // маркери pivot
  const drawMark = (sel: string) => {
    const a = anchorPx(sel); const on = sel === state.selected;
    ctx.strokeStyle = on ? '#ff9a1f' : 'rgba(255,255,255,0.5)'; ctx.fillStyle = ctx.strokeStyle;
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
      const t = eff(state.selected); const a = anchorPx(state.selected); const sc = t.scale * worldGs(state.selected) * s();
      const lx = (0.5 - ssel.pivotX) * img.width * t.flip;
      const ly = (ssel.cut - ssel.pivotY) * img.height;
      const cr = Math.cos(rad(t.rot)), sr = Math.sin(rad(t.rot));
      ctx.fillStyle = '#e8e8e8';
      ctx.beginPath(); ctx.arc(a.x + (lx * cr - ly * sr) * sc, a.y + (lx * sr + ly * cr) * sc, 5, 0, Math.PI * 2); ctx.fill();
    }
  }

  ctx.restore(); // кінець дзеркального шару (підказка нижче — нормальним текстом)

  // КАЛІБРАЦІЯ лінії маківки: раз захоплюємо верхівку поточного персонажа й заморожуємо
  if (isFinite(charBB.minX) && headLineUY == null && !state.anim && imgOf('head')) {
    headLineUY = (charBB.minY - state.origin.y) / s();
    try { localStorage.setItem('zag_head_uy2', String(headLineUY)); } catch { /* ignore */ }
  }

  // mode hint text (after ctx.restore so it's not mirrored)
  if (state.mode || state.pivotMode || state.cutMode) {
    ctx.fillStyle = '#e8e8e8'; ctx.font = '14px monospace';
    const txt = state.cutMode ? 'РОЗРІЗ: клікни, де різати (лікоть/коліно)' : state.pivotMode ? 'PIVOT: клікни на частині' : state.mode === 'B' ? 'ЗГИН (B): рухай мишею ліво/право · клік — ок, Esc — скасувати' : `${state.mode}: рухай мишею · клік — ок, Esc — скасувати`;
    ctx.fillText(txt, 12, canvas.height - 16);
  }
}

// ---- ghost / first-frame overlay ----
// Малює персонажа в позі часу t, ЧБ, з потрібною прозорістю.
// Для keyframe-кліпів тимчасово оновлює state.slots через sampleClip.
// Для процедурних — достатньо змінити state.animT (eff() читає його напряму).
function drawGhostLayer(t: number, alpha: number): void {
  const clip = curClip();
  const hasKeys = !!(clip && clip.keys.length);
  const savedAnimT = state.animT;
  // Зберігаємо слоти тільки для keyframe-режиму
  const savedSlots: Record<string, { rot: number; dx: number; dy: number; scale: number; bend: number }> | null = hasKeys ? {} : null;
  if (hasKeys && savedSlots) {
    for (const d of SLOT_DEFS) { const sl = state.slots[d.key]; savedSlots[d.key] = { rot: sl.rot, dx: sl.dx, dy: sl.dy, scale: sl.scale, bend: sl.bend }; }
    // Заповнюємо слоти позою в момент t
    for (const d of SLOT_DEFS) { const sp = sampleClip(clip!, t, d.key); const sl = state.slots[d.key]; sl.rot = sp.rot; sl.dx = sp.dx; sl.dy = sp.dy; sl.scale = sp.scale; sl.bend = sp.bend; }
  }
  state.animT = t; // для процедурних eff() → animOff/animRoot читає animT
  _ghostDraw = true;
  try {
    ctx.save();
    if (state.facing < 0) { ctx.translate(state.origin.x, 0); ctx.scale(-1, 1); ctx.translate(-state.origin.x, 0); }
    ctx.filter = 'grayscale(1)';
    ctx.globalAlpha = alpha;
    for (const d of SLOT_DEFS) drawImageAt(d.key, 1);
    ctx.restore();
  } finally { _ghostDraw = false; }
  state.animT = savedAnimT;
  if (hasKeys && savedSlots) {
    for (const d of SLOT_DEFS) { const sl = state.slots[d.key]; const sv = savedSlots[d.key]; sl.rot = sv.rot; sl.dx = sv.dx; sl.dy = sv.dy; sl.scale = sv.scale; sl.bend = sv.bend; }
  }
}

// ---- координати картинки під курсором ----
function curLocal(sel: string, sx: number, sy: number): { lx: number; ly: number; iw: number; ih: number } | null {
  const img = imgOf(sel); if (!img) return null;
  const t = tf(sel); const p = pivotOf(sel); const a = anchorPx(sel);
  const ang = -worldRot(sel); const dx = sx - a.x, dy = sy - a.y;
  const rx = dx * Math.cos(ang) - dy * Math.sin(ang); const ry = dx * Math.sin(ang) + dy * Math.cos(ang);
  const wgs = worldGs(sel);
  const scx = t.scale * t.sx * wgs * s(), scy = t.scale * t.sy * wgs * s();
  let localX = rx / scx; if (t.flip < 0) localX = -localX; // врахувати дзеркало
  return { lx: localX + p.x * img.width, ly: ry / scy + p.y * img.height, iw: img.width, ih: img.height };
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
    slot.rot = 0; slot.dx = 0; slot.dy = 0; slot.sx = 1; slot.sy = 1; slot.gscale = 1; slot.pivotX = def(key).piv[0]; slot.pivotY = def(key).piv[1];
    slot.cut = null; slot.bend = 0; slot.bendFlip = false;
  }
}

// яка частина тіла за назвою файлу
function slotForName(name: string): string | null {
  const n = name.toLowerCase();
  if (/brow|брів|брова|брови/.test(n)) return /back|зад/.test(n) ? 'brow_back' : 'brow_front';
  if (/eye|око|очі|очей/.test(n)) return /back|зад/.test(n) ? 'eye_back' : 'eye_front';
  if (/mouth|рот|губ/.test(n)) return 'mouth';
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
function startMode(m: 'R' | 'S' | 'G' | 'B'): void {
  if (m === 'B' && state.selected === 'ref') return; // ref не має bend
  pushUndo();
  const t = tf(state.selected);
  state.mode = m; state.pivotMode = false; state.axis = null;
  state.orig = { rot: t.rot, scale: t.scale, dx: t.dx, dy: t.dy, flip: t.flip, sx: t.sx, sy: t.sy, gscale: t.gscale };
  if (m === 'B') state.origBend = state.slots[state.selected]?.bend ?? 0;
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
    let wdx = mx - state.startMx, wdy = my - state.startMy;
    if (state.axis === 'x') wdy = 0; else if (state.axis === 'z') wdx = 0; // обмеження осі (екранна гориз./верт.)
    const c = Math.cos(-pr), s2 = Math.sin(-pr);
    t.dx = state.orig.dx + (wdx * c - wdy * s2) / s();
    t.dy = state.orig.dy + (wdx * s2 + wdy * c) / s();
  } else if (state.mode === 'R') { const ang = Math.atan2(my - a.y, mx - a.x); t.rot = state.orig.rot + ((ang - state.startAng) * 180) / Math.PI; }
  else if (state.mode === 'S') {
    const ratio = Math.max(0.02, Math.hypot(mx - a.x, my - a.y) / state.startDist);
    if (state.axis === 'x') t.sx = Math.max(0.02, state.orig.sx * ratio);
    else if (state.axis === 'z') t.sy = Math.max(0.02, state.orig.sy * ratio);
    else t.gscale = Math.max(0.02, state.orig.gscale * ratio); // уніформний масштаб поширюється на дітей
  } else if (state.mode === 'B') {
    const sl = state.slots[state.selected]; if (sl) sl.bend = Math.max(-150, Math.min(150, state.origBend + (mx - state.startMx) * 0.8));
  }
  draw();
}
function endMode(commit: boolean): void {
  if (!state.mode) return;
  if (!commit) {
    if (state.orig) Object.assign(tf(state.selected), state.orig);
    if (state.mode === 'B') { const sl = state.slots[state.selected]; if (sl) sl.bend = state.origBend; }
  }
  state.mode = null; state.orig = null; state.axis = null; refreshUI();
}

// ---- UI ----
let faceOpen = false; // підменю «Голова» (брови/очі/рот) — ПКМ по кнопці Голова
function refreshChips(): void {
  const make = (key: string): HTMLElement => {
    const isRef = key === 'ref';
    const label = isRef ? 'Фоновий концепт' : def(key).label;
    const empty = isRef ? !state.ref.canvas : !state.slots[key].image;
    const el = document.createElement('div');
    el.className = 'chip' + (key === state.selected ? ' sel' : '') + (empty ? ' empty' : '');
    el.textContent = label;
    el.onclick = () => { state.selected = key; state.pivotMode = false; state.mode = null; refreshUI(); };
    if (key === 'head') { el.id = 'headChip'; el.title = 'ЛКМ — вибрати; ПКМ — обличчя'; el.oncontextmenu = (e) => { e.preventDefault(); faceOpen = !faceOpen; updateFacePanel(); }; }
    return el;
  };
  const renderRows = (box: HTMLElement, rows: string[][]): void => {
    box.innerHTML = '';
    for (const row of rows) {
      if (row.length === 1) box.appendChild(make(row[0]));
      else { const pair = document.createElement('div'); pair.className = 'chipPair'; for (const k of row) pair.appendChild(make(k)); box.appendChild(pair); }
    }
  };
  renderRows($('slotChips'), LIST_ROWS);
  renderRows($('faceChips'), FACE_ROWS);
  updateFacePanel();
}
function updateFacePanel(): void {
  const fl = $('faceList'); fl.style.display = faceOpen ? 'flex' : 'none';
  if (faceOpen) alignFaceList();
}
// підменю обличчя вирівнюється по верху кнопки «Голова», ліворуч від списку частин
function alignFaceList(): void {
  const cm = $('centerMid').getBoundingClientRect();
  const hc = document.getElementById('headChip'); const pl = $('partsList').getBoundingClientRect();
  const fl = $('faceList');
  if (hc) fl.style.top = Math.round(hc.getBoundingClientRect().top - cm.top) + 'px';
  fl.style.left = Math.round(pl.left - cm.left - 200 - 8) + 'px';
}
// Грід завантажених PNG (як бібліотека): клік = призначити вибраній частині.
const IMG_GRID_MIN = 9; // мінімум слотів (з пустими) — щоб видно сітку/скрол
function refreshImgGrid(): void {
  const box = $('imgGrid'); box.innerHTML = '';
  const cur = state.selected !== 'ref' ? state.slots[state.selected].image : null;
  for (const n of state.imageNames) {
    const cell = document.createElement('div');
    cell.className = 'imgCell' + (n === cur ? ' sel' : '');
    cell.title = n;
    const cv = state.images.get(n);
    if (cv) { const im = document.createElement('img'); im.src = cv.toDataURL('image/png'); im.draggable = false; cell.appendChild(im); }
    cell.onclick = () => {
      if (state.selected === 'ref') { status('Концепт вантаж через «Фоновий концепт» у Додатково'); return; }
      pushUndo(); assignImage(state.selected, n); refreshUI();
    };
    box.appendChild(cell);
  }
  for (let i = state.imageNames.length; i < IMG_GRID_MIN; i++) {
    const e = document.createElement('div'); e.className = 'imgCell empty'; box.appendChild(e);
  }
}
// ev.code → читабельна назва: 'KeyR'→'R', 'Digit1'→'1', решта — як є
function hotkeyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return code;
}
function refreshHotkeyBtn(): void {
  const btn = $<HTMLButtonElement>('hotkeyBtn');
  if (!state.anim) { btn.disabled = true; btn.textContent = 'Хоткей (-)'; btn.classList.remove('light'); return; }
  btn.disabled = false;
  const hk = state.clips[state.anim]?.hotkey;
  btn.textContent = hk ? `Хоткей (${hotkeyLabel(hk)})` : 'Хоткей (-)';
  btn.classList.remove('light');
}
function refreshUI(): void {
  refreshChips(); refreshImgGrid(); refreshHotkeyBtn();
  const t = tf(state.selected);
  $<HTMLInputElement>('rot').value = String(Math.round(t.rot)); $('rotV').textContent = String(Math.round(t.rot));
  $<HTMLInputElement>('scale').value = String(t.scale); $('scaleV').textContent = t.scale < 1 ? t.scale.toFixed(2) : t.scale.toFixed(1);
  $<HTMLButtonElement>('setPivot').textContent = state.pivotMode ? 'Клікни…' : 'Півот (Q)';
  $<HTMLButtonElement>('setPivot').classList.toggle('light', state.pivotMode);
  const ss = state.selected !== 'ref' ? state.slots[state.selected] : null;
  $<HTMLInputElement>('bend').value = String(ss ? ss.bend : 0);
  $('bendV').textContent = String(Math.round(ss ? ss.bend : 0));
  $<HTMLButtonElement>('cutBtn').textContent = ss && ss.cut != null ? 'Прибрати розріз (D)' : 'Розріз (D)';
  $<HTMLButtonElement>('cutBtn').classList.toggle('light', !!(ss && ss.cut != null));
  $<HTMLButtonElement>('bendFlipBtn').textContent = 'Напрям (F)';
  $<HTMLButtonElement>('bendFlipBtn').classList.toggle('light', !!(ss && ss.bendFlip));
  $<HTMLButtonElement>('faceBtn').textContent = '🔄 Перевернути арт: ' + (state.facing > 0 ? '→' : '←');
  $<HTMLButtonElement>('animDirBtn').textContent = '🦵 Хода в бік: ' + (state.animDir > 0 ? '→' : '←');
  refreshBoneLabels();
  saveLocal();
  draw();
}
const status = (m: string): void => { $('status').textContent = m; };

// ---- контроли ----
$<HTMLInputElement>('rot').addEventListener('pointerdown', pushUndo);
$<HTMLInputElement>('rot').addEventListener('input', (e) => { tf(state.selected).rot = Number((e.target as HTMLInputElement).value); $('rotV').textContent = (e.target as HTMLInputElement).value; draw(); });
$<HTMLInputElement>('scale').addEventListener('pointerdown', pushUndo);
$<HTMLInputElement>('scale').addEventListener('input', (e) => { tf(state.selected).scale = Number((e.target as HTMLInputElement).value); draw(); });
$<HTMLInputElement>('bend').addEventListener('pointerdown', pushUndo);
$<HTMLInputElement>('bend').addEventListener('input', (e) => { if (state.selected !== 'ref') { state.slots[state.selected].bend = Number((e.target as HTMLInputElement).value); $('bendV').textContent = (e.target as HTMLInputElement).value; draw(); } });
$<HTMLButtonElement>('cutBtn').addEventListener('click', toggleCut);
$<HTMLButtonElement>('bendFlipBtn').addEventListener('click', () => {
  if (state.selected === 'ref') return;
  pushUndo(); const sl = state.slots[state.selected]; sl.bendFlip = !sl.bendFlip;
  status(sl.bendFlip ? 'Згин цієї кістки — навпаки' : 'Згин цієї кістки — нормальний'); refreshUI();
});
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

// ---- верхні таби розділів — перемикання панелей всередині однієї сторінки ----
const appEl = document.getElementById('app')!;
function setMode(mode: string): void {
  appEl.className = 'mode-' + mode;
  document.querySelectorAll<HTMLButtonElement>('#topTabs button[data-tab]').forEach(b => {
    b.classList.toggle('light', b.getAttribute('data-tab') === mode);
  });
  if (mode === 'level') window.dispatchEvent(new CustomEvent('levelTabActivated'));
  else if (mode === 'char') requestAnimationFrame(() => { resize(); draw(); }); // канвас знову видимий → перецентрувати
}
for (const b of Array.from(document.querySelectorAll<HTMLButtonElement>('#topTabs button'))) {
  const tab = b.getAttribute('data-tab');
  if (tab) { b.addEventListener('click', () => setMode(tab)); }
  else if (b.hasAttribute('data-soon')) { b.disabled = true; b.title = 'Скоро'; }
}
// Initialize level editor (panels are hidden by default via CSS)
initLevelEditor('lv-');

// ---- «Частини персонажа» — кнопка, що розкриває/ховає список частин ----
let partsOpen = false;
$<HTMLButtonElement>('partsToggle').addEventListener('click', () => {
  partsOpen = !partsOpen;
  $('partsList').style.display = partsOpen ? '' : 'none';
});
// вирівняти верх списку частин по верху кнопки «Частини персонажа»
function alignPartsList(): void {
  const cm = $('centerMid').getBoundingClientRect();
  const pt = $('partsToggle').getBoundingClientRect();
  $('partsList').style.top = Math.max(0, Math.round(pt.top - cm.top)) + 'px';
}

// ---- Лінія висоти: поставити на маківку поточного персонажа (фіксується) ----
$<HTMLButtonElement>('setHeadLine').addEventListener('click', () => {
  if (!isFinite(charBB.minY)) { status('Спершу завантаж частини персонажа'); return; }
  headLineUY = (charBB.minY - state.origin.y) / s();
  try { localStorage.setItem('zag_head_uy2', String(headLineUY)); } catch { /* ignore */ }
  draw(); status('Лінію висоти встановлено на маківку');
});

// ---- превʼю гри (вбудована гра в iframe; оновлюється по «Експорт у гру») ----
const previewFrame = $<HTMLIFrameElement>('previewFrame');
function reloadPreview(): void { previewFrame.src = 'index.html?t=' + Date.now(); const h = document.getElementById('previewHint'); if (h) h.style.display = 'none'; }
reloadPreview();
const previewBox = $('preview');
// backdrop — прозорий шар позаду великого превʼю (z:99 < preview z:100).
// Клік по backdrop (тобто за межами превʼю) = згорнути.
const previewBackdrop = document.createElement('div');
previewBackdrop.style.cssText = 'display:none;position:fixed;inset:0;z-index:99;cursor:pointer;';
previewBackdrop.addEventListener('click', () => setPreviewBig(false));
document.body.appendChild(previewBackdrop);
let previewBig = false;
let hotkeyListening = false; // очікуємо клавішу для прив'язки до поточної анімації
// після зміни розміру вікна превʼю — змусити гру в iframe перефітитись під новий
// контейнер. scale.resize(тим самим логічним розміром) реально перемасштабовує
// канвас (refresh() — ні). Кілька викликів: чекаємо поки #game набуде нового розміру.
function refitPreviewGame(): void {
  const fire = (): void => {
    try { (previewFrame.contentWindow as unknown as { __zagRefit?: () => void })?.__zagRefit?.(); } catch { /* ignore */ }
  };
  requestAnimationFrame(fire); setTimeout(fire, 120); setTimeout(fire, 320);
}
function setPreviewBig(on: boolean): void {
  previewBig = on;
  const pc = $('previewClick') as HTMLElement;
  if (on) {
    const lib = $('library').getBoundingClientRect();
    const w = Math.max(360, window.innerWidth - 8 - (lib.right + 12));
    previewBox.classList.add('big');
    previewBox.style.width = w + 'px';
    previewBox.style.height = Math.round((w * 9) / 20) + 'px';
    pc.style.pointerEvents = 'none'; // iframe отримує мишу/клаву
    previewBackdrop.style.display = 'block'; // клік поза превʼю = згорнути
    ($('previewFrame') as HTMLIFrameElement).contentWindow?.focus();
  } else {
    previewBox.classList.remove('big');
    previewBox.style.width = ''; previewBox.style.height = '';
    pc.style.pointerEvents = ''; // overlay знову ловить ЛКМ для розгортання
    previewBackdrop.style.display = 'none';
  }
  refitPreviewGame();
}
$('previewClick').addEventListener('click', () => setPreviewBig(!previewBig)); // ЛКМ — розгорнути / згорнути
$('previewClick').addEventListener('contextmenu', (e) => {
  e.preventDefault();
  ($('previewFrame') as HTMLIFrameElement).contentWindow?.focus();
  const box = $('preview') as HTMLElement;
  box.style.boxShadow = '0 0 0 2px var(--accent)';
  const restore = (): void => { box.style.boxShadow = ''; window.removeEventListener('focus', restore); };
  window.addEventListener('focus', restore);
}); // ПКМ — передати хоткеї без розгортання
window.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).code === 'Escape' && previewBig) setPreviewBig(false); });
window.addEventListener('resize', () => { if (previewBig) setPreviewBig(true); });

// ---- Мірор (M): дзеркалити арт вибраної частини ----
// ---- Хоткей анімації ----
$<HTMLButtonElement>('hotkeyBtn').addEventListener('click', () => {
  if (!state.anim) return;
  hotkeyListening = true;
  const btn = $<HTMLButtonElement>('hotkeyBtn');
  btn.textContent = 'Натисни клавішу…'; btn.classList.add('light');
});
$<HTMLButtonElement>('mirrorBtn').addEventListener('click', () => { pushUndo(); const t = tf(state.selected); t.flip *= -1; refreshUI(); });
// ---- Фліп (F): перемкнути напрям згину УСІХ кісток одразу ----
function flipAllBends(): void {
  pushUndo();
  for (const d of SLOT_DEFS) state.slots[d.key].bendFlip = !state.slots[d.key].bendFlip;
  status('Напрям згину всіх кісток перемкнено'); refreshUI();
}
$<HTMLButtonElement>('flipAllBtn').addEventListener('click', flipAllBends);
// ---- Завантажити картинку ----
$<HTMLButtonElement>('loadImgBtn').addEventListener('click', () => $<HTMLInputElement>('fileInput').click());

// ---- Export JSON / (ПКМ) Import JSON — одна кнопка з тоглом ----
let importMode = false;
const exportBtnEl = $<HTMLButtonElement>('exportBtn');
function refreshExportBtn(): void {
  exportBtnEl.textContent = importMode ? 'Імпортувати JSON' : 'Експортувати JSON';
  exportBtnEl.title = importMode ? 'ПКМ — назад на Експорт' : 'ПКМ — перемкнути на Імпорт';
  exportBtnEl.classList.toggle('light', importMode);
}
exportBtnEl.addEventListener('contextmenu', (e) => { e.preventDefault(); importMode = !importMode; refreshExportBtn(); });

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
    if (loc) { pushUndo(); state.slots[state.selected].cut = Math.max(0.05, Math.min(0.95, loc.ly / loc.ih)); }
    state.cutMode = false; status('Розріз поставлено. Крути «Згин».'); refreshUI(); return;
  }
  if (state.pivotMode && state.selected !== 'ref') {
    const loc = curLocal(state.selected, c.x, c.y);
    if (loc) { pushUndo(); state.slots[state.selected].pivotX = Math.max(0, Math.min(1, loc.lx / loc.iw)); state.slots[state.selected].pivotY = Math.max(0, Math.min(1, loc.ly / loc.ih)); }
    state.pivotMode = false; refreshUI(); return;
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
  // режим прив'язки хоткея: перша натиснута клавіша записується в поточну анімацію
  if (hotkeyListening) {
    ev.preventDefault();
    hotkeyListening = false;
    if (state.anim && ev.code) { // ev.code — фізична клавіша, незалежно від розкладки
      const clip = curClip(); if (clip) clip.hotkey = ev.code;
      status(`Хоткей для «${state.anim}»: ${hotkeyLabel(ev.code)}`);
    }
    refreshUI(); return;
  }
  if (previewBig) return; // превью розгорнуто — хоткеї студії вимкнені, гра отримує клаву
  const tag = (document.activeElement?.tagName ?? '').toUpperCase();
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  if (ev.ctrlKey && ev.code === 'KeyZ') { ev.preventDefault(); undo(); return; }
  // обмеження осі під час G/S (Blender: X — гориз., Z — верт.; повторне натискання знімає)
  if (state.mode && state.mode !== 'B' && (ev.code === 'KeyX' || ev.code === 'KeyZ')) {
    ev.preventDefault(); const ax = ev.code === 'KeyX' ? 'x' : 'z';
    state.axis = state.axis === ax ? null : ax; applyMode(); return;
  }
  if (ev.code === 'Space') { ev.preventDefault(); if (state.anim) play(!state.playing); return; } // пробіл — плей/пауза
  if (ev.code === 'KeyG' || ev.code === 'KeyR' || ev.code === 'KeyS') { ev.preventDefault(); startMode(ev.code === 'KeyG' ? 'G' : ev.code === 'KeyR' ? 'R' : 'S'); }
  else if (ev.code === 'KeyB') { ev.preventDefault(); startMode('B'); } // B — bend interactive
  else if (ev.code === 'KeyM') { ev.preventDefault(); pushUndo(); const t = tf(state.selected); t.flip *= -1; refreshUI(); }
  else if (ev.code === 'KeyF') { ev.preventDefault(); if (state.selected !== 'ref') { pushUndo(); const sl = state.slots[state.selected]; sl.bendFlip = !sl.bendFlip; refreshUI(); } } // F — bendFlip (напрям)
  else if (ev.code === 'KeyD') { ev.preventDefault(); toggleCut(); }
  else if (ev.code === 'KeyK') {
    ev.preventDefault();
    if (state.anim) {
      if (tlHoverFrame !== null) setKeyAt(tlHoverFrame / FPS, tlHoverBone);
      else setKey();
    }
  }
  else if (ev.code === 'Delete') {
    ev.preventDefault();
    if (tlHoverFrame !== null && state.anim) delKeyAt(tlHoverFrame / FPS);
  }
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

function loadRefFile(f: File): void {
  const img = new Image(); img.onload = () => { pushUndo(); state.ref.canvas = imageToCanvas(img); state.selected = 'ref'; refreshUI(); }; img.src = URL.createObjectURL(f);
}
$<HTMLInputElement>('fileInput').addEventListener('change', (ev) => {
  const files = Array.from((ev.target as HTMLInputElement).files ?? []);
  if (!files.length) return;
  // якщо вибрано «Фоновий концепт» — вантажимо як концепт, а не як частину
  if (state.selected === 'ref') { loadRefFile(files[0]); return; }
  pushUndo();
  files.forEach((f) => addImageFile(f, files.length === 1));
});

// ---- експорт / імпорт ----
// самодостатній doc: пропорції + слоти + вшиті картинки (base64)
function buildDoc(): { version: number; proportions: typeof state.prop; slots: Record<string, Slot>; images: Record<string, string>; facing: number; animDir: number; clips: Record<string, Clip> } {
  const rig = rigForExport();
  const used = new Set(Object.values(rig).map((sl) => sl.image).filter(Boolean) as string[]);
  const images: Record<string, string> = {};
  for (const n of used) { const cv = state.images.get(n); if (cv) images[n] = cv.toDataURL('image/png'); }
  return { version: 4, proportions: { ...state.prop }, slots: JSON.parse(JSON.stringify(rig)), images, facing: state.facing, animDir: state.animDir, clips: JSON.parse(JSON.stringify(state.clips)) };
}
function loadCharFromDoc(doc: { proportions?: typeof state.prop; slots?: Record<string, Slot>; images?: Record<string, string>; facing?: number; animDir?: number; clips?: Record<string, Clip> }): void {
  const keepAnim = state.anim; const wasPlaying = state.playing; // лишаємо ту саму вибрану анімацію після перемикання персонажа
  state.anim = null; exitClip(); // чистий вихід із поточного кліпу
  if (typeof doc.facing === 'number') state.facing = doc.facing;
  if (typeof doc.animDir === 'number') state.animDir = doc.animDir;
  if (doc.proportions) Object.assign(state.prop, doc.proportions);
  if (doc.clips) state.clips = doc.clips;
  if (doc.slots) for (const k of Object.keys(state.slots)) if (doc.slots[k]) Object.assign(state.slots[k], doc.slots[k]);
  if (doc.images) for (const [name, data] of Object.entries(doc.images)) {
    const im = new Image();
    im.onload = () => { state.images.set(name, imageToCanvas(im)); if (!state.imageNames.includes(name)) state.imageNames.push(name); refreshUI(); };
    im.src = data;
  }
  if (keepAnim && state.clips[keepAnim]) { state.anim = keepAnim; enterClip(); state.animT = 0; state.selKeys = []; loadFrame(0); play(wasPlaying); }
  refreshAnimOptions();
  refreshUI();
}
// Превʼю персонажа = його ГОЛОВА (PNG зі слота head), вписана в мініатюру.
// (Не кадруємо зібраного персонажа — беремо саме завантажену картинку голови.)
function composeThumb(w: number, h: number): string {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const cx = c.getContext('2d')!;
  const head = state.slots['head'];
  const img = head.image ? state.images.get(head.image) : undefined;
  if (img) {
    const scale = Math.min(w / img.width, h / img.height) * 0.9; // вписати з невеликим відступом
    const dw = img.width * scale, dh = img.height * scale;
    cx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
  }
  return c.toDataURL('image/png');
}

// ---- бібліотека персонажів (IndexedDB — необмежений обсяг) ----
interface LibItem { id: string; name: string; cat: 'char' | 'enemy'; doc: ReturnType<typeof buildDoc>; thumb: string }
const LIB_KEY = 'zag_char_lib'; // IDB key (нова назва, щоб не плутати зі старим localStorage)
let _lib: LibItem[] = [];
let libCat: 'char' | 'enemy' = 'char';
const loadLib = (): LibItem[] => _lib;
const storeLib = (lib: LibItem[]): void => {
  _lib = lib;
  idbSet(LIB_KEY, lib).catch(() => status('Не вдалося зберегти бібліотеку'));
};
const LIB_MIN = 18; // мінімум слотів (з пустими) — щоб видно сітку/скрол
function renderLibrary(): void {
  // одна кнопка-тогл: показує поточний розділ; Герої = світла, Вороги = темна
  const tog = $<HTMLButtonElement>('libToggle');
  tog.textContent = libCat === 'char' ? 'Герої' : 'Вороги';
  tog.classList.toggle('light', libCat === 'char');
  const box = $('libList'); box.innerHTML = '';
  const lib = loadLib().filter((c) => (c.cat ?? 'char') === libCat);
  for (const c of lib) {
    const card = document.createElement('div'); card.className = 'libCard';
    const img = document.createElement('img'); img.src = c.thumb; img.draggable = false;
    const nm = document.createElement('div'); nm.className = 'libName'; nm.textContent = c.name;
    const del = document.createElement('button'); del.className = 'libDel'; del.textContent = '✕';
    card.onclick = () => { currentCharId = c.id; loadCharFromDoc(c.doc); refreshCharSel(); status(`Завантажено: ${c.name}`); };
    del.onclick = (e) => { e.stopPropagation(); storeLib(loadLib().filter((x) => x.id !== c.id)); renderLibrary(); };
    card.appendChild(img); card.appendChild(nm); card.appendChild(del); box.appendChild(card);
  }
  for (let i = lib.length; i < LIB_MIN; i++) { const e = document.createElement('div'); e.className = 'libCard empty'; box.appendChild(e); }
}
function saveCharacter(): void {
  const what = libCat === 'enemy' ? 'ворога' : 'персонажа';
  const name = prompt(`Назва ${what}:`, libCat === 'enemy' ? 'Ворог' : 'Остап'); if (!name) return;
  const lib = loadLib();
  const item: LibItem = { id: 'c' + Date.now(), name, cat: libCat, doc: buildDoc(), thumb: composeThumb(150, 190) };
  const i = lib.findIndex((x) => x.name === name && (x.cat ?? 'char') === libCat); // та сама назва В ЦІЙ вкладці -> заміна
  if (i >= 0) { item.id = lib[i].id; lib[i] = item; status(`Оновлено: ${name}`); }
  else { lib.push(item); status(`Збережено: ${name}`); }
  storeLib(lib); currentCharId = item.id; renderLibrary(); refreshCharSel();
}
$<HTMLButtonElement>('saveChar').addEventListener('click', saveCharacter);
$<HTMLButtonElement>('libToggle').addEventListener('click', () => { libCat = libCat === 'char' ? 'enemy' : 'char'; renderLibrary(); });

$<HTMLButtonElement>('exportBtn').addEventListener('click', () => {
  if (importMode) { $<HTMLInputElement>('importInput').click(); return; } // у режимі імпорту (ПКМ) — відкрити файл
  const doc = buildDoc();
  const blob = new Blob([JSON.stringify(doc)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'character.json'; a.click();
  status(`Експортовано character.json (частин: ${Object.keys(doc.images).length}) — кинь у гру`);
});
async function publishToGame(btn: HTMLButtonElement, statusFn: (s: string) => void): Promise<void> {
  btn.disabled = true;
  const orig = btn.textContent!;
  btn.textContent = 'Публікую...';
  try {
    const character = buildDoc();
    try { localStorage.setItem('zag_game_char', JSON.stringify(character)); } catch { /* ignore */ }
    const level = await idbGet<unknown>('zag_level');
    const files: Record<string, string> = {
      'public/character.json': JSON.stringify(character),
      'public/studio-data/char-library.json': JSON.stringify(loadLib()),
    };
    if (level) files['public/level.json'] = JSON.stringify(level);
    await ghCommit(files, 'studio: publish to game');
    statusFn('✔ Оновлено! Telegram підтягне за ~1 хв.');
    btn.textContent = 'Оновлено!';
  } catch (e) {
    statusFn('✗ ' + String(e).slice(0, 60));
    btn.textContent = 'Помилка';
  }
  setTimeout(() => { btn.disabled = false; btn.textContent = orig; }, 4000);
}
$<HTMLButtonElement>('toGameBtn').addEventListener('click', () => {
  reloadPreview();
  void publishToGame($<HTMLButtonElement>('toGameBtn'), status);
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
// Вихід із кліпу: повертаємо лише АНІМОВНІ поля з bind-пози; СТАТИЧНІ рігові
// (image/pivot/flip/sx/sy/cut/bendFlip) лишаємо живими — щоб правки рігу під час
// анімації (напр. напрям згину) не губилися.
function exitClip(): void {
  if (!state.setup) return;
  for (const k of Object.keys(state.slots)) {
    const su = state.setup[k]; if (!su) continue;
    const sl = state.slots[k];
    sl.rot = su.rot; sl.dx = su.dx; sl.dy = su.dy; sl.scale = su.scale; sl.bend = su.bend;
  }
  state.setup = null;
}
// Слоти для збереження: анімовні поля з bind-пози (setup), статичні — з живих слотів.
function rigForExport(): Record<string, Slot> {
  const bind = rigSlots();
  const out: Record<string, Slot> = {};
  for (const k of Object.keys(state.slots)) {
    out[k] = { ...state.slots[k], rot: bind[k].rot, dx: bind[k].dx, dy: bind[k].dy, scale: bind[k].scale, bend: bind[k].bend };
  }
  return out;
}

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
  // Якщо вибрана конкретна кістка — ключ тільки для неї; без вибору — загальний
  if (!state.selected || state.selected === 'ref') { setAllKey(); return; }
  pushUndo();
  const t = state.animT; const bone = state.selected;
  const sl = state.slots[bone];
  const bonePose: KeyPose = { rot: sl.rot, dx: sl.dx, dy: sl.dy, scale: sl.scale, flip: sl.flip, bend: sl.bend };
  const i = clip.keys.findIndex((k) => Math.abs(k.t - t) < 0.02);
  if (i >= 0) { clip.keys[i].pose = { ...clip.keys[i].pose, [bone]: bonePose }; }
  else { clip.keys.push({ t, interp: 'linear', pose: { [bone]: bonePose } }); clip.keys.sort((a, b) => a.t - b.t); }
  refreshTimeline(); status(`⬤ Ключ «${bone}» кадр ${Math.round(t * FPS)}`);
}
function delKey(): void {
  const clip = curClip(); if (!clip) return;
  pushUndo(); clip.keys = clip.keys.filter((k) => Math.abs(k.t - state.animT) >= 0.02);
  state.selKeys = []; refreshTimeline();
}
function setKeyAt(t: number, bone: string | null): void {
  const clip = curClip(); if (!clip) { status('Вибери кліп у таймлайні'); return; }
  if (!bone || bone === 'ref') return;
  pushUndo();
  const sl = state.slots[bone]; if (!sl) return;
  const pose: KeyPose = { rot: sl.rot, dx: sl.dx, dy: sl.dy, scale: sl.scale, flip: sl.flip, bend: sl.bend ?? 0 };
  const i = clip.keys.findIndex((k) => Math.abs(k.t - t) < 0.02);
  if (i >= 0) clip.keys[i].pose = { ...clip.keys[i].pose, [bone]: pose };
  else { clip.keys.push({ t, interp: 'linear', pose: { [bone]: pose } }); clip.keys.sort((a, b) => a.t - b.t); }
  refreshTimeline(); status(`⬤ Ключ «${bone}» кадр ${Math.round(t * FPS)}`);
}
function delKeyAt(t: number): void {
  const clip = curClip(); if (!clip) return;
  const i = clip.keys.findIndex((k) => Math.abs(k.t - t) < 1 / FPS);
  if (i < 0) return;
  pushUndo();
  const f = Math.round(clip.keys[i].t * FPS);
  clip.keys.splice(i, 1);
  state.selKeys = state.selKeys.filter((x) => x !== i).map((x) => (x > i ? x - 1 : x));
  refreshTimeline(); status(`✕ Ключ кадр ${f} видалено`);
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
function convertToKeys(): void {
  const clip = curClip(); if (!clip || !state.anim) { status('Вибери анімацію'); return; }
  pushUndo();
  const dur = clip.duration;
  const total = Math.round(dur * FPS);
  clip.keys = [];
  // Семплюємо кожен 3-й кадр: 0, 3, 6, 9 … → редагована «ключова анімація»
  for (let f = 0; f <= total; f += 3) {
    const t = f / FPS;
    const pose: Record<string, KeyPose> = {};
    for (const d of SLOT_DEFS) {
      const sl = rigSlots()[d.key];
      const o = animOff(state.anim, t, d.key);
      let dx = sl.dx + o.ddx, dy = sl.dy + o.ddy;
      if (d.key === 'torso') { const r = animRoot(state.anim, t); dx += r.ddx; dy += r.ddy; }
      pose[d.key] = { rot: sl.rot + o.drot * state.animDir, dx, dy, scale: sl.scale, flip: sl.flip, bend: (sl.bend ?? 0) + animBend(state.anim, t, d.key) * state.animDir };
    }
    clip.keys.push({ t, interp: 'smooth', pose });
  }
  loadFrame(state.animT); refreshTimeline(); refreshUI();
  status(`⚙ Конвертовано: ${clip.keys.length} ключів (кадри 0,3,6…) зі згладженням`);
}
function setInterp(mode: 'linear' | 'smooth'): void {
  const clip = curClip(); if (!clip || !state.selKeys.length) { status('Виділи ключі (Shift-клік по точках)'); return; }
  pushUndo(); for (const i of state.selKeys) if (clip.keys[i]) clip.keys[i].interp = mode;
  refreshTimeline(); status(mode === 'smooth' ? 'Звʼязано: згладжено' : 'Звʼязано: лінійно');
}
const FPS = 24; // кадрів на секунду (таймлайн показує НОМЕРИ КАДРІВ)
let framesInView = 30; // скільки кадрів у полі зору (колесо над треком змінює — як зум таймлайну)
let playheadEl: HTMLElement | null = null, badgeEl: HTMLElement | null = null;
let bonePlayheadEl: HTMLElement | null = null; // overlay-лінія плейхеда (через всі рядки)
let endMarkEl: HTMLElement | null = null;
let endMarkOverlayEl: HTMLElement | null = null; // overlay-лінія кінця анімації
let ghostEnabled = false; let ghostBefore = 3; let ghostAfter = 3;
let ghostLeftEl: HTMLElement | null = null; let ghostRightEl: HTMLElement | null = null;
let ghostFillLeftEl: HTMLElement | null = null; let ghostFillRightEl: HTMLElement | null = null;
let firstFrameEnabled = false;
let _ghostDraw = false;

function tlTicksRect(): DOMRect { return $('tlTicks').getBoundingClientRect(); }

function movePlayhead(): void {
  const frame = state.animT * FPS;
  const fiv = framesInView;
  const pct = (frame / fiv * 100) + '%';
  if (playheadEl) playheadEl.style.left = pct;
  if (badgeEl) badgeEl.textContent = String(Math.round(frame));
  if (bonePlayheadEl) bonePlayheadEl.style.left = pct;
  if (ghostEnabled) {
    const curF = Math.round(frame);
    if (ghostLeftEl) ghostLeftEl.style.left = (Math.max(0, curF - ghostBefore) / fiv * 100) + '%';
    if (ghostRightEl) ghostRightEl.style.left = (Math.min(fiv, curF + ghostAfter) / fiv * 100) + '%';
    if (ghostFillLeftEl) { ghostFillLeftEl.style.left = (Math.max(0, curF - ghostBefore) / fiv * 100) + '%'; ghostFillLeftEl.style.width = (Math.min(ghostBefore, curF) / fiv * 100) + '%'; }
    if (ghostFillRightEl) { ghostFillRightEl.style.left = (curF / fiv * 100) + '%'; ghostFillRightEl.style.width = (Math.min(ghostAfter, fiv - curF) / fiv * 100) + '%'; }
  }
}

function makeDot(i: number, k: { t: number; interp: string }, fiv: number): HTMLElement {
  const dot = document.createElement('div');
  dot.className = 'keyDot' + (state.selKeys.includes(i) ? ' sel' : '') + (k.interp === 'smooth' ? ' smooth' : '');
  dot.style.left = (k.t * FPS / fiv * 100) + '%';
  const lbl = document.createElement('span'); lbl.className = 'dotLabel'; lbl.textContent = String(Math.round(k.t * FPS));
  dot.appendChild(lbl);
  dot.addEventListener('mousedown', (e) => {
    e.stopPropagation();
    if ((e as MouseEvent).shiftKey) { const j = state.selKeys.indexOf(i); if (j >= 0) state.selKeys.splice(j, 1); else state.selKeys.push(i); }
    else state.selKeys = [i];
    play(false); loadFrame(k.t); refreshTimeline(); refreshUI();
  });
  return dot;
}

function refreshTimeline(): void {
  const clip = curClip();
  $<HTMLSelectElement>('anim').value = state.anim ?? '';
  const fiv = framesInView;

  // ── тік-рулер ──
  const ticks = $('tlTicks'); ticks.innerHTML = '';
  const step = fiv <= 12 ? 1 : fiv <= 30 ? 2 : fiv <= 80 ? 5 : 10;
  for (let f = 0; f <= fiv; f += step) {
    const tk = document.createElement('div'); tk.className = 'tick'; tk.style.left = (f / fiv * 100) + '%'; tk.textContent = String(f);
    ticks.appendChild(tk);
  }
  // Маркер кінця анімації
  const endFrame = clip ? Math.round(clip.duration * FPS) : 24;
  if (endFrame <= fiv) {
    const m = document.createElement('div'); m.className = 'frameMark';
    m.style.cssText += `left:${(endFrame / fiv * 100)}%;width:12px;margin-left:-6px;cursor:ew-resize;z-index:5;opacity:1;pointer-events:auto;background:linear-gradient(to right,transparent calc(50% - 1px),rgba(255,255,255,.6) calc(50% - 1px),rgba(255,255,255,.6) calc(50% + 1px),transparent calc(50% + 1px));`;
    m.title = `Кінець: кадр ${endFrame}. Тягни щоб змінити тривалість.`;
    m.addEventListener('mousedown', (e) => { e.stopPropagation(); pushUndo(); draggingEnd = true; play(false); });
    ticks.appendChild(m); endMarkEl = m;
  } else { endMarkEl = null; }
  // Ghost маркери в рулері
  ghostLeftEl = null; ghostRightEl = null;
  if (ghostEnabled) {
    const curF = Math.round(state.animT * FPS);
    const gl = document.createElement('div'); gl.className = 'ghostMark'; gl.style.left = (Math.max(0, curF - ghostBefore) / fiv * 100) + '%';
    gl.addEventListener('mousedown', (e) => { e.stopPropagation(); draggingGhostLeft = true; play(false); });
    ticks.appendChild(gl); ghostLeftEl = gl;
    const gr = document.createElement('div'); gr.className = 'ghostMark'; gr.style.left = (Math.min(fiv, curF + ghostAfter) / fiv * 100) + '%';
    gr.addEventListener('mousedown', (e) => { e.stopPropagation(); draggingGhostRight = true; play(false); });
    ticks.appendChild(gr); ghostRightEl = gr;
  }
  // Плейхед у рулері (тільки бейдж)
  const ph = document.createElement('div'); ph.className = 'playhead';
  const badge = document.createElement('div'); badge.className = 'phBadge';
  ph.appendChild(badge); ticks.appendChild(ph);
  playheadEl = ph; badgeEl = badge;

  // ── кісткові треки ──
  const labelsEl = $('tlBoneLabels'); labelsEl.innerHTML = '';
  const tracksEl = $('tlBoneTracks');
  // Зберегти scrollTop і playhead, очистити решту
  const scrollTop = tracksEl.scrollTop;
  tracksEl.innerHTML = '';

  // Ghost fills у tracks
  ghostFillLeftEl = null; ghostFillRightEl = null;
  if (ghostEnabled) {
    const curF = Math.round(state.animT * FPS);
    const fl = document.createElement('div'); fl.className = 'ghostFill';
    fl.style.cssText = `left:${(Math.max(0, curF - ghostBefore) / fiv * 100)}%;width:${(Math.min(ghostBefore, curF) / fiv * 100)}%`;
    tracksEl.appendChild(fl); ghostFillLeftEl = fl;
    const fr = document.createElement('div'); fr.className = 'ghostFill';
    fr.style.cssText = `left:${(curF / fiv * 100)}%;width:${(Math.min(ghostAfter, fiv - curF) / fiv * 100)}%`;
    tracksEl.appendChild(fr); ghostFillRightEl = fr;
  }

  for (const d of SLOT_DEFS) {
    // Лейбл зліва
    const lb = document.createElement('div');
    lb.className = 'boneLabel' + (state.selected === d.key ? ' sel' : '');
    lb.textContent = d.label;
    lb.addEventListener('click', () => { state.selected = d.key; state.pivotMode = false; state.mode = null; refreshUI(); refreshTimeline(); });
    labelsEl.appendChild(lb);
    // Рядок треку справа
    const row = document.createElement('div'); row.className = 'boneTrack';
    row.addEventListener('mousedown', (e) => { if ((e as MouseEvent).button !== 0) return; scrubbing = true; play(false); scrubTo((e as MouseEvent).clientX); });
    row.addEventListener('mousemove', (e) => {
      tlHoverBone = d.key;
      const r = tracksEl.getBoundingClientRect();
      tlHoverFrame = Math.round((e.clientX - r.left) / r.width * framesInView);
    });
    if (clip) {
      for (let i = 0; i < clip.keys.length; i++) {
        const k = clip.keys[i];
        if (!(d.key in k.pose)) continue; // немає ключа для цієї кістки
        row.appendChild(makeDot(i, k, fiv));
      }
    }
    tracksEl.appendChild(row);
  }

  tracksEl.scrollTop = scrollTop;
  labelsEl.scrollTop = scrollTop;

  // Overlay-лінії (плейхед + кінець анімації) через весь таймлайн
  const overlays = $('tlOverlays'); overlays.innerHTML = '';
  const phLine = document.createElement('div'); phLine.className = 'tlOverlayLine';
  phLine.style.cssText = 'background:var(--accent);z-index:20;';
  overlays.appendChild(phLine); bonePlayheadEl = phLine;
  if (endFrame <= fiv) {
    const emLine = document.createElement('div'); emLine.className = 'tlOverlayLine';
    emLine.style.cssText = `background:rgba(255,255,255,.4);left:${(endFrame / fiv * 100)}%;z-index:4;`;
    overlays.appendChild(emLine); endMarkOverlayEl = emLine;
  } else { endMarkOverlayEl = null; }

  movePlayhead();
}

function refreshBoneLabels(): void {
  document.querySelectorAll<HTMLElement>('#tlBoneLabels .boneLabel').forEach((el, i) => {
    if (i < SLOT_DEFS.length) el.classList.toggle('sel', SLOT_DEFS[i].key === state.selected);
  });
}

// hover над таймлайном — для K i Delete по позиції курсора
let tlHoverFrame: number | null = null;
let tlHoverBone: string | null = null;

// скраб
let scrubbing = false;
let draggingEnd = false;
let draggingGhostLeft = false; let draggingGhostRight = false;
function scrubTo(clientX: number): void {
  const r = tlTicksRect();
  let f = (clientX - r.left) / r.width * framesInView;
  f = Math.max(0, Math.min(framesInView, f));
  loadFrame(f / FPS); movePlayhead(); refreshUI();
}
function dragEndTo(clientX: number): void {
  const clip = curClip(); if (!clip) return;
  const r = tlTicksRect();
  let f = Math.max(1, Math.round((clientX - r.left) / r.width * framesInView));
  clip.duration = f / FPS;
  const pct = (f / framesInView * 100) + '%';
  if (endMarkEl) endMarkEl.style.left = pct;
  if (endMarkOverlayEl) endMarkOverlayEl.style.left = pct;
  status(`Тривалість: ${f} кадрів`);
}
$('tlTicks').addEventListener('mousedown', (e) => { if ((e as MouseEvent).button !== 0) return; scrubbing = true; play(false); scrubTo((e as MouseEvent).clientX); });
// Синхронізація прокручування між лейблами і треками
$('tlBoneTracks').addEventListener('mouseleave', () => { tlHoverFrame = null; tlHoverBone = null; });
$('tlBoneTracks').addEventListener('scroll', () => { $('tlBoneLabels').scrollTop = $('tlBoneTracks').scrollTop; }, { passive: true });
$('tlBoneLabels').addEventListener('scroll', () => { $('tlBoneTracks').scrollTop = $('tlBoneLabels').scrollTop; }, { passive: true });
window.addEventListener('mousemove', (e) => {
  const mx = (e as MouseEvent).clientX;
  if (scrubbing) scrubTo(mx);
  if (draggingEnd) dragEndTo(mx);
  if (draggingGhostLeft || draggingGhostRight) {
    const r = tlTicksRect();
    const f = Math.round((mx - r.left) / r.width * framesInView);
    const curF = Math.round(state.animT * FPS);
    if (draggingGhostLeft) ghostBefore = Math.max(1, curF - f);
    else ghostAfter = Math.max(1, f - curF);
    movePlayhead(); draw();
  }
});
window.addEventListener('mouseup', () => {
  if (draggingEnd) refreshTimeline();
  if (draggingGhostLeft || draggingGhostRight) refreshTimeline();
  scrubbing = false; draggingEnd = false; draggingGhostLeft = false; draggingGhostRight = false;
});
// Зум колесом над тікрулером або треками
const _zoomWheel = (e: Event): void => {
  e.preventDefault();
  const stepF = Math.max(2, Math.round(framesInView * 0.12));
  framesInView = Math.max(6, Math.min(120, framesInView + ((e as WheelEvent).deltaY < 0 ? -stepF : stepF)));
  refreshTimeline();
};
$('tlTicks').addEventListener('wheel', _zoomWheel, { passive: false });
$('tlBoneTracks').addEventListener('wheel', _zoomWheel, { passive: false });
let raf = 0;
let lastTs = 0;
function tick(ts: number): void {
  if (!state.playing) return;
  const dt = (ts - lastTs) / 1000 || 0; lastTs = ts;
  const clip = curClip();
  if (clip) { state.animT += dt; if (state.animT > clip.duration) state.animT %= clip.duration; if (clip.keys.length) loadFrame(state.animT); }
  draw();
  movePlayhead();
  raf = requestAnimationFrame(tick);
}
function play(on: boolean): void {
  state.playing = on && !!state.anim;
  cancelAnimationFrame(raf);
  if (state.playing) { lastTs = performance.now(); raf = requestAnimationFrame(tick); }
  refreshTimeline();
}
// ---- іменовані анімації (службові процедурні + власні з ключами) ----
const BUILTIN = ['idle', 'walk', 'run', 'jump', 'attack', 'hurt'];
function refreshAnimOptions(): void {
  const sel = $<HTMLSelectElement>('anim'); const cur = state.anim ?? '';
  sel.innerHTML = '<option value="">base pose</option>';
  for (const b of BUILTIN) { const o = document.createElement('option'); o.value = b; o.textContent = b; sel.appendChild(o); }
  const custom = Object.keys(state.clips).filter((n) => !BUILTIN.includes(n));
  if (custom.length) {
    const og = document.createElement('optgroup'); og.label = 'Мої анімації';
    for (const n of custom) { const o = document.createElement('option'); o.value = n; o.textContent = n; og.appendChild(o); }
    sel.appendChild(og);
  }
  sel.value = cur;
}
function selectAnim(name: string | null): void {
  play(false);
  if (name) { state.anim = name; enterClip(); state.animT = 0; state.selKeys = []; loadFrame(0); refreshAnimOptions(); refreshTimeline(); refreshUI(); play(true); }
  else { state.anim = null; exitClip(); refreshAnimOptions(); refreshTimeline(); refreshUI(); }
}
// «Зберегти анімацію» — зберегти поточні КЛЮЧІ як НОВУ іменовану анімацію
function saveAsNewAnim(): void {
  const clip = curClip();
  if (!clip || !clip.keys.length) { status('Спершу постав ключі (K)'); return; }
  const name = (prompt('Назва нової анімації:', '') || '').trim();
  if (!name) return;
  if (BUILTIN.includes(name)) { status('Це службова назва — обери іншу'); return; }
  pushUndo();
  state.clips[name] = JSON.parse(JSON.stringify(clip)); // копія з ключами
  state.anim = name; refreshAnimOptions(); loadFrame(0); refreshTimeline(); refreshUI();
  status('Збережено анімацію: ' + name);
}
function renameAnim(): void {
  const a = state.anim; if (!a || !state.clips[a]) { status('Вибери анімацію зі своїх'); return; }
  const name = (prompt('Нова назва:', a) || '').trim();
  if (!name || name === a) return;
  if (BUILTIN.includes(name)) { status('Це службова назва — обери іншу'); return; }
  pushUndo();
  state.clips[name] = state.clips[a]; delete state.clips[a];
  state.anim = name; refreshAnimOptions(); refreshTimeline(); refreshUI();
  status('Перейменовано: ' + name);
}
function deleteAnim(): void {
  const a = state.anim; if (!a) { status('Вибери анімацію'); return; }
  if (!confirm(`Видалити анімацію «${a}»?`)) return;
  pushUndo();
  delete state.clips[a]; // для службової назви це повертає процедурну
  state.anim = null; exitClip(); refreshAnimOptions(); refreshTimeline(); refreshUI();
  status('Видалено: ' + a);
}
$<HTMLSelectElement>('anim').addEventListener('change', (e) => {
  const v = (e.target as HTMLSelectElement).value; // ВАЖЛИВО: зчитати ДО play(false) — play()→refreshTimeline() скидає цей select назад на state.anim (тоді ще порожній) і вибір губився
  (e.target as HTMLSelectElement).blur(); // зняти фокус, інакше Пробіл відкриває список замість плей/пауза
  play(false);
  if (v) { state.anim = v; enterClip(); state.animT = 0; state.selKeys = []; loadFrame(0); refreshTimeline(); refreshUI(); play(true); } // вибрав анімацію — одразу програється
  else { state.anim = null; exitClip(); refreshTimeline(); refreshUI(); }
});
function setAllKey(): void {
  const clip = curClip(); if (!clip) { status('Вибери кліп у таймлайні'); return; }
  pushUndo();
  const t = state.animT; const i = clip.keys.findIndex((k) => Math.abs(k.t - t) < 0.02);
  if (i >= 0) clip.keys[i].pose = snapPose();
  else { clip.keys.push({ t, interp: 'linear', pose: snapPose() }); clip.keys.sort((a, b) => a.t - b.t); }
  refreshTimeline(); status('⬤ Загальний ключ поставлено');
}
function invertAnim(): void {
  const clip = curClip();
  if (!clip || state.selKeys.length !== 2) { status('Виділи 2 ключових кадри (Shift-клік по точках)'); return; }
  if (!state.selected || state.selected === 'ref') { status('Вибери частину тіла'); return; }
  pushUndo();
  const sorted = [...state.selKeys].sort((a, b) => clip.keys[a].t - clip.keys[b].t);
  const kA = clip.keys[sorted[0]], kB = clip.keys[sorted[1]];
  const bone = state.selected;
  const su = rigSlots()[bone];
  const base = { rot: su.rot, dx: su.dx, dy: su.dy, scale: su.scale, flip: su.flip, bend: su.bend };
  const pA = kA.pose[bone] ?? base; const pB = kB.pose[bone] ?? base;
  if (!kB.pose[bone]) kB.pose[bone] = { ...pB };
  kB.pose[bone].rot = pB.rot >= pA.rot ? pB.rot - 360 : pB.rot + 360;
  loadFrame(state.animT); refreshUI();
  status(`↔ Інвертовано «${bone}» між кадрами ${Math.round(kA.t * FPS)}–${Math.round(kB.t * FPS)}`);
}
$<HTMLButtonElement>('keyBtn').addEventListener('click', setKey);
$<HTMLButtonElement>('delKeyBtn').addEventListener('click', delKey);
$<HTMLButtonElement>('bakeBtn').addEventListener('click', saveAsNewAnim);
$<HTMLButtonElement>('convertToKeysBtn').addEventListener('click', convertToKeys);
$<HTMLButtonElement>('renameAnimBtn').addEventListener('click', renameAnim);
$<HTMLButtonElement>('delAnimBtn').addEventListener('click', deleteAnim);
// «Звʼязати» — одна кнопка: ЛКМ застосовує режим, ПКМ перемикає лінійно/згладжено (білий = згладжено)
let linkMode: 'linear' | 'smooth' = 'linear';
function refreshLinkBtn(): void { const b = $<HTMLButtonElement>('linkBtn'); b.textContent = 'Звʼязати: ' + (linkMode === 'linear' ? 'лінійно' : 'згладжено'); b.classList.toggle('light', linkMode === 'smooth'); }
$<HTMLButtonElement>('linkBtn').addEventListener('click', () => setInterp(linkMode));
$<HTMLButtonElement>('linkBtn').addEventListener('contextmenu', (e) => { e.preventDefault(); linkMode = linkMode === 'linear' ? 'smooth' : 'linear'; refreshLinkBtn(); });
refreshLinkBtn();
$<HTMLButtonElement>('resetAnim').addEventListener('click', resetAnim);

// ---- вибір персонажа (свій набір анімацій) ----
let currentCharId: string | null = null;
function refreshCharSel(): void {
  const sel = $<HTMLSelectElement>('charSel'); const lib = loadLib();
  sel.innerHTML = '';
  if (!lib.length) { const o = document.createElement('option'); o.value = ''; o.textContent = '(нема персонажів)'; sel.appendChild(o); }
  for (const c of lib) { const o = document.createElement('option'); o.value = c.id; o.textContent = c.name; sel.appendChild(o); }
  sel.value = currentCharId ?? '';
}
$<HTMLSelectElement>('charSel').addEventListener('change', (e) => {
  // зберегти поточного персонажа в бібліотеку перед перемиканням
  if (currentCharId) {
    const lib = loadLib(); const idx = lib.findIndex((x) => x.id === currentCharId);
    if (idx >= 0) { lib[idx].doc = buildDoc(); storeLib(lib); }
  }
  const id = (e.target as HTMLSelectElement).value; (e.target as HTMLSelectElement).blur();
  const c = loadLib().find((x) => x.id === id); if (c) { currentCharId = id; loadCharFromDoc(c.doc); refreshCharSel(); status('Персонаж: ' + c.name); }
});

// ---- Скопіювати анімацію / (ПКМ) Вставити — буфер кліпів між персонажами ----
let animClip: { name: string; clip: Clip } | null = null;
let pasteMode = false;
function refreshCopyBtn(): void { const b = $<HTMLButtonElement>('copyAnimBtn'); b.textContent = pasteMode ? 'Вставити' : 'Скопіювати'; b.classList.toggle('light', pasteMode); }
$<HTMLButtonElement>('copyAnimBtn').addEventListener('click', () => {
  if (pasteMode) {
    if (!animClip) { status('Буфер порожній'); return; }
    pushUndo();
    state.clips[animClip.name] = JSON.parse(JSON.stringify(animClip.clip));
    state.anim = animClip.name; refreshAnimOptions(); loadFrame(0); refreshTimeline(); refreshUI();
    status('Вставлено анімацію: ' + animClip.name);
  } else {
    const a = state.anim; const clip = curClip();
    if (!a || !clip) { status('Вибери анімацію'); return; }
    animClip = { name: a, clip: JSON.parse(JSON.stringify(clip)) };
    status('Скопійовано: ' + a + (clip.keys.length ? '' : ' (без ключів — процедурна)'));
  }
});
$<HTMLButtonElement>('copyAnimBtn').addEventListener('contextmenu', (e) => { e.preventDefault(); pasteMode = !pasteMode; refreshCopyBtn(); });
refreshCopyBtn();

$<HTMLButtonElement>('ghostBtn').addEventListener('click', () => {
  ghostEnabled = !ghostEnabled;
  $<HTMLButtonElement>('ghostBtn').classList.toggle('light', ghostEnabled);
  refreshTimeline(); draw();
});
$<HTMLButtonElement>('firstFrameBtn').addEventListener('click', () => {
  firstFrameEnabled = !firstFrameEnabled;
  $<HTMLButtonElement>('firstFrameBtn').classList.toggle('light', firstFrameEnabled);
  draw();
});
$<HTMLButtonElement>('invertBtn').addEventListener('click', invertAnim);
$<HTMLButtonElement>('allKeyBtn').addEventListener('click', setAllKey);
$<HTMLInputElement>('bwPreview').addEventListener('change', (e) => {
  $<HTMLIFrameElement>('previewFrame').style.filter = (e.target as HTMLInputElement).checked ? 'grayscale(1)' : '';
});
window.addEventListener('resize', () => { resize(); draw(); alignPartsList(); if (faceOpen) alignFaceList(); });
if (typeof ResizeObserver !== 'undefined') {
  new ResizeObserver(() => { resize(); draw(); }).observe(canvas);
}
restoreLocal();
resize(); refreshUI();
renderLibrary(); // спочатку порожня — заповниться після async load
// Завантаження бібліотеки: IDB → міграція з localStorage → pull з GitHub
idbGet<LibItem[]>(LIB_KEY)
  .then(items => {
    if (items?.length) {
      _lib = items;
    } else {
      // Одноразова міграція зі старого localStorage
      try {
        const old = localStorage.getItem('ostap_library');
        if (old) { _lib = JSON.parse(old) as LibItem[]; idbSet(LIB_KEY, _lib).catch(() => {}); localStorage.removeItem('ostap_library'); }
      } catch { /* ignore */ }
    }
    renderLibrary();
    return pullCharLib(_lib);
  })
  .then(({ lib, added }) => {
    if (added > 0) { _lib = lib as LibItem[]; idbSet(LIB_KEY, _lib).catch(() => {}); renderLibrary(); status(`Синхронізовано: +${added} з GitHub`); }
  })
  .catch(() => {});
refreshCharSel();
refreshAnimOptions();
refreshTimeline();
alignPartsList();
status('');
// Перерахувати розміри після того як таймлайн зайняв місце в DOM
requestAnimationFrame(() => { resize(); draw(); });

