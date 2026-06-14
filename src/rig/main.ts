import { keyImage, hasSolidBackground, imageToCanvas } from './keyer';

// ---- Конструктор персонажа (character creator) ----
// Базовий манекен із пропорціями Остапа (бігунки) + слоти під PNG (голова/торс/руки/ноги).
// Кожну частину можна вибрати, покрутити, підскейлити, перетягнути; для активної —
// тицьнути, де її pivot. Цілі кінцівки (без дроблення). Без таймлайну — це збірка персонажа.

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const rad = (d: number): number => (d * Math.PI) / 180;

interface Slot {
  image: string | null;
  pivotX: number;
  pivotY: number;
  rot: number; // градуси, поверх "висіння" вздовж кістки
  scale: number; // одиниць світу на піксель картинки (autofit при призначенні)
  dx: number; // тонкий зсув від суглоба, в одиницях
  dy: number;
}

// Опис скелета (профіль, обличчям праворуч). dir: -90 = вгору, 90 = вниз.
const SLOT_DEFS = [
  { key: 'leg_back', label: 'Нога зад', joint: 'hipBack', dir: 90, len: 'legs', w: 20, piv: [0.5, 0.06] },
  { key: 'arm_back', label: 'Рука зад', joint: 'shBack', dir: 90, len: 'arms', w: 16, piv: [0.5, 0.08] },
  { key: 'torso', label: 'Торс', joint: 'hip', dir: -90, len: 'torso', w: 34, piv: [0.5, 0.94] },
  { key: 'head', label: 'Голова', joint: 'neck', dir: -90, len: 'head', w: 48, piv: [0.5, 0.94] },
  { key: 'leg_front', label: 'Нога перед', joint: 'hipFront', dir: 90, len: 'legs', w: 20, piv: [0.5, 0.06] },
  { key: 'arm_front', label: 'Рука перед', joint: 'shFront', dir: 90, len: 'arms', w: 16, piv: [0.5, 0.08] },
] as const;

const BASE = { torso: 105, head: 86, arms: 116, legs: 140 }; // базові довжини в одиницях

const canvas = $<HTMLCanvasElement>('stage');
const ctx = canvas.getContext('2d')!;

const state = {
  images: new Map<string, HTMLCanvasElement>(),
  imageNames: [] as string[],
  prop: { overall: 1, head: 1, torso: 1, arms: 1, legs: 1 },
  slots: {} as Record<string, Slot>,
  selected: 'torso',
  showPivots: true,
  pivotMode: false,
  zoom: 1,
  origin: { x: 0, y: 0 },
  viewScale: 1,
};

for (const d of SLOT_DEFS) {
  state.slots[d.key] = { image: null, pivotX: d.piv[0], pivotY: d.piv[1], rot: 0, scale: 1, dx: 0, dy: 0 };
}

// ---- геометрія скелета ----
function lenOf(key: string): number {
  const which = SLOT_DEFS.find((d) => d.key === key)!.len as keyof typeof BASE;
  return BASE[which] * state.prop[which];
}
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
// одиниці -> екран
function toPx(ux: number, uy: number): { x: number; y: number } {
  const s = state.viewScale * state.prop.overall;
  return { x: state.origin.x + ux * s, y: state.origin.y + uy * s };
}

// ---- рендер ----
function resize(): void {
  canvas.width = canvas.clientWidth;
  canvas.height = canvas.clientHeight;
  state.origin.x = canvas.width * 0.5;
  state.origin.y = canvas.height * 0.58;
  state.viewScale = (Math.min(canvas.width, canvas.height) / 360) * state.zoom;
}

function draw(): void {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const J = joints();
  const s = state.viewScale * state.prop.overall;

  // підлога-орієнтир
  const floor = toPx(0, lenOf('leg_back') + 6);
  ctx.strokeStyle = 'rgba(255,255,255,.08)';
  ctx.beginPath();
  ctx.moveTo(0, floor.y);
  ctx.lineTo(canvas.width, floor.y);
  ctx.stroke();

  for (const d of SLOT_DEFS) {
    const slot = state.slots[d.key];
    const j = toPx(J[d.joint].x, J[d.joint].y);
    const img = slot.image ? state.images.get(slot.image) : undefined;

    if (img) {
      ctx.save();
      ctx.translate(j.x + slot.dx * s, j.y + slot.dy * s);
      ctx.rotate(rad(slot.rot));
      const sc = slot.scale * s;
      ctx.scale(sc, sc);
      ctx.drawImage(img, -slot.pivotX * img.width, -slot.pivotY * img.height);
      ctx.restore();
    } else if (state.showPivots) {
      // чорний манекен уздовж кістки
      const end = toPx(J[d.joint].x + Math.cos(rad(d.dir)) * lenOf(d.key), J[d.joint].y + Math.sin(rad(d.dir)) * lenOf(d.key));
      ctx.strokeStyle = d.key === state.selected ? '#3b4250' : '#15171c';
      ctx.lineCap = 'round';
      ctx.lineWidth = d.w * s;
      ctx.beginPath();
      ctx.moveTo(j.x, j.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
    }
  }

  if (state.showPivots) {
    // суглоби + півоти
    for (const d of SLOT_DEFS) {
      const slot = state.slots[d.key];
      const j = toPx(J[d.joint].x, J[d.joint].y);
      const sel = d.key === state.selected;
      // позиція pivot картинки (= суглоб + зсув)
      const px = j.x + slot.dx * s;
      const py = j.y + slot.dy * s;
      ctx.fillStyle = sel ? '#ffd000' : '#5aa0ff';
      ctx.beginPath();
      ctx.arc(px, py, (sel ? 6 : 4), 0, Math.PI * 2);
      ctx.fill();
      if (sel) {
        ctx.strokeStyle = '#ffd000';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(px, py, 11, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }
}

// курсор -> екранні координати канвасу
function cursor(ev: MouseEvent): { x: number; y: number } {
  const r = canvas.getBoundingClientRect();
  return { x: ev.clientX - r.left, y: ev.clientY - r.top };
}

// інверсна трансформація точки у простір картинки слота
function toLocal(slotKey: string, sx: number, sy: number): { lx: number; ly: number; iw: number; ih: number } | null {
  const slot = state.slots[slotKey];
  const img = slot.image ? state.images.get(slot.image) : undefined;
  if (!img) return null;
  const J = joints();
  const d = SLOT_DEFS.find((dd) => dd.key === slotKey)!;
  const s = state.viewScale * state.prop.overall;
  const j = toPx(J[d.joint].x, J[d.joint].y);
  const ox = j.x + slot.dx * s;
  const oy = j.y + slot.dy * s;
  const a = rad(-slot.rot);
  const dx = sx - ox;
  const dy = sy - oy;
  const rx = dx * Math.cos(a) - dy * Math.sin(a);
  const ry = dx * Math.sin(a) + dy * Math.cos(a);
  const sc = slot.scale * s;
  return { lx: rx / sc + slot.pivotX * img.width, ly: ry / sc + slot.pivotY * img.height, iw: img.width, ih: img.height };
}

function hitTest(sx: number, sy: number): string | null {
  for (let i = SLOT_DEFS.length - 1; i >= 0; i--) {
    const key = SLOT_DEFS[i].key;
    const loc = toLocal(key, sx, sy);
    if (loc && loc.lx >= 0 && loc.lx <= loc.iw && loc.ly >= 0 && loc.ly <= loc.ih) return key;
  }
  return null;
}

// ---- autofit при призначенні картинки ----
function assignImage(slotKey: string, name: string | null): void {
  const slot = state.slots[slotKey];
  slot.image = name;
  if (name) {
    const img = state.images.get(name);
    if (img) slot.scale = lenOf(slotKey) / img.height; // вписати висоту в кістку
    slot.rot = 0;
    slot.dx = 0;
    slot.dy = 0;
    const d = SLOT_DEFS.find((dd) => dd.key === slotKey)!;
    slot.pivotX = d.piv[0];
    slot.pivotY = d.piv[1];
  }
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
    el.onclick = () => {
      state.selected = d.key;
      state.pivotMode = false;
      refreshUI();
    };
    box.appendChild(el);
  }
}
function refreshImgSel(): void {
  const sel = $<HTMLSelectElement>('imgSel');
  sel.innerHTML = '<option value="">(немає)</option>';
  for (const n of state.imageNames) {
    const o = document.createElement('option');
    o.value = n;
    o.textContent = n;
    sel.appendChild(o);
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
  $('scaleV').textContent = (slot.scale * 100 < 10 ? slot.scale.toFixed(2) : slot.scale.toFixed(1));
  for (const k of ['overall', 'head', 'torso', 'arms', 'legs'] as const) {
    $<HTMLInputElement>(`p_${k}`).value = String(state.prop[k]);
    $(`p_${k}V`).textContent = state.prop[k].toFixed(2);
  }
  $<HTMLButtonElement>('setPivot').textContent = state.pivotMode ? '⌖ Клікни на частині…' : '⌖ Тицьнути півот';
  draw();
}
function status(m: string): void {
  $('status').textContent = m;
}

// ---- події ----
$<HTMLSelectElement>('imgSel').addEventListener('change', (e) => {
  assignImage(state.selected, (e.target as HTMLSelectElement).value || null);
  refreshUI();
});
$<HTMLInputElement>('rot').addEventListener('input', (e) => {
  state.slots[state.selected].rot = Number((e.target as HTMLInputElement).value);
  $('rotV').textContent = (e.target as HTMLInputElement).value;
  draw();
});
$<HTMLInputElement>('scale').addEventListener('input', (e) => {
  state.slots[state.selected].scale = Number((e.target as HTMLInputElement).value);
  draw();
});
$<HTMLButtonElement>('setPivot').addEventListener('click', () => {
  state.pivotMode = !state.pivotMode;
  refreshUI();
});
$<HTMLButtonElement>('resetPart').addEventListener('click', () => {
  const name = state.slots[state.selected].image;
  assignImage(state.selected, name);
  refreshUI();
});
for (const k of ['overall', 'head', 'torso', 'arms', 'legs'] as const) {
  $<HTMLInputElement>(`p_${k}`).addEventListener('input', (e) => {
    state.prop[k] = Number((e.target as HTMLInputElement).value);
    $(`p_${k}V`).textContent = state.prop[k].toFixed(2);
    draw();
  });
}
$<HTMLInputElement>('showPivots').addEventListener('change', (e) => {
  state.showPivots = (e.target as HTMLInputElement).checked;
  draw();
});

// canvas: вибір / перетягування / pivot-режим / зум
let drag: { key: string; sx: number; sy: number; dx: number; dy: number } | null = null;
canvas.addEventListener('mousedown', (ev) => {
  const c = cursor(ev);
  if (state.pivotMode) {
    const loc = toLocal(state.selected, c.x, c.y);
    if (loc) {
      state.slots[state.selected].pivotX = Math.max(0, Math.min(1, loc.lx / loc.iw));
      state.slots[state.selected].pivotY = Math.max(0, Math.min(1, loc.ly / loc.ih));
    }
    state.pivotMode = false;
    refreshUI();
    return;
  }
  const hit = hitTest(c.x, c.y);
  if (hit) {
    state.selected = hit;
    const slot = state.slots[hit];
    drag = { key: hit, sx: c.x, sy: c.y, dx: slot.dx, dy: slot.dy };
    refreshUI();
  }
});
window.addEventListener('mousemove', (ev) => {
  if (!drag) return;
  const c = cursor(ev);
  const s = state.viewScale * state.prop.overall;
  state.slots[drag.key].dx = drag.dx + (c.x - drag.sx) / s;
  state.slots[drag.key].dy = drag.dy + (c.y - drag.sy) / s;
  draw();
});
window.addEventListener('mouseup', () => {
  drag = null;
});
canvas.addEventListener('wheel', (ev) => {
  ev.preventDefault();
  state.zoom = Math.min(3, Math.max(0.3, state.zoom * (ev.deltaY < 0 ? 1.1 : 0.9)));
  resize();
  draw();
}, { passive: false });

// завантаження картинок (із вшитим кеїнгом фону)
$<HTMLInputElement>('fileInput').addEventListener('change', (ev) => {
  const files = (ev.target as HTMLInputElement).files;
  if (!files) return;
  const keyBg = $<HTMLInputElement>('keyBg').checked;
  for (const file of Array.from(files)) {
    const img = new Image();
    img.onload = () => {
      const cv = keyBg && hasSolidBackground(img) ? keyImage(img) : imageToCanvas(img);
      state.images.set(file.name, cv);
      if (!state.imageNames.includes(file.name)) state.imageNames.push(file.name);
      refreshUI();
    };
    img.src = URL.createObjectURL(file);
  }
  status(`Завантажую ${files.length}… назви: ${Array.from(files).map((f) => f.name).join(', ')}`);
});

// експорт / імпорт
$<HTMLButtonElement>('exportBtn').addEventListener('click', () => {
  const doc = { version: 2, proportions: state.prop, slots: state.slots };
  const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'ostap_character.json';
  a.click();
  status('Експортовано ostap_character.json');
});
$<HTMLButtonElement>('importBtn').addEventListener('click', () => $<HTMLInputElement>('importInput').click());
$<HTMLInputElement>('importInput').addEventListener('change', (ev) => {
  const file = (ev.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const doc = JSON.parse(String(reader.result));
      if (doc.proportions) Object.assign(state.prop, doc.proportions);
      if (doc.slots) for (const k of Object.keys(state.slots)) if (doc.slots[k]) Object.assign(state.slots[k], doc.slots[k]);
      status('Імпортовано. Підвантаж ті самі PNG, якщо картинок не видно.');
      refreshUI();
    } catch {
      status('Помилка читання JSON');
    }
  };
  reader.readAsText(file);
});

window.addEventListener('resize', () => {
  resize();
  draw();
});
resize();
refreshUI();
status('Завантаж частини Остапа й збирай. Колесо — зум.');
