// Location editor — статична сцена хабу: будівлі-ассети + активні зони-дії.
import { idbGet, idbSet } from '../store';
import { ghCommit } from '../github';

interface PlacedAsset {
  id: string; url: string; name: string;
  x: number; y: number; rot: number; scale: number; flip: number;
}

interface ActionZone {
  id: string;
  x: number; y: number; w: number; h: number;
  action: string; label: string;
}

interface LocationDoc {
  id: string; name: string; bg: string;
  placed: PlacedAsset[];
  zones: ActionZone[];
}

const ZONE_COLORS: Record<string, string> = {
  shop:    'rgba(255,200,50,0.32)',
  upgrade: 'rgba(80,160,255,0.32)',
  craft:   'rgba(255,120,40,0.32)',
  rest:    'rgba(80,220,120,0.32)',
  quest:   'rgba(200,80,255,0.32)',
  custom:  'rgba(200,200,200,0.22)',
};

const ZONE_ACTIONS = [
  { v: 'shop',    l: 'Магазин' },
  { v: 'upgrade', l: 'Апгрейд' },
  { v: 'craft',   l: 'Кузня' },
  { v: 'rest',    l: 'Відпочинок' },
  { v: 'quest',   l: 'Квести' },
  { v: 'custom',  l: 'Інше' },
];

type GMode = 'G' | 'R' | 'S' | null;

let _init = false;
export function initLocationEditor(prefix: string): void {
  if (_init) return; _init = true;

  const $ = <T extends HTMLElement>(id: string) => document.getElementById(prefix + id) as T;

  const canvas = $<HTMLCanvasElement>('stage');
  const ctx = canvas.getContext('2d')!;

  let _uid = Date.now();
  const uid = () => (++_uid).toString(36);
  const newLoc = (name: string): LocationDoc => ({ id: uid(), name, bg: '', placed: [], zones: [] });

  const state = {
    locs: [newLoc('Локація 1')] as LocationDoc[],
    cur: 0,
    bgImg: null as HTMLImageElement | null,
    images: new Map<string, HTMLImageElement>(),
    sel: null as string | null,
    selType: null as 'placed' | 'zone' | null,
    tool: 'select' as 'select' | 'zone',
    mode: null as GMode,
    modeOrig: null as null | PlacedAsset,
    modeStartX: 0, modeStartY: 0, modeStartAng: 0,
    dragPlaced: null as string | null,
    dragStart: { sx: 0, sy: 0, ox: 0, oy: 0 },
    wasDrag: false,
    zoneDraw: null as null | { sx: number; sy: number },
    panning: false,
    panStart: { mx: 0, my: 0, px: 0, py: 0 },
    zoom: 1,
    pan: { x: 0, y: 0 },
    mouse: { x: 0, y: 0 },
    undoStack: [] as string[],
    showZones: true,
    showGrid: true,
  };

  const loc = (): LocationDoc => state.locs[state.cur];
  const sc = () => state.zoom;
  const toScreen = (wx: number, wy: number) => ({
    x: canvas.width / 2 + state.pan.x + wx * sc(),
    y: canvas.height / 2 + state.pan.y + wy * sc(),
  });
  const toWorld = (sx: number, sy: number) => ({
    x: (sx - canvas.width / 2 - state.pan.x) / sc(),
    y: (sy - canvas.height / 2 - state.pan.y) / sc(),
  });
  const rect = () => canvas.getBoundingClientRect();

  const placedById = (id: string) => loc().placed.find(p => p.id === id);
  const zoneById   = (id: string) => loc().zones.find(z => z.id === id);

  function ensureImages() {
    for (const p of loc().placed) {
      if (!state.images.has(p.id)) {
        const img = new Image(); img.src = p.url;
        state.images.set(p.id, img);
      }
    }
  }

  function loadBgFromDoc() {
    const bg = loc().bg;
    if (bg) { const img = new Image(); img.onload = () => { state.bgImg = img; }; img.src = bg; }
    else state.bgImg = null;
  }

  function pushUndo() {
    state.undoStack.push(JSON.stringify(loc()));
    if (state.undoStack.length > 50) state.undoStack.shift();
  }

  function undo() {
    const snap = state.undoStack.pop(); if (!snap) return;
    state.locs[state.cur] = JSON.parse(snap);
    state.images.clear(); ensureImages(); loadBgFromDoc(); deselect(); save();
  }

  function deselect() { state.sel = null; state.selType = null; updateProps(); }

  function select(id: string, type: 'placed' | 'zone') { state.sel = id; state.selType = type; updateProps(); }

  function deleteSelected() {
    if (!state.sel) return; pushUndo();
    if (state.selType === 'placed') loc().placed = loc().placed.filter(p => p.id !== state.sel);
    else loc().zones = loc().zones.filter(z => z.id !== state.sel);
    deselect(); save();
  }

  // ── Hit testing ───────────────────────────────────────────────────────────

  function placedAt(sx: number, sy: number): PlacedAsset | null {
    for (const p of [...loc().placed].reverse()) {
      const img = state.images.get(p.id);
      if (!img?.complete || !img.naturalWidth) continue;
      const ps = toScreen(p.x, p.y);
      const iw = img.naturalWidth * p.scale * sc();
      const ih = img.naturalHeight * p.scale * sc();
      const dx = sx - ps.x, dy = sy - ps.y;
      const ang = -p.rot * Math.PI / 180;
      const lx = dx * Math.cos(ang) - dy * Math.sin(ang);
      const ly = dx * Math.sin(ang) + dy * Math.cos(ang);
      if (Math.abs(lx) <= iw / 2 && Math.abs(ly) <= ih / 2) return p;
    }
    return null;
  }

  function zoneAt(sx: number, sy: number): ActionZone | null {
    const wp = toWorld(sx, sy);
    for (const z of [...loc().zones].reverse())
      if (wp.x >= z.x && wp.x <= z.x + z.w && wp.y >= z.y && wp.y <= z.y + z.h) return z;
    return null;
  }

  // ── Draw ──────────────────────────────────────────────────────────────────

  function draw() {
    const w = canvas.width = canvas.clientWidth;
    const h = canvas.height = canvas.clientHeight;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, w, h);

    if (!loc()) { requestAnimationFrame(draw); return; }

    if (state.bgImg) {
      const p = toScreen(0, 0);
      ctx.drawImage(state.bgImg, p.x, p.y, state.bgImg.naturalWidth * sc(), state.bgImg.naturalHeight * sc());
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.07)'; ctx.font = '14px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('Тягни PNG будівель/фону сюди', w / 2, h / 2);
    }

    if (state.showGrid) {
      ctx.strokeStyle = '#282828'; ctx.lineWidth = 1;
      const gs = 60 * sc();
      const ox = ((w / 2 + state.pan.x) % gs + gs) % gs;
      const oy = ((h / 2 + state.pan.y) % gs + gs) % gs;
      for (let x = ox; x < w; x += gs) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
      for (let y = oy; y < h; y += gs) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
    }

    if (state.showZones) for (const z of loc().zones) {
      const tl = toScreen(z.x, z.y);
      const sw = z.w * sc(), sh = z.h * sc();
      const isSel = state.sel === z.id;
      ctx.fillStyle = ZONE_COLORS[z.action] ?? ZONE_COLORS.custom;
      ctx.fillRect(tl.x, tl.y, sw, sh);
      ctx.strokeStyle = isSel ? '#ffcc00' : 'rgba(255,255,255,0.45)';
      ctx.lineWidth = isSel ? 2 : 1;
      ctx.setLineDash([5, 3]);
      ctx.strokeRect(tl.x, tl.y, sw, sh);
      ctx.setLineDash([]);
      ctx.fillStyle = isSel ? '#ffcc00' : '#fff';
      ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(z.label || z.action, tl.x + sw / 2, tl.y + sh / 2 + 4);
    }

    // Zone preview while drawing
    if (state.tool === 'zone' && state.zoneDraw) {
      const startW = toWorld(state.zoneDraw.sx, state.zoneDraw.sy);
      const endW   = toWorld(state.mouse.x, state.mouse.y);
      const zx = Math.min(startW.x, endW.x), zy = Math.min(startW.y, endW.y);
      const zw = Math.abs(endW.x - startW.x), zh = Math.abs(endW.y - startW.y);
      const tl2 = toScreen(zx, zy);
      ctx.fillStyle = 'rgba(255,200,50,0.18)'; ctx.fillRect(tl2.x, tl2.y, zw * sc(), zh * sc());
      ctx.strokeStyle = '#ffcc00'; ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]); ctx.strokeRect(tl2.x, tl2.y, zw * sc(), zh * sc()); ctx.setLineDash([]);
    }

    // Placed assets
    for (const p of loc().placed) {
      const img = state.images.get(p.id);
      if (!img?.complete || !img.naturalWidth) continue;
      const ps = toScreen(p.x, p.y);
      const iw = img.naturalWidth * p.scale * sc();
      const ih = img.naturalHeight * p.scale * sc();
      const isSel = state.sel === p.id;
      ctx.save();
      ctx.translate(ps.x, ps.y);
      ctx.rotate(p.rot * Math.PI / 180);
      ctx.scale(p.flip, 1);
      if (isSel) { ctx.shadowColor = '#ffcc00'; ctx.shadowBlur = 14; }
      ctx.drawImage(img, -iw / 2, -ih / 2, iw, ih);
      ctx.shadowBlur = 0;
      if (isSel) { ctx.strokeStyle = '#ffcc00'; ctx.lineWidth = 2 / sc(); ctx.strokeRect(-iw / 2, -ih / 2, iw, ih); }
      ctx.restore();
    }

    requestAnimationFrame(draw);
  }

  // ── Mouse ─────────────────────────────────────────────────────────────────

  canvas.addEventListener('mousemove', e => {
    state.mouse.x = e.clientX - rect().left;
    state.mouse.y = e.clientY - rect().top;

    if (state.panning) {
      state.pan.x = state.panStart.px + e.clientX - state.panStart.mx;
      state.pan.y = state.panStart.py + e.clientY - state.panStart.my;
    }

    if (state.dragPlaced && !state.mode) {
      const dx = state.mouse.x - state.dragStart.sx, dy = state.mouse.y - state.dragStart.sy;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) state.wasDrag = true;
      if (state.wasDrag) {
        const p = placedById(state.dragPlaced);
        if (p) { p.x = state.dragStart.ox + dx / sc(); p.y = state.dragStart.oy + dy / sc(); }
      }
    }

    if (state.mode === 'G' && state.sel && state.modeOrig) {
      const p = placedById(state.sel);
      if (p) { p.x = state.modeOrig.x + (state.mouse.x - state.modeStartX) / sc(); p.y = state.modeOrig.y + (state.mouse.y - state.modeStartY) / sc(); }
    }
    if (state.mode === 'R' && state.sel) {
      const p = placedById(state.sel);
      if (p) { const ps = toScreen(p.x, p.y); p.rot = Math.atan2(state.mouse.y - ps.y, state.mouse.x - ps.x) * 180 / Math.PI - state.modeStartAng; }
    }
    if (state.mode === 'S' && state.sel && state.modeOrig) {
      const p = placedById(state.sel);
      if (p) { const d = Math.hypot(state.mouse.x - state.modeStartX, state.mouse.y - state.modeStartY); p.scale = Math.max(0.02, state.modeOrig.scale * (d / 120)); }
    }
  });

  canvas.addEventListener('mousedown', e => {
    const mx = e.clientX - rect().left, my = e.clientY - rect().top;
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      e.preventDefault();
      state.panning = true; state.panStart = { mx: e.clientX, my: e.clientY, px: state.pan.x, py: state.pan.y };
      return;
    }
    if (e.button !== 0) return;

    if (state.mode) { save(); state.mode = null; state.modeOrig = null; return; }

    if (state.tool === 'select') {
      const p = placedAt(mx, my);
      if (p) {
        select(p.id, 'placed');
        state.dragPlaced = p.id; state.dragStart = { sx: mx, sy: my, ox: p.x, oy: p.y }; state.wasDrag = false;
        return;
      }
      const z = zoneAt(mx, my);
      if (z) { select(z.id, 'zone'); return; }
      deselect();
    }

    if (state.tool === 'zone') state.zoneDraw = { sx: mx, sy: my };
  });

  canvas.addEventListener('mouseup', e => {
    state.panning = false;
    if (state.dragPlaced) { if (state.wasDrag) save(); state.dragPlaced = null; }

    if (state.tool === 'zone' && state.zoneDraw) {
      const mx = e.clientX - rect().left, my = e.clientY - rect().top;
      const sw = toWorld(state.zoneDraw.sx, state.zoneDraw.sy);
      const ew = toWorld(mx, my);
      const zx = Math.min(sw.x, ew.x), zy = Math.min(sw.y, ew.y);
      const zw = Math.abs(ew.x - sw.x), zh = Math.abs(ew.y - sw.y);
      if (zw > 10 && zh > 10) {
        pushUndo();
        const zone: ActionZone = { id: uid(), x: zx, y: zy, w: zw, h: zh, action: 'shop', label: 'Магазин' };
        loc().zones.push(zone); select(zone.id, 'zone'); save();
      }
      state.zoneDraw = null;
    }
  });

  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const f = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const mx = e.clientX - rect().left, my = e.clientY - rect().top;
    const wx = (mx - canvas.width / 2 - state.pan.x) / state.zoom;
    const wy = (my - canvas.height / 2 - state.pan.y) / state.zoom;
    state.zoom = Math.max(0.1, Math.min(4, state.zoom * f));
    state.pan.x = mx - canvas.width / 2 - wx * state.zoom;
    state.pan.y = my - canvas.height / 2 - wy * state.zoom;
  }, { passive: false });

  // ── Keyboard ──────────────────────────────────────────────────────────────

  window.addEventListener('keydown', e => {
    const app = document.getElementById('app');
    if (!app?.className.includes('mode-location')) return;
    const active = document.activeElement;
    const typing = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement;
    if (e.ctrlKey && e.code === 'KeyZ') { e.preventDefault(); undo(); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && !typing) { e.preventDefault(); deleteSelected(); return; }
    if (e.ctrlKey || e.shiftKey || typing) return;

    if (e.code === 'Escape') {
      if (previewBig) { setPreviewBig(false); return; }
      if (state.mode && state.modeOrig && state.sel) {
        const p = placedById(state.sel);
        if (p) Object.assign(p, state.modeOrig);
      }
      state.mode = null; state.modeOrig = null; state.zoneDraw = null;
      setTool('select'); return;
    }
    if (state.sel && state.selType === 'placed' && !state.mode) {
      const p = placedById(state.sel)!;
      if (e.code === 'KeyG') { state.mode = 'G'; state.modeOrig = { ...p }; state.modeStartX = state.mouse.x; state.modeStartY = state.mouse.y; }
      if (e.code === 'KeyR') {
        const ps = toScreen(p.x, p.y);
        state.mode = 'R'; state.modeStartAng = Math.atan2(state.mouse.y - ps.y, state.mouse.x - ps.x) * 180 / Math.PI - p.rot;
      }
      if (e.code === 'KeyS') { state.mode = 'S'; state.modeOrig = { ...p }; state.modeStartX = state.mouse.x; state.modeStartY = state.mouse.y; }
      if (e.code === 'KeyM') { pushUndo(); p.flip *= -1; save(); }
    }
    if (e.code === 'KeyV') setTool('select');
    if (e.code === 'KeyZ') setTool('zone');
  });

  // ── Tools ─────────────────────────────────────────────────────────────────

  function setTool(t: typeof state.tool) {
    state.tool = t; state.zoneDraw = null;
    canvas.style.cursor = t === 'zone' ? 'crosshair' : 'default';
    $('tool-select')?.classList.toggle('on', t === 'select');
    $('tool-zone')?.classList.toggle('on', t === 'zone');
  }

  $('tool-select')?.addEventListener('click', () => setTool('select'));
  $('tool-zone')?.addEventListener('click', () => setTool('zone'));
  $('deleteBtn')?.addEventListener('click', deleteSelected);

  $('undoBtn')?.addEventListener('click', undo);

  const zonesBtn = $('zonesBtn');
  zonesBtn?.addEventListener('click', () => {
    state.showZones = !state.showZones;
    zonesBtn.classList.toggle('on', state.showZones);
  });

  const gridBtn = $('gridBtn');
  gridBtn?.addEventListener('click', () => {
    state.showGrid = !state.showGrid;
    gridBtn.classList.toggle('on', state.showGrid);
  });

  $('fitBtn')?.addEventListener('click', () => { state.zoom = 1; state.pan = { x: 0, y: 0 }; });

  // ── Background + assets ───────────────────────────────────────────────────

  function loadBg(url: string) {
    pushUndo(); loc().bg = url;
    const img = new Image(); img.onload = () => { state.bgImg = img; save(); setStatus('Фон завантажено'); }; img.src = url;
  }

  function dropAsset(url: string, name: string, wx = 0, wy = 0) {
    pushUndo();
    const id = uid();
    loc().placed.push({ id, url, name, x: wx, y: wy, rot: 0, scale: 0.5, flip: 1 });
    const img = new Image(); img.src = url; state.images.set(id, img);
    select(id, 'placed'); save(); setStatus(`«${name}» додано`);
  }

  $<HTMLInputElement>('bgInput').addEventListener('change', function () {
    const file = this.files?.[0]; if (!file) return;
    const r = new FileReader(); r.onload = () => loadBg(r.result as string); r.readAsDataURL(file); this.value = '';
  });
  $('bgBtn')?.addEventListener('click', () => $<HTMLInputElement>('bgInput').click());
  $('bgClearBtn')?.addEventListener('click', () => { pushUndo(); loc().bg = ''; state.bgImg = null; save(); });

  $<HTMLInputElement>('assetInput').addEventListener('change', function () {
    const files = this.files; if (!files) return;
    for (const file of Array.from(files)) { const r = new FileReader(), f = file; r.onload = () => dropAsset(r.result as string, f.name); r.readAsDataURL(file); }
    this.value = '';
  });
  $('assetBtn')?.addEventListener('click', () => $<HTMLInputElement>('assetInput').click());

  canvas.addEventListener('dragover', e => e.preventDefault());
  canvas.addEventListener('drop', e => {
    e.preventDefault();
    const file = e.dataTransfer?.files[0]; if (!file?.type.startsWith('image/')) return;
    const mx = e.clientX - rect().left, my = e.clientY - rect().top;
    const wp = toWorld(mx, my);
    const r = new FileReader();
    r.onload = () => {
      if (file.name.toLowerCase().includes('bg') && !loc().bg) loadBg(r.result as string);
      else dropAsset(r.result as string, file.name, wp.x, wp.y);
    };
    r.readAsDataURL(file);
  });

  // ── Location list ─────────────────────────────────────────────────────────

  $('addLoc')?.addEventListener('click', () => {
    const l = newLoc(`Локація ${state.locs.length + 1}`);
    state.locs.push(l); state.cur = state.locs.length - 1;
    state.images.clear(); state.bgImg = null; deselect(); renderList(); save();
  });

  function renderList() {
    const el = $('locList'); if (!el) return;
    el.innerHTML = '';
    state.locs.forEach((l, i) => {
      const card = document.createElement('div');
      card.className = 'libCard' + (i === state.cur ? ' on' : '');
      card.style.cssText = 'padding:6px 8px;cursor:pointer;border-radius:6px;font-size:13px;display:flex;align-items:center;gap:6px';

      const name = document.createElement('span');
      name.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
      name.textContent = l.name; name.contentEditable = 'true';
      name.addEventListener('blur', () => { l.name = name.textContent || l.name; save(); });
      name.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); name.blur(); } });
      name.addEventListener('click', ev => { if (i === state.cur) ev.stopPropagation(); });

      card.addEventListener('click', () => {
        if (document.activeElement === name) return;
        state.cur = i; state.images.clear(); ensureImages(); loadBgFromDoc(); deselect(); renderList();
      });

      const del = document.createElement('button');
      del.textContent = '×'; del.title = 'Видалити';
      del.style.cssText = 'flex:0 0 20px;width:20px;height:20px;padding:0;font-size:14px;line-height:1;opacity:.5;border-radius:4px;background:transparent;border:0;color:inherit;cursor:pointer';
      del.addEventListener('click', ev => {
        ev.stopPropagation(); if (state.locs.length <= 1) return;
        state.locs.splice(i, 1); state.cur = Math.min(state.cur, state.locs.length - 1);
        state.images.clear(); ensureImages(); loadBgFromDoc(); deselect(); renderList(); save();
      });

      card.append(name, del); el.append(card);
    });
  }

  // ── Properties ────────────────────────────────────────────────────────────

  function updateProps() {
    const noP  = $('noProps');
    const asP  = $('assetProps');
    const znP  = $('zoneProps');
    if (!noP || !asP || !znP) return;

    if (!state.sel) { noP.style.display = ''; asP.style.display = 'none'; znP.style.display = 'none'; return; }
    noP.style.display = 'none';

    if (state.selType === 'placed') {
      znP.style.display = 'none'; asP.style.display = 'flex';
      const p = placedById(state.sel); if (!p) return;
      ($<HTMLInputElement>('assetName')).value = p.name;
    }
    if (state.selType === 'zone') {
      asP.style.display = 'none'; znP.style.display = 'flex';
      const z = zoneById(state.sel); if (!z) return;
      ($<HTMLSelectElement>('zoneAction')).value = z.action;
      ($<HTMLInputElement>('zoneLabel')).value = z.label;
    }
  }

  $<HTMLInputElement>('assetName')?.addEventListener('input', function () {
    const p = placedById(state.sel!); if (p) { p.name = this.value; save(); }
  });

  const actionSel = $<HTMLSelectElement>('zoneAction');
  if (actionSel) {
    ZONE_ACTIONS.forEach(a => { const o = document.createElement('option'); o.value = a.v; o.textContent = a.l; actionSel.append(o); });
    actionSel.addEventListener('change', function () {
      const z = zoneById(state.sel!); if (!z) return;
      z.action = this.value;
      const preset = ZONE_ACTIONS.find(a => a.v === this.value);
      if (preset && ZONE_ACTIONS.some(a => a.l === z.label)) z.label = preset.l;
      updateProps(); save();
    });
  }

  $<HTMLInputElement>('zoneLabel')?.addEventListener('input', function () {
    const z = zoneById(state.sel!); if (z) { z.label = this.value; save(); }
  });

  // ── Preview expand/collapse ───────────────────────────────────────────────

  const previewBox = $<HTMLElement>('preview');
  const previewFrame = $<HTMLIFrameElement>('previewFrame');
  const previewBackdrop = document.createElement('div');
  previewBackdrop.style.cssText = 'display:none;position:fixed;inset:0;z-index:99;cursor:pointer;';
  document.body.appendChild(previewBackdrop);
  let previewBig = false;

  function setPreviewBig(on: boolean): void {
    previewBig = on;
    const pc = $<HTMLElement>('previewClick');
    if (on && previewBox) {
      const lib = document.getElementById('loc-library');
      const w = Math.max(360, window.innerWidth - 8 - ((lib?.getBoundingClientRect().right ?? 300) + 12));
      previewBox.classList.add('big');
      previewBox.style.width = w + 'px';
      previewBox.style.height = Math.round((w * 9) / 20) + 'px';
      if (pc) pc.style.pointerEvents = 'none';
      previewBackdrop.style.display = 'block';
      previewFrame?.contentWindow?.focus();
    } else if (previewBox) {
      previewBox.classList.remove('big');
      previewBox.style.width = ''; previewBox.style.height = '';
      if (pc) pc.style.pointerEvents = '';
      previewBackdrop.style.display = 'none';
    }
  }

  previewBackdrop.addEventListener('click', () => setPreviewBig(false));
  $('previewClick')?.addEventListener('click', () => setPreviewBig(!previewBig));
  $('previewClick')?.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    previewFrame?.contentWindow?.focus();
    if (previewBox) {
      previewBox.style.boxShadow = '0 0 0 2px var(--accent)';
      const restore = (): void => { if (previewBox) previewBox.style.boxShadow = ''; window.removeEventListener('focus', restore); };
      window.addEventListener('focus', restore);
    }
  });
  window.addEventListener('resize', () => { if (previewBig) setPreviewBig(true); });

  // ── Publish to game ───────────────────────────────────────────────────────

  $('exportBtn')?.addEventListener('click', () => {
    const btn = $<HTMLButtonElement>('exportBtn');
    if (!btn) return;
    btn.disabled = true;
    const orig = btn.textContent!;
    btn.textContent = 'Публікую...';
    const json = JSON.stringify({ version: 1, locations: state.locs }, null, 2);
    ghCommit({ 'public/studio-data/locations.json': json }, 'studio: update locations')
      .then(() => {
        btn.textContent = 'Оновлено!';
        setStatus('✔ Оновлено! Гра підтягне за ~1 хв.');
        if (previewFrame) previewFrame.src = 'index.html?t=' + Date.now();
      })
      .catch((e: unknown) => { btn.textContent = 'Помилка'; setStatus('✗ ' + String(e).slice(0, 60)); })
      .finally(() => { setTimeout(() => { btn.disabled = false; btn.textContent = orig; }, 4000); });
  });

  // ── Status + persistence ──────────────────────────────────────────────────

  function setStatus(msg: string) { const el = $('statusBar'); if (el) el.textContent = msg; }
  async function save() { await idbSet('zag_locations', state.locs); }
  async function load() {
    const saved = await idbGet<LocationDoc[]>('zag_locations');
    if (saved?.length) { state.locs = saved; state.cur = 0; ensureImages(); loadBgFromDoc(); }
    renderList(); updateProps();
  }

  window.addEventListener('locationTabActivated', () => {
    canvas.width = canvas.clientWidth; canvas.height = canvas.clientHeight;
  });

  load(); draw(); setTool('select');
}
