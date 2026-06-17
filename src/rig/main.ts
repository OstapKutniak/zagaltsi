import { keyImage, hasSolidBackground, imageToCanvas } from './keyer';

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
interface Clip { duration: number; keys: Keyframe[] }

// Порядок = шари ззаду наперед. Передня нога ПІД торсом (сорочка її перекриває).
const SLOT_DEFS = [
  { key: 'arm_back', label: 'Задня рука', len: 'arms', piv: [0.5, 0.08] },
  { key: 'leg_back', label: 'Задня нога', len: 'legs', piv: [0.5, 0.06] },
  { key: 'leg_front', label: 'Передня нога', len: 'legs', piv: [0.5, 0.06] },
  { key: 'torso', label: 'Торс', len: 'torso', piv: [0.5, 0.94] },
  { key: 'neck', label: 'Шия', len: 'neck', piv: [0.5, 0.9] },
  { key: 'head', label: 'Голова', len: 'head', piv: [0.5, 0.94] },
  { key: 'arm_front', label: 'Передня рука', len: 'arms', piv: [0.5, 0.08] },
] as const;
// Порядок ВІДОБРАЖЕННЯ у списку частин (не плутати зі SLOT_DEFS = порядок шарів).
const LIST_ORDER = ['arm_front', 'head', 'neck', 'torso', 'leg_front', 'leg_back', 'arm_back'] as const;
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
  mode: null as null | 'R' | 'S' | 'G',
  axis: null as null | 'x' | 'z', // обмеження осі (X/Z) під час G/S, як у Blender
  orig: null as null | Tf,
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
  canvas.width = canvas.clientWidth; canvas.height = canvas.clientHeight;
  applyOrigin();
  state.viewScale = (Math.min(canvas.width, canvas.height) / 470) * state.zoom; // ввесь персонаж влазить
}
// межі персонажа в екранних px — для габаритної рамки
const charBB = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
// ФІКСОВАНА лінія маківки (одиниці) — орієнтир висоти базового персонажа: калібрується
// раз під поточного персонажа (Остапа) і зберігається, щоб під неї рівняти інших.
let headLineUY: number | null = (() => { const v = localStorage.getItem('zag_head_uy'); return v != null ? Number(v) : null; })();
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
  ctx.globalAlpha = alpha;
  ctx.translate(a.x, a.y);
  ctx.rotate(worldRot(sel)); // сумарний кут (з урахуванням батьків)
  const wgs = worldGs(sel); // накопичений масштаб ланцюга (скейл батька -> на дітей)
  const scx = t.scale * t.sx * wgs * s(), scy = t.scale * t.sy * wgs * s(); // sx/sy — неоднорідний (S X / S Z)
  ctx.scale(t.flip * scx, scy); // flip<0 — дзеркало по X навколо півота
  if (sel !== 'ref') accumBounds(a, worldRot(sel), t.flip * scx, scy, ox, oy, w, h);

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
  resetBounds(); // межі персонажа збираються під час малювання частин
  ctx.save();
  if (state.facing < 0) { ctx.translate(state.origin.x, 0); ctx.scale(-1, 1); ctx.translate(-state.origin.x, 0); }
  if (state.showRef) drawImageAt('ref', state.selected === 'ref' ? 0.5 : 0.22);
  for (const d of SLOT_DEFS) drawImageAt(d.key, 1);

  // маркери pivot
  const drawMark = (sel: string) => {
    const a = anchorPx(sel); const on = sel === state.selected;
    ctx.strokeStyle = on ? '#ff9a1f' : '#9a9a9a'; ctx.fillStyle = ctx.strokeStyle;
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

  // ГАБАРИТ = реальні межі персонажа (низ ~ ноги/земля). Малюємо ПОВЕРХ, по факту арту.
  if (isFinite(charBB.minX)) {
    let x0 = charBB.minX, x1 = charBB.maxX;
    if (state.facing < 0) { x0 = 2 * state.origin.x - charBB.maxX; x1 = 2 * state.origin.x - charBB.minX; }
    const pad = 4;
    ctx.save();
    ctx.setLineDash([6, 6]); ctx.strokeStyle = 'rgba(255,154,31,0.6)'; ctx.lineWidth = 1.5;
    ctx.strokeRect(x0 - pad, charBB.minY - pad, (x1 - x0) + pad * 2, (charBB.maxY - charBB.minY) + pad * 2);
    ctx.restore();
    // КАЛІБРАЦІЯ лінії маківки: раз захоплюємо верхівку поточного персонажа й заморожуємо
    if (headLineUY == null && !state.anim && state.slots['head'].image) {
      headLineUY = (charBB.minY - state.origin.y) / s();
      try { localStorage.setItem('zag_head_uy', String(headLineUY)); } catch { /* ignore */ }
    }
  }

  if (state.mode || state.pivotMode || state.cutMode) {
    ctx.fillStyle = '#e8e8e8'; ctx.font = '14px monospace';
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
  state.mode = m; state.pivotMode = false; state.axis = null;
  state.orig = { rot: t.rot, scale: t.scale, dx: t.dx, dy: t.dy, flip: t.flip, sx: t.sx, sy: t.sy, gscale: t.gscale };
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
  }
  draw();
}
function endMode(commit: boolean): void {
  if (!state.mode) return;
  if (!commit && state.orig) Object.assign(tf(state.selected), state.orig);
  state.mode = null; state.orig = null; state.axis = null; refreshUI();
}

// ---- UI ----
function refreshChips(): void {
  const box = $('slotChips'); box.innerHTML = '';
  const make = (key: string, label: string, empty: boolean) => {
    const el = document.createElement('div');
    el.className = 'chip' + (key === state.selected ? ' sel' : '') + (empty ? ' empty' : '');
    el.textContent = label;
    el.onclick = () => { state.selected = key; state.pivotMode = false; state.mode = null; refreshUI(); };
    box.appendChild(el);
  };
  for (const key of LIST_ORDER) make(key, def(key).label, !state.slots[key].image);
  make('ref', 'Фоновий концепт', !state.ref.canvas);
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
function refreshUI(): void {
  refreshChips(); refreshImgGrid();
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
  $<HTMLButtonElement>('bendFlipBtn').textContent = 'Напрям (B)';
  $<HTMLButtonElement>('bendFlipBtn').classList.toggle('light', !!(ss && ss.bendFlip));
  $<HTMLButtonElement>('faceBtn').textContent = '🔄 Перевернути арт: ' + (state.facing > 0 ? '→' : '←');
  $<HTMLButtonElement>('animDirBtn').textContent = '🦵 Хода в бік: ' + (state.animDir > 0 ? '→' : '←');
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

// ---- верхні таби розділів (навігація між редакторами) ----
for (const b of Array.from(document.querySelectorAll<HTMLButtonElement>('#topTabs button'))) {
  const go = b.getAttribute('data-go');
  if (go) b.addEventListener('click', () => { window.location.href = go; });
  else if (b.hasAttribute('data-soon')) { b.disabled = true; b.title = 'Скоро'; }
}

// ---- «Частини персонажа» — кнопка, що розкриває/ховає список частин ----
let partsOpen = true;
$<HTMLButtonElement>('partsToggle').addEventListener('click', () => {
  partsOpen = !partsOpen;
  $('partsList').style.display = partsOpen ? '' : 'none';
});

// ---- Лінія висоти: поставити на маківку поточного персонажа (фіксується) ----
$<HTMLButtonElement>('setHeadLine').addEventListener('click', () => {
  if (!isFinite(charBB.minY)) { status('Спершу завантаж частини персонажа'); return; }
  headLineUY = (charBB.minY - state.origin.y) / s();
  try { localStorage.setItem('zag_head_uy', String(headLineUY)); } catch { /* ignore */ }
  draw(); status('Лінію висоти встановлено на маківку');
});

// ---- Мірор (M): дзеркалити арт вибраної частини ----
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
  const tag = (document.activeElement?.tagName ?? '').toUpperCase();
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  if (ev.ctrlKey && ev.code === 'KeyZ') { ev.preventDefault(); undo(); return; }
  // обмеження осі під час G/S (Blender: X — гориз., Z — верт.; повторне натискання знімає)
  if (state.mode && (ev.code === 'KeyX' || ev.code === 'KeyZ')) {
    ev.preventDefault(); const ax = ev.code === 'KeyX' ? 'x' : 'z';
    state.axis = state.axis === ax ? null : ax; applyMode(); return;
  }
  if (ev.code === 'Space') { ev.preventDefault(); if (state.anim) play(!state.playing); return; } // пробіл — плей/пауза
  if (ev.code === 'KeyG' || ev.code === 'KeyR' || ev.code === 'KeyS') { ev.preventDefault(); startMode(ev.code === 'KeyG' ? 'G' : ev.code === 'KeyR' ? 'R' : 'S'); }
  else if (ev.code === 'KeyM') { ev.preventDefault(); pushUndo(); const t = tf(state.selected); t.flip *= -1; refreshUI(); }
  else if (ev.code === 'KeyB') { ev.preventDefault(); if (state.selected !== 'ref') { pushUndo(); const sl = state.slots[state.selected]; sl.bendFlip = !sl.bendFlip; refreshUI(); } }
  else if (ev.code === 'KeyF') { ev.preventDefault(); flipAllBends(); }
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
  if (keepAnim) { state.anim = keepAnim; enterClip(); state.animT = 0; state.selKeys = []; loadFrame(0); play(wasPlaying); }
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

// ---- бібліотека персонажів (localStorage) ----
interface LibItem { id: string; name: string; cat: 'char' | 'enemy'; doc: ReturnType<typeof buildDoc>; thumb: string }
const LIB_KEY = 'ostap_library';
let libCat: 'char' | 'enemy' = 'char'; // активна вкладка бібліотеки
const loadLib = (): LibItem[] => { try { return JSON.parse(localStorage.getItem(LIB_KEY) || '[]'); } catch { return []; } };
const storeLib = (lib: LibItem[]): void => { try { localStorage.setItem(LIB_KEY, JSON.stringify(lib)); } catch { status('Не вдалося зберегти — переповнення сховища браузера'); } };
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
    card.onclick = () => { loadCharFromDoc(c.doc); status(`Завантажено: ${c.name}`); };
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
  storeLib(lib); renderLibrary();
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
const FPS = 24; // кадрів на секунду (таймлайн показує НОМЕРИ КАДРІВ)
const frameOf = (t: number): number => Math.round(t * FPS);
let playheadEl: HTMLElement | null = null, badgeEl: HTMLElement | null = null;
function movePlayhead(): void {
  const dur = curClip()?.duration ?? 1; const pct = (Math.min(state.animT, dur) / dur) * 100;
  if (playheadEl) playheadEl.style.left = pct + '%';
  if (badgeEl) badgeEl.textContent = String(frameOf(state.animT));
  $('tlTime').textContent = state.animT.toFixed(2);
}
function refreshTimeline(): void {
  const clip = curClip(); const dur = clip ? clip.duration : 1;
  $<HTMLInputElement>('dur').value = String(dur);
  $<HTMLButtonElement>('playBtn').textContent = state.playing ? 'Пауза' : 'Грати';
  $<HTMLButtonElement>('playBtn').classList.toggle('light', state.playing);
  $<HTMLSelectElement>('anim').value = state.anim ?? '';
  const track = $('track'); track.innerHTML = '';
  const total = Math.max(1, Math.round(dur * FPS));
  const step = total <= 12 ? 1 : total <= 30 ? 2 : total <= 80 ? 5 : 10;
  for (let f = 0; f <= total; f += step) {
    const tk = document.createElement('div'); tk.className = 'tick'; tk.style.left = `${(f / total) * 100}%`; tk.textContent = String(f);
    track.appendChild(tk);
  }
  if (clip) for (let i = 0; i < clip.keys.length; i++) {
    const k = clip.keys[i];
    const dot = document.createElement('div');
    dot.className = 'keyDot' + (state.selKeys.includes(i) ? ' sel' : '') + (k.interp === 'smooth' ? ' smooth' : '');
    dot.style.left = `${(k.t / dur) * 100}%`;
    dot.addEventListener('mousedown', (e) => {
      e.stopPropagation(); // не скрабити при кліку по ключу
      if (e.shiftKey) { const j = state.selKeys.indexOf(i); if (j >= 0) state.selKeys.splice(j, 1); else state.selKeys.push(i); }
      else state.selKeys = [i];
      play(false); loadFrame(k.t); refreshTimeline(); refreshUI();
    });
    track.appendChild(dot);
  }
  const ph = document.createElement('div'); ph.className = 'playhead';
  const badge = document.createElement('div'); badge.className = 'phBadge'; badge.textContent = String(frameOf(state.animT));
  ph.appendChild(badge); track.appendChild(ph);
  playheadEl = ph; badgeEl = badge; movePlayhead();
}
// скраб: тягни по треку — вибираєш кадр
let scrubbing = false;
function scrubTo(clientX: number): void {
  const r = $('track').getBoundingClientRect(); const dur = curClip()?.duration ?? 1;
  const f = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
  loadFrame(f * dur); movePlayhead(); refreshUI();
}
$('track').addEventListener('mousedown', (e) => { if ((e as MouseEvent).button !== 0) return; scrubbing = true; play(false); scrubTo((e as MouseEvent).clientX); });
window.addEventListener('mousemove', (e) => { if (scrubbing) scrubTo((e as MouseEvent).clientX); });
window.addEventListener('mouseup', () => { scrubbing = false; });
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
$<HTMLSelectElement>('anim').addEventListener('change', (e) => {
  const v = (e.target as HTMLSelectElement).value; // ВАЖЛИВО: зчитати ДО play(false) — play()→refreshTimeline() скидає цей select назад на state.anim (тоді ще порожній) і вибір губився
  (e.target as HTMLSelectElement).blur(); // зняти фокус, інакше Пробіл відкриває список замість плей/пауза
  play(false);
  if (v) { state.anim = v; enterClip(); state.animT = 0; state.selKeys = []; loadFrame(0); refreshTimeline(); refreshUI(); play(true); } // вибрав анімацію — одразу програється
  else { state.anim = null; exitClip(); refreshTimeline(); refreshUI(); }
});
$<HTMLButtonElement>('playBtn').addEventListener('click', () => play(!state.playing));
$<HTMLInputElement>('dur').addEventListener('input', (e) => { const c = curClip(); if (c) { c.duration = Math.max(0.2, Number((e.target as HTMLInputElement).value)); refreshTimeline(); } });
$<HTMLButtonElement>('keyBtn').addEventListener('click', setKey);
$<HTMLButtonElement>('delKeyBtn').addEventListener('click', delKey);
$<HTMLButtonElement>('bakeBtn').addEventListener('click', bakeProcedural);
// «Звʼязати» — одна кнопка: ЛКМ застосовує режим, ПКМ перемикає лінійно/згладжено (білий = згладжено)
let linkMode: 'linear' | 'smooth' = 'linear';
function refreshLinkBtn(): void { const b = $<HTMLButtonElement>('linkBtn'); b.textContent = 'Звʼязати: ' + (linkMode === 'linear' ? 'лінійно' : 'згладжено'); b.classList.toggle('light', linkMode === 'smooth'); }
$<HTMLButtonElement>('linkBtn').addEventListener('click', () => setInterp(linkMode));
$<HTMLButtonElement>('linkBtn').addEventListener('contextmenu', (e) => { e.preventDefault(); linkMode = linkMode === 'linear' ? 'smooth' : 'linear'; refreshLinkBtn(); });
refreshLinkBtn();
$<HTMLButtonElement>('resetAnim').addEventListener('click', resetAnim);

window.addEventListener('resize', () => { resize(); draw(); });
restoreLocal();
resize(); refreshUI();
renderLibrary();
refreshTimeline();
status('');
