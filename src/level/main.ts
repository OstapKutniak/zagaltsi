// ---- Редактор рівнів «Загальці» ----
// Зліва: список рівнів + налаштування. Центр: доріжка (як у грі) — тягни сюди ассети.
// Праворуч: бібліотека по категоріях. Керування як у ріг-тулзі: G/R/S/M, J — снеп до краю,
// колесо — зум, затиск колеса — пан. Колайдер — малюємо квадратами, де можна ходити.

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const rad = (d: number): number => (d * Math.PI) / 180;

const CATS = [
  { key: 'sky', label: 'Небо' },
  { key: 'bg', label: 'Фон' },
  { key: 'map', label: 'Карта' },
  { key: 'decor', label: 'Декор' },
  { key: 'collider', label: 'Колайдер' },
  { key: 'interactive', label: 'Інтерактив' },
  { key: 'trap', label: 'Пастки' },
] as const;
const LAYER: Record<string, number> = { sky: 0, bg: 1, map: 2, decor: 3, interactive: 4, trap: 5 };

interface Asset { id: string; cat: string; name: string; url: string }
interface Placed { id: string; cat: string; asset: string; x: number; y: number; rot: number; scale: number; flip: number }
interface Level { name: string; placed: Placed[]; collider: string[] }

const canvas = $<HTMLCanvasElement>('stage');
const ctx = canvas.getContext('2d')!;

const state = {
  levels: [] as Level[],
  cur: 0,
  assets: [] as Asset[],
  images: new Map<string, HTMLImageElement>(),
  cat: 'map',
  selected: null as string | null,
  mode: null as null | 'G' | 'R' | 'S',
  orig: null as null | { x: number; y: number; rot: number; scale: number },
  startAng: 0, startDist: 1, startWx: 0, startWy: 0,
  colliderTool: 'paint' as 'paint' | 'erase',
  grid: 48,
  snap: true,
  showCollider: true,
  zoom: 0.6,
  pan: { x: 0, y: 0 },
  origin: { x: 0, y: 0 },
  viewScale: 1,
  mouse: { x: 0, y: 0 },
};

const level = (): Level => state.levels[state.cur];
const sc = (): number => state.viewScale * state.zoom;
const toScreen = (wx: number, wy: number) => ({ x: state.origin.x + wx * sc(), y: state.origin.y + wy * sc() });
const toWorld = (sx: number, sy: number) => ({ x: (sx - state.origin.x) / sc(), y: (sy - state.origin.y) / sc() });
const imgOf = (p: Placed): HTMLImageElement | undefined => state.images.get(p.asset);

// ---- persistence ----
function save(): void {
  try {
    localStorage.setItem('zag_levels', JSON.stringify({ levels: state.levels, cur: state.cur }));
    localStorage.setItem('zag_assets', JSON.stringify(state.assets));
  } catch { setStatus('Сховище переповнене'); }
}
function load(): void {
  try {
    const a = JSON.parse(localStorage.getItem('zag_assets') || '[]') as Asset[];
    state.assets = a;
    for (const as of a) loadImg(as);
    const l = JSON.parse(localStorage.getItem('zag_levels') || 'null');
    if (l && l.levels?.length) { state.levels = l.levels; state.cur = l.cur || 0; }
  } catch { /* ignore */ }
  if (!state.levels.length) state.levels = [{ name: 'Рівень 1', placed: [], collider: [] }];
}
function loadImg(a: Asset): void {
  const im = new Image();
  im.onload = () => draw();
  im.src = a.url;
  state.images.set(a.id, im);
}

const setStatus = (m: string): void => { $('status').textContent = m; };

// ---- рендер ----
function applyOrigin(): void { state.origin.x = canvas.width * 0.35 + state.pan.x; state.origin.y = canvas.height * 0.6 + state.pan.y; }
function resize(): void {
  canvas.width = canvas.clientWidth; canvas.height = canvas.clientHeight;
  applyOrigin();
  state.viewScale = Math.min(canvas.width, canvas.height) / 700;
}
function placedSorted(): Placed[] {
  return [...level().placed].sort((a, b) => (LAYER[a.cat] - LAYER[b.cat]) || (level().placed.indexOf(a) - level().placed.indexOf(b)));
}
function draw(): void {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  // лінія землі (доріжка)
  const g0 = toScreen(0, 0);
  ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(0, g0.y); ctx.lineTo(canvas.width, g0.y); ctx.stroke();

  for (const p of placedSorted()) {
    const img = imgOf(p); if (!img) continue;
    const s2 = toScreen(p.x, p.y);
    ctx.save();
    ctx.translate(s2.x, s2.y);
    ctx.rotate(rad(p.rot));
    const k = p.scale * sc();
    ctx.scale(p.flip * k, k);
    ctx.drawImage(img, -img.width / 2, -img.height / 2);
    ctx.restore();
    if (p.id === state.selected) {
      ctx.strokeStyle = '#ffd000'; ctx.lineWidth = 1.5;
      ctx.strokeRect(s2.x - 6, s2.y - 6, 12, 12);
    }
  }

  // колайдер (квадрати де можна ходити)
  if (state.showCollider) {
    const gs = state.grid;
    ctx.lineWidth = 1;
    for (const cell of level().collider) {
      const [cx, cy] = cell.split(',').map(Number);
      const a = toScreen(cx * gs, cy * gs); const b = toScreen((cx + 1) * gs, (cy + 1) * gs);
      ctx.fillStyle = 'rgba(90,255,140,0.18)'; ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
      ctx.strokeStyle = 'rgba(90,255,140,0.5)'; ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
    }
  }
}

// ---- hit test (інверсна трансформація, AABB у локалі картинки) ----
function hitTest(sx: number, sy: number): string | null {
  const list = placedSorted();
  for (let i = list.length - 1; i >= 0; i--) {
    const p = list[i]; const img = imgOf(p); if (!img) continue;
    const o = toScreen(p.x, p.y);
    const ang = rad(-p.rot); const dx = sx - o.x, dy = sy - o.y;
    const k = p.scale * sc();
    let lx = (dx * Math.cos(ang) - dy * Math.sin(ang)) / k; const ly = (dx * Math.sin(ang) + dy * Math.cos(ang)) / k;
    if (p.flip < 0) lx = -lx;
    if (Math.abs(lx) <= img.width / 2 && Math.abs(ly) <= img.height / 2) return p.id;
  }
  return null;
}
const sel = (): Placed | undefined => level().placed.find((p) => p.id === state.selected);

// ---- UI: рівні ----
function refreshLevels(): void {
  const box = $('levelList'); box.innerHTML = '';
  state.levels.forEach((lv, i) => {
    const el = document.createElement('div');
    el.className = 'item' + (i === state.cur ? ' sel' : '');
    const nm = document.createElement('span'); nm.textContent = lv.name;
    nm.onclick = () => { state.cur = i; state.selected = null; refreshLevels(); draw(); save(); };
    nm.ondblclick = () => { const n = prompt('Назва рівня:', lv.name); if (n) { lv.name = n; refreshLevels(); save(); } };
    const x = document.createElement('span'); x.className = 'x'; x.textContent = '✕';
    x.onclick = (e) => { e.stopPropagation(); if (state.levels.length > 1) { state.levels.splice(i, 1); state.cur = Math.max(0, state.cur - 1); refreshLevels(); draw(); save(); } };
    el.appendChild(nm); el.appendChild(x); box.appendChild(el);
  });
}
$<HTMLButtonElement>('addLevel').addEventListener('click', () => {
  state.levels.push({ name: `Рівень ${state.levels.length + 1}`, placed: [], collider: [] });
  state.cur = state.levels.length - 1; state.selected = null; refreshLevels(); draw(); save();
});

// ---- UI: бібліотека ----
function refreshTabs(): void {
  const box = $('catTabs'); box.innerHTML = '';
  for (const c of CATS) {
    const el = document.createElement('div');
    el.className = 'tab' + (c.key === state.cat ? ' active' : '');
    el.textContent = c.label;
    el.onclick = () => { state.cat = c.key; refreshTabs(); refreshAssets(); };
    box.appendChild(el);
  }
  $('colliderTools').style.display = state.cat === 'collider' ? '' : 'none';
  $('assets').style.display = state.cat === 'collider' ? 'none' : '';
}
function refreshAssets(): void {
  const box = $('assets'); box.innerHTML = '';
  for (const a of state.assets.filter((x) => x.cat === state.cat)) {
    const el = document.createElement('div'); el.className = 'asset'; el.draggable = true;
    const img = document.createElement('img'); img.src = a.url;
    const nm = document.createElement('div'); nm.textContent = a.name;
    el.appendChild(img); el.appendChild(nm);
    el.addEventListener('dragstart', (e) => e.dataTransfer?.setData('text/plain', a.id));
    box.appendChild(el);
  }
}
$<HTMLButtonElement>('loadAsset').addEventListener('click', () => $<HTMLInputElement>('fileInput').click());
$<HTMLInputElement>('fileInput').addEventListener('change', (ev) => {
  const files = Array.from((ev.target as HTMLInputElement).files ?? []);
  for (const f of files) {
    const r = new FileReader();
    r.onload = () => {
      const a: Asset = { id: 'a' + Date.now() + Math.round(performance.now()), cat: state.cat, name: f.name.replace(/\.[^.]+$/, ''), url: String(r.result) };
      state.assets.push(a); loadImg(a); refreshAssets(); save();
    };
    r.readAsDataURL(f);
  }
});

// ---- drop ассету в редактор ----
canvas.addEventListener('dragover', (e) => e.preventDefault());
canvas.addEventListener('drop', (e) => {
  e.preventDefault();
  const id = e.dataTransfer?.getData('text/plain'); if (!id) return;
  const a = state.assets.find((x) => x.id === id); if (!a) return;
  const r = canvas.getBoundingClientRect();
  const w = toWorld(e.clientX - r.left, e.clientY - r.top);
  const p: Placed = { id: 'p' + Date.now(), cat: a.cat, asset: a.id, x: w.x, y: w.y, rot: 0, scale: 1, flip: 1 };
  level().placed.push(p); state.selected = p.id; refreshSel(); draw(); save();
});

// ---- вибраний обʼєкт ----
function refreshSel(): void {
  const p = sel();
  $<HTMLInputElement>('rot').value = String(Math.round(p?.rot ?? 0)); $('rotV').textContent = String(Math.round(p?.rot ?? 0));
  $<HTMLInputElement>('scale').value = String(p?.scale ?? 1); $('scaleV').textContent = (p?.scale ?? 1).toFixed(2);
}
$<HTMLInputElement>('rot').addEventListener('input', (e) => { const p = sel(); if (p) { p.rot = Number((e.target as HTMLInputElement).value); $('rotV').textContent = (e.target as HTMLInputElement).value; draw(); save(); } });
$<HTMLInputElement>('scale').addEventListener('input', (e) => { const p = sel(); if (p) { p.scale = Number((e.target as HTMLInputElement).value); draw(); save(); } });
$<HTMLButtonElement>('mirrorBtn').addEventListener('click', () => { const p = sel(); if (p) { p.flip *= -1; draw(); save(); } });
$<HTMLButtonElement>('delBtn').addEventListener('click', deleteSel);
function deleteSel(): void { const p = sel(); if (!p) return; level().placed = level().placed.filter((x) => x !== p); state.selected = null; refreshSel(); draw(); save(); }

// ---- налаштування ----
$<HTMLInputElement>('snap').addEventListener('change', (e) => { state.snap = (e.target as HTMLInputElement).checked; });
$<HTMLInputElement>('showCollider').addEventListener('change', (e) => { state.showCollider = (e.target as HTMLInputElement).checked; draw(); });
$<HTMLInputElement>('grid').addEventListener('input', (e) => { state.grid = Number((e.target as HTMLInputElement).value); $('gridV').textContent = (e.target as HTMLInputElement).value; draw(); });
$<HTMLButtonElement>('paintBtn').addEventListener('click', () => { state.colliderTool = 'paint'; $('paintBtn').classList.add('on'); $('eraseBtn').classList.remove('on'); });
$<HTMLButtonElement>('eraseBtn').addEventListener('click', () => { state.colliderTool = 'erase'; $('eraseBtn').classList.add('on'); $('paintBtn').classList.remove('on'); });
$<HTMLButtonElement>('clearCollider').addEventListener('click', () => { level().collider = []; draw(); save(); });

// ---- J-снеп: притулити край вибраного до найближчого сусіда (безшовні тайли) ----
function snapToEdge(): void {
  const p = sel(); const img = imgOf(p as Placed); if (!p || !img) return;
  const w = img.width * p.scale, h = img.height * p.scale;
  let best: { d: number; x: number; y: number } | null = null;
  for (const q of level().placed) {
    if (q === p) continue; const qi = imgOf(q); if (!qi) continue;
    const qw = qi.width * q.scale;
    // праворуч від сусіда / ліворуч
    for (const nx of [q.x + (qw + w) / 2, q.x - (qw + w) / 2]) {
      const d = Math.hypot(nx - p.x, q.y - p.y);
      if (!best || d < best.d) best = { d, x: nx, y: q.y };
    }
  }
  if (best && best.d < 400) { p.x = best.x; p.y = best.y; draw(); save(); setStatus('Снеп до краю'); }
  void h;
}

// ---- миша: вибір / перетяг / пан / колайдер ----
let drag: { x: number; y: number; ox: number; oy: number } | null = null;
let panning = false; let panStart = { mx: 0, my: 0, px: 0, py: 0 };
let painting = false;
function paintAt(sx: number, sy: number): void {
  const w = toWorld(sx, sy); const gs = state.grid;
  const cell = `${Math.floor(w.x / gs)},${Math.floor(w.y / gs)}`;
  const set = new Set(level().collider);
  if (state.colliderTool === 'erase') set.delete(cell); else set.add(cell);
  level().collider = [...set]; draw();
}
canvas.addEventListener('mousedown', (ev) => {
  const x = ev.offsetX, y = ev.offsetY;
  if (ev.button === 1) { ev.preventDefault(); panning = true; panStart = { mx: x, my: y, px: state.pan.x, py: state.pan.y }; return; }
  if (state.mode) { state.mode = null; state.orig = null; save(); return; } // підтвердити
  if (state.cat === 'collider') { painting = true; paintAt(x, y); return; }
  const hit = hitTest(x, y);
  state.selected = hit;
  if (hit) { const p = sel()!; drag = { x, y, ox: p.x, oy: p.y }; }
  refreshSel(); draw();
});
window.addEventListener('mousemove', (ev) => {
  const r = canvas.getBoundingClientRect();
  state.mouse = { x: ev.clientX - r.left, y: ev.clientY - r.top };
  if (panning) { state.pan.x = panStart.px + (state.mouse.x - panStart.mx); state.pan.y = panStart.py + (state.mouse.y - panStart.my); applyOrigin(); draw(); return; }
  if (painting) { paintAt(state.mouse.x, state.mouse.y); return; }
  if (state.mode) { applyMode(); return; }
  if (drag) { const p = sel(); if (p) { p.x = drag.ox + (state.mouse.x - drag.x) / sc(); p.y = drag.oy + (state.mouse.y - drag.y) / sc(); draw(); } }
});
window.addEventListener('mouseup', () => { if (drag || painting) save(); drag = null; panning = false; painting = false; });
canvas.addEventListener('contextmenu', (e) => { e.preventDefault(); if (state.mode) { const p = sel(); if (p && state.orig) Object.assign(p, state.orig); state.mode = null; state.orig = null; draw(); } });
canvas.addEventListener('wheel', (e) => { e.preventDefault(); state.zoom = Math.min(3, Math.max(0.15, state.zoom * (e.deltaY < 0 ? 1.1 : 0.9))); resize(); draw(); }, { passive: false });

function startMode(m: 'G' | 'R' | 'S'): void {
  const p = sel(); if (!p) return;
  state.mode = m; state.orig = { x: p.x, y: p.y, rot: p.rot, scale: p.scale };
  const o = toScreen(p.x, p.y);
  state.startWx = state.mouse.x; state.startWy = state.mouse.y;
  state.startAng = Math.atan2(state.mouse.y - o.y, state.mouse.x - o.x);
  state.startDist = Math.max(8, Math.hypot(state.mouse.x - o.x, state.mouse.y - o.y));
}
function applyMode(): void {
  const p = sel(); if (!p || !state.orig) return;
  const o = toScreen(p.x, p.y);
  if (state.mode === 'G') { p.x = state.orig.x + (state.mouse.x - state.startWx) / sc(); p.y = state.orig.y + (state.mouse.y - state.startWy) / sc(); }
  else if (state.mode === 'R') { const a = Math.atan2(state.mouse.y - o.y, state.mouse.x - o.x); p.rot = state.orig.rot + ((a - state.startAng) * 180) / Math.PI; }
  else if (state.mode === 'S') { const d = Math.hypot(state.mouse.x - o.x, state.mouse.y - o.y); p.scale = Math.max(0.05, state.orig.scale * (d / state.startDist)); }
  refreshSel(); draw();
}

// ---- клавіатура ----
window.addEventListener('keydown', (ev) => {
  const tag = (document.activeElement?.tagName ?? '').toUpperCase();
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  if (ev.code === 'KeyG' || ev.code === 'KeyR' || ev.code === 'KeyS') { ev.preventDefault(); startMode(ev.code === 'KeyG' ? 'G' : ev.code === 'KeyR' ? 'R' : 'S'); }
  else if (ev.code === 'KeyM') { ev.preventDefault(); const p = sel(); if (p) { p.flip *= -1; draw(); save(); } }
  else if (ev.code === 'KeyJ') { ev.preventDefault(); if (state.snap) snapToEdge(); }
  else if (ev.code === 'Delete' || ev.code === 'Backspace') { ev.preventDefault(); deleteSel(); }
  else if (ev.code === 'Escape' && state.mode) { const p = sel(); if (p && state.orig) Object.assign(p, state.orig); state.mode = null; state.orig = null; draw(); }
});

// ---- експорт ----
$<HTMLButtonElement>('exportLevel').addEventListener('click', () => {
  const lv = level();
  const usedAssets = state.assets.filter((a) => lv.placed.some((p) => p.asset === a.id));
  const doc = { name: lv.name, placed: lv.placed, collider: lv.collider, grid: state.grid, assets: usedAssets };
  const blob = new Blob([JSON.stringify(doc)], { type: 'application/json' });
  const aEl = document.createElement('a'); aEl.href = URL.createObjectURL(blob); aEl.download = `${lv.name}.json`; aEl.click();
  setStatus(`Експортовано ${lv.name}`);
});

window.addEventListener('resize', () => { resize(); draw(); });
load();
resize(); refreshLevels(); refreshTabs(); refreshAssets(); refreshSel(); draw();
setStatus('Завантаж PNG у бібліотеку (праворуч) і тягни на доріжку.');
