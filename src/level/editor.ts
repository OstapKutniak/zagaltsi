// Core level editor logic — usable both standalone (prefix='') and embedded in studio (prefix='lv-').
import { idbGet, idbSet } from '../store';
import { ghCommit } from '../github';
import { pullLevelData, mergeLevelAssets } from '../sync';
import { toggleConstructor } from '../ui-constructor';
import { loadCharLibrary, type LibItem } from '../charlib';
import { footprintWorldCells } from './footprint';
import { generateGameAsset, hasFalKey } from '../ai';

const rad = (d: number): number => (d * Math.PI) / 180;

const CATS = [
  { key: 'sky', label: 'Небо' },
  { key: 'clouds', label: 'Хмари' },
  { key: 'bg', label: 'Задній фон' },
  { key: 'frontbg', label: 'Передній фон' },
  { key: 'map', label: 'Карта' },
  { key: 'decor', label: 'Декор' },
  { key: 'collider', label: 'Колайдер' },
  { key: 'interactive', label: 'Інтерактив' },
  { key: 'trap', label: 'Пастки' },
  { key: 'foreground', label: 'Передній план' },
] as const;
// Порядок малювання (менше = позаду). Передній план — поверх усього.
const LAYER: Record<string, number> = { sky: 0, clouds: 1, bg: 2, frontbg: 3, map: 4, decor: 5, collider: 5, interactive: 5, trap: 5, foreground: 6 };

// Паралакс-шари (швидкість скролу відрізняється від карти). «Дальність» 0..1:
// фонові — 1−дальність (повільніше за карту), передній план — 1+дальність (швидше).
const PARALLAX_LAYERS = ['sky', 'clouds', 'bg', 'frontbg', 'foreground'] as const;
type ParallaxLayer = typeof PARALLAX_LAYERS[number];
const PARALLAX_LABEL: Record<ParallaxLayer, string> = { sky: 'Небо', clouds: 'Хмари', bg: 'Задній фон', frontbg: 'Передній фон', foreground: 'Передній план' };
const PARALLAX_DEFAULTS: Record<ParallaxLayer, number> = { sky: 0.85, clouds: 0.7, bg: 0.5, frontbg: 0.25, foreground: 0.35 };
const ensureParallax = (lv: Level): Record<string, number> => {
  if (!lv.parallax) lv.parallax = {};
  for (const k of PARALLAX_LAYERS) if (typeof lv.parallax[k] !== 'number') lv.parallax[k] = PARALLAX_DEFAULTS[k];
  return lv.parallax;
};
// scrollFactor шару (синхрон з LevelView): фонові 1−дальність, передній план 1+дальність.
const layerScrollFactor = (cat: string, dist: number): number => (cat === 'foreground' ? 1 + dist : Math.max(0, 1 - dist));
const GAME_VIEW_W = 1280; // ширина ігрового кадру — для виводу фініш-ліній паралакс-шарів
// Кольори фініш-ліній шарів (плюс «кінець (карта)» завжди червоний).
const LAYER_LINE_COLOR: Record<string, string> = { sky: '#6aa9ff', clouds: '#9ad0ff', bg: '#7ad0a0', frontbg: '#d0c060', foreground: '#ff9a4f' };

interface Asset { id: string; cat: string; name: string; url: string; footprint?: { cells: { dx: number; dy: number }[] } }
interface Placed { id: string; cat: string; asset: string; x: number; y: number; rot: number; scale: number; flip: number; scaleW?: number; scaleH?: number }
interface Level { name: string; placed: Placed[]; collider: string[]; enemySpawns: string[]; spawn: { x: number; y: number }; spawns: { x: number; y: number }[]; start: number; end: number; grid: number; parallax: Record<string, number> }

const SPAWN_COLORS = ['#ff5555', '#5aa0ff', '#5aff8f', '#ffd000', '#c06aff']; // 5 кольорів точок спавна

export function initLevelEditor(prefix: string): void {
  const $ = <T extends HTMLElement>(id: string): T => document.getElementById(prefix + id) as T;
  const newLevel = (name: string): Level => ({ name, placed: [], collider: [], enemySpawns: [], spawn: { x: 120, y: 0 }, spawns: [{ x: 120, y: 0 }], start: 0, end: 2400, grid: 32, parallax: { ...PARALLAX_DEFAULTS } });

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
    pathTool: null as null | 'h' | 'v' | 'erase' | 'enemy' | 'enemyErase' | 'spawn' | 'raise' | 'lower' | 'flat' | 'walk',
    axisLock: null as null | 'x' | 'z',
    colliderTool: 'paint' as 'paint' | 'erase',
    markerDrag: null as null | 'spawn' | 'start' | 'end',
    spawnSel: 0, // який зі спавнів зараз вибраний/тягнеться
    camView: false,
    grid: 48,
    snap: true,
    showCollider: true,
    showMarkers: true,
    showEnemySpawns: true,
    showPlayerSpawns: true,
    hiddenCats: new Set<string>(),
    soloFillCat: null as string | null,
    zoom: 0.6,
    pan: { x: 0, y: 0 },
    origin: { x: 0, y: 0 },
    viewScale: 1,
    mouse: { x: 0, y: 0 },
    pendingAsset: null as string | null,
    pendingRot: 0,    // градуси для ghost під час розміщення
    pendingScale: 1,  // масштаб ghost
    pendingFlip: 1,   // 1 або -1 (M = дзеркало)
    pendingTransMode: null as null | 'R' | 'S', // активна трансформація ghost
    pendingEnemy: null as string | null,          // id ворога що зараз виставляється
    brushSize: 1, // 1=1×1  2=2×2  3=3×3 …  колесо змінює при активному H/Y/1/2/3
  };

  // Неігрові персонажі (вороги) з бібліотеки персонажів + кеш червоних тонованих мініатюр.
  let npcLib: LibItem[] = [];
  const npcTinted = new Map<string, HTMLCanvasElement>();
  const npcImages = new Map<string, HTMLImageElement>();

  const level = (): Level => state.levels[state.cur];
  const sc = (): number => state.viewScale * state.zoom;
  const toScreen = (wx: number, wy: number) => ({ x: state.origin.x + wx * sc(), y: state.origin.y + wy * sc() });
  const toWorld = (sx: number, sy: number) => ({ x: (sx - state.origin.x) / sc(), y: (sy - state.origin.y) / sc() });
  const imgOf = (p: Placed): HTMLImageElement | undefined => state.images.get(p.asset);

  let _drawRaf = 0;
  let _panning = false;

  // ── Геометрія ізо-ґратки (спільна для draw / прев'ю / кліків) ──
  type Pt = { x: number; y: number };
  // Підлогова клітинка (cx,cy) розміром w×h клітинок → 4 екранні точки.
  const floorPts = (cx: number, cy: number, w = 1, h = 1): Pt[] => {
    const gs = state.grid, k = gs * Math.SQRT1_2;
    const P = (ix: number, iy: number): Pt => toScreen(ix * gs + iy * k, iy * k);
    return [P(cx, cy), P(cx + w, cy), P(cx + w, cy + h), P(cx, cy + h)];
  };
  // Вертикальна стіна (v) — ОРИГІНАЛЬНА ізо-ґратка стіни: боки вертикальні (0,gs), верх/низ 45° (k,k).
  const wallPts = (cx: number, cy: number): Pt[] => {
    const gs = state.grid, k = gs * Math.SQRT1_2;
    const P = (ix: number, iy: number): Pt => toScreen(ix * k, ix * k + iy * gs);
    return [P(cx, cy), P(cx + 1, cy), P(cx + 1, cy + 1), P(cx, cy + 1)];
  };
  // Підлогова клітинка під екранною точкою (інверсія підлогової ґратки).
  const floorCellAt = (sx: number, sy: number): { cx: number; cy: number } => {
    const w = toWorld(sx, sy), gs = state.grid, k = gs * Math.SQRT1_2;
    return { cx: Math.floor((w.x - w.y) / gs), cy: Math.floor(w.y / k) };
  };
  // Куди ляже вертикальний колайдер: стіна стає БОРТОМ на ПРАВУ (45°) грань підлогової
  // клітинки під курсором і піднімається ВГОРУ. Координати дробові (точний снеп без
  // зсуву): нижня грань стіни p4-p3 збігається з правою гранню підлоги. Виведено з
  // рівності wallPts(cx,cy)[3]=правий-нижній кут підлоги (множник √2 між ґратками).
  const wallSnapCell = (sx: number, sy: number): { cx: number; cy: number } => {
    const fc = floorCellAt(sx, sy);
    return { cx: (fc.cx + 1) * Math.SQRT2 + fc.cy, cy: -(fc.cx + 2) };
  };
  // Дві екранні точки правої (45°) грані підлогової клітинки — для білої лінії-снепа.
  const floorRightEdge = (cx: number, cy: number): [Pt, Pt] => {
    const gs = state.grid, k = gs * Math.SQRT1_2;
    return [toScreen((cx + 1) * gs + cy * k, cy * k), toScreen((cx + 1) * gs + (cy + 1) * k, (cy + 1) * k)];
  };
  const fillStroke = (pts: Pt[], fill: string | null, stroke: string | null, lw = 1.5): void => {
    ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
  };

  // ── Рівні висоти підлоги (платформи) ──
  // Клітинка зберігається як "cx,cy,h" (рівень 0) або "cx,cy,h,L" (піднята на L).
  // Вертикальна стіна = АВТОМАТИЧНА бічна грань між клітинкою й нижчим сусідом — тож
  // стіна й платформа завжди впритул (один модуль, без √2-розбіжності старих v-стін).
  const levelMaps = (): { present: Set<string>; lvlOf: (cx: number, cy: number) => number } => {
    const present = new Set<string>(); const lvl = new Map<string, number>();
    for (const cell of level().collider) {
      const p = cell.split(','); if ((p[2] ?? 'h') !== 'h') continue;
      const key = p[0] + ',' + p[1]; present.add(key);
      const L = Number(p[3]) || 0; if (L) lvl.set(key, L);
    }
    return { present, lvlOf: (cx, cy) => lvl.get(cx + ',' + cy) ?? 0 };
  };
  // Екранні точки ВЕРХУ клітинки, піднятої на рівень L (висота сходинки = grid у світі).
  const liftedFloorPts = (cx: number, cy: number, L: number): Pt[] => {
    const d = L * state.grid * sc();
    return floorPts(cx, cy).map((pt) => ({ x: pt.x, y: pt.y - d }));
  };
  // Малює підняту клітинку: сині бічні грані (стіни) до КОЖНОГО нижчого сусіда + помаранчевий верх.
  const drawFloorCell = (cx: number, cy: number, L: number, present: Set<string>, lvlOf: (cx: number, cy: number) => number, preview = false): void => {
    const top = liftedFloorPts(cx, cy, L);
    // ребра клітинки [iA,iB] та сусід за ним: back(cy-1), right(cx+1), front(cy+1), left(cx-1)
    const edges: Array<[number, number, number, number]> = [[0, 1, cx, cy - 1], [1, 2, cx + 1, cy], [2, 3, cx, cy + 1], [3, 0, cx - 1, cy]];
    for (const [a, b, nx, ny] of edges) {
      const NL = present.has(nx + ',' + ny) ? lvlOf(nx, ny) : 0;
      if (L > NL) {
        const dd = (L - NL) * state.grid * sc();
        const tA = top[a], tB = top[b];
        const bA = { x: tA.x, y: tA.y + dd }, bB = { x: tB.x, y: tB.y + dd };
        const isPit = L < 0 || NL < 0;
        const wallFill = isPit ? (preview ? 'rgba(255,60,60,0.40)' : 'rgba(255,60,60,0.28)') : (preview ? 'rgba(64,160,255,0.40)' : 'rgba(64,160,255,0.28)');
        const wallStroke = isPit ? 'rgba(255,60,60,0.9)' : 'rgba(64,160,255,0.9)';
        fillStroke([tA, tB, bB, bA], wallFill, wallStroke, preview ? 2 : 1);
      }
    }
    // Верх: піднята платформа — насичений помаранчевий, яма — приглушений, земля — середній.
    const topFill = L > 0 ? 'rgba(255,154,31,0.32)' : 'rgba(255,154,31,0.20)';
    const topStroke = 'rgba(255,154,31,' + (preview ? 0.95 : 0.85) + ')';
    fillStroke(top, topFill, topStroke, preview ? 2 : 1);
    if (L !== 0) {
      const ctr = { x: (top[0].x + top[2].x) / 2, y: (top[0].y + top[2].y) / 2 };
      ctx.fillStyle = 'rgba(255,255,255,0.92)'; ctx.font = 'bold 11px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText((L > 0 ? '↑' : '↓') + Math.abs(L), ctr.x, ctr.y); ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    }
  };

  // Надгробки: id видалених ассетів, щоб синк із GitHub не повертав їх назад.
  const deletedIds = new Set<string>();
  function rememberDeleted(id: string): void { deletedIds.add(id); idbSet('zag_deleted_assets', [...deletedIds]).catch(() => {}); }
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
      const d = await idbGet<string[]>('zag_deleted_assets'); if (d) for (const id of d) deletedIds.add(id);
      if (!a) { try { const s = localStorage.getItem('zag_assets'); if (s) { a = JSON.parse(s) as Asset[]; await idbSet('zag_assets', a); } } catch { /* ignore */ } }
      if (!l) { try { const s = localStorage.getItem('zag_levels'); if (s) { l = JSON.parse(s); await idbSet('zag_levels', l); } } catch { /* ignore */ } }
      if (a) { state.assets = a; for (const as of a) loadImg(as); }
      if (l && l.levels?.length) { state.levels = l.levels; state.cur = l.cur || 0; }
      try { localStorage.removeItem('zag_assets'); localStorage.removeItem('zag_levels'); } catch { /* ignore */ }
    } catch { /* ignore */ }
    const hadLocalLevels = state.levels.length > 0; // capture before async pull (line below adds default)
    // Pull from GitHub in background — merge new assets, update layouts if remote has data
    pullLevelData().then(({ assets: remoteAssets, layouts: remoteLayouts }) => {
      // Рівні виставляємо ПЕРШИМИ — щоб loadImg → draw() вже бачив placed-елементи
      if (remoteLayouts?.levels?.length && !hadLocalLevels) {
        state.levels = remoteLayouts.levels as Level[];
        state.cur = remoteLayouts.cur || 0;
        for (const lv of state.levels) if (typeof lv.grid !== 'number') lv.grid = 48;
        state.grid = level().grid;
        idbSet('zag_levels', { levels: state.levels, cur: state.cur }).catch(() => {});
        refreshLevels();
        draw();
      }
      const remoteFiltered = (remoteAssets ?? []).filter((r) => !deletedIds.has((r as Asset).id));
      const { merged, added } = mergeLevelAssets(state.assets, remoteFiltered);
      if (added > 0) {
        state.assets = merged;
        for (const as of merged.slice(-added)) loadImg(as as Asset);
        idbSet('zag_assets', state.assets).catch(() => {});
        refreshAssets();
        setStatus(`Синхронізовано: +${added} ассетів з GitHub`);
      }
    }).catch(() => {});
    if (!state.levels.length) state.levels = [newLevel('Рівень 1')];
    for (const lv of state.levels) {
      if (!lv.spawn) lv.spawn = { x: 120, y: 0 };
      if (!lv.spawns || !lv.spawns.length) lv.spawns = [{ ...lv.spawn }]; // міграція: один спавн -> масив
      if (!lv.enemySpawns) lv.enemySpawns = []; // міграція: зони спавна ворогів
      if (typeof lv.start !== 'number') lv.start = 0;
      if (typeof lv.end !== 'number') lv.end = 2400;
      if (typeof lv.grid !== 'number') lv.grid = 32; // міграція: всі рівні на gs=32
      ensureParallax(lv); // міграція: добиваємо всі паралакс-шари (хмари/перед.фон/перед.план)
    }
    state.grid = level().grid;
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
    state.levels = o.levels; state.cur = Math.min(o.cur, o.levels.length - 1); state.grid = level().grid; state.selected = null;
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
    return level().placed
      .filter((p) => !state.hiddenCats.has(p.cat)) // «Наповнення» — приховані категорії не малюються/не клікаються
      .sort((a, b) => (LAYER[a.cat] - LAYER[b.cat]) || (level().placed.indexOf(a) - level().placed.indexOf(b)));
  }
  // Світові ізо-клітинки, вирізані футпринтами розміщених ассетів (непрохідні + плановість).
  function collectFootprintCells(): Set<string> {
    const out = new Set<string>(); const gs = state.grid;
    for (const p of level().placed) {
      if (state.hiddenCats.has(p.cat)) continue;
      const a = state.assets.find((x) => x.id === p.asset);
      if (!a?.footprint?.cells.length) continue;
      for (const c of footprintWorldCells(a.footprint, { x: p.x, y: p.y, scale: p.scale, flip: p.flip, rot: p.rot }, p.x, p.y, gs)) out.add(c);
    }
    return out;
  }
  function _drawNow(): void {
    if (!canvas.width) return;
    ctx.imageSmoothingEnabled = !_panning;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const g0 = toScreen(0, 0);
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(0, g0.y); ctx.lineTo(canvas.width, g0.y); ctx.stroke();

    for (const p of placedSorted()) {
      const img = imgOf(p); if (!img) continue;
      const s2 = toScreen(p.x, p.y);
      const dim = state.soloFillCat !== null && p.cat !== state.soloFillCat;
      ctx.save();
      if (dim) ctx.filter = 'grayscale(1)';
      ctx.translate(s2.x, s2.y);
      ctx.rotate(rad(p.rot));
      const kx = p.scale * (p.scaleW ?? 1) * sc(); const ky = p.scale * (p.scaleH ?? 1) * sc();
      ctx.scale(p.flip * kx, ky);
      ctx.drawImage(img, -img.width / 2, -img.height / 2);
      ctx.restore();
      if (p.id === state.selected && !dim) {
        ctx.strokeStyle = '#ffd000'; ctx.lineWidth = 1.5;
        ctx.strokeRect(s2.x - 6, s2.y - 6, 12, 12);
      }
    }
    // Соло-режим: білий оверлей на весь канвас + перемалювати соло-шар зверху
    if (state.soloFillCat !== null) {
      ctx.fillStyle = 'rgba(255,255,255,0.30)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      for (const p of placedSorted()) {
        if (p.cat !== state.soloFillCat) continue;
        const img = imgOf(p); if (!img) continue;
        const s2 = toScreen(p.x, p.y);
        ctx.save();
        ctx.translate(s2.x, s2.y);
        ctx.rotate(rad(p.rot));
        const kx = p.scale * (p.scaleW ?? 1) * sc(); const ky = p.scale * (p.scaleH ?? 1) * sc();
        ctx.scale(p.flip * kx, ky);
        ctx.drawImage(img, -img.width / 2, -img.height / 2);
        ctx.restore();
        if (p.id === state.selected) { ctx.strokeStyle = '#ffd000'; ctx.lineWidth = 1.5; ctx.strokeRect(s2.x - 6, s2.y - 6, 12, 12); }
      }
    }

    if (state.showCollider) {
      const gs = state.grid;
      const { present, lvlOf } = levelMaps(); // shared: floor cells + chamfers
      // Легасі ручні вертикальні стіни (старий формат) — тьмяно; гра їх ІГНОРУЄ.
      for (const cell of level().collider) {
        const p = cell.split(','); if (p[2] !== 'v') continue;
        fillStroke(wallPts(Number(p[0]), Number(p[1])), 'rgba(64,160,255,0.08)', 'rgba(64,160,255,0.30)', 1);
      }
      // Підлога (h) з рівнями висоти ззаду-наперед.
      {
        const cells = level().collider.map((c) => c.split(',')).filter((p) => (p[2] ?? 'h') === 'h')
          .map((p) => ({ cx: Number(p[0]), cy: Number(p[1]), L: Number(p[3]) || 0 }))
          .filter((c) => Number.isFinite(c.cx) && Number.isFinite(c.cy))
          .sort((a, b) => (a.cy - b.cy) || (a.cx - b.cx) || (a.L - b.L));
        for (const { cx, cy, L } of cells) drawFloorCell(cx, cy, L, present, lvlOf);
      }
      // Футпринт-клітинки ассетів — непрохідні (вирізані з підлоги). Помаранчево-червоні.
      {
        const blocked = collectFootprintCells();
        // ghost майбутнього розміщення: pending-ассет із футпринтом під курсором
        const pa = state.pendingAsset ? state.assets.find((x) => x.id === state.pendingAsset) : null;
        if (pa?.footprint?.cells.length) {
          const w = toWorld(state.mouse.x, state.mouse.y);
          for (const c of footprintWorldCells(pa.footprint, { x: w.x, y: w.y, scale: state.pendingScale, flip: state.pendingFlip, rot: state.pendingRot }, w.x, w.y, gs)) blocked.add(c);
        }
        const kf = gs * Math.SQRT1_2;
        const Pp = (ix: number, iy: number) => toScreen(ix * gs + iy * kf, iy * kf);
        // Зелені «прохідні» override-клітинки — перекривають виріз: прибираємо їх з помаранчевого.
        const green = new Set(level().collider.filter((z) => z.split(',')[2] === 'g').map((z) => { const p = z.split(','); return p[0] + ',' + p[1]; }));
        const cellPath = (cx: number, cy: number): void => {
          const a = Pp(cx, cy), b = Pp(cx + 1, cy), c = Pp(cx + 1, cy + 1), d = Pp(cx, cy + 1);
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.lineTo(d.x, d.y); ctx.closePath();
        };
        ctx.fillStyle = 'rgba(255,80,30,0.28)'; ctx.strokeStyle = 'rgba(255,120,40,0.85)'; ctx.lineWidth = 1;
        for (const s of blocked) {
          if (green.has(s)) continue;
          const [cx, cy] = s.split(',').map(Number);
          cellPath(cx, cy); ctx.fill(); ctx.stroke();
        }
        // Зелені override-клітинки поверх усього.
        ctx.fillStyle = 'rgba(60,255,140,0.30)'; ctx.strokeStyle = 'rgba(90,255,160,0.95)'; ctx.lineWidth = 1.5;
        for (const s of green) {
          const [cx, cy] = s.split(',').map(Number);
          cellPath(cx, cy); ctx.fill(); ctx.stroke();
        }
      }
      // Авто-фаски з висотою: трикутник на внутрішньому куті — вершини підняті
      // до висоти суміжних клітинок (мін при спільному куті).
      {
        const kk = gs * Math.SQRT1_2;
        const Pb = (ix: number, iy: number): Pt => toScreen(ix * gs + iy * kk, iy * kk);
        const lift = (pt: Pt, L: number): Pt => ({ x: pt.x, y: pt.y - L * gs * sc() });
        const tri = (a: Pt, b: Pt, c: Pt): void => {
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.closePath();
          ctx.fillStyle = 'rgba(255,154,31,0.22)'; ctx.fill();
          ctx.strokeStyle = 'rgba(255,154,31,0.8)'; ctx.stroke();
        };
        const cand = new Set<string>();
        for (const key of present) {
          const [cx, cy] = key.split(',').map(Number);
          cand.add((cx - 1) + ',' + cy); cand.add((cx + 1) + ',' + cy);
          cand.add(cx + ',' + (cy - 1)); cand.add(cx + ',' + (cy + 1));
        }
        for (const key of cand) {
          if (present.has(key)) continue;
          const [cx, cy] = key.split(',').map(Number);
          const hasL = present.has((cx - 1) + ',' + cy), hasR = present.has((cx + 1) + ',' + cy);
          const hasU = present.has(cx + ',' + (cy - 1)), hasD = present.has(cx + ',' + (cy + 1));
          const p1 = Pb(cx, cy), p2 = Pb(cx + 1, cy), p3 = Pb(cx + 1, cy + 1), p4 = Pb(cx, cy + 1);
          if (hasL && hasU) {
            const lL = lvlOf(cx - 1, cy), lU = lvlOf(cx, cy - 1);
            tri(lift(p1, Math.min(lL, lU)), lift(p2, lU), lift(p4, lL));
          }
          if (hasR && hasD) {
            const lR = lvlOf(cx + 1, cy), lD = lvlOf(cx, cy + 1);
            tri(lift(p2, lR), lift(p3, Math.min(lR, lD)), lift(p4, lD));
          }
        }
      }
    }
    // Зони спавна ворогів — НЕЗАЛЕЖНИЙ тогл (не залежить від показу колайдерів).
    if (state.showEnemySpawns) {
      const gs = state.grid, k2 = gs * Math.SQRT1_2;
      const Pf = (ix: number, iy: number) => toScreen(ix * gs + iy * k2, iy * k2);
      // якщо виставляємо ворога — визначаємо клітинку під курсором для hover-підсвітки
      const mfc = state.pendingEnemy ? floorCellAt(state.mouse.x, state.mouse.y) : null;
      for (const z of level().enemySpawns) {
        const p = z.split(','); const acx = Number(p[0]), acy = Number(p[1]); const enemyId = p[2];
        if (!Number.isFinite(acx) || !Number.isFinite(acy)) continue;
        const hovered = mfc ? (mfc.cx >= acx && mfc.cx <= acx + 2 && mfc.cy >= acy && mfc.cy <= acy + 2) : false;
        const a = Pf(acx, acy), b = Pf(acx + 3, acy), c = Pf(acx + 3, acy + 3), d = Pf(acx, acy + 3);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.lineTo(d.x, d.y); ctx.closePath();
        ctx.fillStyle = hovered ? 'rgba(255,40,40,0.55)' : 'rgba(255,40,40,0.20)'; ctx.fill();
        ctx.strokeStyle = hovered ? 'rgba(255,80,80,1)' : 'rgba(255,40,40,0.9)'; ctx.lineWidth = hovered ? 3 : 2; ctx.stroke();
        const ctr = Pf(acx + 1.5, acy + 1.5);
        const tint = enemyId ? npcTinted.get(enemyId) : null;
        if (tint) { // напівпрозоре червоне зображення виставленого ворога, прив'язане до зони
          const zh = Math.abs(d.y - a.y) * 1.3 || 64;
          const zw = zh * (tint.width / tint.height);
          ctx.globalAlpha = 0.72;
          ctx.drawImage(tint, ctr.x - zw / 2, ctr.y - zh * 0.78, zw, zh);
          ctx.globalAlpha = 1;
        } else {
          ctx.fillStyle = 'rgba(255,40,40,0.95)'; ctx.beginPath(); ctx.arc(ctr.x, ctr.y, 5, 0, Math.PI * 2); ctx.fill();
        }
      }
    }

    // Прев'ю під курсором для активного інструмента — видно ДЕ ляже дія до кліку.
    if (state.pathTool) {
      const c = floorCellAt(state.mouse.x, state.mouse.y);
      const colAt = (cx: number, cy: number, t: string): boolean =>
        level().collider.some((z) => { const p = z.split(','); return Number(p[0]) === cx && Number(p[1]) === cy && (p[2] ?? 'h') === t; });
      const zoneAt = (cx: number, cy: number): string | undefined =>
        level().enemySpawns.find((z) => { const p = z.split(','); const acx = Number(p[0]), acy = Number(p[1]); return cx >= acx && cx <= acx + 2 && cy >= acy && cy <= acy + 2; });
      const bCells = brushCells(c.cx, c.cy);
      if (state.pathTool === 'h') {
        const { present, lvlOf } = levelMaps();
        for (const { cx, cy } of bCells) {
          const pl = present.has(cx + ',' + cy) ? lvlOf(cx, cy) : 0;
          drawFloorCell(cx, cy, pl, present, lvlOf, true);
        }
      } else if (state.pathTool === 'v') {
        const w = wallSnapCell(state.mouse.x, state.mouse.y);
        const [ea, eb] = floorRightEdge(c.cx, c.cy);
        ctx.beginPath(); ctx.moveTo(ea.x, ea.y); ctx.lineTo(eb.x, eb.y); ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.lineWidth = 3; ctx.stroke();
        fillStroke(wallPts(w.cx, w.cy), 'rgba(64,160,255,0.30)', 'rgba(64,160,255,0.95)', 2);
      } else if (state.pathTool === 'erase') {
        const w = wallSnapCell(state.mouse.x, state.mouse.y);
        if (bCells.length === 1) {
          const h = colAt(c.cx, c.cy, 'h'), v = colAt(w.cx, w.cy, 'v');
          if (h) fillStroke(floorPts(c.cx, c.cy), 'rgba(255,60,60,0.30)', 'rgba(255,60,60,0.95)', 2);
          if (v) fillStroke(wallPts(w.cx, w.cy), 'rgba(255,60,60,0.30)', 'rgba(255,60,60,0.95)', 2);
          if (!h && !v) fillStroke(floorPts(c.cx, c.cy), null, 'rgba(255,60,60,0.5)', 1.5);
        } else {
          for (const { cx, cy } of bCells) {
            const has = colAt(cx, cy, 'h');
            fillStroke(floorPts(cx, cy), has ? 'rgba(255,60,60,0.30)' : null, 'rgba(255,60,60,' + (has ? 0.95 : 0.3) + ')', 2);
          }
        }
      } else if (state.pathTool === 'spawn') {
        const col = SPAWN_COLORS[state.spawnSel % SPAWN_COLORS.length];
        ctx.globalAlpha = 0.35; fillStroke(floorPts(c.cx, c.cy), col, null); ctx.globalAlpha = 1;
        fillStroke(floorPts(c.cx, c.cy), null, col, 2.5);
      } else if (state.pathTool === 'enemy' || state.pathTool === 'enemyErase') {
        const hit = zoneAt(c.cx, c.cy);
        if (hit) { const p = hit.split(','); fillStroke(floorPts(Number(p[0]), Number(p[1]), 3, 3), 'rgba(255,40,40,0.30)', 'rgba(255,255,255,0.95)', 2.5); }
        if (state.pathTool === 'enemy') fillStroke(floorPts(c.cx - 1, c.cy - 1, 3, 3), 'rgba(255,40,40,0.18)', 'rgba(255,40,40,0.9)', 2);
      } else if (state.pathTool === 'raise' || state.pathTool === 'lower' || state.pathTool === 'flat') {
        const { present, lvlOf } = levelMaps();
        for (const { cx, cy } of bCells) {
          if (present.has(cx + ',' + cy)) {
            const top = liftedFloorPts(cx, cy, lvlOf(cx, cy));
            fillStroke(top, 'rgba(255,255,255,0.30)', 'rgba(255,255,255,0.95)', 2.5);
          }
        }
      } else if (state.pathTool === 'walk') {
        for (const { cx, cy } of bCells) fillStroke(floorPts(cx, cy), 'rgba(60,255,140,0.30)', 'rgba(90,255,160,0.95)', 2);
      }
    }

    const lv = level();
    if (state.showMarkers) {
      const sx = toScreen(lv.start, 0).x, ex = toScreen(lv.end, 0).x;
      ctx.font = '11px monospace';
      // Початок (зелена) + фініш-лінії КОЖНОГО шару. Рухається тільки лінія карти (lv.end);
      // решта виводяться з її позиції та дальності шару: чим швидший шар, тим далі фініш.
      //   finishX(sf) = (lv.end − кадр)·sf + кадр  →  для карти (sf=1) = lv.end.
      ctx.strokeStyle = '#5aff8f'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, canvas.height); ctx.stroke();
      ctx.fillStyle = '#5aff8f'; ctx.fillText('початок', sx + 3, 14);
      const px = ensureParallax(lv);
      let labelY = 28;
      for (const layer of PARALLAX_LAYERS) {
        const sf = layerScrollFactor(layer, px[layer]);
        const fx = toScreen((lv.end - GAME_VIEW_W) * sf + GAME_VIEW_W, 0).x;
        const col = LAYER_LINE_COLOR[layer] ?? '#9a9a9a';
        ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.setLineDash([6, 5]);
        ctx.beginPath(); ctx.moveTo(fx, 0); ctx.lineTo(fx, canvas.height); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = col; ctx.fillText('фініш ' + PARALLAX_LABEL[layer], fx + 3, labelY); labelY += 14;
      }
      // Карта — головна (червона, єдина перетягувана) лінія кінця.
      ctx.strokeStyle = '#ff6a6a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(ex, 0); ctx.lineTo(ex, canvas.height); ctx.stroke();
      ctx.fillStyle = '#ff6a6a'; ctx.fillText('кінець (карта)', ex + 3, 14);
    }
    if (state.showPlayerSpawns) {
      // Спавни гравця — кольорова підлогова клітинка (без прапорця), номер у центрі.
      const gs = state.grid, k = gs * Math.SQRT1_2;
      lv.spawns.forEach((s, i) => {
        const cx = Math.floor((s.x - s.y) / gs), cy = Math.floor(s.y / k);
        const col = SPAWN_COLORS[i % SPAWN_COLORS.length];
        ctx.globalAlpha = i === state.spawnSel ? 0.5 : 0.32;
        fillStroke(floorPts(cx, cy), col, null); ctx.globalAlpha = 1;
        fillStroke(floorPts(cx, cy), null, col, i === state.spawnSel ? 3 : 1.8);
        const ctr = toScreen((cx + 0.5) * gs + (cy + 0.5) * k, (cy + 0.5) * k);
        ctx.fillStyle = '#000'; ctx.font = 'bold 12px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(String(i + 1), ctr.x, ctr.y);
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      });
    }

    // Білий ghost для pending-ассету: слідує за курсором
    if (state.pendingAsset) {
      const pa = state.assets.find((x) => x.id === state.pendingAsset);
      const pimg = pa ? state.images.get(pa.id) : undefined;
      if (pimg) {
        const mx = state.mouse.x, my = state.mouse.y;
        const k = state.pendingScale * sc();
        ctx.save();
        ctx.globalAlpha = 0.88;
        ctx.filter = 'brightness(1000) saturate(0)'; // всі пікселі → білі, альфа збережена
        ctx.translate(mx, my);
        ctx.rotate(rad(state.pendingRot));
        ctx.scale(state.pendingFlip * k, k);
        ctx.drawImage(pimg, -pimg.width / 2, -pimg.height / 2);
        ctx.restore();
      }
    }

    if (state.pendingEnemy) {
      const pimg = npcImages.get(state.pendingEnemy);
      if (pimg?.complete && pimg.naturalWidth) {
        const mx = state.mouse.x, my = state.mouse.y;
        const gh = 80 * sc();
        const gw = gh * (pimg.naturalWidth / pimg.naturalHeight);
        ctx.save();
        ctx.globalAlpha = 0.88;
        ctx.filter = 'brightness(1000) saturate(0)';
        ctx.drawImage(pimg, mx - gw / 2, my - gh * 0.9, gw, gh);
        ctx.restore();
      }
    }

    if (state.camView) {
      // Game view: 1280×576, floor (Y=0 in editor) at 550/576 from top of game screen.
      // Рамка ЗАВЖДИ по центру по горизонталі — панаруєш світ, бачиш кадр уздовж усього рівня.
      const GAME_H = 576, FLOOR_M = 26;
      const vw = 1280 * sc(); const vh = GAME_H * sc();
      const vx = (canvas.width - vw) / 2;
      const vy = state.origin.y - (GAME_H - FLOOR_M) * sc(); // підлога кадру = лінія підлоги редактора
      const cw = canvas.width; const ch = canvas.height;
      const cx0 = Math.max(0, vx), cy0 = Math.max(0, vy);
      const cx1 = Math.min(cw, vx + vw), cy1 = Math.min(ch, vy + vh);
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      if (cy0 > 0) ctx.fillRect(0, 0, cw, cy0);
      if (cy1 < ch) ctx.fillRect(0, cy1, cw, ch - cy1);
      if (cx0 > 0) ctx.fillRect(0, cy0, cx0, cy1 - cy0);
      if (cx1 < cw) ctx.fillRect(cx1, cy0, cw - cx1, cy1 - cy0);
      ctx.strokeStyle = '#ff9a1f'; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
      ctx.strokeRect(vx, vy, vw, vh); // справжній кадр 20:9 (canvas обріже зайве, пропорції не псуються)
      ctx.setLineDash([]);
    }
  }
  function draw(): void {
    if (_drawRaf) return;
    _drawRaf = requestAnimationFrame(() => { _drawRaf = 0; _drawNow(); });
  }

  const _alphaCache = new Map<HTMLImageElement, Uint8ClampedArray>();
  function _alphaAt(img: HTMLImageElement, lx: number, ly: number): number {
    const px = Math.round(lx + img.width / 2);
    const py = Math.round(ly + img.height / 2);
    if (px < 0 || px >= img.width || py < 0 || py >= img.height) return 0;
    let data = _alphaCache.get(img);
    if (!data) {
      try {
        const cv = document.createElement('canvas');
        cv.width = img.width; cv.height = img.height;
        const c = cv.getContext('2d')!;
        c.drawImage(img, 0, 0);
        data = c.getImageData(0, 0, img.width, img.height).data;
      } catch { data = new Uint8ClampedArray(0); }
      _alphaCache.set(img, data);
    }
    return data[(py * img.width + px) * 4 + 3] ?? 0;
  }
  function hitTest(sx: number, sy: number): string | null {
    const list = placedSorted().filter(p => state.soloFillCat === null || p.cat === state.soloFillCat);
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i]; const img = imgOf(p); if (!img) continue;
      const o = toScreen(p.x, p.y);
      const ang = rad(-p.rot); const dx = sx - o.x, dy = sy - o.y;
      const k = p.scale * sc();
      let lx = (dx * Math.cos(ang) - dy * Math.sin(ang)) / k; const ly = (dx * Math.sin(ang) + dy * Math.cos(ang)) / k;
      if (p.flip < 0) lx = -lx;
      if (Math.abs(lx) <= img.width / 2 && Math.abs(ly) <= img.height / 2 && _alphaAt(img, lx, ly) > 10) return p.id;
    }
    return null;
  }
  const sel = (): Placed | undefined => level().placed.find((p) => p.id === state.selected);

  function addLevel(): void {
    pushUndo();
    state.levels.push(newLevel(`Рівень ${state.levels.length + 1}`));
    state.cur = state.levels.length - 1; state.grid = level().grid; state.selected = null; refreshLevels(); draw(); save();
  }
  function refreshLevels(): void {
    const makeCard = (lv: Level, i: number): HTMLDivElement => {
      const el = document.createElement('div');
      el.className = 'lvCard' + (i === state.cur ? ' sel' : '');
      const nm = document.createElement('div'); nm.textContent = lv.name; el.appendChild(nm);
      el.onclick = () => { state.cur = i; state.grid = state.levels[i].grid; state.selected = null; refreshLevels(); draw(); save(); };
      el.ondblclick = () => { const n = prompt('Назва рівня:', lv.name); if (n) { lv.name = n; refreshLevels(); save(); } };
      if (state.levels.length > 1) {
        const x = document.createElement('button'); x.className = 'lvDel'; x.textContent = '×';
        x.onclick = (e) => {
          e.stopPropagation(); pushUndo(); state.levels.splice(i, 1);
          if (state.cur >= state.levels.length) state.cur = state.levels.length - 1;
          state.grid = level().grid; state.selected = null; refreshLevels(); draw(); save();
        };
        el.appendChild(x);
      }
      return el;
    };
    const box = $('levelList'); box.innerHTML = '';
    state.levels.forEach((lv, i) => box.appendChild(makeCard(lv, i)));
    const empties = Math.max(0, 9 - state.levels.length);
    for (let i = 0; i < empties; i++) {
      const e = document.createElement('div'); e.className = 'lvCard empty';
      e.onclick = () => addLevel(); box.appendChild(e);
    }
    // Мобільна смуга рівнів
    const bar = $<HTMLElement>('levelBarList');
    if (bar) {
      bar.innerHTML = '';
      state.levels.forEach((lv, i) => bar.appendChild(makeCard(lv, i)));
    }
    refreshParallaxUI();
  }
  $<HTMLButtonElement>('addLevel').addEventListener('click', addLevel);
  $<HTMLButtonElement>('levelBarAdd')?.addEventListener('click', addLevel);

  // ── Паралакс: перемикач шару (циклює всі 5) + слайдер «Дальність» ──
  // Дальність 0..1 регулює швидкість скролу шару в грі. Фонові (небо/хмари/задній/перед.фон):
  // 0 — як карта, 1 — нерухоме. Передній план: 0 — як карта, 1 — удвічі швидше за карту.
  let parallaxLayer: ParallaxLayer = 'bg';
  function refreshParallaxUI(): void {
    const px = ensureParallax(level());
    const sel = $<HTMLSelectElement>('parallaxLayer');
    const sl = $<HTMLInputElement>('parallaxSlider');
    const val = $('parallaxVal');
    if (sel) sel.value = parallaxLayer;
    const v = px[parallaxLayer];
    if (sl) sl.value = String(v);
    if (val) val.textContent = v.toFixed(2);
  }
  $<HTMLSelectElement>('parallaxLayer')?.addEventListener('change', () => {
    const sel = $<HTMLSelectElement>('parallaxLayer');
    if (PARALLAX_LAYERS.includes(sel.value as ParallaxLayer)) parallaxLayer = sel.value as ParallaxLayer;
    refreshParallaxUI();
  });
  $<HTMLInputElement>('parallaxSlider')?.addEventListener('input', () => {
    const sl = $<HTMLInputElement>('parallaxSlider');
    const px = ensureParallax(level());
    const v = Number(sl.value);
    px[parallaxLayer] = v;
    const val = $('parallaxVal'); if (val) val.textContent = v.toFixed(2);
    save();
  });

  function refreshCatSelect(): void {
    $<HTMLSelectElement>('libSelect').value = state.cat;
    const ct = $('colliderTools'); if (ct) ct.style.display = 'none'; // path tools moved to bottom toolbar
    $('libGrid').style.display = 'flex';
  }
  // Інлайн-ренейм ассета: підпис картки → текстове поле.
  function startRename(nm: HTMLElement, a: Asset): void {
    const inp = document.createElement('input');
    inp.value = a.name;
    inp.style.cssText = 'position:absolute;bottom:0;left:0;right:0;width:100%;font-size:10px;padding:2px 3px;background:#1b1b1b;color:#fff;border:1px solid var(--accent);border-radius:0 0 7px 7px;outline:none;z-index:3';
    nm.replaceWith(inp); inp.focus(); inp.select();
    let done = false;
    const commit = (sv: boolean): void => { if (done) return; done = true; const v = inp.value.trim(); if (sv && v) { a.name = v; save(); } refreshAssets(); };
    inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); commit(true); } else if (e.key === 'Escape') { e.preventDefault(); commit(false); } });
    inp.addEventListener('blur', () => commit(true));
    inp.addEventListener('click', (e) => e.stopPropagation());
    inp.addEventListener('mousedown', (e) => e.stopPropagation());
  }
  let _libLastTap = { id: '', time: 0 };
  function refreshAssets(): void {
    const box = $('libGrid'); box.innerHTML = '';
    const cats = state.assets.filter((x) => x.cat === state.cat);
    for (const a of cats) {
      const el = document.createElement('div'); el.className = 'libCard';
      const img = document.createElement('img'); img.src = a.url; img.draggable = false;
      const nm = document.createElement('div'); nm.className = 'libName'; nm.textContent = a.name;
      const del = document.createElement('button'); del.className = 'libDel'; del.textContent = '×';
      del.addEventListener('click', (ev) => {
        ev.stopPropagation(); ev.preventDefault();
        rememberDeleted(a.id);
        state.assets = state.assets.filter((x) => x.id !== a.id);
        for (const lv of state.levels) lv.placed = lv.placed.filter((p) => p.asset !== a.id);
        if (state.selected && !level().placed.find((p) => p.id === state.selected)) state.selected = null;
        refreshAssets(); refreshSel(); draw(); save();
      });
      el.appendChild(img); el.appendChild(nm); el.appendChild(del);
      if (a.footprint?.cells.length) { const dot = document.createElement('div'); dot.className = 'fpDot'; dot.title = 'має колайдери'; el.appendChild(dot); }
      el.addEventListener('contextmenu', (ev) => { ev.preventDefault(); ev.stopPropagation(); openFootprintEditor(a); });
      el.addEventListener('dblclick', (ev) => { ev.preventDefault(); ev.stopPropagation(); openFootprintEditor(a); });
      // Перетягування картки в AI-поле (реф) — несемо id ассета.
      el.draggable = true;
      el.addEventListener('dragstart', (ev) => { (ev as DragEvent).dataTransfer?.setData('text/asset-id', a.id); });
      // Клік колесом (середня) — ренейм ассета інлайн.
      el.addEventListener('mousedown', (ev) => { if (ev.button === 1) { ev.preventDefault(); ev.stopPropagation(); startRename(nm, a); } });
      el.addEventListener('auxclick', (ev) => { if (ev.button === 1) ev.preventDefault(); });
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const same = state.pendingAsset === a.id;
        state.pendingAsset = same ? null : a.id;
        if (!same) { state.pendingRot = 0; state.pendingScale = 1; state.pendingFlip = 1; state.pendingTransMode = null; state.pathTool = null; updatePathBtns(); }
        $('libGrid').querySelectorAll('.libCard').forEach((c) => c.classList.remove('pending'));
        if (state.pendingAsset) el.classList.add('pending');
        draw();
      });
      el.addEventListener('touchend', (ev) => {
        ev.preventDefault();
        const now = Date.now();
        if (now - _libLastTap.time < 300 && _libLastTap.id === a.id) {
          _libLastTap = { id: '', time: 0 };
          openFootprintEditor(a); return;
        }
        _libLastTap = { id: a.id, time: now };
        const same = state.pendingAsset === a.id;
        state.pendingAsset = same ? null : a.id;
        if (!same) { state.pendingRot = 0; state.pendingScale = 1; state.pendingFlip = 1; state.pendingTransMode = null; state.pathTool = null; updatePathBtns(); }
        $('libGrid').querySelectorAll('.libCard').forEach((c) => c.classList.remove('pending'));
        if (state.pendingAsset) el.classList.add('pending');
        draw();
      }, { passive: false });
      box.appendChild(el);
    }
    const empties = Math.max(6, 30 - cats.length);
    for (let i = 0; i < empties; i++) {
      const e = document.createElement('div'); e.className = 'libCard empty';
      e.addEventListener('click', () => $<HTMLInputElement>('fileInput').click());
      e.addEventListener('dragover', (ev) => { ev.preventDefault(); ev.dataTransfer!.dropEffect = 'copy'; e.style.borderColor = 'var(--accent)'; });
      e.addEventListener('dragleave', () => { e.style.borderColor = ''; });
      e.addEventListener('drop', (ev) => {
        ev.preventDefault(); e.style.borderColor = '';
        const files = Array.from(ev.dataTransfer?.files ?? []);
        for (const f of files) {
          toWebP(f, CAT_MAX_PX[state.cat] ?? 1024).then((url) => {
            if (!url) return;
            const a: Asset = { id: 'a' + Date.now() + Math.round(performance.now()), cat: state.cat, name: f.name.replace(/\.[^.]+$/, ''), url };
            state.assets.push(a); loadImg(a); refreshAssets(); save();
          });
        }
      });
      box.appendChild(e);
    }
  }
  const CAT_MAX_PX: Record<string, number> = { sky: 2048, clouds: 2048, bg: 2048, frontbg: 2048, map: 2048, foreground: 2048 }; // решта — 1024
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

  // ── Вікно футпринта (колайдери ассета) — ПКМ по картці ──
  const fp = {
    asset: null as Asset | null,
    cells: new Set<string>(),
    tool: 'paint' as 'paint' | 'erase',
    zoom: 1,
    panX: 0, panY: 0,
    painting: false,
    panning: false, panStart: { mx: 0, my: 0, px: 0, py: 0 },
    wired: false,
  };
  function openFootprintEditor(a: Asset): void {
    if (!state.images.get(a.id)) loadImg(a);
    fp.asset = a;
    fp.cells = new Set((a.footprint?.cells ?? []).map((c) => c.dx + ',' + c.dy));
    fp.zoom = 1; fp.tool = 'paint'; fp.panX = 0; fp.panY = 0;
    const modal = document.getElementById(prefix + 'fpModal') as HTMLElement;
    const backdrop = document.getElementById(prefix + 'fpBackdrop') as HTMLElement;
    const title = document.getElementById(prefix + 'fpTitle');
    if (title) title.textContent = 'Колайдери: ' + a.name;
    // Вікно центруємо у вьюпорті (зручно і на десктопі, і на мобільному)
    const vw = window.innerWidth, vh = window.innerHeight;
    const mw = Math.min(560, vw - 24), mh = Math.min(480, vh - 48);
    modal.style.left = Math.round((vw - mw) / 2) + 'px';
    modal.style.top = Math.round((vh - mh) / 2) + 'px';
    modal.style.width = mw + 'px'; modal.style.height = mh + 'px';
    modal.style.display = 'flex'; backdrop.style.display = 'block';
    fpWire();
    fpSyncToolBtns();
    requestAnimationFrame(fpRender);
  }
  function fpClose(saveIt: boolean): void {
    if (saveIt && fp.asset) {
      const cells = [...fp.cells].map((s) => { const [dx, dy] = s.split(',').map(Number); return { dx, dy }; });
      fp.asset.footprint = cells.length ? { cells } : undefined;
      save(); refreshAssets(); draw();
    }
    fp.asset = null; fp.painting = false;
    (document.getElementById(prefix + 'fpModal') as HTMLElement).style.display = 'none';
    (document.getElementById(prefix + 'fpBackdrop') as HTMLElement).style.display = 'none';
  }
  function fpSyncToolBtns(): void {
    document.getElementById(prefix + 'fpPaint')?.classList.toggle('light', fp.tool === 'paint');
    document.getElementById(prefix + 'fpErase')?.classList.toggle('light', fp.tool === 'erase');
  }
  function fpCanvas(): HTMLCanvasElement { return document.getElementById(prefix + 'fpCanvas') as HTMLCanvasElement; }
  function fpMetrics(cv: HTMLCanvasElement) {
    const img = fp.asset ? state.images.get(fp.asset.id) : undefined;
    const cx = cv.width * 0.5 + fp.panX, cy = cv.height * 0.55 + fp.panY;
    const ds = (img ? Math.min(cv.width * 0.5 / img.width, cv.height * 0.5 / img.height) : 1) * fp.zoom;
    return { img, cx, cy, ds };
  }
  function fpCellAt(mx: number, my: number): { dx: number; dy: number } | null {
    const cv = fpCanvas(); const { cx, cy, ds } = fpMetrics(cv);
    const gs = state.grid, k = gs * Math.SQRT1_2;
    const lx = (mx - cx) / ds, ly = (my - cy) / ds;
    return { dx: Math.floor((lx - ly) / gs), dy: Math.floor(ly / k) };
  }
  function fpRender(): void {
    if (!fp.asset) return;
    const cv = fpCanvas();
    if (cv.width !== cv.clientWidth || cv.height !== cv.clientHeight) { cv.width = cv.clientWidth; cv.height = cv.clientHeight; }
    const g = cv.getContext('2d')!;
    g.clearRect(0, 0, cv.width, cv.height);
    const { img, cx, cy, ds } = fpMetrics(cv);
    const gs = state.grid, k = gs * Math.SQRT1_2;
    const S = (wx: number, wy: number) => ({ x: cx + wx * ds, y: cy + wy * ds });
    const P = (ix: number, iy: number) => S(ix * gs + iy * k, iy * k);
    if (img) { g.drawImage(img, cx - img.width * ds / 2, cy - img.height * ds / 2, img.width * ds, img.height * ds); }
    // Намальовані непрохідні клітинки (без фонової сітки/якоря — лише сам ассет + зони)
    g.fillStyle = 'rgba(255,60,60,.42)'; g.strokeStyle = 'rgba(255,90,90,.95)'; g.lineWidth = 1.5;
    for (const s of fp.cells) {
      const [dx, dy] = s.split(',').map(Number);
      const a = P(dx, dy), b = P(dx + 1, dy), c = P(dx + 1, dy + 1), d = P(dx, dy + 1);
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.lineTo(c.x, c.y); g.lineTo(d.x, d.y); g.closePath();
      g.fill(); g.stroke();
    }
  }
  function fpPaintAt(mx: number, my: number): void {
    const c = fpCellAt(mx, my); if (!c) return;
    const key = c.dx + ',' + c.dy;
    if (fp.tool === 'paint') fp.cells.add(key); else fp.cells.delete(key);
    fpRender();
  }
  function fpWire(): void {
    if (fp.wired) return; fp.wired = true;
    const cv = fpCanvas();
    document.getElementById(prefix + 'fpPaint')?.addEventListener('click', () => { fp.tool = 'paint'; fpSyncToolBtns(); });
    document.getElementById(prefix + 'fpErase')?.addEventListener('click', () => { fp.tool = 'erase'; fpSyncToolBtns(); });
    document.getElementById(prefix + 'fpClear')?.addEventListener('click', () => { fp.cells.clear(); fpRender(); });
    document.getElementById(prefix + 'fpDone')?.addEventListener('click', () => fpClose(true));
    document.getElementById(prefix + 'fpBackdrop')?.addEventListener('click', () => fpClose(true));
    cv.addEventListener('mousedown', (e) => {
      const r = cv.getBoundingClientRect(); const mx = e.clientX - r.left, my = e.clientY - r.top;
      if (e.button === 1) { e.preventDefault(); fp.panning = true; fp.panStart = { mx, my, px: fp.panX, py: fp.panY }; return; } // середня — панорама
      if (e.button !== 0) return;
      fp.painting = true; fpPaintAt(mx, my);
    });
    cv.addEventListener('mousemove', (e) => {
      const r = cv.getBoundingClientRect(); const mx = e.clientX - r.left, my = e.clientY - r.top;
      if (fp.panning) { fp.panX = fp.panStart.px + (mx - fp.panStart.mx); fp.panY = fp.panStart.py + (my - fp.panStart.my); fpRender(); return; }
      if (fp.painting) fpPaintAt(mx, my);
    });
    cv.addEventListener('auxclick', (e) => { if (e.button === 1) e.preventDefault(); }); // глушимо авто-скрол середньої
    window.addEventListener('mouseup', () => { fp.painting = false; fp.panning = false; });
    cv.addEventListener('wheel', (e) => { e.preventDefault(); fp.zoom = Math.min(4, Math.max(0.3, fp.zoom * (e.deltaY < 0 ? 1.1 : 0.9))); fpRender(); }, { passive: false });
    window.addEventListener('keydown', (e) => { if (fp.asset && e.key === 'Escape') fpClose(true); });
    // Touch: 2-finger = pan, double-tap+drag = zoom
    let _fpTouchPanActive = false;
    let _fpTouchPanStart = { mx: 0, my: 0, px: 0, py: 0 };
    let _fpLastTap = 0;
    let _fpZoomMode = false;
    let _fpZoomStartY = 0;
    let _fpZoomStart = 1;
    const _fpcpos = (t: Touch) => { const r = cv.getBoundingClientRect(); return { x: t.clientX - r.left, y: t.clientY - r.top }; };
    cv.addEventListener('touchstart', (ev) => {
      ev.preventDefault();
      if (ev.touches.length === 1) {
        const now = Date.now(); const { x, y } = _fpcpos(ev.touches[0]);
        if (now - _fpLastTap < 300) {
          _fpZoomMode = true; _fpZoomStartY = y; _fpZoomStart = fp.zoom;
          _fpTouchPanActive = false; _fpLastTap = 0; return;
        }
        _fpLastTap = now; _fpZoomMode = false; _fpTouchPanActive = false;
        fp.painting = true; fpPaintAt(x, y);
      } else if (ev.touches.length === 2) {
        fp.painting = false; _fpZoomMode = false;
        const p1 = _fpcpos(ev.touches[0]), p2 = _fpcpos(ev.touches[1]);
        const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
        _fpTouchPanActive = true;
        _fpTouchPanStart = { mx, my, px: fp.panX, py: fp.panY };
      }
    }, { passive: false });
    cv.addEventListener('touchmove', (ev) => {
      ev.preventDefault();
      if (_fpZoomMode && ev.touches.length === 1) {
        const { y } = _fpcpos(ev.touches[0]);
        fp.zoom = Math.min(4, Math.max(0.3, _fpZoomStart * Math.pow(1.8, (_fpZoomStartY - y) / 150)));
        fpRender();
      } else if (_fpTouchPanActive && ev.touches.length === 2) {
        const p1 = _fpcpos(ev.touches[0]), p2 = _fpcpos(ev.touches[1]);
        const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
        fp.panX = _fpTouchPanStart.px + (mx - _fpTouchPanStart.mx);
        fp.panY = _fpTouchPanStart.py + (my - _fpTouchPanStart.my);
        _fpTouchPanStart = { mx, my, px: fp.panX, py: fp.panY };
        fpRender();
      } else if (!_fpTouchPanActive && ev.touches.length === 1 && fp.painting) {
        const { x, y } = _fpcpos(ev.touches[0]); fpPaintAt(x, y);
      }
    }, { passive: false });
    cv.addEventListener('touchend', (ev) => {
      ev.preventDefault();
      fp.painting = false;
      if (ev.touches.length === 0) { _fpTouchPanActive = false; _fpZoomMode = false; }
    }, { passive: false });
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
  $<HTMLButtonElement>('mirrorBtn')?.addEventListener('click', () => { const p = sel(); if (p) { pushUndo(); p.flip *= -1; draw(); save(); } });
  $<HTMLButtonElement>('delBtn')?.addEventListener('click', deleteSel);
  function deleteSel(): void { const p = sel(); if (!p) return; pushUndo(); level().placed = level().placed.filter((x) => x !== p); state.selected = null; refreshSel(); draw(); save(); }

  const snapBtn = $<HTMLButtonElement>('snapBtn');
  snapBtn?.addEventListener('click', () => {
    state.snap = !state.snap;
    snapBtn.classList.toggle('on', state.snap);
  });
  $<HTMLInputElement>('grid')?.addEventListener('input', (e) => { state.grid = Number((e.target as HTMLInputElement).value); const gv = $('gridV'); if (gv) gv.textContent = (e.target as HTMLInputElement).value; draw(); });
  $<HTMLButtonElement>('paintBtn')?.addEventListener('click', () => { state.colliderTool = 'paint'; $('paintBtn').classList.add('on'); $('eraseBtn').classList.remove('on'); });
  $<HTMLButtonElement>('eraseBtn')?.addEventListener('click', () => { state.colliderTool = 'erase'; $('eraseBtn').classList.add('on'); $('paintBtn').classList.remove('on'); });
  $<HTMLButtonElement>('clearCollider')?.addEventListener('click', () => { level().collider = []; level().enemySpawns = []; draw(); save(); });
  const pathBtnIds = ['pathHBtn', 'pathVBtn', 'erasePathBtn', 'enemySpawnBtn', 'enemyEraseBtn'] as const;
  const pathBtnTools: Record<string, 'h' | 'v' | 'erase' | 'enemy' | 'enemyErase'> = { pathHBtn: 'h', pathVBtn: 'v', erasePathBtn: 'erase', enemySpawnBtn: 'enemy', enemyEraseBtn: 'enemyErase' };
  for (const id of pathBtnIds) {
    $<HTMLButtonElement>(id)?.addEventListener('click', () => {
      const tool = pathBtnTools[id];
      state.pathTool = state.pathTool === tool ? null : tool;
      updatePathBtns();
    });
  }
  // Стіни тепер автоматичні (бічні грані піднятих клітинок) — ручний «Вертикальний шлях»
  // більше не потрібен. Ховаємо кнопку; стирання легасі-стін лишається через «Видалити».
  $('pathVBtn')?.style.setProperty('display', 'none');
  // «Плановість» — заголовок, що згортає/розгортає тогл Фонова/Ігрова
  const planToggle = $<HTMLButtonElement>('planToggle');
  const planPanel = $<HTMLElement>('planPanel');
  if (planToggle && planPanel) {
    planPanel.style.display = 'none'; // звернуто за замовчуванням
    planToggle.addEventListener('click', () => {
      const open = planPanel.style.display === 'none';
      planPanel.style.display = open ? '' : 'none';
      planToggle.classList.toggle('on', open);
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
    $('raiseBtn')?.classList.toggle('on', state.pathTool === 'raise');
    $('lowerBtn')?.classList.toggle('on', state.pathTool === 'lower');
    $('flatBtn')?.classList.toggle('on', state.pathTool === 'flat');
    $('walkBtn')?.classList.toggle('on', state.pathTool === 'walk');
    $('enemySpawnBtn')?.classList.toggle('on', state.pathTool === 'enemy');
    $('enemyEraseBtn')?.classList.toggle('on', state.pathTool === 'enemyErase');
    $('addSpawn')?.classList.toggle('on', state.pathTool === 'spawn');
  }
  $<HTMLButtonElement>('raiseBtn')?.addEventListener('click', () => { state.pathTool = state.pathTool === 'raise' ? null : 'raise'; updatePathBtns(); setStatus(state.pathTool ? 'Підняти: тапни/тягни на клітинку' : ''); draw(); });
  $<HTMLButtonElement>('lowerBtn')?.addEventListener('click', () => { state.pathTool = state.pathTool === 'lower' ? null : 'lower'; updatePathBtns(); setStatus(state.pathTool ? 'Опустити: тапни/тягни на клітинку' : ''); draw(); });
  $<HTMLButtonElement>('flatBtn')?.addEventListener('click', () => { state.pathTool = state.pathTool === 'flat' ? null : 'flat'; updatePathBtns(); setStatus(state.pathTool ? 'Вирівняти: тапни/тягни на клітинку' : ''); draw(); });
  $<HTMLButtonElement>('walkBtn')?.addEventListener('click', () => { state.pathTool = state.pathTool === 'walk' ? null : 'walk'; updatePathBtns(); setStatus(state.pathTool ? 'Зелений колайдер (прохідність): малюй поверх вирізу ассета. Колесо — пензель' : ''); draw(); });
  let drag: { x: number; y: number; ox: number; oy: number } | null = null;
  let panning = false; let panStart = { mx: 0, my: 0, px: 0, py: 0 };
  let painting = false;
  // brushCells: всі клітинки в квадраті brushSize×brushSize навколо (cx,cy).
  function brushCells(cx: number, cy: number): Array<{ cx: number; cy: number }> {
    const s = state.brushSize, r = Math.floor((s - 1) / 2);
    const cells: Array<{ cx: number; cy: number }> = [];
    for (let dy = -r; dy < s - r; dy++) for (let dx = -r; dx < s - r; dx++) cells.push({ cx: cx + dx, cy: cy + dy });
    return cells;
  }
  const strokeCells = new Set<string>(); // клітинки, вже зачеплені поточним штрихом (щоб драг не множив +1)
  function paintAt(sx: number, sy: number): void {
    if (!state.pathTool) return;
    const fl = floorCellAt(sx, sy);
    const wl = wallSnapCell(sx, sy);
    const lv = level();
    const matchV = (p: string[]): boolean => Number(p[0]) === wl.cx && Number(p[1]) === wl.cy && p[2] === 'v';
    if (state.pathTool === 'v') {
      lv.collider = lv.collider.filter((z) => !matchV(z.split(',')));
      lv.collider.push(`${wl.cx},${wl.cy},v`);
    } else {
      for (const cell of brushCells(fl.cx, fl.cy)) {
        const matchH = (p: string[]): boolean => Number(p[0]) === cell.cx && Number(p[1]) === cell.cy && (p[2] ?? 'h') === 'h';
        const matchG = (p: string[]): boolean => Number(p[0]) === cell.cx && Number(p[1]) === cell.cy && p[2] === 'g';
        if (state.pathTool === 'erase') {
          lv.collider = lv.collider.filter((z) => { const p = z.split(','); return !(matchH(p) || matchG(p) || (cell.cx === fl.cx && cell.cy === fl.cy && matchV(p))); });
        } else if (state.pathTool === 'walk') {
          // Зелений колайдер: примусово прохідна клітинка, що перекриває авто-виріз футпринта ассета.
          if (!lv.collider.some((z) => matchG(z.split(',')))) lv.collider.push(`${cell.cx},${cell.cy},g`);
        } else if (state.pathTool === 'h') {
          const existing = lv.collider.find((z) => matchH(z.split(',')));
          const keepL = existing ? (Number(existing.split(',')[3]) || 0) : 0;
          lv.collider = lv.collider.filter((z) => !matchH(z.split(',')));
          lv.collider.push(keepL !== 0 ? `${cell.cx},${cell.cy},h,${keepL}` : `${cell.cx},${cell.cy},h`);
        } else if (state.pathTool === 'raise' || state.pathTool === 'lower' || state.pathTool === 'flat') {
          const key = cell.cx + ',' + cell.cy;
          if (!strokeCells.has(key)) {
            strokeCells.add(key);
            const L = setCellLevel(cell.cx, cell.cy, state.pathTool);
            if (L !== null && state.brushSize === 1) setStatus(`Висота клітинки: ${L}`);
          }
        }
      }
    }
    draw();
  }
  // Змінити РІВЕНЬ ВИСОТИ наявної підлогової клітинки (cx,cy). Не створює нову.
  // 'raise' +1 / 'lower' −1 (від'ємні = яма) / 'flat' = 0. Повертає новий рівень або null.
  function setCellLevel(cx: number, cy: number, mode: 'raise' | 'lower' | 'flat'): number | null {
    const lv = level();
    const idx = lv.collider.findIndex((z) => { const p = z.split(','); return Number(p[0]) === cx && Number(p[1]) === cy && (p[2] ?? 'h') === 'h'; });
    if (idx < 0) return null;
    let L = Number(lv.collider[idx].split(',')[3]) || 0;
    L = mode === 'raise' ? L + 1 : mode === 'lower' ? L - 1 : 0;
    lv.collider[idx] = L !== 0 ? `${cx},${cy},h,${L}` : `${cx},${cy},h`;
    return L;
  }
  // Поставити вибраний спавн гравця на підлогову клітинку під курсором (центр клітинки).
  function placeSpawnAt(sx: number, sy: number): void {
    const c = floorCellAt(sx, sy); const gs = state.grid, k = gs * Math.SQRT1_2;
    const lv = level();
    lv.spawns[state.spawnSel] = { x: (c.cx + 0.5) * gs + (c.cy + 0.5) * k, y: (c.cy + 0.5) * k };
    lv.spawn = lv.spawns[0];
    draw();
  }
  // Зона спавна ворогів — 3×3 підлогових клітинки, центровані на клітинці під курсором.
  function enemyAt(sx: number, sy: number): void {
    const w = toWorld(sx, sy); const gs = state.grid; const k = gs * Math.SQRT1_2;
    const fcx = Math.floor((w.x - w.y) / gs), fcy = Math.floor(w.y / k); // підлогова клітинка під курсором
    if (!Number.isFinite(fcx) || !Number.isFinite(fcy)) return; // вироджений канвас — не писати биті анкери
    const lv = level();
    if (state.pathTool === 'enemyErase') {
      lv.enemySpawns = lv.enemySpawns.filter((z) => {
        const p = z.split(','); const acx = Number(p[0]), acy = Number(p[1]);
        return !(fcx >= acx && fcx <= acx + 2 && fcy >= acy && fcy <= acy + 2);
      });
    } else {
      const key = (fcx - 1) + ',' + (fcy - 1); // 3×3 з центром на клітинці курсора
      if (!lv.enemySpawns.includes(key)) lv.enemySpawns.push(key);
    }
    draw();
  }
  canvas.addEventListener('mousedown', (ev) => {
    const x = ev.offsetX, y = ev.offsetY;
    if (ev.button === 1) { ev.preventDefault(); panning = true; panStart = { mx: x, my: y, px: state.pan.x, py: state.pan.y }; return; }
    const lv0 = level();
    const MHIT = 9;
    const startSx = toScreen(lv0.start, 0).x;
    const endSx = toScreen(lv0.end, 0).x;
    if (Math.abs(x - startSx) < MHIT) { pushUndo(); state.markerDrag = 'start'; return; }
    if (Math.abs(x - endSx) < MHIT) { pushUndo(); state.markerDrag = 'end'; return; }
    // Клік по кольоровій клітинці спавна (без інструмента) — вибрати цей спавн.
    if (!state.pathTool && !state.mode) {
      const cc = floorCellAt(x, y); const gs0 = state.grid, k0 = gs0 * Math.SQRT1_2;
      const si = lv0.spawns.findIndex((s) => Math.floor((s.x - s.y) / gs0) === cc.cx && Math.floor(s.y / k0) === cc.cy);
      if (si >= 0) { state.spawnSel = si; refreshSpawnUI(); draw(); return; }
    }
    // Pending-ворог: ЛКМ виставляє ворога у зону спавна під курсором
    if (ev.button === 0 && state.pendingEnemy) {
      const w = toWorld(x, y); const gs = state.grid, k = gs * Math.SQRT1_2;
      const fcx = Math.floor((w.x - w.y) / gs), fcy = Math.floor(w.y / k);
      const lv = level();
      const idx = lv.enemySpawns.findIndex((z) => { const p = z.split(','); const acx = Number(p[0]), acy = Number(p[1]); return fcx >= acx && fcx <= acx + 2 && fcy >= acy && fcy <= acy + 2; });
      if (idx >= 0) {
        pushUndo();
        const p = lv.enemySpawns[idx].split(',');
        lv.enemySpawns[idx] = `${Number(p[0])},${Number(p[1])},${state.pendingEnemy}`;
        save(); draw(); setStatus('Ворога виставлено'); return;
      }
      // клік поза зоною — скасувати
      state.pendingEnemy = null;
      $('npcList')?.querySelectorAll('.npcCard').forEach((c) => c.classList.remove('pending'));
      draw(); return;
    }
    // Pending-ассет: ЛКМ підтверджує transform-режим або розміщує ассет
    if (ev.button === 0 && !state.pathTool && state.pendingAsset) {
      if (state.pendingTransMode) { state.pendingTransMode = null; draw(); return; }
      const pa = state.assets.find((a) => a.id === state.pendingAsset);
      if (pa) {
        pushUndo();
        const w = toWorld(x, y);
        const p: Placed = { id: 'p' + Date.now(), cat: pa.cat, asset: pa.id, x: w.x, y: w.y, rot: state.pendingRot, scale: state.pendingScale, flip: state.pendingFlip };
        level().placed.push(p); state.selected = p.id;
        state.pendingAsset = null; state.pendingRot = 0; state.pendingScale = 1; state.pendingFlip = 1; state.pendingTransMode = null;
        $('libGrid')?.querySelectorAll('.libCard').forEach((c) => c.classList.remove('pending'));
        refreshSel(); draw(); save(); return;
      }
    }
    if (state.mode) { state.mode = null; state.orig = null; save(); return; }
    if (state.pathTool === 'spawn') { pushUndo(); placeSpawnAt(x, y); save(); refreshSpawnUI(); return; } // спавн — дискретно, по кліку
    if (state.pathTool === 'enemy' || state.pathTool === 'enemyErase') { pushUndo(); enemyAt(x, y); save(); return; } // зони — дискретно, по кліку
    if (state.pathTool) { pushUndo(); painting = true; strokeCells.clear(); paintAt(x, y); return; }
    const hit = hitTest(x, y);
    state.selected = hit;
    if (hit) { pushUndo(); const p = sel()!; drag = { x, y, ox: p.x, oy: p.y }; }
    refreshSel(); draw();
  });
  window.addEventListener('mousemove', (ev) => {
    const r = canvas.getBoundingClientRect();
    state.mouse = { x: ev.clientX - r.left, y: ev.clientY - r.top };
    if (panning) { state.pan.x = panStart.px + (state.mouse.x - panStart.mx); state.pan.y = panStart.py + (state.mouse.y - panStart.my); applyOrigin(); draw(); return; }
    if (state.markerDrag) {
      const w = toWorld(state.mouse.x, state.mouse.y); const lv = level();
      if (state.markerDrag === 'start') lv.start = w.x;
      else if (state.markerDrag === 'end') lv.end = w.x;
      else { lv.spawns[state.spawnSel] = { x: w.x, y: w.y }; lv.spawn = lv.spawns[0]; }
      draw(); return;
    }
    if (painting) { paintAt(state.mouse.x, state.mouse.y); return; }
    if (state.mode) { applyMode(); return; }
    if (state.pendingAsset && state.pendingTransMode) {
      const dx = state.mouse.x - state.startWx;
      if (state.pendingTransMode === 'R') state.pendingRot = dx * 0.8;
      else state.pendingScale = Math.max(0.1, Math.min(10, 1 + dx / 120));
      draw(); return;
    }
    if (drag) { const p = sel(); if (p) { p.x = drag.ox + (state.mouse.x - drag.x) / sc(); p.y = drag.oy + (state.mouse.y - drag.y) / sc(); draw(); } }
    else if (state.pathTool || state.pendingAsset || state.pendingEnemy) draw(); // оновити прев'ю інструмента або ghost під курсором
  });
  window.addEventListener('mouseup', () => { if (drag || painting || state.markerDrag) save(); drag = null; panning = false; painting = false; state.markerDrag = null; });

  // Touch support: 1 finger = draw/interact, 2 fingers = pan + pinch-zoom
  {
    let touchPanActive = false;
    let touchPanStart = { mx: 0, my: 0, px: 0, py: 0 };
    let pinchDist = 0;
    let singleTouchDown = false;
    const cpos = (t: Touch): { x: number; y: number } => {
      const r = canvas.getBoundingClientRect();
      return { x: t.clientX - r.left, y: t.clientY - r.top };
    };
    canvas.addEventListener('touchstart', (ev) => {
      ev.preventDefault();
      if (ev.touches.length === 1) {
        singleTouchDown = true; touchPanActive = false;
        const { x, y } = cpos(ev.touches[0]);
        state.mouse = { x, y };
        const lv0 = level();
        const MHIT = 18;
        if (Math.abs(x - toScreen(lv0.start, 0).x) < MHIT) { pushUndo(); state.markerDrag = 'start'; return; }
        if (Math.abs(x - toScreen(lv0.end, 0).x) < MHIT) { pushUndo(); state.markerDrag = 'end'; return; }
        if (!state.pathTool && !state.mode && state.pendingAsset) {
          const a = state.assets.find(a => a.id === state.pendingAsset);
          if (a) {
            pushUndo();
            const w = toWorld(x, y);
            const p: Placed = { id: 'p' + Date.now(), cat: a.cat, asset: a.id, x: w.x, y: w.y, rot: state.pendingRot, scale: state.pendingScale, flip: state.pendingFlip };
            level().placed.push(p); state.selected = p.id;
            state.pendingAsset = null; state.pendingRot = 0; state.pendingScale = 1; state.pendingFlip = 1; state.pendingTransMode = null;
            $('libGrid')?.querySelectorAll('.libCard').forEach((c) => c.classList.remove('pending'));
            refreshSel(); draw(); save(); return;
          }
        }
        if (state.mode) return; // touchmove відстежує позицію, touchend підтверджує
        if (state.pathTool === 'spawn') { pushUndo(); placeSpawnAt(x, y); save(); refreshSpawnUI(); return; }
        if (state.pathTool === 'enemy' || state.pathTool === 'enemyErase') { pushUndo(); enemyAt(x, y); save(); return; }
        if (state.pathTool) { pushUndo(); painting = true; strokeCells.clear(); paintAt(x, y); return; }
        const hit = hitTest(x, y);
        state.selected = hit;
        if (hit) { pushUndo(); const p = sel()!; drag = { x, y, ox: p.x, oy: p.y }; }
        refreshSel(); draw();
      } else if (ev.touches.length === 2) {
        singleTouchDown = false;
        if (drag || painting || state.markerDrag) save();
        drag = null; painting = false; state.markerDrag = null;
        const p1 = cpos(ev.touches[0]), p2 = cpos(ev.touches[1]);
        pinchDist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
        touchPanActive = true; _panning = true;
        touchPanStart = { mx, my, px: state.pan.x, py: state.pan.y };
      }
    }, { passive: false });
    canvas.addEventListener('touchmove', (ev) => {
      ev.preventDefault();
      if (ev.touches.length === 1 && singleTouchDown && !touchPanActive) {
        const { x, y } = cpos(ev.touches[0]);
        state.mouse = { x, y };
        if (state.mode) { applyMode(); draw(); return; }
        if (state.markerDrag) {
          const w = toWorld(x, y); const lv = level();
          if (state.markerDrag === 'start') lv.start = w.x;
          else if (state.markerDrag === 'end') lv.end = w.x;
          else { lv.spawns[state.spawnSel] = { x: w.x, y: w.y }; lv.spawn = lv.spawns[0]; }
          draw(); return;
        }
        if (painting) { paintAt(x, y); return; }
        if (drag) { const p = sel(); if (p) { p.x = drag.ox + (x - drag.x) / sc(); p.y = drag.oy + (y - drag.y) / sc(); draw(); } return; }
        if (state.pathTool) draw();
      } else if (ev.touches.length === 2 && touchPanActive) {
        const p1 = cpos(ev.touches[0]), p2 = cpos(ev.touches[1]);
        const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
        const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        state.pan.x = touchPanStart.px + (mx - touchPanStart.mx);
        state.pan.y = touchPanStart.py + (my - touchPanStart.my);
        if (pinchDist > 0) state.zoom = Math.min(3, Math.max(0.15, state.zoom * dist / pinchDist));
        pinchDist = dist;
        touchPanStart = { mx, my, px: state.pan.x, py: state.pan.y };
        applyOrigin(); resize(); draw();
      }
    }, { passive: false });
    canvas.addEventListener('touchend', (ev) => {
      ev.preventDefault();
      if (ev.touches.length === 0) {
        if (singleTouchDown && state.mode) { state.mode = null; state.orig = null; save(); }
        else if (singleTouchDown && (drag || painting || state.markerDrag)) save();
        drag = null; painting = false; state.markerDrag = null;
        singleTouchDown = false; touchPanActive = false; pinchDist = 0;
        _panning = false; draw();
      } else if (ev.touches.length === 1 && touchPanActive) {
        touchPanActive = false; pinchDist = 0; singleTouchDown = true;
        _panning = false; draw();
        const { x, y } = cpos(ev.touches[0]);
        state.mouse = { x, y };
      }
    }, { passive: false });
  }

  canvas.addEventListener('contextmenu', (e) => { e.preventDefault(); if (state.mode) { const p = sel(); if (p && state.orig) Object.assign(p, state.orig); state.mode = null; state.orig = null; draw(); } });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (state.pendingAsset) {
      state.pendingScale = Math.max(0.1, Math.min(10, state.pendingScale * (e.deltaY < 0 ? 1.1 : 0.9)));
      draw(); return;
    }
    if (['h', 'erase', 'raise', 'lower', 'flat', 'walk'].includes(state.pathTool ?? '')) {
      state.brushSize = Math.max(1, Math.min(9, state.brushSize + (e.deltaY < 0 ? 1 : -1)));
      setStatus(`Пензель: ${state.brushSize}×${state.brushSize}`);
      draw();
    } else {
      state.zoom = Math.min(3, Math.max(0.15, state.zoom * (e.deltaY < 0 ? 1.1 : 0.9))); resize(); draw();
    }
  }, { passive: false });

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
    if (ev.code === 'KeyG' || ev.code === 'KeyR' || ev.code === 'KeyS') {
      ev.preventDefault();
      if (state.pendingAsset) {
        if (ev.code === 'KeyG') { // скасувати розміщення
          state.pendingAsset = null; state.pendingRot = 0; state.pendingScale = 1; state.pendingFlip = 1; state.pendingTransMode = null;
          $('libGrid')?.querySelectorAll('.libCard').forEach((c) => c.classList.remove('pending'));
          draw();
        } else { // R або S: увімкнути/вимкнути transform-режим ghost
          const m = ev.code === 'KeyR' ? 'R' : 'S';
          state.pendingTransMode = state.pendingTransMode === m ? null : m;
          state.startWx = state.mouse.x;
          if (state.pendingTransMode === null && m === 'R') state.pendingRot = 0;
          if (state.pendingTransMode === null && m === 'S') state.pendingScale = 1;
          draw();
        }
      } else { startMode(ev.code === 'KeyG' ? 'G' : ev.code === 'KeyR' ? 'R' : 'S'); }
    }
    else if (ev.code === 'KeyD' && ev.shiftKey) {
      ev.preventDefault();
      const p = sel();
      if (p) {
        pushUndo();
        const copy: Placed = { ...p, id: 'p' + Date.now() + Math.round(performance.now()) };
        level().placed.push(copy); state.selected = copy.id;
        refreshSel(); draw(); save(); startMode('G');
      }
    }
    else if (ev.code === 'KeyH') { ev.preventDefault(); state.pathTool = state.pathTool === 'h' ? null : 'h'; updatePathBtns(); if (state.pathTool === 'h') setStatus('Підлога (земля). Наведи на клітинку: 1 вище / 2 нижче / 3 вирівняти — стіни малюються самі'); }
    // Висотні інструменти: 1 підняти / 2 опустити / 3 вирівняти. Клавіша лише АКТИВУЄ режим —
    // далі наводиш на колайдер (підсвічується білим) і клікаєш/тягнеш ЛКМ, щоб застосувати.
    else if (ev.code === 'Digit1') { ev.preventDefault(); state.pathTool = state.pathTool === 'raise' ? null : 'raise'; updatePathBtns(); setStatus(state.pathTool ? 'Підняти: наведи на колайдер і клікай/тягни ЛКМ' : ''); draw(); }
    else if (ev.code === 'Digit2') { ev.preventDefault(); state.pathTool = state.pathTool === 'lower' ? null : 'lower'; updatePathBtns(); setStatus(state.pathTool ? 'Опустити: наведи на колайдер і клікай/тягни ЛКМ' : ''); draw(); }
    else if (ev.code === 'Digit3') { ev.preventDefault(); state.pathTool = state.pathTool === 'flat' ? null : 'flat'; updatePathBtns(); setStatus(state.pathTool ? 'Вирівняти: наведи на колайдер і клікай/тягни ЛКМ' : ''); draw(); }
    else if (ev.code === 'Digit4') { ev.preventDefault(); state.pathTool = state.pathTool === 'walk' ? null : 'walk'; updatePathBtns(); setStatus(state.pathTool ? 'Зелений колайдер (прохідність): малюй поверх вирізу ассета. Колесо — пензель' : ''); draw(); }
    else if (ev.code === 'KeyY') { ev.preventDefault(); state.pathTool = state.pathTool === 'erase' ? null : 'erase'; updatePathBtns(); }
    else if (ev.code === 'KeyM') {
      ev.preventDefault();
      if (state.pendingAsset) { state.pendingFlip *= -1; draw(); }
      else { const p = sel(); if (p) { pushUndo(); p.flip *= -1; draw(); save(); } }
    }
    else if (ev.code === 'KeyJ') { ev.preventDefault(); if (state.snap) snapToEdge(); }
    else if (ev.code === 'Delete' || ev.code === 'Backspace') { ev.preventDefault(); deleteSel(); }
    else if (ev.code === 'Escape') {
      if (state.pendingEnemy) {
        state.pendingEnemy = null;
        $('npcList')?.querySelectorAll('.npcCard').forEach((c) => c.classList.remove('pending'));
        draw();
      } else if (state.pendingAsset) {
        state.pendingAsset = null; state.pendingRot = 0; state.pendingScale = 1; state.pendingFlip = 1; state.pendingTransMode = null;
        $('libGrid')?.querySelectorAll('.libCard').forEach((c) => c.classList.remove('pending'));
        draw();
      } else if (state.mode) { const p = sel(); if (p && state.orig) Object.assign(p, state.orig); state.mode = null; state.orig = null; state.axisLock = null; draw(); }
      else if (state.pathTool) { state.pathTool = null; updatePathBtns(); }
    }
  });

  $<HTMLSelectElement>('libSelect').addEventListener('change', (e) => {
    state.cat = (e.target as HTMLSelectElement).value;
    refreshCatSelect(); refreshAssets();
  });

  function snapCamView(): void {
    // Вписуємо ВЕСЬ кадр 1280×576 у canvas (letterbox) — щоб зберегти 20:9,
    // а не обрізати по ширині (тоді рамка здавалась квадратною).
    const GAME_W = 1280, GAME_H = 576, FLOOR_M = 26, margin = 0.96;
    const vs = state.viewScale;
    state.zoom = Math.min(canvas.width / (GAME_W * vs), canvas.height / (GAME_H * vs)) * margin;
    const s = vs * state.zoom;
    const vw = GAME_W * s, vh = GAME_H * s;
    const frameLeft = (canvas.width - vw) / 2;
    const frameTop = (canvas.height - vh) / 2;
    // Підлога редактора (Y=0) → де реально підлога гри: (GAME_H-FLOOR_M)/GAME_H від верху кадру.
    state.pan.y = frameTop + (GAME_H - FLOOR_M) * s - canvas.height * 0.6;
    // Лівий край кадру = початок рівня (camera bound left).
    state.pan.x = frameLeft - canvas.width * 0.35 - level().start * s;
    applyOrigin();
  }
  $<HTMLButtonElement>('camViewBtn').addEventListener('click', () => {
    state.camView = !state.camView;
    $('camViewBtn').classList.toggle('on', state.camView);
    if (state.camView) snapCamView();
    draw();
  });

  // tabChar — navigate back to char editor (standalone only; no-op when element doesn't exist in studio)
  document.getElementById(prefix + 'tabChar')?.addEventListener('click', () => {
    if (window.self !== window.top) window.parent.postMessage('backToStudio', '*');
    else window.location.href = 'studio.html';
  });

  // Шлях до гри: веб → index.html; Android-APK (Capacitor) → game.html (index.html там — меню).
  const gameUrl = (window as unknown as { Capacitor?: unknown }).Capacitor ? 'game.html' : 'index.html';

  // «Грати» — запустити саму гру (зручно перевіряти після оновлення; standalone level.html)
  document.getElementById(prefix + 'playGame')?.addEventListener('click', () => {
    window.location.href = gameUrl;
  });

  // Preview expand/collapse — same behaviour as char editor
  const lvPreviewBox = $<HTMLElement>('preview');
  const lvPreviewFrame = $<HTMLIFrameElement>('previewFrame');
  // У APK iframe із src="index.html" показав би меню — перенацілюємо на гру.
  if (lvPreviewFrame && (window as unknown as { Capacitor?: unknown }).Capacitor) lvPreviewFrame.src = gameUrl;
  const lvPreviewBackdrop = document.createElement('div');
  lvPreviewBackdrop.style.cssText = 'display:none;position:fixed;inset:0;z-index:99;cursor:pointer;';
  document.body.appendChild(lvPreviewBackdrop);
  let lvPreviewBig = false;
  function refitLvGame(): void {
    const fire = (): void => { try { (lvPreviewFrame?.contentWindow as unknown as { __zagRefit?: () => void })?.__zagRefit?.(); } catch { /* */ } };
    requestAnimationFrame(fire); setTimeout(fire, 120); setTimeout(fire, 320);
  }
  function setLvPreviewBig(on: boolean): void {
    lvPreviewBig = on;
    const pc = $<HTMLElement>('previewClick');
    if (on && lvPreviewBox) {
      // Розгортання відносно правого верхнього кута (клас .big: position:fixed; top:8px; right:8px).
      // Ширина = від правого краю бібліотеки до правого краю вікна (як у редакторі персонажів).
      const lib = $<HTMLElement>('library').getBoundingClientRect();
      const w = Math.max(360, window.innerWidth - 8 - (lib.right + 12));
      lvPreviewBox.classList.add('big');
      lvPreviewBox.style.width = w + 'px';
      lvPreviewBox.style.height = Math.round((w * 9) / 20) + 'px';
      if (pc) pc.style.pointerEvents = 'none';
      lvPreviewBackdrop.style.display = 'block';
      lvPreviewFrame?.contentWindow?.focus();
    } else if (lvPreviewBox) {
      lvPreviewBox.classList.remove('big');
      lvPreviewBox.style.width = ''; lvPreviewBox.style.height = '';
      if (pc) pc.style.pointerEvents = '';
      lvPreviewBackdrop.style.display = 'none';
    }
    refitLvGame();
  }
  lvPreviewBackdrop.addEventListener('click', () => setLvPreviewBig(false));
  $('previewClick')?.addEventListener('click', () => setLvPreviewBig(!lvPreviewBig));
  $('previewClick')?.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    lvPreviewFrame?.contentWindow?.focus();
    if (lvPreviewBox) {
      lvPreviewBox.style.boxShadow = '0 0 0 2px var(--accent)';
      const restore = (): void => { if (lvPreviewBox) lvPreviewBox.style.boxShadow = ''; window.removeEventListener('focus', restore); };
      window.addEventListener('focus', restore);
    }
  }); // ПКМ — активувати без розгортання
  window.addEventListener('keydown', (e) => { if (e.code === 'Escape' && lvPreviewBig) setLvPreviewBig(false); });
  window.addEventListener('resize', () => { if (lvPreviewBig) setLvPreviewBig(true); });

  const showColliderBtn = $<HTMLButtonElement>('showColliderBtn');
  showColliderBtn?.addEventListener('click', () => {
    state.showCollider = !state.showCollider;
    showColliderBtn.classList.toggle('on', state.showCollider);
    draw();
  });
  const bwBtn = $<HTMLButtonElement>('bwBtn');
  let bwOn = false;
  bwBtn?.addEventListener('click', () => {
    bwOn = !bwOn;
    bwBtn.classList.toggle('on', bwOn);
    if (lvPreviewFrame) lvPreviewFrame.style.filter = bwOn ? 'grayscale(1)' : '';
  });
  const linesBtn = $<HTMLButtonElement>('linesBtn');
  linesBtn?.addEventListener('click', () => {
    state.showMarkers = !state.showMarkers;
    linesBtn.classList.toggle('on', state.showMarkers);
    draw();
  });
  const enemySpawnsBtn = $<HTMLButtonElement>('enemySpawnsViewBtn');
  enemySpawnsBtn?.addEventListener('click', () => {
    state.showEnemySpawns = !state.showEnemySpawns;
    enemySpawnsBtn.classList.toggle('on', state.showEnemySpawns);
    draw();
  });
  const playerSpawnsBtn = $<HTMLButtonElement>('playerSpawnsViewBtn');
  playerSpawnsBtn?.addEventListener('click', () => {
    state.showPlayerSpawns = !state.showPlayerSpawns;
    playerSpawnsBtn.classList.toggle('on', state.showPlayerSpawns);
    draw();
  });
  const constructorBtn = $<HTMLButtonElement>('constructorBtn');
  constructorBtn?.addEventListener('click', () => constructorBtn.classList.toggle('on', toggleConstructor()));

  // ── Наповнення: flyout категорій у вьюпорті; клік ховає/вертає об'єкти категорії ──
  const fillMenu = $<HTMLElement>('fillMenu');
  let fillOpen = false;
  function buildFillMenu(): void {
    if (!fillMenu) return;
    fillMenu.innerHTML = '';
    for (const c of CATS) {
      const b = document.createElement('button');
      const isSolo = state.soloFillCat === c.key;
      const isBlocked = state.soloFillCat !== null && !isSolo;
      b.className = 'fillBtn' + (state.hiddenCats.has(c.key) ? ' off' : '') + (isSolo ? ' solo' : '') + (isBlocked ? ' blocked' : '');
      b.textContent = c.label;
      b.onclick = () => {
        if (state.hiddenCats.has(c.key)) state.hiddenCats.delete(c.key); else state.hiddenCats.add(c.key);
        b.classList.toggle('off', state.hiddenCats.has(c.key));
        draw();
      };
      b.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        state.soloFillCat = state.soloFillCat === c.key ? null : c.key;
        buildFillMenu(); buildFillLayersPanel(); draw();
      });
      fillMenu.appendChild(b);
    }
  }
  function buildFillLayersPanel(): void {
    const fl = $<HTMLElement>('fillLayers');
    if (!fl) return;
    fl.innerHTML = '';
    for (const c of CATS) {
      const b = document.createElement('button');
      const isSolo = state.soloFillCat === c.key;
      const isBlocked = state.soloFillCat !== null && !isSolo;
      b.className = 'fillBtn' + (state.hiddenCats.has(c.key) ? ' off' : '') + (isSolo ? ' solo' : '') + (isBlocked ? ' blocked' : '');
      b.textContent = c.label;
      b.onclick = () => {
        if (state.hiddenCats.has(c.key)) state.hiddenCats.delete(c.key); else state.hiddenCats.add(c.key);
        b.classList.toggle('off', state.hiddenCats.has(c.key));
        draw();
      };
      b.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        state.soloFillCat = state.soloFillCat === c.key ? null : c.key;
        buildFillLayersPanel(); buildFillMenu(); draw();
      });
      fl.appendChild(b);
    }
  }
  $<HTMLButtonElement>('fillBtn')?.addEventListener('click', () => {
    const fl = $<HTMLElement>('fillLayers');
    if (!fl) return;
    const open = fl.style.display === 'none';
    fl.style.display = open ? 'flex' : 'none';
    if (open) buildFillLayersPanel();
    $('fillBtn')?.classList.toggle('on', open);
  });
  $<HTMLButtonElement>('fillBtn')?.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    fillOpen = !fillOpen;
    if (fillMenu) {
      if (fillOpen) { buildFillMenu(); positionFillMenu(); }
      fillMenu.style.display = fillOpen ? 'flex' : 'none';
    }
  });
  window.addEventListener('levelTabDeactivated', () => {
    if (fillOpen && fillMenu) { fillOpen = false; fillMenu.style.display = 'none'; $('fillBtn')?.classList.remove('on'); }
  });
  // Список «Наповнення» — у правій частині вьюпорта: ширина як таб «Історія» (B5),
  // верх врівень з верхом прев'ю (де хелсбари HUD), висота обмежена до верху нижньої
  // панелі — щоб довгий список (10 категорій) не накладався на тулбар.
  function positionFillMenu(): void {
    if (!fillMenu) return;
    const b5 = document.querySelectorAll('#topTabs button')[4] as HTMLElement | undefined;
    const preview = $('preview'); // lv-preview — зверху хелсбари гри; вирівнюємо меню по його верху
    const toolbar = $('levelToolbar'); // нижня панель — нижня межа меню
    const stage = canvas.getBoundingClientRect();
    const w = b5?.offsetWidth || 170;
    const top = preview ? preview.getBoundingClientRect().top : stage.top + 16;
    const botLimit = toolbar ? toolbar.getBoundingClientRect().top - 8 : window.innerHeight - 8;
    fillMenu.style.position = 'fixed';
    fillMenu.style.left = (stage.right - w - 16) + 'px';
    fillMenu.style.right = 'auto';
    fillMenu.style.bottom = 'auto';
    fillMenu.style.top = top + 'px';
    fillMenu.style.width = w + 'px';
    fillMenu.style.flexDirection = 'column';
    fillMenu.style.maxHeight = Math.max(120, botLimit - top) + 'px';
    fillMenu.style.overflowY = 'auto';
  }

  // ── Згортувані секції правої панелі ──
  function wireSection(headId: string, bodyId: string): void {
    const h = $(headId), b = $<HTMLElement>(bodyId);
    if (!h || !b) return;
    h.addEventListener('click', () => {
      const open = b.style.display === 'none';
      b.style.display = open ? '' : 'none';
      h.classList.toggle('open', open);
    });
  }
  wireSection('secLevels', 'bodyLevels');
  wireSection('secSettings', 'bodySettings');
  wireSection('secNpc', 'bodyNpc');

  // ── Неігрові персонажі: бібліотека ворогів (drag → зона спавна) ──
  let npcCatVal: 'enemy' | 'neutral' = 'enemy';
  const npcEnemyBtn = $<HTMLButtonElement>('npcEnemyBtn');
  const npcNeutralBtn = $<HTMLButtonElement>('npcNeutralBtn');
  const npcList = $<HTMLElement>('npcList');
  function buildNpcTint(item: LibItem): void { // червона тонована мініатюра для оверлея на зоні
    if (!item.thumb || npcTinted.has(item.id)) return;
    const img = new Image();
    img.onload = () => {
      const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
      const c = cv.getContext('2d'); if (!c) return;
      c.drawImage(img, 0, 0);
      c.globalCompositeOperation = 'source-atop'; // тонувати лише непрозорі пікселі
      c.fillStyle = 'rgba(220,30,30,0.72)'; c.fillRect(0, 0, cv.width, cv.height);
      npcTinted.set(item.id, cv); draw();
    };
    img.src = item.thumb;
  }
  function setNpcCat(cat: 'enemy' | 'neutral'): void {
    npcCatVal = cat;
    npcEnemyBtn?.classList.toggle('on', cat === 'enemy');
    npcNeutralBtn?.classList.toggle('on', cat === 'neutral');
    renderNpc();
  }
  npcEnemyBtn?.addEventListener('click', () => setNpcCat('enemy'));
  npcNeutralBtn?.addEventListener('click', () => setNpcCat('neutral'));

  function renderNpc(): void {
    if (!npcList) return;
    npcList.innerHTML = '';
    if (npcCatVal === 'neutral') {
      const e = document.createElement('div'); e.className = 'npcEmpty'; e.textContent = 'Нейтрали — поки заглушка'; npcList.appendChild(e); return;
    }
    const enemies = npcLib.filter((x) => x.cat === 'enemy');
    if (!enemies.length) {
      const e = document.createElement('div'); e.className = 'npcEmpty';
      e.textContent = 'Немає ворогів. Створи персонажа з категорією «Ворог» у редакторі персонажів.';
      npcList.appendChild(e); return;
    }
    for (const it of enemies) {
      buildNpcTint(it);
      // передзавантажити зображення для ghost
      if (it.thumb && !npcImages.has(it.id)) {
        const img = new Image(); img.src = it.thumb; npcImages.set(it.id, img);
      }
      const card = document.createElement('div'); card.className = 'npcCard'; card.title = it.name; card.draggable = true;
      if (state.pendingEnemy === it.id) card.classList.add('pending');
      if (it.thumb) { const im = document.createElement('img'); im.src = it.thumb; card.appendChild(im); }
      const nm = document.createElement('div'); nm.className = 'npcName'; nm.textContent = it.name; card.appendChild(nm);
      card.addEventListener('dragstart', (e) => { (e as DragEvent).dataTransfer?.setData('text/enemy-id', it.id); });
      card.addEventListener('click', () => {
        const active = state.pendingEnemy === it.id;
        state.pendingEnemy = active ? null : it.id;
        npcList.querySelectorAll('.npcCard').forEach((c) => c.classList.remove('pending'));
        if (!active) card.classList.add('pending');
        draw();
      });
      npcList.appendChild(card);
    }
  }
  loadCharLibrary().then((lib) => { npcLib = lib; renderNpc(); }).catch(() => {});

  // Drag ворога з бібліотеки → призначити зоні спавна під курсором.
  canvas.addEventListener('dragover', (e) => e.preventDefault());
  canvas.addEventListener('drop', (e) => {
    e.preventDefault();
    const id = (e as DragEvent).dataTransfer?.getData('text/enemy-id');
    if (!id) return;
    const w = toWorld((e as DragEvent).offsetX, (e as DragEvent).offsetY);
    const gs = state.grid, k = gs * Math.SQRT1_2;
    const fcx = Math.floor((w.x - w.y) / gs), fcy = Math.floor(w.y / k);
    const lv = level();
    const idx = lv.enemySpawns.findIndex((z) => { const p = z.split(','); const acx = Number(p[0]), acy = Number(p[1]); return fcx >= acx && fcx <= acx + 2 && fcy >= acy && fcy <= acy + 2; });
    if (idx < 0) { setStatus('Кинь на червону зону спавна'); return; }
    pushUndo();
    const p = lv.enemySpawns[idx].split(',');
    lv.enemySpawns[idx] = `${Number(p[0])},${Number(p[1])},${id}`;
    save(); draw(); setStatus('Ворога призначено зоні');
  });

  // ── Плановість: перемикач Фонова / Ігрова ──
  function setPlanMode(mode: 'bg' | 'game'): void {
    $('planBgBtn')?.classList.toggle('on', mode === 'bg');
    $('planGameBtn')?.classList.toggle('on', mode === 'game');
    const bg = $('planBg'), gm = $('planGame');
    if (bg) bg.style.display = mode === 'bg' ? 'flex' : 'none';
    if (gm) gm.style.display = mode === 'game' ? 'flex' : 'none';
  }
  $('planBgBtn')?.addEventListener('click', () => setPlanMode('bg'));
  $('planGameBtn')?.addEventListener('click', () => setPlanMode('game'));

  // z-порядок вибраного об'єкта у межах його категорії (Фонова плановість)
  function reorderSel(kind: 'forward' | 'back' | 'front' | 'bottom'): void {
    const p = sel(); if (!p) return;
    const arr = level().placed;
    // sky/bg/map (tier 0-2) — переставляємо лише в межах своєї категорії.
    // decor/interactive/trap та інші (tier 3) — спільний пул, вільно між собою.
    const tier = LAYER[p.cat] ?? 3;
    const group = tier <= 2 ? arr.filter((x) => x.cat === p.cat) : arr.filter((x) => (LAYER[x.cat] ?? 3) >= 3);
    const k = group.indexOf(p);
    let nk = k;
    if (kind === 'forward') nk = Math.min(group.length - 1, k + 1);
    else if (kind === 'back') nk = Math.max(0, k - 1);
    else if (kind === 'front') nk = group.length - 1;
    else nk = 0;
    if (nk === k) return;
    pushUndo();
    group.splice(k, 1); group.splice(nk, 0, p);
    // Вписуємо оновлений порядок групи назад у arr
    let gi = 0;
    if (tier <= 2) {
      for (let i = 0; i < arr.length; i++) if (arr[i].cat === p.cat) arr[i] = group[gi++];
    } else {
      for (let i = 0; i < arr.length; i++) if ((LAYER[arr[i].cat] ?? 3) >= 3) arr[i] = group[gi++];
    }
    draw(); save();
  }
  $('zForward')?.addEventListener('click', () => reorderSel('forward'));
  $('zBack')?.addEventListener('click', () => reorderSel('back'));
  $('zFront')?.addEventListener('click', () => reorderSel('front'));
  $('zBottom')?.addEventListener('click', () => reorderSel('bottom'));


  // ── керування точками спавна (до 5, різнокольорові) — кнопки в нижній панелі ──
  function refreshSpawnUI(): void {
    const lv = level();
    state.spawnSel = Math.max(0, Math.min(state.spawnSel, lv.spawns.length - 1));
    const info = document.getElementById(prefix + 'spawnInfo');
    if (info) { info.textContent = `спавн ${state.spawnSel + 1}/${lv.spawns.length}`; (info as HTMLElement).style.color = SPAWN_COLORS[state.spawnSel % SPAWN_COLORS.length]; }
  }
  function wireSpawnControls(): void {
    $('addSpawn')?.addEventListener('click', () => {
      const lv = level();
      // Якщо інструмент уже активний — просто вимкнути (тогл).
      if (state.pathTool === 'spawn') { state.pathTool = null; updatePathBtns(); draw(); return; }
      if (lv.spawns.length >= 5) { setStatus('Максимум 5 точок спавна'); return; }
      pushUndo(); const w = toWorld(canvas.width / 2, state.origin.y);
      lv.spawns.push({ x: Math.round(w.x), y: 0 }); lv.spawn = lv.spawns[0];
      state.spawnSel = lv.spawns.length - 1;
      state.pathTool = 'spawn'; updatePathBtns(); // одразу режим розставляння — тицьни на колайдер
      save(); refreshSpawnUI(); draw();
      setStatus(`Тицьни на колайдер — там зʼявиться спавн ${state.spawnSel + 1}`);
    });
    $('delSpawn')?.addEventListener('click', () => {
      const lv = level(); if (lv.spawns.length <= 1) { setStatus('Має лишитись хоча б 1 спавн'); return; }
      pushUndo(); lv.spawns.splice(state.spawnSel, 1);
      state.spawnSel = Math.min(state.spawnSel, lv.spawns.length - 1); lv.spawn = lv.spawns[0];
      save(); refreshSpawnUI(); draw();
    });
    refreshSpawnUI();
  }

  function buildLevelDoc(): unknown {
    const lv = level();
    const used = state.assets.filter((a) => lv.placed.some((p) => p.asset === a.id));
    return { name: lv.name, placed: lv.placed, collider: lv.collider, enemySpawns: lv.enemySpawns, grid: state.grid, spawn: lv.spawns[0] ?? lv.spawn, spawns: lv.spawns, start: lv.start, end: lv.end, parallax: ensureParallax(lv), assets: used };
  }
  $<HTMLButtonElement>('saveLevelBtn')?.addEventListener('click', () => {
    idbSet('zag_level', buildLevelDoc())
      .then(() => setStatus('✔ Рівень збережено в гру'))
      .catch(() => setStatus('✗ Помилка збереження'));
  });
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
  $<HTMLButtonElement>('mobSave')?.addEventListener('click', () => $<HTMLButtonElement>('saveLevelBtn')?.click());
  $<HTMLButtonElement>('mobPublish')?.addEventListener('click', () => $<HTMLButtonElement>('toGame')?.click());

  // Висоту тулбару/AI-панелей задає ЄДИНИЙ писар у rig/main.ts через CSS-змінну
  // --panel-h (вимірює видимий таймлайн і застосовує до всіх панелей). Тут лише
  // ре-рендер канви при зміні видимості/розміру.
  window.addEventListener('levelTabActivated', () => { resize(); draw(); });
  window.addEventListener('resize', () => { resize(); draw(); });

  load().then(() => {
    resize(); refreshLevels(); refreshCatSelect(); refreshAssets(); refreshSel(); draw();
    wireSpawnControls();
    showColliderBtn?.classList.toggle('on', state.showCollider);
    snapBtn?.classList.toggle('on', state.snap);
    setStatus('Завантаж PNG у бібліотеку і тягни на доріжку.');
  });

  // ---- AI панель: drag-and-drop + click для рефу ----
  {
    const drop = document.getElementById('lv-aiRefDrop');
    const input = document.getElementById('lv-aiRefInput') as HTMLInputElement | null;
    const img = document.getElementById('lv-aiRefImg') as HTMLImageElement | null;
    if (drop && input && img) {
      const setRef = (file: File) => { img.src = URL.createObjectURL(file); img.style.display = 'block'; };
      drop.addEventListener('click', () => input.click());
      drop.addEventListener('contextmenu', (e) => { e.preventDefault(); img.src = ''; img.style.display = 'none'; });
      input.addEventListener('change', () => { if (input.files?.[0]) setRef(input.files[0]); });
      drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('drag-over'); });
      drop.addEventListener('dragleave', () => drop.classList.remove('drag-over'));
      drop.addEventListener('drop', (e) => {
        e.preventDefault(); drop.classList.remove('drag-over');
        const dt = (e as DragEvent).dataTransfer;
        const assetId = dt?.getData('text/asset-id');
        if (assetId) { // перетягнули картку з бібліотеки → беремо її зображення як реф
          const a = state.assets.find((x) => x.id === assetId);
          if (a) { img.src = a.url; img.style.display = 'block'; }
          return;
        }
        const file = dt?.files[0];
        if (file?.type.startsWith('image/')) setRef(file);
      });
    }
    wireAiGenerate();
  }

  // Конвертувати будь-який src (data/http) у WebP-dataURL з обмеженням розміру (альфа збережена).
  function imgSrcToWebP(src: string, maxPx: number): Promise<string> {
    return new Promise((resolve) => {
      const im = new Image(); im.crossOrigin = 'anonymous';
      im.onload = () => {
        const k = Math.min(1, maxPx / Math.max(im.naturalWidth, im.naturalHeight));
        const w = Math.round(im.naturalWidth * k), h = Math.round(im.naturalHeight * k);
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        c.getContext('2d')!.drawImage(im, 0, 0, w, h);
        const out = c.toDataURL('image/webp', 0.9);
        resolve(out.startsWith('data:image/webp') ? out : c.toDataURL('image/png'));
      };
      im.onerror = () => resolve(src);
      im.src = src;
    });
  }
  let aiBusy = false;
  function wireAiGenerate(): void {
    const btn = $<HTMLButtonElement>('aiGenBtn');
    const promptEl = document.getElementById(prefix + 'aiPrompt') as HTMLTextAreaElement | null;
    const refImg = document.getElementById(prefix + 'aiRefImg') as HTMLImageElement | null;
    if (!btn) return;
    btn.addEventListener('click', () => {
      if (aiBusy) return;
      const prompt = promptEl?.value ?? '';
      const refUrl = refImg && refImg.style.display !== 'none' && refImg.src ? refImg.src : null;
      if (!hasFalKey()) { setStatus('Нема VITE_OPENAI_KEY у .env (або VITE_FAL_PROXY на деплої)'); return; }
      if (!prompt.trim() && !refUrl) { setStatus('Введи опис або кинь реф-зображення'); return; }
      aiBusy = true; const orig = btn.textContent; btn.textContent = 'Генерую…'; btn.disabled = true;
      setStatus('AI генерує — це може зайняти 10–30с…');
      void (async () => {
        try {
          const png = await generateGameAsset({ prompt, refDataUrl: refUrl, context: 'prop' });
          const url = await imgSrcToWebP(png, CAT_MAX_PX[state.cat] ?? 1024);
          const a: Asset = { id: 'a' + Date.now() + Math.round(performance.now()), cat: state.cat, name: (prompt.trim().slice(0, 24) || 'AI'), url };
          state.assets.push(a); loadImg(a); refreshAssets(); save();
          setStatus('✔ Готово — ассет у бібліотеці (' + state.cat + ')');
        } catch (e) {
          setStatus('AI помилка: ' + ((e as Error)?.message ?? e));
        } finally {
          aiBusy = false; btn.textContent = orig; btn.disabled = false;
        }
      })();
    });
  }
}
