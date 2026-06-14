import { keyImage, hasSolidBackground, imageToCanvas } from './keyer';

// ---- Конструктор персонажа, керування у стилі Blender ----
// Слоти під PNG (цілі кінцівки) + орієнтир-силует (теж трансформовний).
// Гарячі клавіші за ФІЗИЧНОЮ клавішею (ev.code) — працюють за будь-якої розкладки:
// G рух · R поворот · S розмір · Q півот · Ctrl+Z відміна. Клік — підтвердити, Esc — скасувати.

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const rad = (d: number): number => (d * Math.PI) / 180;

interface Tf { rot: number; scale: number; dx: number; dy: number }
interface Slot extends Tf { image: string | null; pivotX: number; pivotY: number }
interface Ref extends Tf { canvas: HTMLCanvasElement | null }

const SLOT_DEFS = [
  { key: 'leg_back', label: 'Нога зад', joint: 'hipBack', len: 'legs', piv: [0.5, 0.06] },
  { key: 'arm_back', label: 'Рука зад', joint: 'shBack', len: 'arms', piv: [0.5, 0.08] },
  { key: 'torso', label: 'Торс', joint: 'hip', len: 'torso', piv: [0.5, 0.94] },
  { key: 'head', label: 'Голова', joint: 'neck', len: 'head', piv: [0.5, 0.94] },
  { key: 'leg_front', label: 'Нога перед', joint: 'hipFront', len: 'legs', piv: [0.5, 0.06] },
  { key: 'arm_front', label: 'Рука перед', joint: 'shFront', len: 'arms', piv: [0.5, 0.08] },
] as const;
const def = (key: string) => SLOT_DEFS.find((d) => d.key === key)!;
const BASE = { torso: 105, head: 86, arms: 116, legs: 140 };

const canvas = $<HTMLCanvasElement>('stage');
const ctx = canvas.getContext('2d')!;

const state = {
  images: new Map<string, HTMLCanvasElement>(),
  imageNames: [] as string[],
  ref: { canvas: null, rot: 0, scale: 1, dx: 0, dy: 0 } as Ref,
  showRef: true,
  prop: { overall: 1, head: 1.4, torso: 0.95, arms: 1.1, legs: 1.3 },
  slots: {} as Record<string, Slot>,
  selected: 'torso',
  showPivots: true,
  pivotMode: false,
  zoom: 1,
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
for (const d of SLOT_DEFS) state.slots[d.key] = { image: null, pivotX: d.piv[0], pivotY: d.piv[1], rot: 0, scale: 1, dx: 0, dy: 0 };

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
  const b = baseUnit(sel); const t = tf(sel); const j = toPx(b.x, b.y);
  return { x: j.x + t.dx * s(), y: j.y + t.dy * s() };
}

// ---- undo ----
const undoStack: string[] = [];
const snapshot = (): string => JSON.stringify({ prop: state.prop, slots: state.slots, ref: { rot: state.ref.rot, scale: state.ref.scale, dx: state.ref.dx, dy: state.ref.dy }, sel: state.selected });
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

// ---- рендер ----
function resize(): void {
  canvas.width = canvas.clientWidth; canvas.height = canvas.clientHeight;
  state.origin.x = canvas.width * 0.5; state.origin.y = canvas.height * 0.58;
  state.viewScale = (Math.min(canvas.width, canvas.height) / 360) * state.zoom;
}
function drawImageAt(sel: string, alpha: number): void {
  const img = imgOf(sel); if (!img) return;
  const t = tf(sel); const p = pivotOf(sel); const a = anchorPx(sel);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(a.x, a.y);
  ctx.rotate(rad(t.rot));
  const sc = t.scale * s();
  ctx.scale(sc, sc);
  ctx.drawImage(img, -p.x * img.width, -p.y * img.height);
  ctx.restore();
}
function draw(): void {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
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

  if (state.mode || state.pivotMode) {
    ctx.fillStyle = '#ffd000'; ctx.font = '14px monospace';
    ctx.fillText(state.pivotMode ? 'PIVOT: клікни на частині' : `${state.mode}: рухай мишею · клік — ок, Esc — скасувати`, 12, canvas.height - 16);
  }
}

// ---- координати картинки під курсором ----
function curLocal(sel: string, sx: number, sy: number): { lx: number; ly: number; iw: number; ih: number } | null {
  const img = imgOf(sel); if (!img) return null;
  const t = tf(sel); const p = pivotOf(sel); const a = anchorPx(sel);
  const ang = rad(-t.rot); const dx = sx - a.x, dy = sy - a.y;
  const rx = dx * Math.cos(ang) - dy * Math.sin(ang); const ry = dx * Math.sin(ang) + dy * Math.cos(ang);
  const sc = t.scale * s();
  return { lx: rx / sc + p.x * img.width, ly: ry / sc + p.y * img.height, iw: img.width, ih: img.height };
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
  }
}
function addImageFile(file: File, assignToSelected: boolean): void {
  const keyBg = $<HTMLInputElement>('keyBg').checked;
  const img = new Image();
  img.onload = () => {
    const cv = keyBg && hasSolidBackground(img) ? keyImage(img) : imageToCanvas(img);
    state.images.set(file.name, cv);
    if (!state.imageNames.includes(file.name)) state.imageNames.push(file.name);
    if (assignToSelected && state.selected !== 'ref') assignImage(state.selected, file.name);
    refreshUI();
  };
  img.src = URL.createObjectURL(file);
}

// ---- режими R/S/G ----
function startMode(m: 'R' | 'S' | 'G'): void {
  pushUndo();
  const t = tf(state.selected);
  state.mode = m; state.pivotMode = false;
  state.orig = { rot: t.rot, scale: t.scale, dx: t.dx, dy: t.dy };
  const a = anchorPx(state.selected);
  state.startMx = state.mouse.x; state.startMy = state.mouse.y;
  state.startAng = Math.atan2(state.mouse.y - a.y, state.mouse.x - a.x);
  state.startDist = Math.max(8, Math.hypot(state.mouse.x - a.x, state.mouse.y - a.y));
  draw();
}
function applyMode(): void {
  if (!state.mode || !state.orig) return;
  const t = tf(state.selected); const a = anchorPx(state.selected);
  if (state.mode === 'G') { t.dx = state.orig.dx + (state.mouse.x - state.startMx) / s(); t.dy = state.orig.dy + (state.mouse.y - state.startMy) / s(); }
  else if (state.mode === 'R') { const ang = Math.atan2(state.mouse.y - a.y, state.mouse.x - a.x); t.rot = state.orig.rot + ((ang - state.startAng) * 180) / Math.PI; }
  else if (state.mode === 'S') { const d = Math.hypot(state.mouse.x - a.x, state.mouse.y - a.y); t.scale = Math.max(0.02, state.orig.scale * (d / state.startDist)); }
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
  draw();
}
const status = (m: string): void => { $('status').textContent = m; };

// ---- контроли ----
$<HTMLSelectElement>('imgSel').addEventListener('change', (e) => { pushUndo(); assignImage(state.selected, (e.target as HTMLSelectElement).value || null); refreshUI(); });
$<HTMLInputElement>('rot').addEventListener('pointerdown', pushUndo);
$<HTMLInputElement>('rot').addEventListener('input', (e) => { tf(state.selected).rot = Number((e.target as HTMLInputElement).value); $('rotV').textContent = (e.target as HTMLInputElement).value; draw(); });
$<HTMLInputElement>('scale').addEventListener('pointerdown', pushUndo);
$<HTMLInputElement>('scale').addEventListener('input', (e) => { tf(state.selected).scale = Number((e.target as HTMLInputElement).value); draw(); });
$<HTMLButtonElement>('setPivot').addEventListener('click', () => { if (state.selected !== 'ref') { state.pivotMode = !state.pivotMode; state.mode = null; refreshUI(); } });
$<HTMLButtonElement>('resetPart').addEventListener('click', () => { pushUndo(); if (state.selected === 'ref') Object.assign(state.ref, { rot: 0, scale: 1, dx: 0, dy: 0 }); else assignImage(state.selected, state.slots[state.selected].image); refreshUI(); });
for (const k of ['overall', 'head', 'torso', 'arms', 'legs'] as const) {
  $<HTMLInputElement>(`p_${k}`).addEventListener('pointerdown', pushUndo);
  $<HTMLInputElement>(`p_${k}`).addEventListener('input', (e) => { state.prop[k] = Number((e.target as HTMLInputElement).value); $(`p_${k}V`).textContent = state.prop[k].toFixed(2); draw(); });
}
$<HTMLInputElement>('showPivots').addEventListener('change', (e) => { state.showPivots = (e.target as HTMLInputElement).checked; draw(); });
$<HTMLInputElement>('showRef').addEventListener('change', (e) => { state.showRef = (e.target as HTMLInputElement).checked; draw(); });
$<HTMLButtonElement>('refBtn').addEventListener('click', () => $<HTMLInputElement>('refInput').click());
$<HTMLButtonElement>('refClear').addEventListener('click', () => { pushUndo(); state.ref.canvas = null; draw(); });
$<HTMLInputElement>('refInput').addEventListener('change', (ev) => {
  const f = (ev.target as HTMLInputElement).files?.[0]; if (!f) return;
  const img = new Image(); img.onload = () => { state.ref.canvas = imageToCanvas(img); state.selected = 'ref'; refreshUI(); }; img.src = URL.createObjectURL(f);
});

// ---- canvas ----
let drag: { key: string; sx: number; sy: number; dx: number; dy: number } | null = null;
canvas.addEventListener('mousedown', (ev) => {
  const c = { x: ev.offsetX, y: ev.offsetY };
  if (state.mode) { endMode(ev.button === 0); return; }
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
  if (state.mode) applyMode();
  else if (drag) { tf(drag.key).dx = drag.dx + (state.mouse.x - drag.sx) / s(); tf(drag.key).dy = drag.dy + (state.mouse.y - drag.sy) / s(); draw(); }
});
window.addEventListener('mouseup', () => { drag = null; });
canvas.addEventListener('contextmenu', (ev) => { ev.preventDefault(); if (state.mode) endMode(false); });
canvas.addEventListener('wheel', (ev) => { ev.preventDefault(); state.zoom = Math.min(3, Math.max(0.3, state.zoom * (ev.deltaY < 0 ? 1.1 : 0.9))); resize(); draw(); }, { passive: false });

// ---- клавіатура (ev.code — незалежно від розкладки) ----
window.addEventListener('keydown', (ev) => {
  const tag = (document.activeElement?.tagName ?? '').toUpperCase();
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  if (ev.ctrlKey && ev.code === 'KeyZ') { ev.preventDefault(); undo(); return; }
  if (ev.code === 'KeyG' || ev.code === 'KeyR' || ev.code === 'KeyS') { ev.preventDefault(); startMode(ev.code === 'KeyG' ? 'G' : ev.code === 'KeyR' ? 'R' : 'S'); }
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
  if (files.length && state.selected !== 'ref') pushUndo();
  files.forEach((f, i) => addImageFile(f, i === 0));
  if (files.length) status(`Перетягнуто → "${state.selected === 'ref' ? 'бібліотека' : tfLabel(state.selected)}"`);
});
const tfLabel = (key: string): string => (key === 'ref' ? 'Орієнтир' : def(key).label);

$<HTMLInputElement>('fileInput').addEventListener('change', (ev) => { Array.from((ev.target as HTMLInputElement).files ?? []).forEach((f, i) => addImageFile(f, i === 0)); });

// ---- експорт / імпорт ----
$<HTMLButtonElement>('exportBtn').addEventListener('click', () => {
  const doc = { version: 2, proportions: state.prop, slots: state.slots };
  const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'ostap_character.json'; a.click();
  status('Експортовано ostap_character.json');
});
$<HTMLButtonElement>('importBtn').addEventListener('click', () => $<HTMLInputElement>('importInput').click());
$<HTMLInputElement>('importInput').addEventListener('change', (ev) => {
  const file = (ev.target as HTMLInputElement).files?.[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const doc = JSON.parse(String(reader.result));
      if (doc.proportions) Object.assign(state.prop, doc.proportions);
      if (doc.slots) for (const k of Object.keys(state.slots)) if (doc.slots[k]) Object.assign(state.slots[k], doc.slots[k]);
      status('Імпортовано. Підвантаж ті самі PNG, якщо картинок не видно.'); refreshUI();
    } catch { status('Помилка читання JSON'); }
  };
  reader.readAsText(file);
});

window.addEventListener('resize', () => { resize(); draw(); });
resize(); refreshUI();
status('Завантаж орієнтир-силует і частини. G/R/S — рух/поворот/розмір, Q — півот, Ctrl+Z — відміна.');
