// Location editor — статична сцена хабу: будівлі-ассети + активні зони-дії.
import { idbGet, idbSet } from '../store';
import { pullArray, mergeByIdLWW } from '../sync';
import { registerPublisher, wirePublishButton } from '../publish';
import { keyDataUrl } from '../rig/keyer';
import type { NodeGraph } from '../node-editor';
import { type Atmosphere, type WeatherPhase, type LayerKey, evalTod, weatherToggles, DEFAULT_WEATHER_PHASE } from '../level/atmosphere';
import { buildAtmospherePanel } from '../level/atmospherePanel';
import { drawFogLayerCanvas, drawRainCanvas, drawVignetteCanvas, applyColorBalanceCanvas, drawLayerTinted } from '../level/atmoPreview';
import { locationFit } from '../world/worldData';
import {
  fxDisp, fxDeformAt, drawDeformedImage, drawDeformHandles, hitDeformHandle,
  applyHandleDrag, recordDeformKeyframe, openFxObjMenu, type DeformView,
  type PlacedAnim, type PlacedDeform,
} from '../level/placedFx';

interface PlacedAsset {
  id: string; url: string; name: string;
  x: number; y: number; rot: number; scale: number; flip: number;
  plan?: number;         // плановість 1..7 (3 = дефолт); більше — ближче
  anim?: PlacedAnim;     // обертання/дрейф — як у Редакторі Мандр
  deform?: PlacedDeform; // перспектива/FFD + кейфрейми
}

interface ActionZone {
  id: string;
  x: number; y: number; w: number; h: number;
  action: string; label: string;
}

// Legacy смуга туману (старий підменю «Туман» під Дуб) — мігрується в atmosphere.
interface LegacyFogBand {
  id: string; y: number; h: number;
  alpha: number; tint: string; speed: number; front: boolean;
}

interface LocationDoc {
  id: string; name: string; bg: string;
  placed: PlacedAsset[];
  zones: ActionZone[];
  fogs?: LegacyFogBand[];   // legacy — конвертується в atmosphere.weather.fogLayers
  atmosphere?: Atmosphere;  // плановість/погода/віньєтка/баланс — як у Редакторі Мандр
  nodeGraph?: NodeGraph;
  updatedAt?: number; // мітка останньої правки — для синхронізації між компами (LWW)
}

// Шари атмосфери в локації: bg = фон, map = будівлі/декор, foreground = перед усім.
const LOC_ATM_LAYERS: LayerKey[] = ['bg', 'map', 'foreground'];
const LOC_ATM_LABELS: Partial<Record<LayerKey, string>> = {
  bg: 'Фон (позаду)', map: 'Будівлі (перед ними)', foreground: 'Передній план',
};

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

export type OpenNodesFn = (graph: NodeGraph, cats: string[], onChange: (g: NodeGraph) => void, title: string) => void;

let _init = false;
export function initLocationEditor(prefix: string, onOpenNodes?: OpenNodesFn): void {
  if (_init) return; _init = true;

  const $ = <T extends HTMLElement>(id: string) => document.getElementById(prefix + id) as T;

  const canvas = $<HTMLCanvasElement>('stage');
  const ctx = canvas.getContext('2d')!;

  let _uid = Date.now();
  const uid = () => (++_uid).toString(36);
  const newLoc = (name: string): LocationDoc => ({ id: uid(), name, bg: '', placed: [], zones: [], updatedAt: Date.now() });

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
    // Деформація: редагування хендлів (як у Редакторі Мандр)
    deformEdit: null as string | null,
    deformHandleIdx: -1,
    deformDragSx0: 0, deformDragSy0: 0,
    deformDragOrigVals: [] as number[],
    // «Задати лінію напряму» анімації переміщення (світові координати)
    moveLine: null as null | { id: string; x0?: number; y0?: number; x1?: number; y1?: number },
    showZones: true,
    showGrid: true,
    showCamView: true, // 20:9 УВІМК за замовчуванням — рамка показує фактичний кадр гри
    hoverPlaced: null as string | null,
    hoverScale: new Map<string, number>(),
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
    state.images.clear(); ensureImages(); loadBgFromDoc(); deselect(); renderAtmPanel(); save();
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

  // Анімації об'єктів грають, поки нічого не тягнемо й не редагуємо хендли.
  const fxPlaying = (): boolean =>
    !state.mode && !state.dragPlaced && state.deformEdit == null && !state.moveLine && !state.zoneDraw;
  const animClock = (): number => performance.now() / 1000;
  // Дисплейний трансформ (з анімаційним зсувом/кейфреймами).
  const placedDisp = (p: PlacedAsset): { x: number; y: number; rot: number; scale: number } =>
    fxDisp({ x: p.x, y: p.y, rot: p.rot, scale: p.scale, anim: p.anim, deform: p.deform }, animClock(), fxPlaying());
  // Порядок малювання: плановість (1..7, дефолт 3), у межах плану — порядок додавання.
  const placedSorted = (): PlacedAsset[] =>
    [...loc().placed].sort((a, b) => (a.plan ?? 3) - (b.plan ?? 3));

  function placedDeformView(p: PlacedAsset, playing: boolean): DeformView | null {
    if (!p.deform) return null;
    const img = state.images.get(p.id);
    if (!img?.complete || !img.naturalWidth) return null;
    const d = fxDisp({ x: p.x, y: p.y, rot: p.rot, scale: p.scale, anim: p.anim, deform: p.deform }, animClock(), playing);
    const ps = toScreen(d.x, d.y);
    return {
      W: img.naturalWidth, H: img.naturalHeight,
      deform: fxDeformAt(p.deform, animClock(), playing),
      x: ps.x, y: ps.y, rot: d.rot,
      kx: d.scale * sc(), ky: d.scale * sc(),
      flip: p.flip, baked: p.deform.baked,
    };
  }

  function placedAt(sx: number, sy: number): PlacedAsset | null {
    for (const p of placedSorted().reverse()) {
      const img = state.images.get(p.id);
      if (!img?.complete || !img.naturalWidth) continue;
      const d = placedDisp(p);
      const ps = toScreen(d.x, d.y);
      const iw = img.naturalWidth * d.scale * sc();
      const ih = img.naturalHeight * d.scale * sc();
      const dx = sx - ps.x, dy = sy - ps.y;
      const ang = -d.rot * Math.PI / 180;
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

  // Активна погодна фаза (для прев'ю дощу/туману/блискавки) або null.
  function wxPhase(): WeatherPhase | null {
    const wx = loc().atmosphere?.weather;
    if (!wx?.enabled) return null;
    return (wx.phases[0] as WeatherPhase) ?? null;
  }

  // Рамка фактичного кадру гри (той самий фіт, що LocationScene): у СВІТОВИХ координатах.
  function gameFrameWorld(): { x: number; y: number; w: number; h: number } {
    const bgW = state.bgImg?.naturalWidth ?? 0, bgH = state.bgImg?.naturalHeight ?? 0;
    const f = locationFit(loc(), bgW, bgH, 1280, 576);
    return { x: (0 - f.ox) / f.s, y: (0 - f.oy) / f.s, w: 1280 / f.s, h: 576 / f.s };
  }

  function draw() {
    const w = canvas.width = canvas.clientWidth;
    const h = canvas.height = canvas.clientHeight;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, w, h);

    if (!loc()) { requestAnimationFrame(draw); return; }

    const atm = loc().atmosphere;
    const todLayers = atm?.tod?.enabled ? evalTod(atm.tod, 0).layers : {};
    const ph = wxPhase();
    const fogOn = ph ? weatherToggles(ph).fog && !!ph.fogLayers : false;
    const tNow = performance.now() / 1000;

    if (state.bgImg) {
      const bgImg = state.bgImg;
      drawLayerTinted(ctx, w, h, todLayers.bg, (c) => {
        const p = toScreen(0, 0);
        c.drawImage(bgImg, p.x, p.y, bgImg.naturalWidth * sc(), bgImg.naturalHeight * sc());
      });
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

    // Туман за будівлями (шар bg) — між фоном і будівлями, як у грі
    if (fogOn && ph!.fogLayers!.bg) drawFogLayerCanvas(ctx, w, h, ph!.fogLayers!.bg, sc(), tNow);

    // Placed assets (будівлі) — hover: білий контур + плавний масштаб (як у Гамлеті DD1)
    const playing = fxPlaying();
    drawLayerTinted(ctx, w, h, todLayers.map, (c) => {
      for (const p of placedSorted()) {
        const img = state.images.get(p.id);
        if (!img?.complete || !img.naturalWidth) continue;
        const isSel = state.sel === p.id;
        if (p.deform) {
          // Деформований — квадосітка (без hover-масштабу; виділення — рамка нижче)
          const v = placedDeformView(p, playing && state.deformEdit !== p.id)!;
          drawDeformedImage(c, img, v);
          if (isSel && state.deformEdit !== p.id) {
            const bw = img.naturalWidth * p.scale * sc(), bh = img.naturalHeight * p.scale * sc();
            c.save(); c.translate(v.x, v.y); c.rotate(v.rot * Math.PI / 180);
            c.strokeStyle = '#ffcc00'; c.lineWidth = 2; c.setLineDash([5, 3]);
            c.strokeRect(-bw / 2, -bh / 2, bw, bh); c.setLineDash([]); c.restore();
          }
          continue;
        }
        const d = placedDisp(p);
        const hv = state.tool === 'select' && state.hoverPlaced === p.id && !state.dragPlaced && !state.mode;
        const cur = state.hoverScale.get(p.id) ?? 1;
        const target = hv ? 1.08 : 1;
        let hs = cur + (target - cur) * 0.18;
        if (Math.abs(hs - target) < 0.002) hs = target;
        state.hoverScale.set(p.id, hs);
        const ps = toScreen(d.x, d.y);
        const iw = img.naturalWidth * d.scale * sc() * hs;
        const ih = img.naturalHeight * d.scale * sc() * hs;
        c.save();
        c.translate(ps.x, ps.y);
        c.rotate(d.rot * Math.PI / 180);
        c.scale(p.flip, 1);
        if (isSel) { c.shadowColor = '#ffcc00'; c.shadowBlur = 14; }
        else if (hs > 1.005) { c.shadowColor = 'rgba(255,255,255,0.6)'; c.shadowBlur = 12; }
        c.drawImage(img, -iw / 2, -ih / 2, iw, ih);
        c.shadowBlur = 0;
        if (isSel) { c.strokeStyle = '#ffcc00'; c.lineWidth = 2; c.strokeRect(-iw / 2, -ih / 2, iw, ih); }
        else if (hs > 1.005) { c.strokeStyle = 'rgba(255,255,255,0.85)'; c.lineWidth = 2; c.strokeRect(-iw / 2, -ih / 2, iw, ih); }
        c.restore();
      }
    });

    // Хендли деформації обраного об'єкта — поверх тінту
    if (state.deformEdit) {
      const pd = placedById(state.deformEdit);
      if (pd?.deform) {
        const v = placedDeformView(pd, false);
        if (v) drawDeformHandles(ctx, v, state.deformHandleIdx);
      }
    }

    // Лінія напряму руху (режим «Задати лінію»)
    if (state.moveLine?.x0 !== undefined) {
      const L = state.moveLine;
      const a = toScreen(L.x0!, L.y0!);
      const b = toScreen(L.x1 ?? L.x0!, L.y1 ?? L.y0!);
      ctx.strokeStyle = '#39d0ff'; ctx.fillStyle = '#39d0ff'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      ctx.beginPath(); ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x - 12 * Math.cos(ang - 0.4), b.y - 12 * Math.sin(ang - 0.4));
      ctx.lineTo(b.x - 12 * Math.cos(ang + 0.4), b.y - 12 * Math.sin(ang + 0.4));
      ctx.closePath(); ctx.fill();
    }

    // Туман перед будівлями (шар map)
    if (fogOn && ph!.fogLayers!.map) drawFogLayerCanvas(ctx, w, h, ph!.fogLayers!.map, sc(), tNow);

    // Рамка фактичного кадру гри (той самий фіт, що LocationScene) — у світових координатах
    const fw = gameFrameWorld();
    const tl = toScreen(fw.x, fw.y);
    const frame = { x: tl.x, y: tl.y, w: fw.w * sc(), h: fw.h * sc() };

    // Віньєтка — у межах ігрового кадру (як у грі)
    if (atm?.vignette?.enabled) drawVignetteCanvas(ctx, frame.x, frame.y, frame.w, frame.h, atm.vignette);

    // Найближчий туман (шар foreground) — поверх усього
    if (fogOn && ph!.fogLayers!.foreground) drawFogLayerCanvas(ctx, w, h, ph!.fogLayers!.foreground, sc(), tNow);

    // Дощ — поверх сцени
    if (ph) drawRainCanvas(ctx, w, h, ph, sc(), tNow);

    // Кольоровий баланс — грейдиться вся сцена (як у грі), до рамок редактора
    if (atm?.colorBalance?.enabled) applyColorBalanceCanvas(ctx, canvas, atm.colorBalance);

    if (state.showCamView) {
      const { x: vx, y: vy, w: vw, h: vh } = frame;
      const cx0 = Math.max(0, vx), cy0 = Math.max(0, vy);
      const cx1 = Math.min(w, vx + vw), cy1 = Math.min(h, vy + vh);
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      if (cy0 > 0) ctx.fillRect(0, 0, w, cy0);
      if (cy1 < h) ctx.fillRect(0, cy1, w, h - cy1);
      if (cx0 > 0) ctx.fillRect(0, cy0, cx0, cy1 - cy0);
      if (cx1 < w) ctx.fillRect(cx1, cy0, w - cx1, cy1 - cy0);
      ctx.strokeStyle = '#ff9a1f'; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
      ctx.strokeRect(vx, vy, vw, vh);
      ctx.setLineDash([]);
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

    if (state.moveLine?.x0 !== undefined) {
      const wp = toWorld(state.mouse.x, state.mouse.y);
      state.moveLine.x1 = wp.x; state.moveLine.y1 = wp.y;
      return;
    }
    if (state.deformHandleIdx >= 0 && state.deformEdit) {
      const pd = placedById(state.deformEdit);
      if (pd?.deform) {
        applyHandleDrag(
          pd.deform, state.deformHandleIdx, state.deformDragOrigVals,
          state.mouse.x - state.deformDragSx0, state.mouse.y - state.deformDragSy0,
          pd.rot, pd.scale * sc(), pd.scale * sc(), pd.flip,
        );
        return;
      }
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

    // Hover-підсвітка будівель (тільки у режимі вибору, без перетягування/трансформації)
    if (state.tool === 'select' && !state.mode && !state.dragPlaced && !state.panning) {
      const h = placedAt(state.mouse.x, state.mouse.y);
      state.hoverPlaced = h?.id ?? null;
      canvas.style.cursor = h ? 'pointer' : 'default';
    } else if (state.tool === 'select') {
      state.hoverPlaced = null;
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

    // Режим «Задати лінію напряму» анімації переміщення — старт лінії
    if (state.moveLine) {
      const wp = toWorld(mx, my);
      state.moveLine.x0 = wp.x; state.moveLine.y0 = wp.y;
      state.moveLine.x1 = wp.x; state.moveLine.y1 = wp.y;
      return;
    }
    // Редагування хендлів деформації — клік по хендлу починає його дрег
    if (state.deformEdit) {
      const pd = placedById(state.deformEdit);
      if (pd?.deform) {
        const v = placedDeformView(pd, false);
        const hi = v ? hitDeformHandle(v, mx, my) : -1;
        if (hi >= 0) {
          pushUndo();
          state.deformHandleIdx = hi;
          state.deformDragSx0 = mx; state.deformDragSy0 = my;
          state.deformDragOrigVals = [...(pd.deform.type === 'persp' ? (pd.deform.corners ?? new Array(8).fill(0)) : (pd.deform.pts ?? []))];
          return;
        }
      }
    }

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
    // Завершення лінії напряму руху → пишемо anim.move у виділений об'єкт
    if (state.moveLine?.x0 !== undefined) {
      const L = state.moveLine;
      const p = placedById(L.id);
      const ddx = (L.x1 ?? L.x0!) - L.x0!, ddy = (L.y1 ?? L.y0!) - L.y0!;
      const len = Math.hypot(ddx, ddy);
      if (p && len > 2) {
        pushUndo();
        p.anim = { type: 'move', dx: ddx / len, dy: ddy / len, dist: Math.round(len), speed: p.anim?.speed ?? 40, constant: p.anim?.constant ?? false };
        save(); setStatus('Напрям руху задано');
      }
      state.moveLine = null;
      return;
    }
    if (state.deformHandleIdx >= 0) { save(); state.deformHandleIdx = -1; return; }
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

  // ПКМ по будівлі — повне меню як у Редакторі Мандр: плановість + анімація +
  // деформація (з кейфреймами) + дзеркало/видалити.
  canvas.addEventListener('contextmenu', e => {
    e.preventDefault();
    const mx = e.clientX - rect().left, my = e.clientY - rect().top;
    const p = placedAt(mx, my);
    if (!p) return;
    select(p.id, 'placed');
    openFxObjMenu(e.clientX, e.clientY, {
      title: p.name || 'Будівля',
      objId: p.id,
      obj: p,
      plan: {
        get: () => p.plan ?? 3, set: (v) => { p.plan = v; },
        min: 1, max: 7, hint: 'більше = ближче',
      },
      getBase: () => ({ x: p.x, y: p.y, rot: p.rot, scale: p.scale }),
      isEditingHandles: () => state.deformEdit === p.id,
      toggleEditHandles: () => { state.deformEdit = state.deformEdit === p.id ? null : p.id; },
      onSetMoveLine: () => { state.moveLine = { id: p.id }; setStatus('Проведи лінію напряму руху на канвасі'); },
      extras: [
        { label: 'Дзеркалити (M)', on: () => { pushUndo(); p.flip *= -1; save(); } },
        'sep',
        { label: 'Видалити (Del)', danger: true, on: () => {
          pushUndo();
          loc().placed = loc().placed.filter((x) => x.id !== p.id);
          if (state.sel === p.id) deselect();
          if (state.deformEdit === p.id) state.deformEdit = null;
          save();
        } },
      ],
      pushUndo,
      save: () => void save(),
      draw: () => {},
      setStatus,
    });
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
    // нодова панель відкрита — клавіші належать редактору нодів, не сцені локації
    if (document.getElementById('nodeEditorPanel')?.style.display === 'flex') return;
    const active = document.activeElement;
    const typing = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement
      || (active instanceof HTMLElement && active.contentEditable === 'true');
    if (e.ctrlKey && e.code === 'KeyZ') { e.preventDefault(); undo(); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && !typing) { e.preventDefault(); deleteSelected(); return; }
    if (e.ctrlKey || e.shiftKey || typing) return;

    if (e.code === 'Escape') {
      if (previewBig) { setPreviewBig(false); return; }
      if (state.deformEdit || state.moveLine) { state.deformEdit = null; state.moveLine = null; return; }
      if (state.mode && state.modeOrig && state.sel) {
        const p = placedById(state.sel);
        if (p) Object.assign(p, state.modeOrig);
      }
      state.mode = null; state.modeOrig = null; state.zoneDraw = null;
      setTool('select'); return;
    }
    // K — записати кейфрейм деформації виділеної будівлі
    if (e.code === 'KeyK' && state.sel && state.selType === 'placed') {
      const p = placedById(state.sel);
      if (p?.deform) {
        pushUndo();
        const n = recordDeformKeyframe(p.deform, { x: p.x, y: p.y, rot: p.rot, scale: p.scale });
        save(); setStatus(`Кейфрейм ${n} записано · K — додати ще`);
      } else setStatus('Спочатку додай деформацію (ПКМ по будівлі)');
      return;
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
      // Плановість: [ / ] — далі/ближче (як у редакторі меню)
      if (e.key === '[' || e.key === ']') {
        pushUndo();
        p.plan = Math.max(1, Math.min(7, (p.plan ?? 3) + (e.key === ']' ? 1 : -1)));
        save(); setStatus(`План: ${p.plan}`);
      }
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

  const camViewBtn = $('camViewBtn');
  camViewBtn?.classList.toggle('on', state.showCamView);
  camViewBtn?.addEventListener('click', () => {
    state.showCamView = !state.showCamView;
    camViewBtn.classList.toggle('on', state.showCamView);
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

  // Тогл «Вирізати фон» (loc-keyBgBtn) — кеїти рівний фон у завантажених PNG (пропси/будівлі, не фон локації).
  const keyBgOn = (): boolean => {
    const b = document.getElementById(prefix + 'keyBgBtn');
    return b ? b.classList.contains('on') : false;
  };
  document.getElementById(prefix + 'keyBgBtn')
    ?.addEventListener('click', (e) => (e.currentTarget as HTMLElement).classList.toggle('on'));

  $<HTMLInputElement>('bgInput').addEventListener('change', function () {
    const file = this.files?.[0]; if (!file) return;
    const r = new FileReader(); r.onload = () => loadBg(r.result as string); r.readAsDataURL(file); this.value = '';
  });
  $('bgBtn')?.addEventListener('click', () => $<HTMLInputElement>('bgInput').click());
  $('bgClearBtn')?.addEventListener('click', () => { pushUndo(); loc().bg = ''; state.bgImg = null; save(); });

  $<HTMLInputElement>('assetInput').addEventListener('change', function () {
    const files = this.files; if (!files) return;
    for (const file of Array.from(files)) { const r = new FileReader(), f = file; r.onload = () => void keyDataUrl(r.result as string, keyBgOn()).then((u) => dropAsset(u, f.name)); r.readAsDataURL(file); }
    this.value = '';
  });
  $('assetBtn')?.addEventListener('click', () => $<HTMLInputElement>('assetInput').click());

  $('nodesBtn')?.addEventListener('click', () => {
    if (!onOpenNodes) return;
    const l = loc();
    onOpenNodes(
      l.nodeGraph ?? { nodes: [], edges: [] },
      ['condition', 'behavior', 'function'],
      (g) => { l.nodeGraph = g; void save(); },
      'Ноди: ' + l.name,
    );
  });

  canvas.addEventListener('dragover', e => e.preventDefault());
  canvas.addEventListener('drop', e => {
    e.preventDefault();
    const mx = e.clientX - rect().left, my = e.clientY - rect().top;
    // Картка з бібліотеки споруд
    const bid = e.dataTransfer?.getData('text/building-id');
    if (bid) {
      const b = buildings.find(x => x.id === bid);
      if (b?.png) { const wp0 = toWorld(mx, my); dropAsset(b.png, b.name, wp0.x, wp0.y); }
      else setStatus('Будівля без візуалу — спершу кинь PNG на її картку');
      return;
    }
    const file = e.dataTransfer?.files[0]; if (!file?.type.startsWith('image/')) return;
    const wp = toWorld(mx, my);
    const r = new FileReader();
    r.onload = () => {
      if (file.name.toLowerCase().includes('bg') && !loc().bg) loadBg(r.result as string);
      else void keyDataUrl(r.result as string, keyBgOn()).then((u) => dropAsset(u, file.name, wp.x, wp.y));
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
    renderAtmPanel(); // панель атмосфери завжди показує ПОТОЧНУ локацію
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

  // ── Атмосфера: спільна панель (плановість/погода/віньєтка/баланс кольору) ──
  function renderAtmPanel(): void {
    const box = $('atmPanel'); if (!box) return;
    buildAtmospherePanel(box, () => {
      const l = loc();
      if (!l.atmosphere) l.atmosphere = {};
      return l.atmosphere;
    }, () => void save(), { layers: LOC_ATM_LAYERS, labels: LOC_ATM_LABELS });
  }

  // Одноразова міграція legacy-смуг туману («Дуб») → atmosphere.weather.fogLayers.
  function migrateLegacyFogs(l: LocationDoc): boolean {
    if (!l.fogs?.length) { if (l.fogs) delete l.fogs; return false; }
    const atm = (l.atmosphere ??= {});
    if (!atm.weather) atm.weather = { enabled: true, phases: [{ ...DEFAULT_WEATHER_PHASE }] };
    if (!atm.weather.phases.length) atm.weather.phases.push({ ...DEFAULT_WEATHER_PHASE });
    const ph = atm.weather.phases[0];
    atm.weather.enabled = true;
    ph.fog = true;
    if (!ph.fogLayers) ph.fogLayers = {};
    const toFl = (fg: LegacyFogBand) => ({
      color: fg.tint || '#aaa1bd', alpha: Math.min(1, fg.alpha * 1.2),
      speed: Math.abs(fg.speed) || 12, dir: fg.speed < 0 ? 180 : 0,
      seed: Math.floor(Math.random() * 1000), scale: 1,
    });
    const back = l.fogs.find((f) => !f.front), front = l.fogs.find((f) => f.front);
    if (back && !ph.fogLayers.bg) ph.fogLayers.bg = toFl(back);
    if (front && !ph.fogLayers.map) ph.fogLayers.map = toFl(front);
    delete l.fogs;
    return true;
  }

  // ── Preview expand/collapse ───────────────────────────────────────────────

  const previewBox = $<HTMLElement>('preview');
  const previewFrame = $<HTMLIFrameElement>('previewFrame');
  const _locGameUrl = (window as unknown as { Capacitor?: unknown }).Capacitor ? 'game.html' : 'index.html';
  if (previewFrame && !previewFrame.getAttribute('src')) previewFrame.src = _locGameUrl;
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

  registerPublisher(() => ({
    'public/studio-data/locations.json': JSON.stringify({ version: 1, locations: state.locs }, null, 2),
    'public/studio-data/buildings.json': JSON.stringify({ version: 1, buildings }, null, 2),
  }));
  const exportBtn = $<HTMLButtonElement>('exportBtn');
  if (exportBtn) wirePublishButton(exportBtn, setStatus, () => {
    if (previewFrame) previewFrame.src = _locGameUrl + '?t=' + Date.now();
  });

  // ── Бібліотека споруд ──────────────────────────────────────────────────────
  // Будівля = тип з PNG-візуалом + власним нодовим деревом. Палітра спільна для
  // всіх локацій, зберігається в IDB. Клік по картці — нодове дерево цього типу;
  // тягни картку — постав копію у вьюпорт; кинь PNG на картку — задай/заміни візуал.
  interface Building { id: string; name: string; png: string; nodeGraph?: NodeGraph; updatedAt?: number }
  let buildings: Building[] = [];

  // Заглушка-силует для порожньої (без PNG) будівлі.
  let _placeholder = '';
  function placeholderHouse(): string {
    if (_placeholder) return _placeholder;
    const c = document.createElement('canvas'); c.width = 96; c.height = 96;
    const x = c.getContext('2d'); if (!x) return '';
    x.fillStyle = 'rgba(255,255,255,0.22)';
    x.beginPath();
    x.moveTo(48, 16); x.lineTo(82, 46); x.lineTo(72, 46); x.lineTo(72, 80);
    x.lineTo(24, 80); x.lineTo(24, 46); x.lineTo(14, 46); x.closePath(); x.fill();
    return (_placeholder = c.toDataURL());
  }

  // Гарна «біла альфа» drag-image — силует за альфою PNG, замість сирої картинки.
  function makeDragGhost(imgEl: HTMLImageElement): HTMLCanvasElement {
    const max = 100;
    const iw = imgEl.naturalWidth || 64, ih = imgEl.naturalHeight || 64;
    const k = Math.min(max / iw, max / ih, 1);
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(iw * k)); c.height = Math.max(1, Math.round(ih * k));
    const x = c.getContext('2d'); if (!x) return c;
    try {
      x.drawImage(imgEl, 0, 0, c.width, c.height);
      x.globalCompositeOperation = 'source-atop';
      x.fillStyle = 'rgba(255,255,255,0.9)';
      x.fillRect(0, 0, c.width, c.height);
    } catch { /* зображення ще не завантажене — порожній ghost */ }
    return c;
  }

  function renderBuildingLib(): void {
    const grid = $('buildingGrid'); if (!grid) return;
    grid.innerHTML = '';
    for (const b of buildings) {
      const card = document.createElement('div');
      card.className = 'libCard' + (b.png ? '' : ' empty');
      card.title = b.name; card.draggable = true;

      const im = document.createElement('img');
      im.src = b.png || placeholderHouse(); im.draggable = false;
      if (!b.png) im.style.opacity = '0.5';
      card.appendChild(im);

      const nm = document.createElement('div'); nm.className = 'libName'; nm.textContent = b.name;
      card.appendChild(nm);

      const del = document.createElement('button'); del.className = 'libDel'; del.textContent = '✕'; del.title = 'Видалити';
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        buildings = buildings.filter(x => x.id !== b.id); void saveBuildings(); renderBuildingLib();
      });
      card.appendChild(del);

      // Клік — нодове дерево цього типу будівлі (спільне для всіх копій).
      card.addEventListener('click', () => {
        if (!onOpenNodes) return;
        onOpenNodes(
          b.nodeGraph ?? { nodes: [], edges: [] },
          ['condition', 'behavior', 'function'],
          (g) => { b.nodeGraph = g; b.updatedAt = Date.now(); void saveBuildings(); },
          'Будівля: ' + b.name,
        );
      });

      // Drag → біла альфа-силует drag-image, несемо id будівлі.
      card.addEventListener('dragstart', (e) => {
        const dt = (e as DragEvent).dataTransfer; if (!dt) return;
        dt.setData('text/building-id', b.id);
        dt.setData('text/building-name', b.name);
        const ghost = makeDragGhost(im);
        ghost.style.cssText = 'position:fixed;top:-1000px;left:-1000px;pointer-events:none';
        document.body.appendChild(ghost);
        dt.setDragImage(ghost, ghost.width / 2, ghost.height / 2);
        setTimeout(() => ghost.remove(), 0);
      });

      // Кинути PNG на картку → задати/замінити візуал цієї будівлі.
      card.addEventListener('dragover', (e) => {
        if ((e as DragEvent).dataTransfer?.types.includes('Files')) { e.preventDefault(); card.classList.add('dropping'); }
      });
      card.addEventListener('dragleave', () => card.classList.remove('dropping'));
      card.addEventListener('drop', (e) => {
        card.classList.remove('dropping');
        const file = (e as DragEvent).dataTransfer?.files[0];
        if (!file?.type.startsWith('image/')) return;
        e.preventDefault(); e.stopPropagation();
        const r = new FileReader();
        r.onload = () => void keyDataUrl(r.result as string, keyBgOn()).then((u) => { b.png = u; b.updatedAt = Date.now(); void saveBuildings(); renderBuildingLib(); setStatus(`«${b.name}»: візуал оновлено`); });
        r.readAsDataURL(file);
      });

      grid.appendChild(card);
    }
  }

  $('addBuilding')?.addEventListener('click', () => {
    buildings.push({ id: 'bld' + uid(), name: 'Споруда ' + (buildings.length + 1), png: '', updatedAt: Date.now() });
    void saveBuildings(); renderBuildingLib(); setStatus('Будівлю створено — кинь PNG на картку');
  });

  async function saveBuildings(): Promise<void> { await idbSet('zag_buildings', buildings); }
  async function loadBuildings(): Promise<void> {
    const saved = await idbGet<Building[]>('zag_buildings');
    buildings = Array.isArray(saved) ? saved : [];
    renderBuildingLib();
    // Підтягнути опубліковану бібліотеку будівель і злити LWW.
    const remote = await pullArray<Building>('buildings.json', 'buildings');
    if (remote && remote.length) {
      const { merged, changed } = mergeByIdLWW(buildings, remote);
      if (changed > 0) {
        buildings = merged as Building[];
        await idbSet('zag_buildings', buildings);
        renderBuildingLib();
        setStatus(`Синхронізовано: ${changed} будівель з GitHub`);
      }
    }
  }

  // ── Status + persistence ──────────────────────────────────────────────────

  function setStatus(msg: string) { const el = $('statusBar'); if (el) el.textContent = msg; }
  async function save() {
    const l = state.locs[state.cur];
    if (l) l.updatedAt = Date.now(); // правлять поточну локацію → оновлюємо її мітку часу
    await idbSet('zag_locations', state.locs);
  }
  async function load() {
    const saved = await idbGet<LocationDoc[]>('zag_locations');
    if (saved?.length) { state.locs = saved; state.cur = 0; }
    // Legacy-смуги туману → атмосфера (одноразово, без зміни updatedAt).
    if (state.locs.some((l) => migrateLegacyFogs(l))) await idbSet('zag_locations', state.locs);
    // Локальне — одразу на екран; синхронізацію з репо тягнемо фоном (нижче).
    if (state.locs.length) { ensureImages(); loadBgFromDoc(); }
    renderList(); updateProps(); draw();
    // Підтягнути опубліковані локації з репо й злити (LWW).
    const curId = state.locs[state.cur]?.id;
    const remote = await pullArray<LocationDoc>('locations.json', 'locations');
    if (remote && remote.length) {
      const { merged, changed } = mergeByIdLWW(state.locs, remote);
      if (changed > 0) {
        state.locs = merged;
        state.locs.forEach((l) => migrateLegacyFogs(l));
        const i = curId ? merged.findIndex((l) => l.id === curId) : 0;
        state.cur = i >= 0 ? i : 0;
        await idbSet('zag_locations', state.locs);
        ensureImages(); loadBgFromDoc();
        renderList(); updateProps(); draw();
        setStatus(`Синхронізовано: ${changed} локацій з GitHub`);
      }
    }
  }

  window.addEventListener('locationTabActivated', () => {
    canvas.width = canvas.clientWidth; canvas.height = canvas.clientHeight;
  });

  void loadBuildings();
  load(); draw(); setTool('select');
}
