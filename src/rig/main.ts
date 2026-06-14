import { keyImage, hasSolidBackground, imageToCanvas } from './keyer';

// ---- Конструктор персонажа (character creator), керування у стилі Blender ----
// Слоти під PNG (цілі кінцівки) поверх орієнтира-силуету Остапа. Drag&drop картинки
// на вибрану частину. R/S/G — поворот/масштаб/рух за мишею (клік — підтвердити, Esc —
// скасувати). Pivot — видимий хрестик, обертання/масштаб навколо нього.

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const rad = (d: number): number => (d * Math.PI) / 180;

interface Slot {
  image: string | null;
  pivotX: number;
  pivotY: number;
  rot: number;
  scale: number; // одиниць світу на піксель картинки
  dx: number; // зсув від суглоба, в одиницях
  dy: number;
}

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
  reference: null as HTMLCanvasElement | null,
  showRef: true,
  prop: { overall: 1, head: 1.4, torso: 0.95, arms: 1.1, legs: 1.3 }, // стартові пропорції — ланкий Остап
  slots: {} as Record<string, Slot>,
  selected: 'torso',
  showPivots: true,
  pivotMode: false,
  zoom: 1,
  origin: { x: 0, y: 0 },
  viewScale: 1,
  mouse: { x: 0, y: 0 },
  mode: null as null | 'R' | 'S' | 'G',
  orig: null as null | { rot: number; scale: number; dx: number; dy: number },
  startAng: 0,
  startDist: 1,
  startMx: 0,
  startMy: 0,
};
for (const d of SLOT_DEFS) state.slots[d.key] = { image: null, pivotX: d.piv[0], pivotY: d.piv[1], rot: 0, scale: 1, dx: 0, dy: 0 };

const lenOf = (key: string): number => {
  const w = def(key).len as keyof typeof BASE;
  return BASE[w] * state.prop[w];
};
function joints(): Record<string, { x: number; y: number }> {
  const t = BASE.torso * state.prop.torso;
  return {
    hip: { x: 0, y: 0 },
    neck: { x: 0, y: -t },
    shBack: { x: -7, y: -t + 12 },
    shFront: { x: 7, y: -t + 12 },
    hipBack: { x: -9, y: -4 },
    hipFront: { x: 9, y: -4 },
  };
}
const s = (): number => state.viewScale * state.prop.overall;
function toPx(ux: number, uy: number): { x: number; y: number } {
  return { x: state.origin.x + ux * s(), y: state.origin.y + uy * s() };
}
function anchorPx(key: string): { x: number; y: number } {
  const slot = state.slots[key];
  const j = toPx(joints()[def(key).joint].x, joints()[def(key).joint].y);
  return { x: j.x + slot.dx * s(), y: j.y + slot.dy * s() };
}

function resize(): void {
  canvas.width = canvas.clientWidth;
  canvas.height = canvas.clientHeight;
  state.origin.x = canvas.width * 0.5;
  state.origin.y = canvas.height * 0.58;
  state.viewScale = (Math.min(canvas.width, canvas.height) / 360) * state.zoom;
}

function draw(): void {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // орієнтир-силует (блідо позаду)
  if (state.reference && state.showRef) {
    const r = state.reference;
    const h = canvas.height * 0.82;
    const sc = h / r.height;
    ctx.globalAlpha = 0.22;
    ctx.drawImage(r, canvas.width / 2 - (r.width * sc) / 2, canvas.height / 2 - h / 2, r.width * sc, h);
    ctx.globalAlpha = 1;
  }

  // частини (порядок масиву = ззаду наперед)
  for (const d of SLOT_DEFS) {
    const slot = state.slots[d.key];
    const img = slot.image ? state.images.get(slot.image) : undefined;
    if (!img) continue;
    const a = anchorPx(d.key);
    ctx.save();
    ctx.translate(a.x, a.y);
    ctx.rotate(rad(slot.rot));
    const sc = slot.scale * s();
    ctx.scale(sc, sc);
    ctx.drawImage(img, -slot.pivotX * img.width, -slot.pivotY * img.height);
    ctx.restore();
  }

  // півоти/маркери
  for (const d of SLOT_DEFS) {
    const sel = d.key === state.selected;
    if (!state.showPivots && !sel) continue;
    const a = anchorPx(d.key);
    ctx.strokeStyle = sel ? '#ffd000' : '#5aa0ff';
    ctx.fillStyle = ctx.strokeStyle;
    if (sel) {
      // хрестик-pivot
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(a.x - 9, a.y); ctx.lineTo(a.x + 9, a.y);
      ctx.moveTo(a.x, a.y - 9); ctx.lineTo(a.x, a.y + 9);
      ctx.stroke();
      ctx.beginPath(); ctx.arc(a.x, a.y, 4, 0, Math.PI * 2); ctx.stroke();
    } else {
      ctx.beginPath(); ctx.arc(a.x, a.y, 3, 0, Math.PI * 2); ctx.fill();
    }
  }

  // підказка режиму
  if (state.mode || state.pivotMode) {
    ctx.fillStyle = '#ffd000';
    ctx.font = '14px monospace';
    const txt = state.pivotMode ? 'PIVOT: клікни на частині' : `${state.mode}: рухай мишею · клік — ок, Esc — скасувати`;
    ctx.fillText(txt, 12, canvas.height - 16);
  }
}

function curLocal(key: string, sx: number, sy: number): { lx: number; ly: number; iw: number; ih: number } | null {
  const slot = state.slots[key];
  const img = slot.image ? state.images.get(slot.image) : undefined;
  if (!img) return null;
  const a = anchorPx(key);
  const ang = rad(-slot.rot);
  const dx = sx - a.x, dy = sy - a.y;
  const rx = dx * Math.cos(ang) - dy * Math.sin(ang);
  const ry = dx * Math.sin(ang) + dy * Math.cos(ang);
  const sc = slot.scale * s();
  return { lx: rx / sc + slot.pivotX * img.width, ly: ry / sc + slot.pivotY * img.height, iw: img.width, ih: img.height };
}
function hitTest(sx: number, sy: number): string | null {
  for (let i = SLOT_DEFS.length - 1; i >= 0; i--) {
    const loc = curLocal(SLOT_DEFS[i].key, sx, sy);
    if (loc && loc.lx >= 0 && loc.lx <= loc.iw && loc.ly >= 0 && loc.ly <= loc.ih) return SLOT_DEFS[i].key;
  }
  return null;
}

function assignImage(key: string, name: string | null): void {
  const slot = state.slots[key];
  slot.image = name;
  if (name) {
    const img = state.images.get(name);
    if (img) slot.scale = lenOf(key) / img.height;
    slot.rot = 0; slot.dx = 0; slot.dy = 0;
    slot.pivotX = def(key).piv[0]; slot.pivotY = def(key).piv[1];
  }
}

function addImageFile(file: File, assignToSelected: boolean): void {
  const keyBg = $<HTMLInputElement>('keyBg').checked;
  const img = new Image();
  img.onload = () => {
    const cv = keyBg && hasSolidBackground(img) ? keyImage(img) : imageToCanvas(img);
    state.images.set(file.name, cv);
    if (!state.imageNames.includes(file.name)) state.imageNames.push(file.name);
    if (assignToSelected) assignImage(state.selected, file.name);
    refreshUI();
  };
  img.src = URL.createObjectURL(file);
}

// ---- Blender-режими R/S/G ----
function startMode(m: 'R' | 'S' | 'G'): void {
  const slot = state.slots[state.selected];
  state.mode = m;
  state.pivotMode = false;
  state.orig = { rot: slot.rot, scale: slot.scale, dx: slot.dx, dy: slot.dy };
  const a = anchorPx(state.selected);
  state.startMx = state.mouse.x; state.startMy = state.mouse.y;
  state.startAng = Math.atan2(state.mouse.y - a.y, state.mouse.x - a.x);
  state.startDist = Math.max(8, Math.hypot(state.mouse.x - a.x, state.mouse.y - a.y));
  draw();
}
function applyMode(): void {
  if (!state.mode || !state.orig) return;
  const slot = state.slots[state.selected];
  const a = anchorPx(state.selected);
  if (state.mode === 'G') {
    slot.dx = state.orig.dx + (state.mouse.x - state.startMx) / s();
    slot.dy = state.orig.dy + (state.mouse.y - state.startMy) / s();
  } else if (state.mode === 'R') {
    const ang = Math.atan2(state.mouse.y - a.y, state.mouse.x - a.x);
    slot.rot = state.orig.rot + ((ang - state.startAng) * 180) / Math.PI;
  } else if (state.mode === 'S') {
    const d = Math.hypot(state.mouse.x - a.x, state.mouse.y - a.y);
    slot.scale = Math.max(0.02, state.orig.scale * (d / state.startDist));
  }
  draw();
}
function endMode(commit: boolean): void {
  if (!state.mode) return;
  if (!commit && state.orig) Object.assign(state.slots[state.selected], state.orig);
  state.mode = null;
  state.orig = null;
  refreshUI();
}

// ---- UI ----
function refreshChips(): void {
  const box = $('slotChips');
  box.innerHTML = '';
  for (const d of SLOT_DEFS) {
    const has = !!state.slots[d.key].image;
    const el = document.createElement('div');
    el.className = 'chip' + (d.key === state.selected ? ' sel' : '') + (has ? '' : ' empty');
    el.textContent = d.label + (has ? '' : ' ○');
    el.onclick = () => { state.selected = d.key; state.pivotMode = false; state.mode = null; refreshUI(); };
    box.appendChild(el);
  }
}
function refreshImgSel(): void {
  const sel = $<HTMLSelectElement>('imgSel');
  sel.innerHTML = '<option value="">(немає)</option>';
  for (const n of state.imageNames) {
    const o = document.createElement('option');
    o.value = n; o.textContent = n; sel.appendChild(o);
  }
  sel.value = state.slots[state.selected].image ?? '';
}
function refreshUI(): void {
  refreshChips();
  refreshImgSel();
  const slot = state.slots[state.selected];
  $<HTMLInputElement>('rot').value = String(Math.round(slot.rot));
  $('rotV').textContent = String(Math.round(slot.rot));
  $<HTMLInputElement>('scale').value = String(slot.scale);
  $('scaleV').textContent = slot.scale < 1 ? slot.scale.toFixed(2) : slot.scale.toFixed(1);
  for (const k of ['overall', 'head', 'torso', 'arms', 'legs'] as const) {
    $<HTMLInputElement>(`p_${k}`).value = String(state.prop[k]);
    $(`p_${k}V`).textContent = state.prop[k].toFixed(2);
  }
  $<HTMLButtonElement>('setPivot').textContent = state.pivotMode ? '⌖ Клікни на частині…' : '⌖ Тицьнути півот';
  draw();
}
const status = (m: string): void => { $('status').textContent = m; };

// ---- події контролів ----
$<HTMLSelectElement>('imgSel').addEventListener('change', (e) => { assignImage(state.selected, (e.target as HTMLSelectElement).value || null); refreshUI(); });
$<HTMLInputElement>('rot').addEventListener('input', (e) => { state.slots[state.selected].rot = Number((e.target as HTMLInputElement).value); $('rotV').textContent = (e.target as HTMLInputElement).value; draw(); });
$<HTMLInputElement>('scale').addEventListener('input', (e) => { state.slots[state.selected].scale = Number((e.target as HTMLInputElement).value); draw(); });
$<HTMLButtonElement>('setPivot').addEventListener('click', () => { state.pivotMode = !state.pivotMode; state.mode = null; refreshUI(); });
$<HTMLButtonElement>('resetPart').addEventListener('click', () => { assignImage(state.selected, state.slots[state.selected].image); refreshUI(); });
for (const k of ['overall', 'head', 'torso', 'arms', 'legs'] as const) {
  $<HTMLInputElement>(`p_${k}`).addEventListener('input', (e) => { state.prop[k] = Number((e.target as HTMLInputElement).value); $(`p_${k}V`).textContent = state.prop[k].toFixed(2); draw(); });
}
$<HTMLInputElement>('showPivots').addEventListener('change', (e) => { state.showPivots = (e.target as HTMLInputElement).checked; draw(); });
$<HTMLInputElement>('showRef').addEventListener('change', (e) => { state.showRef = (e.target as HTMLInputElement).checked; draw(); });
$<HTMLButtonElement>('refBtn').addEventListener('click', () => $<HTMLInputElement>('refInput').click());
$<HTMLButtonElement>('refClear').addEventListener('click', () => { state.reference = null; draw(); });
$<HTMLInputElement>('refInput').addEventListener('change', (ev) => {
  const f = (ev.target as HTMLInputElement).files?.[0]; if (!f) return;
  const img = new Image();
  img.onload = () => { state.reference = imageToCanvas(img); draw(); };
  img.src = URL.createObjectURL(f);
});

// ---- canvas: вибір / drag / pivot / режими ----
let drag: { key: string; sx: number; sy: number; dx: number; dy: number } | null = null;
canvas.addEventListener('mousedown', (ev) => {
  const c = { x: ev.offsetX, y: ev.offsetY };
  if (state.mode) { endMode(ev.button === 0); return; } // ЛКМ — підтвердити
  if (state.pivotMode) {
    const loc = curLocal(state.selected, c.x, c.y);
    if (loc) {
      state.slots[state.selected].pivotX = Math.max(0, Math.min(1, loc.lx / loc.iw));
      state.slots[state.selected].pivotY = Math.max(0, Math.min(1, loc.ly / loc.ih));
    }
    state.pivotMode = false; refreshUI(); return;
  }
  const hit = hitTest(c.x, c.y);
  if (hit) { state.selected = hit; const sl = state.slots[hit]; drag = { key: hit, sx: c.x, sy: c.y, dx: sl.dx, dy: sl.dy }; refreshUI(); }
});
canvas.addEventListener('mousemove', (ev) => { state.mouse = { x: ev.offsetX, y: ev.offsetY }; if (state.mode) applyMode(); });
window.addEventListener('mousemove', (ev) => {
  if (drag) {
    const r = canvas.getBoundingClientRect();
    state.slots[drag.key].dx = drag.dx + (ev.clientX - r.left - drag.sx) / s();
    state.slots[drag.key].dy = drag.dy + (ev.clientY - r.top - drag.sy) / s();
    draw();
  }
});
window.addEventListener('mouseup', () => { drag = null; });
canvas.addEventListener('contextmenu', (ev) => { ev.preventDefault(); if (state.mode) endMode(false); });
canvas.addEventListener('wheel', (ev) => { ev.preventDefault(); state.zoom = Math.min(3, Math.max(0.3, state.zoom * (ev.deltaY < 0 ? 1.1 : 0.9))); resize(); draw(); }, { passive: false });

// ---- клавіатура (Blender-стиль) ----
window.addEventListener('keydown', (ev) => {
  const tag = (document.activeElement?.tagName ?? '').toUpperCase();
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  const k = ev.key.toLowerCase();
  if (k === 'r' || k === 's' || k === 'g') { ev.preventDefault(); startMode(k.toUpperCase() as 'R' | 'S' | 'G'); }
  else if (ev.key === 'Escape') endMode(false);
  else if (ev.key === 'Enter') endMode(true);
});

// ---- drag&drop картинок на вибрану частину ----
const stage = $('stageWrap');
['dragenter', 'dragover'].forEach((e) => stage.addEventListener(e, (ev) => { ev.preventDefault(); }));
stage.addEventListener('drop', (ev) => {
  ev.preventDefault();
  const files = Array.from((ev as DragEvent).dataTransfer?.files ?? []).filter((f) => f.type.startsWith('image/'));
  files.forEach((f, i) => addImageFile(f, i === 0)); // першу — у вибрану частину
  if (files.length) status(`Перетягнуто: ${files.map((f) => f.name).join(', ')} → у "${def(state.selected).label}"`);
});

// ---- завантаження через кнопку ----
$<HTMLInputElement>('fileInput').addEventListener('change', (ev) => {
  const files = Array.from((ev.target as HTMLInputElement).files ?? []);
  files.forEach((f, i) => addImageFile(f, i === 0));
});

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
      status('Імпортовано. Підвантаж ті самі PNG, якщо картинок не видно.');
      refreshUI();
    } catch { status('Помилка читання JSON'); }
  };
  reader.readAsText(file);
});

window.addEventListener('resize', () => { resize(); draw(); });
resize();
refreshUI();
status('Завантаж орієнтир-силует і частини. R/S/G — поворот/розмір/рух.');
