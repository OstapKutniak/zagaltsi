// Core level editor logic — usable both standalone (prefix='') and embedded in studio (prefix='lv-').
import { idbGet, idbSet } from '../store';
import { ghCommit } from '../github';
import { pullLevelData, mergeLevelAssets } from '../sync';

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
interface Placed { id: string; cat: string; asset: string; x: number; y: number; rot: number; scale: number; flip: number; scaleW?: number; scaleH?: number }
interface Level { name: string; placed: Placed[]; collider: string[]; spawn: { x: number; y: number }; start: number; end: number }

export function initLevelEditor(prefix: string): void {
  const $ = <T extends HTMLElement>(id: string): T => document.getElementById(prefix + id) as T;
  const newLevel = (name: string): Level => ({ name, placed: [], collider: [], spawn: { x: 120, y: 0 }, start: 0, end: 2400 });

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
    orig: null as null | { x: number; y: number; rot: number; scale: number; scaleW: number; scaleH: number },
    startAng: 0, startDist: 1, startWx: 0, startWy: 0,
    pathTool: null as null | 'h' | 'v' | 'erase',
    axisLock: null as null | 'x' | 'z',
    colliderTool: 'paint' as 'paint' | 'erase',
    markerDrag: null as null | 'spawn' | 'start' | 'end',
    camView: false,
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

  let saveTimer = 0;
  function save(): void {
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      idbSet('zag_levels', { levels: state.levels, cur: state.cur }).catch(() => setStatus('Не вдалося зберегти'));
      idbSet('zag_assets', state.assets).catch(() => setStatus('Не вдалося зберегти'));
    }, 250);
  }
  async function load(): Promise<void> {
    try {
      let a = await idbGet<Asset[]>('zag_assets');
      let l = await idbGet<{ levels: Level[]; cur: number }>('zag_levels');
      if (!a) { try { const s = localStorage.getItem('zag_assets'); if (s) { a = JSON.parse(s) as Asset[]; await idbSet('zag_assets', a); } } catch { /* ignore */ } }
      if (!l) { try { const s = localStorage.getItem('zag_levels'); if (s) { l = JSON.parse(s); await idbSet('zag_levels', l); } } catch { /* ignore */ } }
      if (a) { state.assets = a; for (const as of a) loadImg(as); }
      if (l && l.levels?.length) { state.levels = l.levels; state.cur = l.cur || 0; }
      try { localStorage.removeItem('zag_assets'); localStorage.removeItem('zag_levels'); } catch { /* ignore */ }
    } catch { /* ignore */ }
    // Pull from GitHub in background — merge new assets, update layouts if remote has data
    pullLevelData().then(({ assets: remoteAssets, layouts: remoteLayouts }) => {
      const { merged, added } = mergeLevelAssets(state.assets, remoteAssets);
      if (added > 0) {
        state.assets = merged;
        for (const as of merged.slice(-added)) loadImg(as as Asset);
        idbSet('zag_assets', state.assets).catch(() => {});
        refreshAssets();
        setStatus(`Синхронізовано: +${added} ассетів з GitHub`);
      }
      if (remoteLayouts?.levels?.length && !state.levels.length) {
        state.levels = remoteLayouts.levels as Level[];
        state.cur = remoteLayouts.cur || 0;
        idbSet('zag_levels', { levels: state.levels, cur: state.cur }).catch(() => {});
        refreshLevels();
      }
    }).catch(() => {});
    if (!state.levels.length) state.levels = [newLevel('Рівень 1')];
    for (const lv of state.levels) {
      if (!lv.spawn) lv.spawn = { x: 120, y: 0 };
      if (typeof lv.start !== 'number') lv.start = 0;
      if (typeof lv.end !== 'number') lv.end = 2400;
    }
  }
  function loadImg(a: Asset): void {
    const im = new Image();
    im.onload = () => draw();
    im.src = a.url;
    state.images.set(a.id, im);
  }

  const setStatus = (m: string): void => { const el = $('statusBar'); if (el) el.textContent = m; };

  const undoStack: string[] = [];
  function pushUndo(): void { undoStack.push(JSON.stringify({ levels: state.levels, cur: state.cur })); if (undoStack.length > 80) undoStack.shift(); }
  function undo(): void {
    const s0 = undoStack.pop(); if (!s0) { setStatus('Нема що відміняти'); return; }
    const o = JSON.parse(s0) as { levels: Level[]; cur: number };
    state.levels = o.levels; state.cur = Math.min(o.cur, o.levels.length - 1); state.selected = null;
    refreshLevels(); refreshSel(); draw(); save(); setStatus('↩ Відмінено');
  }

  function applyOrigin(): void { state.origin.x = canvas.width * 0.35 + state.pan.x; state.origin.y = canvas.height * 0.6 + state.pan.y; }
  function resize(): void {
    if (!canvas.offsetWidth) return; // hidden — skip
    canvas.width = canvas.clientWidth; canvas.height = canvas.clientHeight;
    applyOrigin();
    state.viewScale = Math.min(canvas.width, canvas.height) / 700;
  }
  function placedSorted(): Placed[] {
    return [...level().placed].sort((a, b) => (LAYER[a.cat] - LAYER[b.cat]) || (level().placed.indexOf(a) - level().placed.indexOf(b)));
  }
  function draw(): void {
    if (!canvas.width) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const g0 = toScreen(0, 0);
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(0, g0.y); ctx.lineTo(canvas.width, g0.y); ctx.stroke();

    for (const p of placedSorted()) {
      const img = imgOf(p); if (!img) continue;
      const s2 = toScreen(p.x, p.y);
      ctx.save();
      ctx.translate(s2.x, s2.y);
      ctx.rotate(rad(p.rot));
      const kx = p.scale * (p.scaleW ?? 1) * sc(); const ky = p.scale * (p.scaleH ?? 1) * sc();
      ctx.scale(p.flip * kx, ky);
      ctx.drawImage(img, -img.width / 2, -img.height / 2);
      ctx.restore();
      if (p.id === state.selected) {
        ctx.strokeStyle = '#ffd000'; ctx.lineWidth = 1.5;
        ctx.strokeRect(s2.x - 6, s2.y - 6, 12, 12);
      }
    }

    if (state.showCollider) {
      const gs = state.grid; ctx.lineWidth = 1;
      for (const cell of level().collider) {
        const parts = cell.split(',');
        const cx = Number(parts[0]); const cy = Number(parts[1]); const type = parts[2] ?? 'h';
        let p1, p2, p3, p4;
        if (type === 'h') {
          // Горизонтальний: повна висота клітини, нахил = gs → 45°, без проміжків між рядами
          p1 = toScreen(cx * gs,           (cy + 1) * gs); // нижній-лівий
          p2 = toScreen((cx + 1) * gs,     (cy + 1) * gs); // нижній-правий
          p3 = toScreen((cx + 1) * gs + gs, cy * gs);       // верхній-правий
          p4 = toScreen(cx * gs + gs,       cy * gs);       // верхній-лівий
        } else {
          // Вертикальний: лів/прав вертикальні, верх/низ під 45° (ширина = gs/2)
          const s = gs / 2;
          p1 = toScreen(cx * gs,     cy * gs);
          p2 = toScreen(cx * gs,     (cy + 1) * gs);
          p3 = toScreen(cx * gs + s, (cy + 1) * gs + s);
          p4 = toScreen(cx * gs + s, cy * gs + s);
        }
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y);
        ctx.lineTo(p3.x, p3.y); ctx.lineTo(p4.x, p4.y);
        ctx.closePath();
        ctx.fillStyle = type === 'h' ? 'rgba(255,154,31,0.22)' : 'rgba(64,160,255,0.22)'; ctx.fill();
        ctx.strokeStyle = type === 'h' ? 'rgba(255,154,31,0.8)' : 'rgba(64,160,255,0.8)'; ctx.stroke();
      }
    }

    const lv = level();
    const sx = toScreen(lv.start, 0).x, ex = toScreen(lv.end, 0).x;
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#5aff8f'; ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, canvas.height); ctx.stroke();
    ctx.strokeStyle = '#ff6a6a'; ctx.beginPath(); ctx.moveTo(ex, 0); ctx.lineTo(ex, canvas.height); ctx.stroke();
    ctx.fillStyle = '#5aff8f'; ctx.font = '11px monospace'; ctx.fillText('початок', sx + 3, 14);
    ctx.fillStyle = '#ff6a6a'; ctx.fillText('кінець', ex + 3, 14);
    const sp = toScreen(lv.spawn.x, lv.spawn.y);
    ctx.strokeStyle = '#ffd000'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(sp.x, sp.y); ctx.lineTo(sp.x, sp.y - 42); ctx.stroke();
    ctx.fillStyle = '#ffd000'; ctx.fillRect(sp.x, sp.y - 42, 20, 13);
    ctx.beginPath(); ctx.arc(sp.x, sp.y, 5, 0, Math.PI * 2); ctx.fill();

    if (state.camView) {
      const vw = 1280 * sc(); const vh = 576 * sc();
      const cw = canvas.width; const ch = canvas.height;
      const vx = (cw - vw) / 2; const vy = (ch - vh) / 2;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      if (vy > 0) { ctx.fillRect(0, 0, cw, vy); ctx.fillRect(0, vy + vh, cw, ch - vy - vh); }
      if (vx > 0) { ctx.fillRect(0, vy, vx, vh); ctx.fillRect(vx + vw, vy, cw - vx - vw, vh); }
      ctx.strokeStyle = '#ff9a1f'; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
      ctx.strokeRect(vx + 1, vy + 1, vw - 2, vh - 2);
      ctx.setLineDash([]);
    }
  }

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

  function refreshLevels(): void {
    const box = $('levelList'); box.innerHTML = '';
    state.levels.forEach((lv, i) => {
      const el = document.createElement('div');
      el.className = 'item' + (i === state.cur ? ' sel' : '');
      const nm = document.createElement('span'); nm.textContent = lv.name;
      nm.onclick = () => { state.cur = i; state.selected = null; refreshLevels(); draw(); save(); };
      nm.ondblclick = () => { const n = prompt('Назва рівня:', lv.name); if (n) { lv.name = n; refreshLevels(); save(); } };
      const x = document.createElement('span'); x.className = 'x'; x.textContent = '✕';
      x.onclick = (e) => { e.stopPropagation(); if (state.levels.length > 1) { pushUndo(); state.levels.splice(i, 1); state.cur = Math.max(0, state.cur - 1); refreshLevels(); draw(); save(); } };
      el.appendChild(nm); el.appendChild(x); box.appendChild(el);
    });
  }
  $<HTMLButtonElement>('addLevel').addEventListener('click', () => {
    pushUndo();
    state.levels.push(newLevel(`Рівень ${state.levels.length + 1}`));
    state.cur = state.levels.length - 1; state.selected = null; refreshLevels(); draw(); save();
  });

  function refreshCatSelect(): void {
    $<HTMLSelectElement>('libSelect').value = state.cat;
    const ct = $('colliderTools'); if (ct) ct.style.display = 'none'; // path tools moved to bottom toolbar
    $('libGrid').style.display = 'flex';
  }
  const LIB_MIN = 10;
  function refreshAssets(): void {
    const box = $('libGrid'); box.innerHTML = '';
    const cats = state.assets.filter((x) => x.cat === state.cat);
    for (const a of cats) {
      const el = document.createElement('div'); el.className = 'libCard'; el.draggable = true;
      const img = document.createElement('img'); img.src = a.url; img.draggable = false;
      const nm = document.createElement('div'); nm.className = 'libName'; nm.textContent = a.name;
      el.appendChild(img); el.appendChild(nm);
      el.addEventListener('dragstart', (e) => e.dataTransfer?.setData('text/plain', a.id));
      box.appendChild(el);
    }
    for (let i = cats.length; i < LIB_MIN; i++) {
      const e = document.createElement('div'); e.className = 'libCard empty';
      e.addEventListener('click', () => $<HTMLInputElement>('fileInput').click());
      box.appendChild(e);
    }
  }
  const CAT_MAX_PX: Record<string, number> = { sky: 2048, bg: 2048, map: 2048 }; // решта — 1024
  // Convert imported image to WebP — reduces storage 5-10x vs raw PNG
  function toWebP(file: File, maxPx = 1024, quality = 0.85): Promise<string> {
    return new Promise((resolve) => {
      const img = new Image();
      const blobUrl = URL.createObjectURL(file);
      img.onload = () => {
        const scale = Math.min(1, maxPx / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.round(img.naturalWidth * scale);
        const h = Math.round(img.naturalHeight * scale);
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        c.getContext('2d')!.drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(blobUrl);
        const out = c.toDataURL('image/webp', quality);
        resolve(out.startsWith('data:image/webp') ? out : c.toDataURL('image/png'));
      };
      img.onerror = () => { URL.revokeObjectURL(blobUrl); resolve(''); };
      img.src = blobUrl;
    });
  }

  $<HTMLButtonElement>('loadAsset')?.addEventListener('click', () => $<HTMLInputElement>('fileInput').click());
  $<HTMLInputElement>('fileInput').addEventListener('change', (ev) => {
    const files = Array.from((ev.target as HTMLInputElement).files ?? []);
    for (const f of files) {
      toWebP(f, CAT_MAX_PX[state.cat] ?? 1024).then((url) => {
        if (!url) return;
        const a: Asset = { id: 'a' + Date.now() + Math.round(performance.now()), cat: state.cat, name: f.name.replace(/\.[^.]+$/, ''), url };
        state.assets.push(a); loadImg(a); refreshAssets(); save();
      });
    }
    (ev.target as HTMLInputElement).value = '';
  });

  canvas.addEventListener('dragover', (e) => e.preventDefault());
  canvas.addEventListener('drop', (e) => {
    e.preventDefault();
    const id = e.dataTransfer?.getData('text/plain'); if (!id) return;
    const a = state.assets.find((x) => x.id === id); if (!a) return;
    pushUndo();
    const r = canvas.getBoundingClientRect();
    const w = toWorld(e.clientX - r.left, e.clientY - r.top);
    const p: Placed = { id: 'p' + Date.now(), cat: a.cat, asset: a.id, x: w.x, y: w.y, rot: 0, scale: 1, flip: 1 };
    level().placed.push(p); state.selected = p.id; refreshSel(); draw(); save();
  });

  function refreshSel(): void {
    const p = sel();
    $<HTMLInputElement>('scale').value = String(p?.scale ?? 1); $('scaleV').textContent = (p?.scale ?? 1).toFixed(2);
  }
  $<HTMLInputElement>('scale').addEventListener('pointerdown', () => { if (sel()) pushUndo(); });
  $<HTMLInputElement>('scale').addEventListener('input', (e) => { const p = sel(); if (p) { p.scale = Number((e.target as HTMLInputElement).value); $('scaleV').textContent = p.scale.toFixed(2); draw(); save(); } });
  $<HTMLButtonElement>('mirrorBtn').addEventListener('click', () => { const p = sel(); if (p) { pushUndo(); p.flip *= -1; draw(); save(); } });
  $<HTMLButtonElement>('delBtn').addEventListener('click', deleteSel);
  function deleteSel(): void { const p = sel(); if (!p) return; pushUndo(); level().placed = level().placed.filter((x) => x !== p); state.selected = null; refreshSel(); draw(); save(); }

  const snapBtn = $<HTMLButtonElement>('snapBtn');
  snapBtn?.addEventListener('click', () => {
    state.snap = !state.snap;
    snapBtn.classList.toggle('on', state.snap);
  });
  $<HTMLInputElement>('grid')?.addEventListener('input', (e) => { state.grid = Number((e.target as HTMLInputElement).value); const gv = $('gridV'); if (gv) gv.textContent = (e.target as HTMLInputElement).value; draw(); });
  $<HTMLButtonElement>('paintBtn')?.addEventListener('click', () => { state.colliderTool = 'paint'; $('paintBtn').classList.add('on'); $('eraseBtn').classList.remove('on'); });
  $<HTMLButtonElement>('eraseBtn')?.addEventListener('click', () => { state.colliderTool = 'erase'; $('eraseBtn').classList.add('on'); $('paintBtn').classList.remove('on'); });
  $<HTMLButtonElement>('clearCollider')?.addEventListener('click', () => { level().collider = []; draw(); save(); });
  const pathBtnIds = ['pathHBtn', 'pathVBtn', 'erasePathBtn'] as const;
  const pathBtnTools: Record<string, 'h' | 'v' | 'erase'> = { pathHBtn: 'h', pathVBtn: 'v', erasePathBtn: 'erase' };
  for (const id of pathBtnIds) {
    $<HTMLButtonElement>(id)?.addEventListener('click', () => {
      const tool = pathBtnTools[id];
      state.pathTool = state.pathTool === tool ? null : tool;
      updatePathBtns();
    });
  }

  function snapToEdge(): void {
    const p = sel(); const img = imgOf(p as Placed); if (!p || !img) return;
    const w = img.width * p.scale, h = img.height * p.scale;
    let best: { d: number; x: number; y: number } | null = null;
    for (const q of level().placed) {
      if (q === p) continue; const qi = imgOf(q); if (!qi) continue;
      const qw = qi.width * q.scale;
      for (const nx of [q.x + (qw + w) / 2, q.x - (qw + w) / 2]) {
        const d = Math.hypot(nx - p.x, q.y - p.y);
        if (!best || d < best.d) best = { d, x: nx, y: q.y };
      }
    }
    if (best && best.d < 400) { pushUndo(); p.x = best.x; p.y = best.y; draw(); save(); setStatus('Снеп до краю'); }
    void h;
  }

  function updatePathBtns(): void {
    $('pathHBtn')?.classList.toggle('on', state.pathTool === 'h');
    $('pathVBtn')?.classList.toggle('on', state.pathTool === 'v');
    $('erasePathBtn')?.classList.toggle('on', state.pathTool === 'erase');
  }
  let drag: { x: number; y: number; ox: number; oy: number } | null = null;
  let panning = false; let panStart = { mx: 0, my: 0, px: 0, py: 0 };
  let painting = false;
  function paintAt(sx: number, sy: number): void {
    if (!state.pathTool) return;
    const w = toWorld(sx, sy); const gs = state.grid;
    const cx = Math.floor(w.x / gs); const cy = Math.floor(w.y / gs);
    const base = `${cx},${cy}`;
    let cells = level().collider.filter((c) => { const p = c.split(','); return !(p[0] === String(cx) && p[1] === String(cy)); });
    if (state.pathTool !== 'erase') cells = [...cells, `${base},${state.pathTool}`];
    level().collider = cells; draw();
  }
  canvas.addEventListener('mousedown', (ev) => {
    const x = ev.offsetX, y = ev.offsetY;
    if (ev.button === 1) { ev.preventDefault(); panning = true; panStart = { mx: x, my: y, px: state.pan.x, py: state.pan.y }; return; }
    const lv0 = level();
    const MHIT = 9;
    const startSx = toScreen(lv0.start, 0).x;
    const endSx = toScreen(lv0.end, 0).x;
    const spawnS = toScreen(lv0.spawn.x, lv0.spawn.y);
    if (Math.abs(x - startSx) < MHIT) { pushUndo(); state.markerDrag = 'start'; return; }
    if (Math.abs(x - endSx) < MHIT) { pushUndo(); state.markerDrag = 'end'; return; }
    if (Math.abs(x - spawnS.x) < 16 && y > spawnS.y - 52 && y < spawnS.y + 8) { pushUndo(); state.markerDrag = 'spawn'; return; }
    if (state.mode) { state.mode = null; state.orig = null; save(); return; }
    if (state.pathTool) { pushUndo(); painting = true; paintAt(x, y); return; }
    const hit = hitTest(x, y);
    state.selected = hit;
    if (hit) { pushUndo(); const p = sel()!; drag = { x, y, ox: p.x, oy: p.y }; }
    refreshSel(); draw();
  });
  window.addEventListener('mousemove', (ev) => {
    const r = canvas.getBoundingClientRect();
    state.mouse = { x: ev.clientX - r.left, y: ev.clientY - r.top };
    if (panning) { state.pan.x = panStart.px + (state.mouse.x - panStart.mx); if (!state.camView) state.pan.y = panStart.py + (state.mouse.y - panStart.my); applyOrigin(); draw(); return; }
    if (state.markerDrag) {
      const w = toWorld(state.mouse.x, state.mouse.y); const lv = level();
      if (state.markerDrag === 'start') lv.start = w.x;
      else if (state.markerDrag === 'end') lv.end = w.x;
      else lv.spawn = { x: w.x, y: w.y };
      draw(); return;
    }
    if (painting) { paintAt(state.mouse.x, state.mouse.y); return; }
    if (state.mode) { applyMode(); return; }
    if (drag) { const p = sel(); if (p) { p.x = drag.ox + (state.mouse.x - drag.x) / sc(); p.y = drag.oy + (state.mouse.y - drag.y) / sc(); draw(); } }
  });
  window.addEventListener('mouseup', () => { if (drag || painting || state.markerDrag) save(); drag = null; panning = false; painting = false; state.markerDrag = null; });
  canvas.addEventListener('contextmenu', (e) => { e.preventDefault(); if (state.mode) { const p = sel(); if (p && state.orig) Object.assign(p, state.orig); state.mode = null; state.orig = null; draw(); } });
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); if (!state.camView) { state.zoom = Math.min(3, Math.max(0.15, state.zoom * (e.deltaY < 0 ? 1.1 : 0.9))); resize(); } draw(); }, { passive: false });

  function startMode(m: 'G' | 'R' | 'S'): void {
    const p = sel(); if (!p) return;
    pushUndo(); state.axisLock = null;
    state.mode = m; state.orig = { x: p.x, y: p.y, rot: p.rot, scale: p.scale, scaleW: p.scaleW ?? 1, scaleH: p.scaleH ?? 1 };
    const o = toScreen(p.x, p.y);
    state.startWx = state.mouse.x; state.startWy = state.mouse.y;
    state.startAng = Math.atan2(state.mouse.y - o.y, state.mouse.x - o.x);
    state.startDist = Math.max(8, Math.hypot(state.mouse.x - o.x, state.mouse.y - o.y));
  }
  function applyMode(): void {
    const p = sel(); if (!p || !state.orig) return;
    const o = toScreen(p.x, p.y);
    if (state.mode === 'G') {
      const dx = (state.mouse.x - state.startWx) / sc(); const dy = (state.mouse.y - state.startWy) / sc();
      if (state.axisLock === 'x') { p.x = state.orig.x + dx; p.y = state.orig.y; }
      else if (state.axisLock === 'z') { p.x = state.orig.x; p.y = state.orig.y + dy; }
      else { p.x = state.orig.x + dx; p.y = state.orig.y + dy; }
    }
    else if (state.mode === 'R') { const a = Math.atan2(state.mouse.y - o.y, state.mouse.x - o.x); p.rot = state.orig.rot + ((a - state.startAng) * 180) / Math.PI; }
    else if (state.mode === 'S') {
      const d = Math.hypot(state.mouse.x - o.x, state.mouse.y - o.y); const ratio = d / state.startDist;
      if (state.axisLock === 'x') { p.scaleW = Math.max(0.05, state.orig.scaleW * ratio); }
      else if (state.axisLock === 'z') { p.scaleH = Math.max(0.05, state.orig.scaleH * ratio); }
      else { p.scale = Math.max(0.05, state.orig.scale * ratio); }
    }
    refreshSel(); draw();
  }

  window.addEventListener('keydown', (ev) => {
    if (!canvas.offsetWidth) return; // level editor not visible — ignore
    const tag = (document.activeElement?.tagName ?? '').toUpperCase();
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (ev.ctrlKey && ev.code === 'KeyZ') { ev.preventDefault(); undo(); return; }
    if ((ev.code === 'KeyX' || ev.code === 'KeyZ') && (state.mode === 'G' || state.mode === 'S')) {
      ev.preventDefault(); state.axisLock = ev.code === 'KeyX' ? 'x' : 'z'; return;
    }
    if (ev.code === 'KeyG' || ev.code === 'KeyR' || ev.code === 'KeyS') { ev.preventDefault(); startMode(ev.code === 'KeyG' ? 'G' : ev.code === 'KeyR' ? 'R' : 'S'); }
    else if (ev.code === 'KeyM') { ev.preventDefault(); const p = sel(); if (p) { pushUndo(); p.flip *= -1; draw(); save(); } }
    else if (ev.code === 'KeyJ') { ev.preventDefault(); if (state.snap) snapToEdge(); }
    else if (ev.code === 'Delete' || ev.code === 'Backspace') { ev.preventDefault(); deleteSel(); }
    else if (ev.code === 'Escape') {
      if (state.mode) { const p = sel(); if (p && state.orig) Object.assign(p, state.orig); state.mode = null; state.orig = null; state.axisLock = null; draw(); }
      else if (state.pathTool) { state.pathTool = null; updatePathBtns(); }
    }
  });

  $<HTMLSelectElement>('libSelect').addEventListener('change', (e) => {
    state.cat = (e.target as HTMLSelectElement).value;
    refreshCatSelect(); refreshAssets();
  });

  $<HTMLButtonElement>('camViewBtn').addEventListener('click', () => {
    state.camView = !state.camView;
    $('camViewBtn').classList.toggle('on', state.camView);
    if (state.camView) {
      state.zoom = canvas.height / (576 * state.viewScale);
      state.pan.y = 0; state.pan.x = 0; applyOrigin();
      const startSx = toScreen(level().start, 0).x;
      state.pan.x = canvas.width * 0.1 - startSx; applyOrigin();
    }
    draw();
  });

  // tabChar — navigate back to char editor (standalone only; no-op when element doesn't exist in studio)
  document.getElementById(prefix + 'tabChar')?.addEventListener('click', () => {
    if (window.self !== window.top) window.parent.postMessage('backToStudio', '*');
    else window.location.href = 'studio.html';
  });

  $('previewClick')?.addEventListener('click', () => { ($('previewClick') as HTMLElement).style.display = 'none'; }); // ЛКМ — активувати (прибрати overlay)
  $('previewClick')?.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    $<HTMLIFrameElement>('previewFrame')?.contentWindow?.focus();
    const box = $<HTMLElement>('preview');
    if (box) {
      box.style.boxShadow = '0 0 0 2px var(--accent)';
      const restore = (): void => { box.style.boxShadow = ''; window.removeEventListener('focus', restore); };
      window.addEventListener('focus', restore);
    }
  }); // ПКМ — передати хоткеї без розгортання

  const showColliderBtn = $<HTMLButtonElement>('showColliderBtn');
  showColliderBtn?.addEventListener('click', () => {
    state.showCollider = !state.showCollider;
    showColliderBtn.classList.toggle('on', state.showCollider);
    draw();
  });

  function buildLevelDoc(): unknown {
    const lv = level();
    const used = state.assets.filter((a) => lv.placed.some((p) => p.asset === a.id));
    return { name: lv.name, placed: lv.placed, collider: lv.collider, grid: state.grid, spawn: lv.spawn, start: lv.start, end: lv.end, assets: used };
  }
  $<HTMLButtonElement>('exportLevel')?.addEventListener('click', () => {
    const doc = buildLevelDoc();
    const blob = new Blob([JSON.stringify(doc)], { type: 'application/json' });
    const aEl = document.createElement('a'); aEl.href = URL.createObjectURL(blob); aEl.download = `${level().name}.json`; aEl.click();
    setStatus(`Експортовано ${level().name}`);
  });
  $<HTMLButtonElement>('toGame').addEventListener('click', () => {
    const btn = $<HTMLButtonElement>('toGame');
    const level = buildLevelDoc();
    btn.disabled = true;
    const orig = btn.textContent!;
    btn.textContent = 'Публікую...';
    idbSet('zag_level', level).catch(() => {});
    const character: unknown = (() => { try { const s = localStorage.getItem('zag_game_char'); return s ? JSON.parse(s) : null; } catch { return null; } })();
    const files: Record<string, string> = {
      'public/level.json': JSON.stringify(level),
      'public/studio-data/level-assets.json': JSON.stringify(state.assets),
      'public/studio-data/level-layouts.json': JSON.stringify({ levels: state.levels, cur: state.cur }),
    };
    if (character) files['public/character.json'] = JSON.stringify(character);
    ghCommit(files, 'studio: publish to game')
      .then(() => { btn.textContent = 'Оновлено!'; setStatus('✔ Оновлено! Telegram підтягне за ~1 хв.'); })
      .catch((e: unknown) => { btn.textContent = 'Помилка'; setStatus('✗ ' + String(e).slice(0, 60)); })
      .finally(() => { setTimeout(() => { btn.disabled = false; btn.textContent = orig; }, 4000); });
  });

  let cachedTlH = 0;
  function syncToolbarHeight(): void {
    const tl = document.getElementById('timelineBar');
    const lt = document.getElementById(prefix + 'levelToolbar');
    if (!lt) return;
    if (tl && tl.offsetHeight > 0) cachedTlH = tl.offsetHeight;
    if (cachedTlH > 0) lt.style.height = cachedTlH + 'px';
  }

  // Re-render when tab becomes visible
  window.addEventListener('levelTabActivated', () => { resize(); draw(); syncToolbarHeight(); });
  window.addEventListener('resize', () => { resize(); draw(); syncToolbarHeight(); });

  load().then(() => {
    resize(); refreshLevels(); refreshCatSelect(); refreshAssets(); refreshSel(); draw();
    showColliderBtn?.classList.toggle('on', state.showCollider);
    snapBtn?.classList.toggle('on', state.snap);
    // rAF ensures timeline is painted and offsetHeight is non-zero
    requestAnimationFrame(syncToolbarHeight);
    setStatus('Завантаж PNG у бібліотеку і тягни на доріжку.');
  });
}
