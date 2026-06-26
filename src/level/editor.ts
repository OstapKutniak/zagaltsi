// Core level editor logic — usable both standalone (prefix='') and embedded in studio (prefix='lv-').
import { idbGet, idbSet } from '../store';
import { registerPublisher, wirePublishButton } from '../publish';
import { hasSolidBackground, keyImage, loadImageEl } from '../rig/keyer';
import { pullLevelData, mergeLevelAssets, mergeByIdLWW } from '../sync';
import { toggleConstructor } from '../ui-constructor';
import { loadCharLibrary, type LibItem } from '../charlib';
import { gatherBehaviors } from '../behaviors';
import { footprintWorldCells } from './footprint';
import { animOffset, deformImgPt, deformKfAt, deformKfTransform, PLAN_DIST_STEP, type DeformKf, type PlacedAnim, type PlacedDeform } from './LevelView';
import { type Atmosphere, type AtmSky, type AtmTod, type AtmWeather, type SkyPhase, type TodPhase, type WeatherPhase, type WeatherType, DEFAULT_SKY_PHASE, DEFAULT_TOD_PHASE, DEFAULT_WEATHER_PHASE } from './atmosphere';
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
interface Placed { id: string; cat: string; asset: string; x: number; y: number; rot: number; scale: number; flip: number; scaleW?: number; scaleH?: number; plan?: number; anim?: PlacedAnim; deform?: PlacedDeform; pivotX?: number; pivotY?: number; group?: string; transparent?: boolean }
// Зона блокування камери (бітемап-стиль): при вході гравця в тригерну смугу [x−w/2 .. x+w/2]
// камера фіксується на camX до виконання умови (битва/діалог/авто/тощо).
interface CamZone { id: string; x: number; w: number; camX: number; label?: string }
interface Level { id?: string; updatedAt?: number; name: string; placed: Placed[]; collider: string[]; enemySpawns: string[]; neutralSpawns: string[]; spawn: { x: number; y: number }; spawns: { x: number; y: number }[]; start: number; end: number; grid: number; parallax: Record<string, number>; atmosphere?: Atmosphere; camZones?: CamZone[] }

const SPAWN_COLORS = ['#ff5555', '#5aa0ff', '#5aff8f', '#ffd000', '#c06aff']; // 5 кольорів точок спавна

export function initLevelEditor(prefix: string): void {
  const $ = <T extends HTMLElement>(id: string): T => document.getElementById(prefix + id) as T;
  const newLevel = (name: string): Level => ({ id: 'lv-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7), updatedAt: Date.now(), name, placed: [], collider: [], enemySpawns: [], neutralSpawns: [], spawn: { x: 120, y: 0 }, spawns: [{ x: 120, y: 0 }], start: 0, end: 2400, grid: 32, parallax: { ...PARALLAX_DEFAULTS } });
  // Стабільний id для легасі-рівнів без id (на двох компах виводиться однаково з назви,
  // тож ті самі рівні зливаються, а не дублюються). Викликати перед merge-by-id.
  const ensureLevelId = (lv: Level): Level => { if (!lv.id) lv.id = 'L:' + lv.name; return lv; };

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
    pathTool: null as null | 'h' | 'v' | 'erase' | 'enemy' | 'enemyErase' | 'neutral' | 'neutralErase' | 'spawn' | 'raise' | 'lower' | 'flat' | 'walk',
    axisLock: null as null | 'x' | 'z',
    colliderTool: 'paint' as 'paint' | 'erase',
    markerDrag: null as null | 'spawn' | 'start' | 'end',
    spawnSel: 0, // який зі спавнів зараз вибраний/тягнеться
    camView: true,
    showGrid: false,
    grid: 48,
    snap: true,
    showCollider: false,
    showMarkers: false,
    showEnemySpawns: false,
    showPlayerSpawns: false,
    showAtm: false,
    showAnim: false,
    hiddenCats: new Set<string>(),
    hiddenIds: new Set<string>(), // тимчасово приховані ассети (тільки редактор, H / Alt+H)
    multiSel: new Set<string>(),  // мультивибір (Shift+ЛКМ); primary = state.selected
    openGroup: null as string | null, // id групи в «відкритому» режимі (Alt+G)
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
    pendingNeutral: null as string | null,        // id нейтрала що зараз виставляється
    animLinePid: null as string | null,           // id ассета, для якого зараз малюємо лінію руху
    brushSize: 1, // 1=1×1  2=2×2  3=3×3 …  колесо змінює при активному H/Y/1/2/3
    camZoneTool: false,
    camZoneSel: null as string | null,
    camZoneDrag: null as null | { id: string; type: 'zone' | 'camX'; startSx: number; zoneX0: number; camX0: number },
    deformEdit: null as string | null,     // id ассета, чиї хендли редагуємо
    deformHandleIdx: -1,                   // індекс перетягуваного хендла (-1 = немає)
    deformDragSx0: 0, deformDragSy0: 0,   // екранна позиція початку дрегу
    deformDragOrigVals: [] as number[],    // знімок corners/pts на початку дрегу
  };

  // Неігрові персонажі (вороги/нейтрали) з бібліотеки персонажів + кеш тонованих мініатюр.
  let npcLib: LibItem[] = [];
  const npcTinted = new Map<string, HTMLCanvasElement>();
  const npcNeutralTinted = new Map<string, HTMLCanvasElement>();
  const npcImages = new Map<string, HTMLImageElement>();

  const level = (): Level => state.levels[state.cur];
  const sc = (): number => state.viewScale * state.zoom;
  const toScreen = (wx: number, wy: number) => ({ x: state.origin.x + wx * sc(), y: state.origin.y + wy * sc() });
  const toWorld = (sx: number, sy: number) => ({ x: (sx - state.origin.x) / sc(), y: (sy - state.origin.y) / sc() });
  const imgOf = (p: Placed): HTMLImageElement | undefined => state.images.get(p.asset);
  // Паралакс-корекція X для режиму камери (camView). Виведено зі scrollFactor Phaser.
  const plxDx = (cat: string, plan?: number): number => {
    if (!state.camView) return 0;
    if (!(PARALLAX_LAYERS as readonly string[]).includes(cat)) return 0;
    const fl = (canvas.width - 1280 * sc()) / 2;
    let d = level().parallax?.[cat] ?? PARALLAX_DEFAULTS[cat as ParallaxLayer];
    if (plan) d += (cat === 'foreground' ? +1 : -1) * plan * PLAN_DIST_STEP;
    d = Math.max(0, Math.min(0.98, d));
    return (1 - layerScrollFactor(cat, d)) * (fl - state.origin.x);
  };

  // Оголошено рано (до draw/previewActive), щоб не було TDZ при першому малюванні.
  let drag: { x: number; y: number; ox: number; oy: number; others: { id: string; ox: number; oy: number }[] } | null = null;
  // Початкові трансформи інших виділених ассетів для G/R/S-mode.
  let multiOrigPos: { id: string; x: number; y: number; rot: number; scale: number; scaleW: number; scaleH: number }[] = [];
  let panning = false; let panStart = { mx: 0, my: 0, px: 0, py: 0 };
  let painting = false;
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
    state.levels.forEach(migrateLevel);
    // Pull from GitHub in background — LWW-merge рівнів і ассетів за id (свіже з інших компів).
    pullLevelData().then(({ assets: remoteAssets, layouts: remoteLayouts }) => {
      // Рівні: зливаємо по id (найновіша правка перемагає). Легасі без id → стабільний
      // id з назви (ensureLevelId), щоб ті самі рівні не дублювались між компами.
      const remoteLevels = (remoteLayouts?.levels as Level[] | undefined)?.map((lv) => { migrateLevel(lv); return lv; }) ?? [];
      if (remoteLevels.length) {
        const curId = state.levels[state.cur]?.id;
        const base = hadLocalLevels ? state.levels : []; // ігноруємо синтетичний дефолт-рівень
        const { merged, changed } = mergeByIdLWW(base, remoteLevels);
        if (changed > 0 || !hadLocalLevels) {
          merged.forEach(migrateLevel);
          state.levels = merged.length ? merged : state.levels;
          const i = curId ? state.levels.findIndex((lv) => lv.id === curId) : 0;
          state.cur = i >= 0 ? i : 0;
          state.grid = level().grid;
          idbSet('zag_levels', { levels: state.levels, cur: state.cur }).catch(() => {});
          refreshLevels();
          draw();
          if (changed > 0) setStatus(`Синхронізовано: ${changed} рівнів з GitHub`);
        }
      }
      const remoteFiltered = (remoteAssets ?? []).filter((r) => !deletedIds.has((r as Asset).id));
      const { merged, added } = mergeLevelAssets(state.assets, remoteFiltered);
      if (added > 0) {
        state.assets = merged as Asset[];
        for (const as of state.assets.slice(-added)) loadImg(as);
        idbSet('zag_assets', state.assets).catch(() => {});
        refreshAssets();
        setStatus(`Синхронізовано: +${added} ассетів з GitHub`);
      }
    }).catch(() => {});
    if (!state.levels.length) state.levels = [newLevel('Рівень 1')];
    state.levels.forEach(migrateLevel);
    state.grid = level().grid;
  }

  // Міграція одного рівня до повної схеми (старі збереження + злиті з репо).
  function migrateLevel(lv: Level): void {
    if (!lv.spawn) lv.spawn = { x: 120, y: 0 };
    if (!lv.spawns || !lv.spawns.length) lv.spawns = [{ ...lv.spawn }]; // один спавн -> масив
    if (!lv.enemySpawns) lv.enemySpawns = []; // зони спавна ворогів
    if (!lv.neutralSpawns) lv.neutralSpawns = []; // зони спавна нейтралів
    if (typeof lv.start !== 'number') lv.start = 0;
    if (typeof lv.end !== 'number') lv.end = 2400;
    if (typeof lv.grid !== 'number') lv.grid = 32; // всі рівні на gs=32
    ensureParallax(lv); // добиваємо всі паралакс-шари (хмари/перед.фон/перед.план)
    ensureLevelId(lv); // стабільний id для злиття між компами
    if (!lv.camZones) lv.camZones = [];
  }
  function loadImg(a: Asset): void {
    const im = new Image();
    im.onload = () => draw();
    im.src = a.url;
    state.images.set(a.id, im);
  }

  const setStatus = (m: string): void => { const el = $('statusBar'); if (el) el.textContent = m; };

  const undoStack: string[] = [];
  function pushUndo(): void {
    const lv = state.levels[state.cur];
    if (lv) lv.updatedAt = Date.now(); // pushUndo = «зараз буде правка» → оновлюємо мітку часу рівня
    undoStack.push(JSON.stringify({ levels: state.levels, cur: state.cur, hiddenIds: [...state.hiddenIds] }));
    if (undoStack.length > 80) undoStack.shift();
  }
  function undo(): void {
    const s0 = undoStack.pop(); if (!s0) { setStatus('Нема що відміняти'); return; }
    const o = JSON.parse(s0) as { levels: Level[]; cur: number; hiddenIds?: string[] };
    state.levels = o.levels; state.cur = Math.min(o.cur, o.levels.length - 1); state.grid = level().grid;
    state.selected = null; state.multiSel.clear(); state.openGroup = null;
    state.hiddenIds = new Set(o.hiddenIds ?? []);
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
      .filter((p) => !state.hiddenCats.has(p.cat) && !state.hiddenIds.has(p.id)) // приховані категорії + окремо приховані ассети (H)
      // у межах шару: більший plan (ближче) малюється пізніше = зверху
      .sort((a, b) => (LAYER[a.cat] - LAYER[b.cat]) || ((a.plan ?? 0) - (b.plan ?? 0)) || (level().placed.indexOf(a) - level().placed.indexOf(b)));
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
  // ── Живе прев'ю анімацій ассетів (обертання/переміщення) ──
  // Грає автоматично, поки є анімовані ассети й користувач не тягне/не редагує.
  let animClock = 0; let animRaf = 0; let animLast = 0;
  let lineDraw: { x0: number; y0: number; x1: number; y1: number } | null = null;
  let lastMenuX = 0, lastMenuY = 0;
  const hasAnims = (): boolean => !!level()?.placed.some((p) => p.anim || (p.deform?.keyframes && p.deform.keyframes.length >= 2));
  const previewActive = (): boolean =>
    hasAnims() && canvas.offsetWidth > 0 && !drag && !state.mode && !panning && !painting
    && !state.pendingAsset && !state.markerDrag && state.animLinePid == null && !lineDraw
    && state.deformHandleIdx < 0;
  // Відображувані позиція/кут/масштаб ассета (з анімаційним зсувом або кейфреймами).
  function animDisp(p: Placed): { x: number; y: number; rot: number; scale: number } {
    const base = { x: p.x, y: p.y, rot: p.rot, scale: p.scale };
    if (p.anim && previewActive()) {
      const o = animOffset(p.anim, animClock);
      return { ...base, x: p.x + o.dx, y: p.y + o.dy, rot: p.rot + o.rot };
    }
    if (p.deform?.keyframes && p.deform.keyframes.length >= 2 && previewActive()) {
      return deformKfTransform(p.deform, animClock, base);
    }
    return base;
  }
  function tickAnim(ts: number): void {
    animRaf = 0;
    if (!previewActive()) { animLast = 0; return; }
    if (animLast) animClock += Math.min((ts - animLast) / 1000, 0.1);
    animLast = ts;
    _drawNow();
    animRaf = requestAnimationFrame(tickAnim);
  }
  function ensureAnimLoop(): void {
    if (previewActive() && !animRaf) { animLast = 0; animRaf = requestAnimationFrame(tickAnim); }
  }

  // ── Деформація ассетів (перспектива / FFD) ──
  // Інтерполяція кейфреймів деформації для поточного моменту (animClock).
  function kfDeformOf(p: Placed): PlacedDeform | null {
    const df = p.deform;
    if (!df?.keyframes || df.keyframes.length < 2 || !previewActive()) return null;
    return deformKfAt(df, animClock);
  }
  // Перетворює UV (t,s) → екранна позиція з урахуванням деформації + pivot + повного трансформу.
  function deformScreenPt(p: Placed, img: HTMLImageElement, t: number, s: number): { x: number; y: number } {
    const W = img.width, H = img.height;
    const d = animDisp(p);
    const s2 = toScreen(d.x, d.y);
    s2.x += plxDx(p.cat, p.plan);
    const effDeform = kfDeformOf(p) ?? p.deform;
    const pos = effDeform ? deformImgPt(effDeform, W, H, t, s) : { x: (t - 0.5) * W, y: (s - 0.5) * H };
    const pivX = p.pivotX ?? 0, pivY = p.pivotY ?? 0;
    const sc_ = d.scale * (p.scaleW ?? 1) * p.flip * sc();
    const ky = d.scale * (p.scaleH ?? 1) * sc();
    const lx = (pos.x - pivX) * sc_, ly = (pos.y - pivY) * ky;
    if (p.deform?.baked) {
      return { x: s2.x + lx, y: s2.y + ly };
    }
    const rRad = rad(d.rot);
    const cosR = Math.cos(rRad), sinR = Math.sin(rRad);
    return { x: s2.x + lx * cosR - ly * sinR, y: s2.y + lx * sinR + ly * cosR };
  }
  // Малює один трикутник з афінним UV-відображенням (src → dst, Крамер).
  function drawDeformTri(
    img: HTMLImageElement,
    s0: { x: number; y: number }, s1: { x: number; y: number }, s2: { x: number; y: number },
    d0: { x: number; y: number }, d1: { x: number; y: number }, d2: { x: number; y: number },
  ): void {
    ctx.save();
    ctx.beginPath(); ctx.moveTo(d0.x, d0.y); ctx.lineTo(d1.x, d1.y); ctx.lineTo(d2.x, d2.y); ctx.closePath(); ctx.clip();
    const det = (s0.x - s2.x) * (s1.y - s2.y) - (s1.x - s2.x) * (s0.y - s2.y);
    if (Math.abs(det) < 0.0001) { ctx.restore(); return; }
    const a  = ((d0.x - d2.x) * (s1.y - s2.y) - (d1.x - d2.x) * (s0.y - s2.y)) / det;
    const b  = ((d0.y - d2.y) * (s1.y - s2.y) - (d1.y - d2.y) * (s0.y - s2.y)) / det;
    const cc = ((d1.x - d2.x) * (s0.x - s2.x) - (d0.x - d2.x) * (s1.x - s2.x)) / det;
    const dd = ((d1.y - d2.y) * (s0.x - s2.x) - (d0.y - d2.y) * (s1.x - s2.x)) / det;
    const ee = d0.x - a * s0.x - cc * s0.y;
    const ff = d0.y - b * s0.x - dd * s0.y;
    ctx.transform(a, b, cc, dd, ee, ff);
    ctx.drawImage(img, 0, 0);
    ctx.restore();
  }
  // Малює деформований ассет на Canvas 2D квадосіткою N×N трикутних пар.
  function drawDeformedAsset(p: Placed, img: HTMLImageElement): void {
    const N = p.deform!.subdiv ?? 8; // у редакторі достатньо 8 — швидше
    const W = img.width, H = img.height;
    const baked = !!p.deform?.baked;
    let cosA = 1, sinA = 0;
    if (baked) {
      const a = -rad(animDisp(p).rot);
      cosA = Math.cos(a); sinA = Math.sin(a);
    }
    const mkSrc = (t: number, s: number): { x: number; y: number } => {
      if (!baked) return { x: t * W, y: s * H };
      const dx = t * W - W / 2, dy = s * H - H / 2;
      return { x: W / 2 + dx * cosA - dy * sinA, y: H / 2 + dx * sinA + dy * cosA };
    };
    for (let row = 0; row < N; row++) {
      for (let col = 0; col < N; col++) {
        const t0 = col / N, t1 = (col + 1) / N;
        const s0 = row / N, s1 = (row + 1) / N;
        const p00 = deformScreenPt(p, img, t0, s0);
        const p10 = deformScreenPt(p, img, t1, s0);
        const p01 = deformScreenPt(p, img, t0, s1);
        const p11 = deformScreenPt(p, img, t1, s1);
        drawDeformTri(img, mkSrc(t0, s0), mkSrc(t1, s0), mkSrc(t0, s1), p00, p10, p01);
        drawDeformTri(img, mkSrc(t1, s0), mkSrc(t1, s1), mkSrc(t0, s1), p10, p11, p01);
      }
    }
  }
  // Малює хендли деформації поточного обраного ассета (якщо state.deformEdit збігається).
  function drawDeformHandles(p: Placed, img: HTMLImageElement): void {
    if (state.deformEdit !== p.id || !p.deform) return;
    const df = p.deform;
    const W = img.width, H = img.height;
    const pts: Array<{ t: number; s: number }> = [];
    if (df.type === 'persp') {
      pts.push({ t: 0, s: 0 }, { t: 1, s: 0 }, { t: 1, s: 1 }, { t: 0, s: 1 });
    } else {
      const cols = df.cols ?? 2, rows = df.rows ?? 2;
      for (let ri = 0; ri <= rows; ri++) for (let ci = 0; ci <= cols; ci++) pts.push({ t: ci / cols, s: ri / rows });
    }
    pts.forEach(({ t, s }, hi) => {
      const sp = deformScreenPt(p, img, t, s);
      const active = state.deformHandleIdx === hi;
      ctx.beginPath(); ctx.arc(sp.x, sp.y, active ? 7 : 5, 0, Math.PI * 2);
      ctx.fillStyle = active ? '#ffcc00' : '#ffffff'; ctx.fill();
      ctx.strokeStyle = '#333'; ctx.lineWidth = 1.5; ctx.stroke();
    });
  }

  function _drawNow(): void {
    if (!canvas.width) return;
    ctx.imageSmoothingEnabled = !_panning;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (state.showGrid) {
      ctx.strokeStyle = '#282828'; ctx.lineWidth = 1;
      const gs = 60 * sc();
      const ox = (state.origin.x % gs + gs) % gs;
      const oy = (state.origin.y % gs + gs) % gs;
      for (let x = ox; x < canvas.width; x += gs) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke(); }
      for (let y = oy; y < canvas.height; y += gs) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke(); }
    }
    const g0 = toScreen(0, 0);
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(0, g0.y); ctx.lineTo(canvas.width, g0.y); ctx.stroke();

    for (const p of placedSorted()) {
      const img = imgOf(p); if (!img) continue;
      const d2 = animDisp(p); const s2 = toScreen(d2.x, d2.y);
      s2.x += plxDx(p.cat, p.plan);
      const dim = state.soloFillCat !== null && p.cat !== state.soloFillCat;
      if (p.deform) {
        // Деформований ассет: квадрова сітка через Canvas 2D afine mapping
        ctx.save(); if (dim) ctx.filter = 'grayscale(1)';
        drawDeformedAsset(p, img);
        ctx.restore();
      } else {
        ctx.save();
        if (dim) ctx.filter = 'grayscale(1)';
        ctx.translate(s2.x, s2.y);
        ctx.rotate(rad(d2.rot));
        const kx = d2.scale * (p.scaleW ?? 1) * sc(); const ky = d2.scale * (p.scaleH ?? 1) * sc();
        ctx.scale(p.flip * kx, ky);
        ctx.drawImage(img, -img.width / 2 - (p.pivotX ?? 0), -img.height / 2 - (p.pivotY ?? 0));
        ctx.restore();
      }
      if (p.id === state.selected && !dim) {
        ctx.strokeStyle = '#ffd000'; ctx.lineWidth = 1.5;
        ctx.strokeRect(s2.x - 6, s2.y - 6, 12, 12);
        // Pivot-хрест
        if (p.pivotX || p.pivotY) {
          const cosR = Math.cos(rad(d2.rot)), sinR = Math.sin(rad(d2.rot));
          const kxf = d2.scale * (p.scaleW ?? 1) * p.flip * sc(), kyf = d2.scale * (p.scaleH ?? 1) * sc();
          const px2 = s2.x + (p.pivotX ?? 0) * kxf * cosR - (p.pivotY ?? 0) * kyf * sinR;
          const py2 = s2.y + (p.pivotX ?? 0) * kxf * sinR + (p.pivotY ?? 0) * kyf * cosR;
          ctx.strokeStyle = '#ff6600'; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.moveTo(px2 - 7, py2); ctx.lineTo(px2 + 7, py2); ctx.moveTo(px2, py2 - 7); ctx.lineTo(px2, py2 + 7); ctx.stroke();
        }
      } else if (state.multiSel.has(p.id) && !dim) {
        ctx.strokeStyle = '#55aaff'; ctx.lineWidth = 1.2;
        ctx.strokeRect(s2.x - 5, s2.y - 5, 10, 10);
      }
      // Прозорий ассет: пунктирна рамка навколо точки опори
      if (p.transparent && !dim) {
        ctx.save(); ctx.strokeStyle = 'rgba(180,180,255,0.7)'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
        ctx.strokeRect(s2.x - 8, s2.y - 8, 16, 16); ctx.setLineDash([]); ctx.restore();
      }
      // Індикатор групи: маленький квадратик у лівому верхньому куті
      if (p.group && !dim) {
        ctx.fillStyle = state.openGroup === p.group ? 'rgba(255,200,0,0.9)' : 'rgba(255,200,0,0.5)';
        ctx.fillRect(s2.x - 9, s2.y - 9, 4, 4);
      }
    }
    // Соло-режим: білий оверлей на весь канвас + перемалювати соло-шар зверху
    if (state.soloFillCat !== null) {
      ctx.fillStyle = 'rgba(255,255,255,0.30)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      for (const p of placedSorted()) {
        if (p.cat !== state.soloFillCat) continue;
        const img = imgOf(p); if (!img) continue;
        const d2 = animDisp(p); const s2 = toScreen(d2.x, d2.y);
        s2.x += plxDx(p.cat, p.plan);
        if (p.deform) {
          drawDeformedAsset(p, img);
        } else {
          ctx.save();
          ctx.translate(s2.x, s2.y);
          ctx.rotate(rad(d2.rot));
          const kx = d2.scale * (p.scaleW ?? 1) * sc(); const ky = d2.scale * (p.scaleH ?? 1) * sc();
          ctx.scale(p.flip * kx, ky);
          ctx.drawImage(img, -img.width / 2 - (p.pivotX ?? 0), -img.height / 2 - (p.pivotY ?? 0));
          ctx.restore();
        }
        if (p.id === state.selected) { ctx.strokeStyle = '#ffd000'; ctx.lineWidth = 1.5; ctx.strokeRect(s2.x - 6, s2.y - 6, 12, 12); }
      }
    }

    // Хендли деформації — поверх усіх ассетів
    if (state.deformEdit) {
      const dp = level().placed.find((pp) => pp.id === state.deformEdit);
      const dimg = dp ? imgOf(dp) : undefined;
      if (dp && dimg) drawDeformHandles(dp, dimg);
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

    // Зони спавна нейтралів — фіолетові.
    if (state.showEnemySpawns) {
      const gs = state.grid, k2 = gs * Math.SQRT1_2;
      const Pf = (ix: number, iy: number) => toScreen(ix * gs + iy * k2, iy * k2);
      const mfc = state.pendingNeutral ? floorCellAt(state.mouse.x, state.mouse.y) : null;
      for (const z of level().neutralSpawns) {
        const p = z.split(','); const acx = Number(p[0]), acy = Number(p[1]); const neutralId = p[2];
        if (!Number.isFinite(acx) || !Number.isFinite(acy)) continue;
        const hovered = mfc ? (mfc.cx >= acx && mfc.cx <= acx + 2 && mfc.cy >= acy && mfc.cy <= acy + 2) : false;
        const a = Pf(acx, acy), b = Pf(acx + 3, acy), c = Pf(acx + 3, acy + 3), d = Pf(acx, acy + 3);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.lineTo(d.x, d.y); ctx.closePath();
        ctx.fillStyle = hovered ? 'rgba(160,40,255,0.55)' : 'rgba(160,40,255,0.20)'; ctx.fill();
        ctx.strokeStyle = hovered ? 'rgba(190,80,255,1)' : 'rgba(160,40,255,0.9)'; ctx.lineWidth = hovered ? 3 : 2; ctx.stroke();
        const ctr = Pf(acx + 1.5, acy + 1.5);
        const tint = neutralId ? npcNeutralTinted.get(neutralId) : null;
        if (tint) {
          const zh = Math.abs(d.y - a.y) * 1.3 || 64;
          const zw = zh * (tint.width / tint.height);
          ctx.globalAlpha = 0.72;
          ctx.drawImage(tint, ctr.x - zw / 2, ctr.y - zh * 0.78, zw, zh);
          ctx.globalAlpha = 1;
        } else {
          ctx.fillStyle = 'rgba(160,40,255,0.95)'; ctx.beginPath(); ctx.arc(ctr.x, ctr.y, 5, 0, Math.PI * 2); ctx.fill();
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
      const neutralZoneAt = (cx: number, cy: number): string | undefined =>
        level().neutralSpawns.find((z) => { const p = z.split(','); const acx = Number(p[0]), acy = Number(p[1]); return cx >= acx && cx <= acx + 2 && cy >= acy && cy <= acy + 2; });
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
      } else if (state.pathTool === 'neutral' || state.pathTool === 'neutralErase') {
        const hit = neutralZoneAt(c.cx, c.cy);
        if (hit) { const p = hit.split(','); fillStroke(floorPts(Number(p[0]), Number(p[1]), 3, 3), 'rgba(160,40,255,0.30)', 'rgba(255,255,255,0.95)', 2.5); }
        if (state.pathTool === 'neutral') fillStroke(floorPts(c.cx - 1, c.cy - 1, 3, 3), 'rgba(160,40,255,0.18)', 'rgba(160,40,255,0.9)', 2);
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
    // Зони блокування камери: смуга тригера + лінія позиції камери.
    if (lv.camZones?.length) {
      ctx.font = '11px monospace';
      for (const z of lv.camZones) {
        const sel = z.id === state.camZoneSel;
        const lx = toScreen(z.x - z.w / 2, 0).x, rx = toScreen(z.x + z.w / 2, 0).x;
        const cx = toScreen(z.camX, 0).x;
        ctx.fillStyle = sel ? 'rgba(80,200,255,0.15)' : 'rgba(80,200,255,0.07)';
        ctx.fillRect(lx, 0, rx - lx, canvas.height);
        ctx.strokeStyle = sel ? 'rgba(80,200,255,0.95)' : 'rgba(80,200,255,0.45)';
        ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]);
        ctx.strokeRect(lx, 0, rx - lx, canvas.height); ctx.setLineDash([]);
        ctx.strokeStyle = sel ? '#ffcc00' : 'rgba(255,180,40,0.75)';
        ctx.lineWidth = sel ? 2.5 : 2;
        ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, canvas.height); ctx.stroke();
        const lbl = z.label || 'Зона камери';
        ctx.fillStyle = sel ? '#ffcc00' : 'rgba(255,180,40,0.9)';
        ctx.fillText('⊡ ' + lbl, cx + 4, canvas.height - 22);
      }
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

    if (state.pendingNeutral) {
      const pimg = npcImages.get(state.pendingNeutral);
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
    // Лінія напряму руху (режим «Задати лінію») — стрілка від старту до курсора.
    if (lineDraw) {
      const { x0, y0, x1, y1 } = lineDraw;
      ctx.strokeStyle = '#39d0ff'; ctx.fillStyle = '#39d0ff'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      const ang = Math.atan2(y1 - y0, x1 - x0);
      ctx.beginPath(); ctx.moveTo(x1, y1);
      ctx.lineTo(x1 - 12 * Math.cos(ang - 0.4), y1 - 12 * Math.sin(ang - 0.4));
      ctx.lineTo(x1 - 12 * Math.cos(ang + 0.4), y1 - 12 * Math.sin(ang + 0.4));
      ctx.closePath(); ctx.fill();
    }
    // Атмосфера у вьюпорті редактора
    if (state.showAtm) drawEditorRain();
  }

  function drawEditorRain(): void {
    const lv = level();
    const wx = lv.atmosphere?.weather;
    if (!wx?.enabled) return;
    const ph = wx.phases[0] as import('./atmosphere').WeatherPhase;
    if (!ph || ph.type !== 'rain') return;
    const W = canvas.width, H = canvas.height;
    const t = performance.now() / 1000;
    const GR = 0.6180339887, GR2 = 0.7548776662;
    const angle = Math.tan((ph.rainDir ?? 15) * Math.PI / 180);
    const spd = ph.rainSpeed ?? 600, baseLen = ph.rainDropLen ?? 16;
    const color = ph.rainColor ?? '#aaddff';
    const layers = [
      { sm: 0.55, lm: 0.6,  w: 0.8, a: ph.rainFar  ?? 0.35, n: 80,  to: 0    },
      { sm: 1.0,  lm: 1.0,  w: 1.5, a: ph.rainMid  ?? 0.7,  n: 100, to: 777  },
      { sm: 1.55, lm: 1.55, w: 2.5, a: ph.rainNear ?? 1.0,  n: 40,  to: 1337 },
    ];
    for (const l of layers) {
      if (l.a < 0.01) continue;
      const speed = spd * l.sm, len = baseLen * l.lm;
      const OW = W + len * Math.abs(angle) + 80, OH = H + len + 40, lt = t + l.to;
      ctx.save();
      ctx.strokeStyle = color;
      ctx.globalAlpha = Math.min(1, l.a);
      ctx.lineWidth = l.w;
      for (let i = 0; i < l.n; i++) {
        const hf = (i * GR) % 1, vf = (i * GR2) % 1;
        const sy = ((vf * OH + lt * speed) % OH) - 20;
        const sx = ((hf * OW + lt * speed * angle) % OW) - 40;
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + len * angle, sy + len); ctx.stroke();
      }
      ctx.restore();
    }
  }

  function draw(): void {
    ensureAnimLoop();
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
    const list = placedSorted().filter(p =>
      !p.transparent &&                                          // прозорі ассети — невибирані
      (state.soloFillCat === null || p.cat === state.soloFillCat) &&
      (state.openGroup === null || p.group === state.openGroup) // у відкритій групі — тільки її члени
    );
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i]; const img = imgOf(p); if (!img) continue;
      const d2 = animDisp(p); const o = toScreen(d2.x, d2.y);
      o.x += plxDx(p.cat, p.plan); // паралакс-корекція — як у малюванні
      const ang = rad(-d2.rot); const dx = sx - o.x, dy = sy - o.y;
      const kx = d2.scale * (p.scaleW ?? 1) * sc();
      const ky = d2.scale * (p.scaleH ?? 1) * sc();
      let lx = (dx * Math.cos(ang) - dy * Math.sin(ang)) / kx;
      const ly = (dx * Math.sin(ang) + dy * Math.cos(ang)) / ky;
      if (p.flip < 0) lx = -lx;
      // Зміщуємо в просторі зображення з урахуванням pivot
      const testLx = lx + (p.pivotX ?? 0), testLy = ly + (p.pivotY ?? 0);
      if (Math.abs(testLx) <= img.width / 2 && Math.abs(testLy) <= img.height / 2 && _alphaAt(img, testLx, testLy) > 10) return p.id;
    }
    return null;
  }
  const sel = (): Placed | undefined => level().placed.find((p) => p.id === state.selected);
  // Hit-тест для зон камери: повертає { zone, nearCamX } — nearCamX=true якщо клік поруч з лінією позиції.
  function hitCamZone(sx: number): { zone: CamZone; nearCamX: boolean } | null {
    const zones = level().camZones;
    if (!zones?.length) return null;
    const MHIT = 8;
    for (let i = zones.length - 1; i >= 0; i--) {
      const z = zones[i];
      const lx = toScreen(z.x - z.w / 2, 0).x, rx = toScreen(z.x + z.w / 2, 0).x;
      const cx = toScreen(z.camX, 0).x;
      if (Math.abs(sx - cx) < MHIT) return { zone: z, nearCamX: true };
      if (sx >= lx && sx <= rx) return { zone: z, nearCamX: false };
    }
    return null;
  }

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
      el.onclick = () => { state.cur = i; state.grid = state.levels[i].grid; state.selected = null; state.multiSel.clear(); state.openGroup = null; refreshLevels(); draw(); save(); };
      el.ondblclick = () => { const n = prompt('Назва рівня:', lv.name); if (n) { lv.name = n; lv.updatedAt = Date.now(); refreshLevels(); save(); } };
      if (state.levels.length > 1) {
        const x = document.createElement('button'); x.className = 'lvDel'; x.textContent = '×';
        x.onclick = (e) => {
          e.stopPropagation(); pushUndo(); state.levels.splice(i, 1);
          if (state.cur >= state.levels.length) state.cur = state.levels.length - 1;
          state.grid = level().grid; state.selected = null; state.multiSel.clear(); state.openGroup = null; refreshLevels(); draw(); save();
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
  // Touch drag from library card to canvas
  let _libDragId = '';
  let _libDragSrc = '';
  let _libDragStartX = 0;
  let _libDragStartY = 0;
  let _libDragActive = false;
  let _libDragGhost: HTMLElement | null = null;

  // ПКМ-меню бібліотечного ассету: «Малювати колайдер» + «Очистити фон»
  let _libMenuEl: HTMLDivElement | null = null;
  const _libMenuOutside = (e: MouseEvent): void => {
    if (_libMenuEl && !_libMenuEl.contains(e.target as Node)) { _libMenuEl.remove(); _libMenuEl = null; document.removeEventListener('mousedown', _libMenuOutside, true); }
  };
  function openLibMenu(a: typeof state.assets[0], clientX: number, clientY: number): void {
    if (_libMenuEl) { _libMenuEl.remove(); _libMenuEl = null; document.removeEventListener('mousedown', _libMenuOutside, true); }
    const m = document.createElement('div'); _libMenuEl = m;
    m.style.cssText = 'position:fixed;z-index:99999;background:#2a2a2a;border:1px solid #444;border-radius:8px;padding:6px;min-width:172px;box-shadow:0 4px 16px rgba(0,0,0,.5);';
    const btn = (label: string, cb: () => void): void => {
      const b = document.createElement('button');
      b.textContent = label;
      b.style.cssText = 'display:block;width:100%;padding:7px 11px;margin:2px 0;border-radius:6px;border:0;background:#3a3a3a;color:#e8e8e8;cursor:pointer;font:13px sans-serif;text-align:left;';
      b.onmouseenter = (): void => { b.style.background = '#505050'; };
      b.onmouseleave = (): void => { b.style.background = '#3a3a3a'; };
      b.addEventListener('mousedown', (ev) => { ev.stopPropagation(); m.remove(); _libMenuEl = null; document.removeEventListener('mousedown', _libMenuOutside, true); cb(); });
      m.appendChild(b);
    };
    btn('Малювати колайдер', () => openFootprintEditor(a));
    btn('Очистити фон', async () => {
      setStatus('Очищення фону…');
      try {
        const img = await loadImageEl(a.url);
        // Не перевіряємо hasSolidBackground — юзер явно просить, keyImage сам вирішить
        // чи є фон (через перевірку крайових пікселів і spread > 50 всередині).
        const keyed = keyImage(img).toDataURL('image/png');
        if (keyed === a.url) { setStatus('Фон не виявлено або вже очищено'); return; }
        a.url = keyed;
        save(); refreshAssets(); draw(); setStatus('Фон очищено');
      } catch { setStatus('Не вдалося очистити фон'); }
    });
    m.style.left = Math.max(8, Math.min(window.innerWidth - 190, clientX)) + 'px';
    m.style.top  = Math.max(8, Math.min(window.innerHeight - 80, clientY)) + 'px';
    document.body.appendChild(m);
    setTimeout(() => document.addEventListener('mousedown', _libMenuOutside, true), 0);
  }

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
      el.addEventListener('contextmenu', (ev) => { ev.preventDefault(); ev.stopPropagation(); openLibMenu(a, ev.clientX, ev.clientY); });
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
      el.addEventListener('touchstart', (ev) => {
        _libDragId = a.id; _libDragSrc = a.url;
        _libDragStartX = ev.touches[0].clientX; _libDragStartY = ev.touches[0].clientY;
        _libDragActive = false;
      }, { passive: true });
      el.addEventListener('touchend', (ev) => {
        ev.preventDefault();
        if (_libDragActive) return; // document touchend будує размміщення
        _libDragId = '';
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
          toWebP(f, CAT_MAX_PX[state.cat] ?? 1024, 0.85, keyBgOn()).then((url) => {
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
  // Тогл «Вирізати фон» (lv-keyBgBtn) — кеїти рівний фон у завантажених PNG.
  const keyBgOn = (): boolean => {
    const b = document.getElementById(prefix + 'keyBgBtn');
    return b ? b.classList.contains('on') : false;
  };
  document.getElementById(prefix + 'keyBgBtn')
    ?.addEventListener('click', (e) => (e.currentTarget as HTMLElement).classList.toggle('on'));

  // Convert imported image to WebP — reduces storage 5-10x vs raw PNG.
  // doKey=true → спершу вирізаємо рівний фон (keyImage), webp зберігає альфу.
  function toWebP(file: File, maxPx = 1024, quality = 0.85, doKey = false): Promise<string> {
    return new Promise((resolve) => {
      const img = new Image();
      const blobUrl = URL.createObjectURL(file);
      img.onload = () => {
        const src: HTMLImageElement | HTMLCanvasElement = doKey && hasSolidBackground(img) ? keyImage(img) : img;
        const sw = src instanceof HTMLCanvasElement ? src.width : src.naturalWidth;
        const sh = src instanceof HTMLCanvasElement ? src.height : src.naturalHeight;
        const scale = Math.min(1, maxPx / Math.max(sw, sh));
        const w = Math.round(sw * scale);
        const h = Math.round(sh * scale);
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        c.getContext('2d')!.drawImage(src, 0, 0, w, h);
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
    // Touch: 1-finger = paint, 2-finger = pan, double-tap = toggle zoom mode (persistent)
    let _fpTouchPanActive = false;
    let _fpTouchPanStart = { mx: 0, my: 0, px: 0, py: 0 };
    let _fpLastTap = 0;
    let _fpLastTapWasPaint = false;
    let _fpZoomMode = false; // persistent: survives finger-lift until two-finger or next double-tap
    let _fpZoomStartY = 0;
    let _fpZoomStart = 1;
    const _fpcpos = (t: Touch) => { const r = cv.getBoundingClientRect(); return { x: t.clientX - r.left, y: t.clientY - r.top }; };
    cv.addEventListener('touchstart', (ev) => {
      ev.preventDefault();
      if (ev.touches.length === 1) {
        const now = Date.now(); const { x, y } = _fpcpos(ev.touches[0]);
        if (now - _fpLastTap < 300 && !_fpLastTapWasPaint) {
          _fpZoomMode = !_fpZoomMode;
          if (_fpZoomMode) { _fpZoomStartY = y; _fpZoomStart = fp.zoom; }
          _fpTouchPanActive = false; fp.painting = false; _fpLastTap = 0; return;
        }
        if (_fpZoomMode) { _fpZoomStartY = y; _fpZoomStart = fp.zoom; fp.painting = false; return; }
        _fpLastTap = now; _fpLastTapWasPaint = false; _fpTouchPanActive = false;
        fp.painting = true; fpPaintAt(x, y);
      } else if (ev.touches.length === 2) {
        fp.painting = false; _fpZoomMode = false; _fpLastTap = 0;
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
      } else if (!_fpTouchPanActive && !_fpZoomMode && ev.touches.length === 1 && fp.painting) {
        _fpLastTapWasPaint = true;
        const { x, y } = _fpcpos(ev.touches[0]); fpPaintAt(x, y);
      }
    }, { passive: false });
    cv.addEventListener('touchend', (ev) => {
      ev.preventDefault();
      fp.painting = false;
      if (ev.touches.length === 0) {
        _fpTouchPanActive = false;
        // _fpZoomMode intentionally NOT reset — persists until two-finger or next double-tap
      }
    }, { passive: false });
  }

  $<HTMLButtonElement>('loadAsset')?.addEventListener('click', () => $<HTMLInputElement>('fileInput').click());
  $<HTMLInputElement>('fileInput').addEventListener('change', (ev) => {
    const files = Array.from((ev.target as HTMLInputElement).files ?? []);
    for (const f of files) {
      toWebP(f, CAT_MAX_PX[state.cat] ?? 1024, 0.85, keyBgOn()).then((url) => {
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
  $<HTMLButtonElement>('clearCollider')?.addEventListener('click', () => { level().collider = []; level().enemySpawns = []; level().neutralSpawns = []; draw(); save(); });
  const pathBtnIds = ['pathHBtn', 'pathVBtn', 'erasePathBtn'] as const;
  const pathBtnTools: Record<string, 'h' | 'v' | 'erase'> = { pathHBtn: 'h', pathVBtn: 'v', erasePathBtn: 'erase' };
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

  // ── Атмосфера: три незалежні секції ─────────────────────────────────────────
  const atmToggle = $<HTMLButtonElement>('atmToggle');
  const atmPanel  = $<HTMLElement>('atmPanel');
  if (atmToggle && atmPanel) {
    atmPanel.style.display = 'none';
    atmToggle.addEventListener('click', () => {
      const open = atmPanel.style.display === 'none';
      atmPanel.style.display = open ? 'flex' : 'none';
      atmToggle.classList.toggle('on', open);
      if (open) renderAtmPanel();
    });
  }

  const WEATHER_LABELS: Record<string, string> = { clear: 'Ясно', rain: 'Дощ', snow: 'Сніг', fog: 'Туман' };

  // Будує один рядок фази (загальний вигляд: заголовок з тривалістю + кнопка видалення + контент)
  function makePhaseCard(dur: number, onDurChange: (v: number) => void, onDelete: () => void): { card: HTMLElement; body: HTMLElement } {
    const card = document.createElement('div');
    card.style.cssText = 'background:var(--rail);border-radius:6px;padding:6px;display:flex;flex-direction:column;gap:4px;font-size:11px';
    const hd = document.createElement('div'); hd.style.cssText = 'display:flex;align-items:center;gap:4px';
    const lbl = document.createElement('span'); lbl.style.cssText = 'color:var(--muted)'; lbl.textContent = 'Тривалість (сек)';
    const inp = document.createElement('input') as HTMLInputElement;
    inp.type = 'number'; inp.min = '1'; inp.max = '3600'; inp.value = String(Math.round(dur));
    inp.style.cssText = 'width:48px;background:var(--bg);border:1px solid var(--line);border-radius:4px;padding:2px 4px;font-size:11px;color:var(--ink);font-family:inherit';
    inp.addEventListener('change', () => { onDurChange(Math.max(1, Number(inp.value) || 30)); save(); });
    const del = document.createElement('button'); del.textContent = '✕'; del.style.cssText = 'margin-left:auto;background:none;border:none;color:var(--muted);cursor:pointer;font-size:13px;padding:0 4px';
    del.addEventListener('click', onDelete);
    hd.appendChild(lbl); hd.appendChild(inp); hd.appendChild(del); card.appendChild(hd);
    const body = document.createElement('div'); body.style.cssText = 'display:flex;flex-direction:column;gap:3px';
    card.appendChild(body);
    return { card, body };
  }

  function mkSlider(lbl: string, val: number, max: number, onChange: (v: number) => void): HTMLElement {
    const wr = document.createElement('div'); wr.style.cssText = 'display:flex;align-items:center;gap:4px';
    const sp = document.createElement('span'); sp.style.cssText = 'color:var(--muted);flex:0 0 50px;font-size:11px'; sp.textContent = lbl;
    const sl = document.createElement('input') as HTMLInputElement;
    sl.type = 'range'; sl.min = '0'; sl.max = String(max); sl.step = '1'; sl.value = String(Math.round(val * max)); sl.style.cssText = 'flex:1;accent-color:var(--sel)';
    const vl = document.createElement('span'); vl.style.cssText = 'flex:0 0 28px;text-align:right;color:var(--muted);font-size:11px'; vl.textContent = Math.round(val * 100) + '%';
    sl.addEventListener('input', () => { const v = Number(sl.value) / max; onChange(v); vl.textContent = Math.round(v * 100) + '%'; save(); });
    wr.appendChild(sp); wr.appendChild(sl); wr.appendChild(vl); return wr;
  }

  function mkColorPicker(lbl: string, val: string, onChange: (v: string) => void): HTMLElement {
    const wr = document.createElement('div'); wr.style.cssText = 'display:flex;align-items:center;gap:4px';
    const sp = document.createElement('span'); sp.style.cssText = 'color:var(--muted);flex:0 0 50px;font-size:11px'; sp.textContent = lbl;
    const inp = document.createElement('input') as HTMLInputElement;
    inp.type = 'color'; inp.value = val; inp.style.cssText = 'width:44px;height:22px;padding:1px;border:1px solid var(--line);border-radius:3px;cursor:pointer;background:none;flex:0 0 44px';
    inp.addEventListener('input', () => { onChange(inp.value); save(); });
    wr.appendChild(sp); wr.appendChild(inp); return wr;
  }

  // Будує секцію-акордеон (заголовок + ON/OFF + Незмінне + тіло)
  function makeSection(label: string, enabled: boolean, onToggle: (v: boolean) => void, staticVal = false, onStatic?: (v: boolean) => void): { wrap: HTMLElement; body: HTMLElement; setOpen: (v: boolean) => void } {
    const wrap = document.createElement('div'); wrap.style.cssText = 'border:1px solid var(--line);border-radius:6px;overflow:hidden';
    const hd   = document.createElement('div'); hd.style.cssText = 'display:flex;align-items:center;gap:4px;cursor:pointer;user-select:none;background:var(--rail);padding:5px 6px';
    const arr  = document.createElement('span'); arr.style.cssText = 'font-size:11px;transition:transform .15s'; arr.textContent = '▶';
    const lbEl = document.createElement('span'); lbEl.style.cssText = 'font-size:12px;font-weight:600;flex:1'; lbEl.textContent = label;
    const onOff = document.createElement('button');
    onOff.textContent = enabled ? 'ВКЛ' : 'ВИКЛ';
    onOff.style.cssText = 'font-size:10px;padding:2px 7px;border-radius:4px;border:1px solid var(--line);cursor:pointer;background:' + (enabled ? 'var(--accent)' : 'var(--rail)') + ';color:' + (enabled ? '#1b1b1b' : 'var(--muted)');
    onOff.addEventListener('click', (e) => {
      e.stopPropagation();
      const nv = onOff.textContent === 'ВИКЛ';
      onOff.textContent = nv ? 'ВКЛ' : 'ВИКЛ';
      onOff.style.background = nv ? 'var(--accent)' : 'var(--rail)';
      onOff.style.color = nv ? '#1b1b1b' : 'var(--muted)';
      onToggle(nv); save(); renderAtmPanel();
    });
    hd.appendChild(arr); hd.appendChild(lbEl); hd.appendChild(onOff);
    if (onStatic) {
      const lk = document.createElement('button');
      lk.title = 'Незмінне (не переходить між фазами)';
      lk.textContent = staticVal ? '🔒' : '🔓';
      lk.style.cssText = 'font-size:13px;padding:0 3px;border-radius:3px;border:1px solid var(--line);cursor:pointer;background:' + (staticVal ? 'var(--accent)' : 'var(--rail)');
      lk.addEventListener('click', (e) => {
        e.stopPropagation();
        const nv = lk.textContent === '🔓';
        lk.textContent = nv ? '🔒' : '🔓';
        lk.style.background = nv ? 'var(--accent)' : 'var(--rail)';
        onStatic(nv); save();
      });
      hd.appendChild(lk);
    }
    wrap.appendChild(hd);
    const body = document.createElement('div'); body.style.cssText = 'display:none;flex-direction:column;gap:4px;padding:6px';
    wrap.appendChild(body);
    let open = false;
    const setOpen = (v: boolean): void => {
      open = v; arr.style.transform = v ? 'rotate(90deg)' : ''; body.style.display = v ? 'flex' : 'none';
    };
    hd.addEventListener('click', () => setOpen(!open));
    return { wrap, body, setOpen };
  }

  function mkRangeAbs(lbl: string, val: number, min: number, max: number, suffix: string, onChange: (v: number) => void): HTMLElement {
    const wr = document.createElement('div'); wr.style.cssText = 'display:flex;align-items:center;gap:4px';
    const sp = document.createElement('span'); sp.style.cssText = 'color:var(--muted);flex:0 0 60px;font-size:11px'; sp.textContent = lbl;
    const sl = document.createElement('input') as HTMLInputElement;
    sl.type = 'range'; sl.min = String(min); sl.max = String(max); sl.step = '1'; sl.value = String(Math.round(val));
    sl.style.cssText = 'flex:1;accent-color:var(--sel)';
    const vl = document.createElement('span'); vl.style.cssText = 'flex:0 0 36px;text-align:right;color:var(--muted);font-size:11px'; vl.textContent = Math.round(val) + suffix;
    sl.addEventListener('input', () => { const v = Number(sl.value); onChange(v); vl.textContent = v + suffix; save(); });
    wr.appendChild(sp); wr.appendChild(sl); wr.appendChild(vl); return wr;
  }

  function mkDirPicker(val: number, onChange: (v: number) => void): HTMLElement {
    const wr = document.createElement('div'); wr.style.cssText = 'display:flex;align-items:center;gap:6px';
    const sp = document.createElement('span'); sp.style.cssText = 'color:var(--muted);flex:0 0 60px;font-size:11px'; sp.textContent = 'Напрямок';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 32 32');
    svg.style.cssText = 'width:26px;height:26px;flex:0 0 26px;border:1px solid var(--line);border-radius:50%;background:var(--bg)';
    const ln = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    ln.setAttribute('x1', '16'); ln.setAttribute('y1', '4');
    ln.setAttribute('stroke', 'var(--sel)'); ln.setAttribute('stroke-width', '2.5'); ln.setAttribute('stroke-linecap', 'round');
    svg.appendChild(ln);
    const updateArrow = (deg: number) => {
      const rad = deg * Math.PI / 180;
      ln.setAttribute('x2', (16 + 12 * Math.sin(rad)).toFixed(1));
      ln.setAttribute('y2', (4  + 24 * Math.cos(rad)).toFixed(1));
    };
    updateArrow(val);
    const sl = document.createElement('input') as HTMLInputElement;
    sl.type = 'range'; sl.min = '-45'; sl.max = '45'; sl.step = '1'; sl.value = String(Math.round(val));
    sl.style.cssText = 'flex:1;accent-color:var(--sel)';
    const vl = document.createElement('span'); vl.style.cssText = 'flex:0 0 28px;text-align:right;color:var(--muted);font-size:11px'; vl.textContent = Math.round(val) + '°';
    sl.addEventListener('input', () => { const v = Number(sl.value); onChange(v); updateArrow(v); vl.textContent = v + '°'; save(); });
    wr.appendChild(sp); wr.appendChild(svg); wr.appendChild(sl); wr.appendChild(vl); return wr;
  }

  function renderAtmPanel(): void {
    if (!atmPanel) return;
    atmPanel.innerHTML = '';
    const lv = level();
    if (!lv.atmosphere) lv.atmosphere = {};

    const atm = lv.atmosphere;

    // ── НЕБО ─────────────────────────────────────────────────────────────────
    const skyEnabled = !!(atm.sky?.enabled);
    const { wrap: skyWrap, body: skyBody, setOpen: skyOpen } = makeSection('Небо', skyEnabled, (en) => {
      if (!atm.sky) atm.sky = { enabled: en, phases: [{ ...DEFAULT_SKY_PHASE }] };
      else atm.sky.enabled = en;
    }, !!(atm.sky?.static), (v) => { if (atm.sky) atm.sky.static = v; });
    if (atm.sky?.enabled) {
      skyOpen(true);
      const sky = atm.sky;
      sky.phases.forEach((ph: SkyPhase, i: number) => {
        const { card, body } = makePhaseCard(ph.durationSec, (v) => { ph.durationSec = v; }, () => {
          if (sky.phases.length > 1) { sky.phases.splice(i, 1); save(); renderAtmPanel(); } else setStatus('Мінімум 1 фаза');
        });
        body.appendChild(mkColorPicker('Небо', ph.skyHex, (v) => { ph.skyHex = v; }));
        body.appendChild(mkColorPicker('Земля', ph.groundHex, (v) => { ph.groundHex = v; }));
        skyBody.appendChild(card);
      });
      const addBtn = document.createElement('button'); addBtn.textContent = '+ Додати фазу'; addBtn.style.cssText = 'font-size:11px;padding:4px;width:100%';
      addBtn.addEventListener('click', () => { sky.phases.push({ ...DEFAULT_SKY_PHASE }); save(); renderAtmPanel(); });
      skyBody.appendChild(addBtn);
    }
    atmPanel.appendChild(skyWrap);

    // ── ЧАС ДОБИ ─────────────────────────────────────────────────────────────
    const todEnabled = !!(atm.tod?.enabled);
    const { wrap: todWrap, body: todBody, setOpen: todOpen } = makeSection('Час доби', todEnabled, (en) => {
      if (!atm.tod) atm.tod = { enabled: en, phases: [{ ...DEFAULT_TOD_PHASE }] };
      else atm.tod.enabled = en;
    }, !!(atm.tod?.static), (v) => { if (atm.tod) atm.tod.static = v; });
    if (atm.tod?.enabled) {
      todOpen(true);
      const tod = atm.tod;
      tod.phases.forEach((ph: TodPhase, i: number) => {
        const { card, body } = makePhaseCard(ph.durationSec, (v) => { ph.durationSec = v; }, () => {
          if (tod.phases.length > 1) { tod.phases.splice(i, 1); save(); renderAtmPanel(); } else setStatus('Мінімум 1 фаза');
        });
        body.appendChild(mkColorPicker('Відтінок', ph.ambientHex, (v) => { ph.ambientHex = v; }));
        body.appendChild(mkSlider('Сила', ph.ambientAlpha, 100, (v) => { ph.ambientAlpha = v; }));
        todBody.appendChild(card);
      });
      const addBtn = document.createElement('button'); addBtn.textContent = '+ Додати фазу'; addBtn.style.cssText = 'font-size:11px;padding:4px;width:100%';
      addBtn.addEventListener('click', () => { tod.phases.push({ ...DEFAULT_TOD_PHASE }); save(); renderAtmPanel(); });
      todBody.appendChild(addBtn);
    }
    atmPanel.appendChild(todWrap);

    // ── ПОГОДА ───────────────────────────────────────────────────────────────
    const wxEnabled = !!(atm.weather?.enabled);
    const { wrap: wxWrap, body: wxBody, setOpen: wxOpen } = makeSection('Погода', wxEnabled, (en) => {
      if (!atm.weather) atm.weather = { enabled: en, phases: [{ ...DEFAULT_WEATHER_PHASE }] };
      else atm.weather.enabled = en;
    }, !!(atm.weather?.static), (v) => { if (atm.weather) atm.weather.static = v; });
    if (atm.weather?.enabled) {
      wxOpen(true);
      const wx = atm.weather;
      wx.phases.forEach((ph: WeatherPhase, i: number) => {
        const { card, body } = makePhaseCard(ph.durationSec, (v) => { ph.durationSec = v; }, () => {
          if (wx.phases.length > 1) { wx.phases.splice(i, 1); save(); renderAtmPanel(); } else setStatus('Мінімум 1 фаза');
        });
        // Тип погоди
        const wxRow = document.createElement('div'); wxRow.style.cssText = 'display:flex;align-items:center;gap:4px';
        const wxLbl = document.createElement('span'); wxLbl.style.cssText = 'color:var(--muted);flex:0 0 60px;font-size:11px'; wxLbl.textContent = 'Тип';
        const wxSel = document.createElement('select') as HTMLSelectElement;
        wxSel.style.cssText = 'flex:1;background:var(--bg);border:1px solid var(--line);border-radius:4px;color:var(--ink);font-size:11px;padding:2px;font-family:inherit';
        (['clear','rain','snow','fog'] as WeatherType[]).forEach((w) => {
          const o = document.createElement('option'); o.value = w; o.textContent = WEATHER_LABELS[w]; wxSel.appendChild(o);
        });
        wxSel.value = ph.type;
        // Rain-specific controls container
        const rainBlock = document.createElement('div'); rainBlock.style.cssText = 'display:flex;flex-direction:column;gap:3px';
        const fogBlock  = document.createElement('div'); fogBlock.style.cssText = 'display:flex;flex-direction:column;gap:3px';
        const refreshBlocks = () => {
          rainBlock.style.display = ph.type === 'rain' ? 'flex' : 'none';
          fogBlock.style.display  = (ph.type === 'fog' || ph.type === 'rain') ? 'flex' : 'none';
        };
        wxSel.addEventListener('change', () => { ph.type = wxSel.value as WeatherType; refreshBlocks(); save(); });
        wxRow.appendChild(wxLbl); wxRow.appendChild(wxSel); body.appendChild(wxRow);

        // Дощ: колір, напрямок, швидкість, довжина, три шари
        rainBlock.appendChild(mkColorPicker('Колір', ph.rainColor ?? '#aaddff', (v) => { ph.rainColor = v; }));
        rainBlock.appendChild(mkDirPicker(ph.rainDir ?? 15, (v) => { ph.rainDir = v; }));
        rainBlock.appendChild(mkRangeAbs('Швидкість', ph.rainSpeed ?? 600, 50, 2000, ' px/s', (v) => { ph.rainSpeed = v; }));
        rainBlock.appendChild(mkRangeAbs('Довжина', ph.rainDropLen ?? 16, 2, 80, ' px', (v) => { ph.rainDropLen = v; }));
        rainBlock.appendChild(mkSlider('Ближній', ph.rainNear ?? 1, 100, (v) => { ph.rainNear = v; }));
        rainBlock.appendChild(mkSlider('Середній', ph.rainMid ?? 0.7, 100, (v) => { ph.rainMid = v; }));
        rainBlock.appendChild(mkSlider('Дальній', ph.rainFar ?? 0.35, 100, (v) => { ph.rainFar = v; }));

        // Туман / загальне
        fogBlock.appendChild(mkSlider('Туман', ph.fogAlpha, 100, (v) => { ph.fogAlpha = v; }));

        body.appendChild(rainBlock); body.appendChild(fogBlock);
        refreshBlocks();
        wxBody.appendChild(card);
      });
      const addBtn = document.createElement('button'); addBtn.textContent = '+ Додати фазу'; addBtn.style.cssText = 'font-size:11px;padding:4px;width:100%';
      addBtn.addEventListener('click', () => { wx.phases.push({ ...DEFAULT_WEATHER_PHASE }); save(); renderAtmPanel(); });
      wxBody.appendChild(addBtn);
    }
    atmPanel.appendChild(wxWrap);
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
    $('enemyBtn')?.classList.toggle('on', state.pathTool === 'enemy' || state.pathTool === 'enemyErase');
    $('neutralBtn')?.classList.toggle('on', state.pathTool === 'neutral' || state.pathTool === 'neutralErase');
    $('spawnBtn')?.classList.toggle('on', state.pathTool === 'spawn');
  }
  $<HTMLButtonElement>('raiseBtn')?.addEventListener('click', () => { state.pathTool = state.pathTool === 'raise' ? null : 'raise'; updatePathBtns(); setStatus(state.pathTool ? 'Підняти: тапни/тягни на клітинку' : ''); draw(); });
  $<HTMLButtonElement>('lowerBtn')?.addEventListener('click', () => { state.pathTool = state.pathTool === 'lower' ? null : 'lower'; updatePathBtns(); setStatus(state.pathTool ? 'Опустити: тапни/тягни на клітинку' : ''); draw(); });
  $<HTMLButtonElement>('flatBtn')?.addEventListener('click', () => { state.pathTool = state.pathTool === 'flat' ? null : 'flat'; updatePathBtns(); setStatus(state.pathTool ? 'Вирівняти: тапни/тягни на клітинку' : ''); draw(); });
  $<HTMLButtonElement>('walkBtn')?.addEventListener('click', () => { state.pathTool = state.pathTool === 'walk' ? null : 'walk'; updatePathBtns(); setStatus(state.pathTool ? 'Зелений колайдер (прохідність): малюй поверх вирізу ассета. Колесо — пензель' : ''); draw(); });
  // (drag/panning/painting оголошено рано — див. початок initLevelEditor)
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
  // Зона спавна нейтралів — 3×3 підлогових клітинки, фіолетова.
  function neutralAt(sx: number, sy: number): void {
    const w = toWorld(sx, sy); const gs = state.grid; const k = gs * Math.SQRT1_2;
    const fcx = Math.floor((w.x - w.y) / gs), fcy = Math.floor(w.y / k);
    if (!Number.isFinite(fcx) || !Number.isFinite(fcy)) return;
    const lv = level();
    if (state.pathTool === 'neutralErase') {
      lv.neutralSpawns = lv.neutralSpawns.filter((z) => {
        const p = z.split(','); const acx = Number(p[0]), acy = Number(p[1]);
        return !(fcx >= acx && fcx <= acx + 2 && fcy >= acy && fcy <= acy + 2);
      });
    } else {
      const key = (fcx - 1) + ',' + (fcy - 1);
      if (!lv.neutralSpawns.includes(key)) lv.neutralSpawns.push(key);
    }
    draw();
  }
  canvas.addEventListener('mousedown', (ev) => {
    const x = ev.offsetX, y = ev.offsetY;
    if (ev.button === 1) { ev.preventDefault(); panning = true; panStart = { mx: x, my: y, px: state.pan.x, py: state.pan.y }; return; }
    if (state.animLinePid && ev.button === 0) { lineDraw = { x0: x, y0: y, x1: x, y1: y }; return; } // режим «Задати лінію»
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
    // Shift+ЛКМ — мультивибір (додати/прибрати ассет або всю групу)
    if (ev.button === 0 && ev.shiftKey && !state.pathTool && !state.mode && !state.pendingAsset) {
      const hit = hitTest(x, y);
      if (hit) {
        const hp = level().placed.find((p) => p.id === hit);
        const gid = hp?.group;
        if (gid && state.openGroup !== gid) {
          // Клік на групу: перемикаємо всі її члени
          const mates = level().placed.filter((p) => p.group === gid).map((p) => p.id);
          const allIn = mates.every((id) => state.multiSel.has(id));
          if (allIn) { mates.forEach((id) => { state.multiSel.delete(id); if (state.selected === id) state.selected = null; }); }
          else { mates.forEach((id) => state.multiSel.add(id)); state.selected = hit; }
        } else {
          if (state.multiSel.has(hit)) { state.multiSel.delete(hit); if (state.selected === hit) state.selected = [...state.multiSel][0] ?? null; }
          else { state.multiSel.add(hit); state.selected = hit; }
        }
        refreshSel(); draw();
      }
      return;
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
    // Pending-нейтрал: ЛКМ виставляє нейтрала у зону спавна під курсором
    if (ev.button === 0 && state.pendingNeutral) {
      const w = toWorld(x, y); const gs = state.grid, k = gs * Math.SQRT1_2;
      const fcx = Math.floor((w.x - w.y) / gs), fcy = Math.floor(w.y / k);
      const lv = level();
      const idx = lv.neutralSpawns.findIndex((z) => { const p = z.split(','); const acx = Number(p[0]), acy = Number(p[1]); return fcx >= acx && fcx <= acx + 2 && fcy >= acy && fcy <= acy + 2; });
      if (idx >= 0) {
        pushUndo();
        const p = lv.neutralSpawns[idx].split(',');
        lv.neutralSpawns[idx] = `${Number(p[0])},${Number(p[1])},${state.pendingNeutral}`;
        save(); draw(); setStatus('Нейтрала виставлено'); return;
      }
      state.pendingNeutral = null;
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
    // Інструмент зон камери: ЛКМ — вибрати/перетягти зону або створити нову.
    if (state.camZoneTool && ev.button === 0) {
      const h = hitCamZone(x);
      if (h) {
        state.camZoneSel = h.zone.id;
        pushUndo();
        state.camZoneDrag = { id: h.zone.id, type: h.nearCamX ? 'camX' : 'zone', startSx: x, zoneX0: h.zone.x, camX0: h.zone.camX };
      } else {
        pushUndo();
        const wx = toWorld(x, y).x;
        if (!level().camZones) level().camZones = [];
        const z: CamZone = { id: 'cz-' + Date.now(), x: wx, w: 600, camX: wx, label: '' };
        level().camZones!.push(z);
        state.camZoneSel = z.id;
        state.camZoneDrag = { id: z.id, type: 'zone', startSx: x, zoneX0: wx, camX0: wx };
        save();
      }
      draw(); return;
    }
    if (state.pathTool === 'spawn') { pushUndo(); placeSpawnAt(x, y); save(); refreshSpawnUI(); return; }
    if (state.pathTool === 'enemy' || state.pathTool === 'enemyErase') { pushUndo(); enemyAt(x, y); save(); return; }
    if (state.pathTool === 'neutral' || state.pathTool === 'neutralErase') { pushUndo(); neutralAt(x, y); save(); return; }
    if (state.pathTool) { pushUndo(); painting = true; strokeCells.clear(); paintAt(x, y); return; }
    // Хендли деформації: якщо state.deformEdit → перевіряємо, чи клік потрапив у хендл
    if (state.deformEdit && ev.button === 0) {
      const p = level().placed.find((pp) => pp.id === state.deformEdit);
      const img = p ? imgOf(p) : undefined;
      if (p && img && p.deform) {
        const df = p.deform;
        const handles: Array<{ t: number; s: number }> = [];
        if (df.type === 'persp') handles.push({ t: 0, s: 0 }, { t: 1, s: 0 }, { t: 1, s: 1 }, { t: 0, s: 1 });
        else { const cols = df.cols ?? 2, rows = df.rows ?? 2; for (let ri = 0; ri <= rows; ri++) for (let ci = 0; ci <= cols; ci++) handles.push({ t: ci / cols, s: ri / rows }); }
        for (let hi = 0; hi < handles.length; hi++) {
          const sp = deformScreenPt(p, img, handles[hi].t, handles[hi].s);
          if (Math.hypot(x - sp.x, y - sp.y) <= 10) {
            pushUndo();
            state.deformHandleIdx = hi;
            state.deformDragSx0 = x; state.deformDragSy0 = y;
            state.deformDragOrigVals = [...(df.type === 'persp' ? (df.corners ?? new Array(8).fill(0)) : (df.pts ?? []))];
            return;
          }
        }
      }
    }
    const hit = hitTest(x, y);
    if (hit) {
      const hp = level().placed.find((p) => p.id === hit)!;
      const gid = hp.group;
      if (gid && state.openGroup !== gid) {
        // Клік на згруповану ассету → виділити всю групу
        state.selected = hit;
        state.multiSel.clear();
        level().placed.forEach((p) => { if (p.group === gid) state.multiSel.add(p.id); });
      } else if (state.multiSel.has(hit)) {
        // Клік на вже вибраний ассет: залишаємо multiSel, просто міняємо primary
        state.selected = hit;
      } else {
        // Звичайний клік на новий ассет: скидаємо мультивибір
        state.selected = hit; state.multiSel.clear(); state.multiSel.add(hit);
      }
      pushUndo();
      const pp = level().placed.find((p) => p.id === hit)!;
      const others = [...state.multiSel].filter((id) => id !== hit).map((id) => {
        const q = level().placed.find((p) => p.id === id)!;
        return { id, ox: q.x, oy: q.y };
      });
      drag = { x, y, ox: pp.x, oy: pp.y, others };
    } else {
      state.selected = null; state.multiSel.clear(); state.openGroup = null;
    }
    refreshSel(); draw();
  });
  window.addEventListener('mousemove', (ev) => {
    const r = canvas.getBoundingClientRect();
    state.mouse = { x: ev.clientX - r.left, y: ev.clientY - r.top };
    if (lineDraw) { lineDraw.x1 = state.mouse.x; lineDraw.y1 = state.mouse.y; draw(); return; }
    if (panning) { state.pan.x = panStart.px + (state.mouse.x - panStart.mx); state.pan.y = panStart.py + (state.mouse.y - panStart.my); applyOrigin(); draw(); return; }
    if (state.markerDrag) {
      const w = toWorld(state.mouse.x, state.mouse.y); const lv = level();
      if (state.markerDrag === 'start') lv.start = w.x;
      else if (state.markerDrag === 'end') lv.end = w.x;
      else { lv.spawns[state.spawnSel] = { x: w.x, y: w.y }; lv.spawn = lv.spawns[0]; }
      draw(); return;
    }
    if (painting) { paintAt(state.mouse.x, state.mouse.y); return; }
    // Дрег хендла деформації: конвертуємо екранну дельту → пікселі зображення
    if (state.deformHandleIdx >= 0 && state.deformEdit) {
      const p = level().placed.find((pp) => pp.id === state.deformEdit);
      if (p?.deform) {
        const dsx = state.mouse.x - state.deformDragSx0, dsy = state.mouse.y - state.deformDragSy0;
        const d = animDisp(p);
        const rRad = -rad(d.rot); const cosR = Math.cos(rRad), sinR = Math.sin(rRad);
        const kx = p.scale * (p.scaleW ?? 1) * p.flip * sc();
        const ky = p.scale * (p.scaleH ?? 1) * sc();
        // Скасовуємо: zoom → ротацію → scale+flip → отримуємо дельту в пікселях зображення
        const drx = dsx * cosR - dsy * sinR, dry = dsx * sinR + dsy * cosR;
        const dpx = drx / kx, dpy = dry / ky;
        const hi = state.deformHandleIdx;
        const orig = state.deformDragOrigVals;
        if (p.deform.type === 'persp') {
          if (!p.deform.corners) p.deform.corners = new Array(8).fill(0);
          p.deform.corners[hi * 2] = (orig[hi * 2] ?? 0) + dpx;
          p.deform.corners[hi * 2 + 1] = (orig[hi * 2 + 1] ?? 0) + dpy;
        } else {
          const totalPts = ((p.deform.cols ?? 2) + 1) * ((p.deform.rows ?? 2) + 1) * 2;
          if (!p.deform.pts || p.deform.pts.length < totalPts) p.deform.pts = new Array(totalPts).fill(0);
          p.deform.pts[hi * 2] = (orig[hi * 2] ?? 0) + dpx;
          p.deform.pts[hi * 2 + 1] = (orig[hi * 2 + 1] ?? 0) + dpy;
        }
        draw(); return;
      }
    }
    if (state.mode) { applyMode(); return; }
    if (state.pendingAsset && state.pendingTransMode) {
      const dx = state.mouse.x - state.startWx;
      if (state.pendingTransMode === 'R') state.pendingRot = dx * 0.8;
      else state.pendingScale = Math.max(0.1, Math.min(10, 1 + dx / 120));
      draw(); return;
    }
    if (state.camZoneDrag) {
      const dw = (state.mouse.x - state.camZoneDrag.startSx) / sc();
      const z = level().camZones?.find((zz) => zz.id === state.camZoneDrag!.id);
      if (z) {
        if (state.camZoneDrag.type === 'camX') z.camX = state.camZoneDrag.camX0 + dw;
        else { z.x = state.camZoneDrag.zoneX0 + dw; z.camX = state.camZoneDrag.camX0 + dw; }
      }
      draw(); return;
    }
    if (drag) {
      const p = sel();
      if (p) {
        const ddx = (state.mouse.x - drag.x) / sc(), ddy = (state.mouse.y - drag.y) / sc();
        p.x = drag.ox + ddx; p.y = drag.oy + ddy;
        for (const o of drag.others) {
          const pp = level().placed.find((q) => q.id === o.id);
          if (pp) { pp.x = o.ox + ddx; pp.y = o.oy + ddy; }
        }
        draw();
      }
    }
    else if (state.pathTool || state.pendingAsset || state.pendingEnemy || state.pendingNeutral || state.camZoneTool) draw(); // оновити прев'ю інструмента або ghost під курсором
  });
  window.addEventListener('mouseup', () => {
    if (lineDraw) {
      const w0 = toWorld(lineDraw.x0, lineDraw.y0), w1 = toWorld(lineDraw.x1, lineDraw.y1);
      const ddx = w1.x - w0.x, ddy = w1.y - w0.y; const len = Math.hypot(ddx, ddy);
      const pid = state.animLinePid; const p = level().placed.find((pp) => pp.id === pid);
      if (p && len > 2) {
        pushUndo();
        p.anim = { type: 'move', dx: ddx / len, dy: ddy / len, dist: Math.round(len), speed: p.anim?.speed ?? 40, constant: p.anim?.constant ?? false };
        save(); setStatus('Напрям руху задано');
      }
      lineDraw = null; state.animLinePid = null;
      if (p) openAssetMenu(p, lastMenuX, lastMenuY);
      draw(); return;
    }
    if (state.deformHandleIdx >= 0) { save(); state.deformHandleIdx = -1; draw(); return; }
    if (drag || painting || state.markerDrag || state.camZoneDrag) save();
    drag = null; panning = false; painting = false; state.markerDrag = null; state.camZoneDrag = null;
  });

  // Touch support: 1 finger = draw/interact, 2 fingers = pan; double-tap = toggle zoom mode (persistent)
  {
    let touchPanActive = false;
    let touchPanStart = { mx: 0, my: 0, px: 0, py: 0 };
    let singleTouchDown = false;
    let _lvZoomMode = false;
    let _lvZoomStartY = 0;
    let _lvZoomStart = 1;
    let _lvLastTapTime = 0;
    let _lvLastTapWasDrag = false;
    const cpos = (t: Touch): { x: number; y: number } => {
      const r = canvas.getBoundingClientRect();
      return { x: t.clientX - r.left, y: t.clientY - r.top };
    };
    canvas.addEventListener('touchstart', (ev) => {
      ev.preventDefault();
      if (ev.touches.length === 1) {
        const { x, y } = cpos(ev.touches[0]);
        const now = Date.now();
        if (now - _lvLastTapTime < 300 && !_lvLastTapWasDrag) {
          _lvZoomMode = !_lvZoomMode;
          if (_lvZoomMode) { _lvZoomStartY = y; _lvZoomStart = state.zoom; }
          singleTouchDown = false; _lvLastTapTime = 0; return;
        }
        if (_lvZoomMode) { _lvZoomStartY = y; _lvZoomStart = state.zoom; singleTouchDown = false; return; }
        _lvLastTapTime = now; _lvLastTapWasDrag = false;
        singleTouchDown = true; touchPanActive = false;
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
        state.selected = hit; state.multiSel.clear(); if (hit) state.multiSel.add(hit);
        if (hit) { pushUndo(); const p = sel()!; drag = { x, y, ox: p.x, oy: p.y, others: [] }; }
        refreshSel(); draw();
      } else if (ev.touches.length === 2) {
        singleTouchDown = false;
        _lvZoomMode = false; _lvLastTapTime = 0;
        if (drag || painting || state.markerDrag) save();
        drag = null; painting = false; state.markerDrag = null;
        const p1 = cpos(ev.touches[0]), p2 = cpos(ev.touches[1]);
        const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
        touchPanActive = true; _panning = true;
        touchPanStart = { mx, my, px: state.pan.x, py: state.pan.y };
      }
    }, { passive: false });
    canvas.addEventListener('touchmove', (ev) => {
      ev.preventDefault();
      if (_lvZoomMode && ev.touches.length === 1) {
        const { y } = cpos(ev.touches[0]);
        state.zoom = Math.min(3, Math.max(0.15, _lvZoomStart * Math.pow(1.8, (_lvZoomStartY - y) / 150)));
        resize(); draw(); return;
      }
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
        if (drag) { _lvLastTapWasDrag = true; const p = sel(); if (p) { p.x = drag.ox + (x - drag.x) / sc(); p.y = drag.oy + (y - drag.y) / sc(); draw(); } return; }
        if (state.pathTool) draw();
      } else if (ev.touches.length === 2 && touchPanActive) {
        const p1 = cpos(ev.touches[0]), p2 = cpos(ev.touches[1]);
        const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
        // pan only, no pinch zoom (consistent with rig editor)
        state.pan.x = touchPanStart.px + (mx - touchPanStart.mx);
        state.pan.y = touchPanStart.py + (my - touchPanStart.my);
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
        singleTouchDown = false; touchPanActive = false;
        _panning = false; draw();
      } else if (ev.touches.length === 1 && touchPanActive) {
        touchPanActive = false; singleTouchDown = true;
        _panning = false; draw();
        const { x, y } = cpos(ev.touches[0]);
        state.mouse = { x, y };
      }
    }, { passive: false });

    // Touch drag from library card → drop on canvas to place asset
    document.addEventListener('touchmove', (ev) => {
      if (!_libDragId) return;
      const t = ev.touches[0];
      if (!_libDragActive && Math.hypot(t.clientX - _libDragStartX, t.clientY - _libDragStartY) > 12) {
        _libDragActive = true;
        state.pendingAsset = _libDragId;
        state.pendingRot = 0; state.pendingScale = 1; state.pendingFlip = 1; state.pendingTransMode = null; state.pathTool = null; updatePathBtns();
        // floating ghost follows finger
        _libDragGhost = document.createElement('img');
        (_libDragGhost as HTMLImageElement).src = _libDragSrc;
        Object.assign(_libDragGhost.style, { position: 'fixed', width: '56px', height: '56px', objectFit: 'contain', pointerEvents: 'none', opacity: '0.65', zIndex: '200', transform: 'translate(-50%,-50%)', borderRadius: '8px' });
        document.body.appendChild(_libDragGhost);
        $('libGrid')?.querySelectorAll('.libCard').forEach((c) => c.classList.remove('pending'));
      }
      if (!_libDragActive) return;
      ev.preventDefault(); // prevent library scroll once drag is active
      if (_libDragGhost) { (_libDragGhost as HTMLElement).style.left = t.clientX + 'px'; (_libDragGhost as HTMLElement).style.top = t.clientY + 'px'; }
      // update mouse position on canvas for white-ghost preview
      const cr = canvas.getBoundingClientRect();
      if (t.clientX >= cr.left && t.clientX <= cr.right && t.clientY >= cr.top && t.clientY <= cr.bottom) {
        state.mouse = { x: t.clientX - cr.left, y: t.clientY - cr.top }; draw();
      }
    }, { passive: false });

    document.addEventListener('touchend', (ev) => {
      if (!_libDragId) return;
      if (_libDragGhost) { _libDragGhost.remove(); _libDragGhost = null; }
      if (_libDragActive && state.pendingAsset) {
        const t = ev.changedTouches[0];
        const cr = canvas.getBoundingClientRect();
        if (t.clientX >= cr.left && t.clientX <= cr.right && t.clientY >= cr.top && t.clientY <= cr.bottom) {
          const x = t.clientX - cr.left, y = t.clientY - cr.top;
          const a = state.assets.find((x2) => x2.id === state.pendingAsset);
          if (a) {
            pushUndo();
            const w = toWorld(x, y);
            const p: Placed = { id: 'p' + Date.now(), cat: a.cat, asset: a.id, x: w.x, y: w.y, rot: state.pendingRot, scale: state.pendingScale, flip: state.pendingFlip };
            level().placed.push(p); state.selected = p.id;
            state.pendingAsset = null; state.pendingRot = 0; state.pendingScale = 1; state.pendingFlip = 1; state.pendingTransMode = null;
            refreshSel(); draw(); save();
          }
        } else {
          state.pendingAsset = null; draw();
        }
      }
      _libDragId = ''; _libDragActive = false;
    }, { passive: true });
  }

  // ── Контекст-меню виставленого ассета (ПКМ): планарність + анімація ──
  let _assetMenuEl: HTMLDivElement | null = null;
  const _menuOutside = (e: MouseEvent): void => { if (_assetMenuEl && !_assetMenuEl.contains(e.target as Node)) closeAssetMenu(); };
  function closeAssetMenu(): void { if (_assetMenuEl) { _assetMenuEl.remove(); _assetMenuEl = null; } document.removeEventListener('mousedown', _menuOutside, true); }
  function openAssetMenu(p: Placed, clientX: number, clientY: number): void {
    lastMenuX = clientX; lastMenuY = clientY;
    closeAssetMenu();
    const mk = (tag: string, css: string | null, txt?: string): HTMLElement => { const e = document.createElement(tag); if (css) e.style.cssText = css; if (txt != null) e.textContent = txt; return e; };
    const btnCss = (active: boolean): string => `padding:5px 9px;margin:2px;border-radius:6px;border:1px solid ${active ? '#39d0ff' : '#555'};background:${active ? '#1d3b46' : '#3a3a3a'};color:#e8e8e8;cursor:pointer;font:13px sans-serif;`;
    const rebuild = (): void => openAssetMenu(p, lastMenuX, lastMenuY);
    const m = document.createElement('div'); _assetMenuEl = m;
    m.style.cssText = 'position:fixed;z-index:99999;background:#2a2a2a;border:1px solid #444;border-radius:8px;padding:10px;min-width:212px;box-shadow:0 6px 20px rgba(0,0,0,0.5);color:#e8e8e8;font:13px sans-serif;';
    const isParallax = ['sky', 'clouds', 'bg', 'frontbg', 'foreground'].includes(p.cat);
    const aname = state.assets.find((a) => a.id === p.asset)?.name ?? p.cat;
    m.appendChild(mk('div', 'font-weight:600;margin-bottom:8px;color:#9ad0ff;', '⚙ ' + aname));

    // Плановість
    m.appendChild(mk('div', 'opacity:0.7;margin:6px 0 2px;', 'Плановість' + (isParallax ? ' (далі = повільніше)' : '')));
    const prow = mk('div', 'display:flex;align-items:center;gap:6px;');
    const far = mk('button', btnCss(false), '− Дальше');
    const planVal = mk('span', 'min-width:26px;text-align:center;', String(p.plan ?? 0));
    const near = mk('button', btnCss(false), 'Ближче +');
    far.onclick = () => { pushUndo(); p.plan = (p.plan ?? 0) - 1; planVal.textContent = String(p.plan); save(); draw(); };
    near.onclick = () => { pushUndo(); p.plan = (p.plan ?? 0) + 1; planVal.textContent = String(p.plan); save(); draw(); };
    prow.append(far, planVal, near); m.appendChild(prow);

    // Анімація
    m.appendChild(mk('div', 'opacity:0.7;margin:10px 0 2px;', 'Анімація'));
    const arow = mk('div', 'display:flex;flex-wrap:wrap;');
    const none = mk('button', btnCss(!p.anim), 'Немає');
    const rotB = mk('button', btnCss(p.anim?.type === 'rotate'), 'Обертання');
    const movB = mk('button', btnCss(p.anim?.type === 'move'), 'Переміщення');
    none.onclick = () => { pushUndo(); delete p.anim; save(); draw(); rebuild(); };
    rotB.onclick = () => { pushUndo(); p.anim = { type: 'rotate', range: p.anim?.range ?? 360, speed: p.anim?.type === 'rotate' ? p.anim.speed : 60 }; save(); draw(); rebuild(); };
    movB.onclick = () => { pushUndo(); p.anim = { type: 'move', dx: p.anim?.dx ?? 1, dy: p.anim?.dy ?? 0, dist: p.anim?.dist ?? 100, speed: p.anim?.type === 'move' ? p.anim.speed : 40, constant: p.anim?.constant ?? false }; save(); draw(); rebuild(); };
    arow.append(none, rotB, movB); m.appendChild(arow);

    const numRow = (label: string, val: number, on: (v: number) => void): HTMLElement => {
      const r = mk('div', 'display:flex;align-items:center;gap:6px;margin-top:6px;');
      r.appendChild(mk('span', 'min-width:84px;opacity:0.8;', label));
      const inp = document.createElement('input'); inp.type = 'number'; inp.value = String(val);
      inp.style.cssText = 'width:70px;padding:3px 5px;background:#1f1f1f;border:1px solid #555;border-radius:5px;color:#e8e8e8;';
      inp.onchange = () => on(Number(inp.value));
      r.appendChild(inp); return r;
    };

    const an = p.anim;
    if (an?.type === 'rotate') {
      m.appendChild(numRow('Діапазон, °', an.range ?? 360, (v) => { pushUndo(); an.range = v; save(); draw(); }));
      m.appendChild(numRow('Швидкість, °/с', an.speed, (v) => { pushUndo(); an.speed = v; save(); draw(); }));
      m.appendChild(mk('div', 'opacity:0.55;margin-top:4px;font-size:11px;', '360° = безперервне; менше = туди-сюди'));
    } else if (an?.type === 'move') {
      const lineBtn = mk('button', btnCss(false) + 'display:block;width:100%;margin-top:6px;', 'Задати лінію напряму →');
      lineBtn.onclick = () => { state.animLinePid = p.id; closeAssetMenu(); setStatus('Проведи лінію напряму руху на канвасі'); draw(); };
      m.appendChild(lineBtn);
      m.appendChild(mk('div', 'opacity:0.55;margin-top:3px;font-size:11px;', 'довжина лінії = діапазон (' + (an.dist ?? 0) + ' од)'));
      m.appendChild(numRow('Швидкість, од/с', an.speed, (v) => { pushUndo(); an.speed = v; save(); draw(); }));
      const cr = mk('label', 'display:flex;align-items:center;gap:6px;margin-top:6px;cursor:pointer;');
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !!an.constant;
      cb.onchange = () => { pushUndo(); an.constant = cb.checked; save(); draw(); };
      cr.append(cb, mk('span', null, 'Постійно (без вороття)')); m.appendChild(cr);
    }

    // Деформація
    m.appendChild(mk('div', 'opacity:0.7;margin:10px 0 2px;', 'Деформація'));
    const dfrow = mk('div', 'display:flex;flex-wrap:wrap;');
    const dfNone = mk('button', btnCss(!p.deform), 'Немає');
    const dfPersp = mk('button', btnCss(p.deform?.type === 'persp'), 'Перспектива');
    const dfFfd = mk('button', btnCss(p.deform?.type === 'ffd'), 'FFD');
    dfNone.onclick = () => { pushUndo(); delete p.deform; if (state.deformEdit === p.id) state.deformEdit = null; save(); draw(); rebuild(); };
    dfPersp.onclick = () => {
      if (p.deform?.type !== 'persp') { pushUndo(); p.deform = { type: 'persp' }; save(); draw(); rebuild(); }
    };
    dfFfd.onclick = () => {
      if (p.deform?.type !== 'ffd') { pushUndo(); p.deform = { type: 'ffd', cols: 2, rows: 2 }; save(); draw(); rebuild(); }
    };
    dfrow.append(dfNone, dfPersp, dfFfd); m.appendChild(dfrow);

    if (p.deform?.type === 'ffd') {
      const df = p.deform;
      m.appendChild(numRow('Стовпці', df.cols ?? 2, (v) => {
        const nc = Math.max(1, Math.min(16, Math.round(v)));
        if (nc !== (df.cols ?? 2)) { pushUndo(); df.cols = nc; df.rows = df.rows ?? 2; df.pts = undefined as unknown as number[]; save(); draw(); rebuild(); }
      }));
      m.appendChild(numRow('Рядки', df.rows ?? 2, (v) => {
        const nr = Math.max(1, Math.min(16, Math.round(v)));
        if (nr !== (df.rows ?? 2)) { pushUndo(); df.rows = nr; df.cols = df.cols ?? 2; df.pts = undefined as unknown as number[]; save(); draw(); rebuild(); }
      }));
      m.appendChild(mk('div', 'opacity:0.55;margin-top:3px;font-size:11px;', 'Зміна поділу скидає хендли'));
    }

    if (p.deform) {
      const df = p.deform;
      const editBtn = mk('button', btnCss(state.deformEdit === p.id) + 'display:block;width:100%;margin-top:6px;', state.deformEdit === p.id ? 'Редагую хендли ✓' : 'Редагувати хендли');
      editBtn.onclick = () => { state.deformEdit = state.deformEdit === p.id ? null : p.id; draw(); rebuild(); };
      m.appendChild(editBtn);
      if (df.corners?.some((v) => v !== 0) || df.pts?.some((v) => v !== 0)) {
        const resetBtn = mk('button', 'padding:4px 9px;margin:4px 2px 0;border-radius:6px;border:1px solid #a04040;background:#3a2020;color:#ffaaaa;cursor:pointer;font:12px sans-serif;', 'Скинути хендли');
        resetBtn.onclick = () => { pushUndo(); if (p.deform) { p.deform.corners = undefined as unknown as number[]; p.deform.pts = undefined as unknown as number[]; } save(); draw(); rebuild(); };
        m.appendChild(resetBtn);
      }

      // ── Кейфрейм-анімація деформації ──
      m.appendChild(mk('div', 'opacity:0.7;margin:10px 0 3px;', 'Анімація деформації'));
      m.appendChild(numRow('Швидкість, с', df.speed ?? 1, (v) => { pushUndo(); df.speed = Math.max(0.05, v); save(); draw(); }));
      const revRow = mk('label', 'display:flex;align-items:center;gap:6px;margin-top:5px;cursor:pointer;');
      const revCb = document.createElement('input'); revCb.type = 'checkbox'; revCb.checked = !!df.reverse;
      revCb.onchange = () => { pushUndo(); df.reverse = revCb.checked; save(); draw(); };
      revRow.append(revCb, mk('span', null, 'Зворотна (пінг-понг)')); m.appendChild(revRow);
      // Галочки що записується в кейфрейм
      const mkCheck = (lbl: string, checked: boolean, onChange: (v: boolean) => void): HTMLElement => {
        const r = mk('label', 'display:flex;align-items:center;gap:6px;margin-top:4px;cursor:pointer;');
        const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = checked;
        cb.onchange = () => onChange(cb.checked);
        r.append(cb, mk('span', null, lbl)); return r;
      };
      m.appendChild(mkCheck('Запечені хендли',     !!df.baked,     (v) => { pushUndo(); df.baked     = v || undefined; save(); draw(); }));
      m.appendChild(mkCheck('Анімувати позицію',  !!df.animPos,   (v) => { pushUndo(); df.animPos   = v; save(); }));
      m.appendChild(mkCheck('Анімувати обертання', !!df.animRot,   (v) => { pushUndo(); df.animRot   = v; save(); }));
      m.appendChild(mkCheck('Анімувати масштаб',   !!df.animScale, (v) => { pushUndo(); df.animScale = v; save(); }));
      // Статус кейфреймів
      const kfCount = df.keyframes?.length ?? 0;
      const kfInfo = mk('div', 'margin-top:6px;font-size:12px;opacity:0.8;', kfCount < 2 ? `Кейфреймів: ${kfCount} · натисни K щоб записати` : `Кейфреймів: ${kfCount} · K — додати`);
      m.appendChild(kfInfo);
      if (kfCount > 0) {
        const kfResetBtn = mk('button', 'padding:4px 9px;margin-top:4px;border-radius:6px;border:1px solid #a04040;background:#3a2020;color:#ffaaaa;cursor:pointer;font:12px sans-serif;', 'Скинути кейфрейми');
        kfResetBtn.onclick = () => { pushUndo(); df.keyframes = []; save(); draw(); rebuild(); };
        m.appendChild(kfResetBtn);
      }
    }

    // Прозорий ассет: виділення ігнорує цей ассет (для туману/оверлеїв)
    const transRow = mk('label', 'display:flex;align-items:center;gap:6px;margin-top:10px;cursor:pointer;');
    const transCb = document.createElement('input'); transCb.type = 'checkbox'; transCb.checked = !!p.transparent;
    transCb.onchange = () => { pushUndo(); p.transparent = transCb.checked || undefined; save(); draw(); };
    transRow.append(transCb, mk('span', 'opacity:0.8;', 'Прозорий ассет (невибираний)')); m.appendChild(transRow);

    const cl = mk('button', btnCss(false) + 'display:block;width:100%;margin-top:10px;', 'Закрити');
    cl.onclick = () => closeAssetMenu(); m.appendChild(cl);

    document.body.appendChild(m);
    const rct = m.getBoundingClientRect();
    let left = clientX, top = clientY;
    if (left + rct.width > window.innerWidth) left = window.innerWidth - rct.width - 8;
    if (top + rct.height > window.innerHeight) top = window.innerHeight - rct.height - 8;
    m.style.left = Math.max(8, left) + 'px'; m.style.top = Math.max(8, top) + 'px';
    setTimeout(() => document.addEventListener('mousedown', _menuOutside, true), 0);
  }

  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (state.mode) { const p = sel(); if (p && state.orig) Object.assign(p, state.orig); state.mode = null; state.orig = null; draw(); return; }
    if (state.pathTool || state.pendingAsset || state.pendingEnemy || state.pendingNeutral) return; // ПКМ зайнятий інструментом
    // ПКМ у режимі зон камери — редагувати/видалити зону.
    if (state.camZoneTool) {
      const h = hitCamZone(e.offsetX);
      if (!h) return;
      const z = h.zone; state.camZoneSel = z.id; draw();
      const m = document.createElement('div');
      m.style.cssText = 'position:fixed;z-index:9999;background:#2a2a2a;border:1px solid #555;border-radius:8px;padding:10px 12px;min-width:220px;box-shadow:0 4px 16px rgba(0,0,0,.6);font:13px sans-serif;color:#e8e8e8;display:flex;flex-direction:column;gap:8px';
      m.style.left = Math.max(8, e.clientX) + 'px'; m.style.top = Math.max(8, e.clientY) + 'px';
      const row = (lbl: string, val: string, key: keyof CamZone) => {
        const r = document.createElement('label'); r.style.cssText = 'display:flex;align-items:center;gap:8px;font-size:12px';
        const sp = document.createElement('span'); sp.textContent = lbl; sp.style.cssText = 'color:#aaa;white-space:nowrap;width:80px';
        const inp = document.createElement('input'); inp.type = key === 'label' ? 'text' : 'number'; inp.value = String(val);
        inp.style.cssText = 'flex:1;padding:4px 6px;background:#3a3a3a;border:1px solid #555;border-radius:5px;color:#e8e8e8;font-size:12px';
        inp.oninput = () => { pushUndo(); (z as unknown as Record<string, unknown>)[key] = key === 'label' ? inp.value : Number(inp.value); save(); draw(); };
        r.appendChild(sp); r.appendChild(inp); return r;
      };
      m.appendChild(row('Підпис:', z.label ?? '', 'label'));
      m.appendChild(row('Ширина:', String(Math.round(z.w)), 'w'));
      m.appendChild(row('Позиція X:', String(Math.round(z.x)), 'x'));
      m.appendChild(row('Камера X:', String(Math.round(z.camX)), 'camX'));
      const delBtn = document.createElement('button'); delBtn.textContent = '🗑 Видалити зону';
      delBtn.style.cssText = 'margin-top:4px;padding:6px 10px;background:#5a2020;border:1px solid #a03030;border-radius:6px;color:#ffaaaa;cursor:pointer;font-size:12px';
      delBtn.onclick = () => { pushUndo(); level().camZones = level().camZones!.filter((zz) => zz.id !== z.id); state.camZoneSel = null; save(); draw(); m.remove(); };
      m.appendChild(delBtn);
      document.body.appendChild(m);
      const outside = (ev: MouseEvent) => { if (!m.contains(ev.target as Node)) { m.remove(); document.removeEventListener('mousedown', outside, true); } };
      setTimeout(() => document.addEventListener('mousedown', outside, true), 0);
      return;
    }
    // Shift+ПКМ — перемістити pivot у точку кліка
    if (e.shiftKey && state.selected && !state.pathTool && !state.mode) {
      const p = sel(); const img = p ? imgOf(p) : undefined;
      if (p && img) {
        const d = animDisp(p); const s2 = toScreen(d.x, d.y); s2.x += plxDx(p.cat, p.plan);
        const ddx = e.offsetX - s2.x, ddy = e.offsetY - s2.y;
        const ang = -rad(d.rot);
        const rdx = ddx * Math.cos(ang) - ddy * Math.sin(ang), rdy = ddx * Math.sin(ang) + ddy * Math.cos(ang);
        pushUndo();
        p.pivotX = rdx / (d.scale * (p.scaleW ?? 1) * p.flip * sc());
        p.pivotY = rdy / (d.scale * (p.scaleH ?? 1) * sc());
        save(); draw(); setStatus('Pivot переміщено · Shift+ПКМ на центрі — скинути');
        return;
      }
    }
    const hit = hitTest(e.offsetX, e.offsetY);
    if (hit) {
      state.selected = hit; state.multiSel.clear(); state.multiSel.add(hit);
      refreshSel(); draw(); const p = sel(); if (p) openAssetMenu(p, e.clientX, e.clientY);
    }
  });
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
    // Запам'ятати оригінали ВСІХ виділених ассетів (крім primary)
    multiOrigPos = [...state.multiSel].filter((id) => id !== p.id).map((id) => {
      const q = level().placed.find((x) => x.id === id);
      return q ? { id, x: q.x, y: q.y, rot: q.rot, scale: q.scale, scaleW: q.scaleW ?? 1, scaleH: q.scaleH ?? 1 } : null;
    }).filter((x): x is typeof multiOrigPos[0] => !!x);
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
      // Решта виділених — той самий зсув
      for (const mo of multiOrigPos) {
        const q = level().placed.find((x) => x.id === mo.id);
        if (!q) continue;
        if (state.axisLock === 'x') { q.x = mo.x + dx; q.y = mo.y; }
        else if (state.axisLock === 'z') { q.x = mo.x; q.y = mo.y + dy; }
        else { q.x = mo.x + dx; q.y = mo.y + dy; }
      }
    }
    else if (state.mode === 'R') {
      const a = Math.atan2(state.mouse.y - o.y, state.mouse.x - o.x);
      const dRot = ((a - state.startAng) * 180) / Math.PI;
      p.rot = state.orig.rot + dRot;
      // Кожен обертається навколо власного центру на той самий кут
      for (const mo of multiOrigPos) {
        const q = level().placed.find((x) => x.id === mo.id); if (q) q.rot = mo.rot + dRot;
      }
    }
    else if (state.mode === 'S') {
      const d = Math.hypot(state.mouse.x - o.x, state.mouse.y - o.y); const ratio = d / state.startDist;
      if (state.axisLock === 'x') { p.scaleW = Math.max(0.05, state.orig.scaleW * ratio); }
      else if (state.axisLock === 'z') { p.scaleH = Math.max(0.05, state.orig.scaleH * ratio); }
      else { p.scale = Math.max(0.05, state.orig.scale * ratio); }
      // Той самий ratio на решту
      for (const mo of multiOrigPos) {
        const q = level().placed.find((x) => x.id === mo.id); if (!q) continue;
        if (state.axisLock === 'x') q.scaleW = Math.max(0.05, mo.scaleW * ratio);
        else if (state.axisLock === 'z') q.scaleH = Math.max(0.05, mo.scaleH * ratio);
        else q.scale = Math.max(0.05, mo.scale * ratio);
      }
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
    // Ctrl+G — згрупувати виділені; Alt+G — відкрити групу; Shift+G — розформувати
    if (ev.code === 'KeyG' && ev.ctrlKey) {
      ev.preventDefault();
      const ids = state.multiSel.size > 1 ? [...state.multiSel] : state.selected ? [state.selected] : [];
      if (ids.length < 2) { setStatus('Виділи ≥2 ассети (Shift+ЛКМ) щоб згрупувати'); return; }
      pushUndo();
      const gid = 'g' + Date.now();
      ids.forEach((id) => { const p = level().placed.find((x) => x.id === id); if (p) p.group = gid; });
      save(); draw(); setStatus('Групу створено · Alt+G — відкрити · Shift+G — розформувати'); return;
    }
    if (ev.code === 'KeyG' && ev.altKey) {
      ev.preventDefault();
      const p = sel(); if (!p?.group) { setStatus('Спочатку виділи ассет із групою'); return; }
      state.openGroup = state.openGroup === p.group ? null : p.group;
      draw(); setStatus(state.openGroup ? 'Група відкрита · Alt+G — закрити' : 'Групу закрито'); return;
    }
    if (ev.code === 'KeyG' && ev.shiftKey) {
      ev.preventDefault();
      const p = sel(); if (!p?.group) { setStatus('Спочатку виділи ассет із групою'); return; }
      pushUndo();
      const gid = p.group;
      level().placed.forEach((x) => { if (x.group === gid) delete x.group; });
      state.openGroup = null; save(); draw(); setStatus('Групу розформовано'); return;
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
    else if (ev.code === 'KeyK') {
      ev.preventDefault();
      const p = sel(); if (!p?.deform) { setStatus('Спочатку вибери ассет із деформацією'); return; }
      pushUndo();
      if (!p.deform.keyframes) p.deform.keyframes = [];
      const kf: DeformKf = {
        corners: p.deform.corners ? [...p.deform.corners] : undefined,
        pts:     p.deform.pts     ? [...p.deform.pts]     : undefined,
      };
      if (p.deform.animPos)   { kf.x = p.x; kf.y = p.y; }
      if (p.deform.animRot)   { kf.rot   = p.rot; }
      if (p.deform.animScale) { kf.scale = p.scale; }
      p.deform.keyframes.push(kf);
      save(); draw(); setStatus(`Кейфрейм ${p.deform.keyframes.length} записано · K — додати ще · Del — скинути`);
    }
    else if (ev.code === 'KeyD' && ev.shiftKey) {
      ev.preventDefault();
      const ids = state.multiSel.size > 1 ? [...state.multiSel] : state.selected ? [state.selected] : [];
      if (!ids.length) return;
      pushUndo();
      // Якщо всі належать одній групі — нова копія отримує НОВИЙ спільний group id
      const srcGroups = new Set(ids.map((id) => level().placed.find((p) => p.id === id)?.group).filter(Boolean));
      const groupRemap = new Map<string, string>();
      srcGroups.forEach((g) => groupRemap.set(g!, 'g' + Date.now() + Math.random().toString(36).slice(2, 6)));
      const copies: Placed[] = ids.map((id, i) => {
        const src = level().placed.find((p) => p.id === id)!;
        return { ...src, id: 'p' + Date.now() + i + Math.round(performance.now()), group: src.group ? groupRemap.get(src.group) : undefined };
      });
      level().placed.push(...copies);
      state.multiSel.clear(); copies.forEach((c) => state.multiSel.add(c.id));
      state.selected = copies[0].id;
      refreshSel(); draw(); save(); startMode('G');
    }
    else if (ev.code === 'KeyF' && ev.altKey) {
      ev.preventDefault();
      // Alt+F — зняти "прозорий" з усіх ассетів (щоб їх знову можна було вибрати)
      pushUndo();
      level().placed.forEach((p) => { p.transparent = false; });
      setStatus('Прозорість знята з усіх ассетів'); draw(); save();
    }
    else if (ev.code === 'KeyH') {
      ev.preventDefault();
      if (ev.altKey) {
        // Alt+H — показати всі приховані ассети (undo-сумісно)
        pushUndo(); state.hiddenIds.clear(); setStatus('Усі скриті ассети показано'); draw();
      } else if (state.selected && !state.mode) {
        // H з вибраним ассетом — сховати його (має пріоритет над інструментом підлоги)
        pushUndo();
        const toHide = state.multiSel.size > 1 ? [...state.multiSel] : [state.selected];
        toHide.forEach((id) => state.hiddenIds.add(id));
        state.selected = null; state.multiSel.clear(); refreshSel(); draw();
        setStatus('Ассет(и) приховано · Ctrl+Z — повернути · Alt+H — показати всі');
      } else {
        // H без вибраного — інструмент підлоги (як раніше)
        state.pathTool = state.pathTool === 'h' ? null : 'h'; updatePathBtns();
        if (state.pathTool === 'h') setStatus('Підлога (земля). 1 вище / 2 нижче / 3 вирівняти');
      }
    }
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
      else {
        const ids = state.multiSel.size > 0 ? [...state.multiSel] : state.selected ? [state.selected] : [];
        if (ids.length) {
          pushUndo();
          ids.forEach((id) => { const q = level().placed.find((p) => p.id === id); if (q) q.flip *= -1; });
          draw(); save();
        }
      }
    }
    else if (ev.code === 'KeyJ') { ev.preventDefault(); if (state.snap) snapToEdge(); }
    else if (ev.code === 'Delete' || ev.code === 'Backspace') {
      ev.preventDefault();
      if (state.camZoneSel) {
        pushUndo(); level().camZones = level().camZones?.filter((z) => z.id !== state.camZoneSel); state.camZoneSel = null; save(); draw();
      } else if (state.multiSel.size > 1) {
        pushUndo();
        const toDelete = new Set(state.multiSel);
        level().placed = level().placed.filter((p) => !toDelete.has(p.id));
        state.selected = null; state.multiSel.clear(); state.openGroup = null; refreshSel(); draw(); save();
      } else { deleteSel(); }
    }
    else if (ev.code === 'Escape') {
      if (state.openGroup) {
        state.openGroup = null; draw();
      } else if (state.pendingEnemy) {
        state.pendingEnemy = null;
        $('npcList')?.querySelectorAll('.npcCard').forEach((c) => c.classList.remove('pending'));
        draw();
      } else if (state.pendingNeutral) {
        state.pendingNeutral = null;
        $('npcList')?.querySelectorAll('.npcCard').forEach((c) => c.classList.remove('pending'));
        draw();
      } else if (state.pendingAsset) {
        state.pendingAsset = null; state.pendingRot = 0; state.pendingScale = 1; state.pendingFlip = 1; state.pendingTransMode = null;
        $('libGrid')?.querySelectorAll('.libCard').forEach((c) => c.classList.remove('pending'));
        draw();
      } else if (state.multiSel.size > 1) {
        state.multiSel.clear(); state.selected = null; refreshSel(); draw();
      } else if (state.mode) {
        const p = sel(); if (p && state.orig) Object.assign(p, state.orig);
        // Відкотити решту виділених до їх оригіналів
        for (const mo of multiOrigPos) {
          const q = level().placed.find((x) => x.id === mo.id);
          if (q) { q.x = mo.x; q.y = mo.y; q.rot = mo.rot; q.scale = mo.scale; q.scaleW = mo.scaleW; q.scaleH = mo.scaleH; }
        }
        multiOrigPos = []; state.mode = null; state.orig = null; state.axisLock = null; draw();
      }
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
  $<HTMLButtonElement>('camZoneBtn')?.addEventListener('click', () => {
    state.camZoneTool = !state.camZoneTool;
    $('camZoneBtn')?.classList.toggle('on', state.camZoneTool);
    if (state.camZoneTool) { state.pathTool = null; updatePathBtns(); setStatus('Зони камери: ЛКМ — додати зону · Тягни смугу — перемістити · Тягни жовту лінію — змістити позицію камери · ПКМ на зону — редагувати/видалити'); }
    else setStatus('');
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
  // Lazy-load: src не ставимо в HTML, щоб не запускати 3 Phaser-інстанси водночас на iOS.
  // Ставимо тут — лише той iframe, що відповідає активному редактору.
  if (lvPreviewFrame && !lvPreviewFrame.getAttribute('src')) lvPreviewFrame.src = gameUrl;
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

  const lv_gridBtn = $<HTMLButtonElement>('gridBtn');
  lv_gridBtn?.addEventListener('click', () => {
    state.showGrid = !state.showGrid;
    lv_gridBtn.classList.toggle('on', state.showGrid);
    draw();
  });
  // showDebugBtn = колайдери + спавни (одна кнопка)
  const showDebugBtn = $<HTMLButtonElement>('showDebugBtn');
  showDebugBtn?.addEventListener('click', () => {
    const on = !state.showCollider;
    state.showCollider = on; state.showEnemySpawns = on; state.showPlayerSpawns = on;
    showDebugBtn.classList.toggle('on', on);
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
  const showAtmBtn = $<HTMLButtonElement>('showAtmBtn');
  showAtmBtn?.addEventListener('click', () => {
    state.showAtm = !state.showAtm;
    showAtmBtn.classList.toggle('on', state.showAtm);
    draw();
  });
  const showAnimBtn = $<HTMLButtonElement>('showAnimBtn');
  showAnimBtn?.addEventListener('click', () => {
    state.showAnim = !state.showAnim;
    showAnimBtn.classList.toggle('on', state.showAnim);
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
    const toolbar = $('levelToolbar');
    const stage = canvas.getBoundingClientRect();
    const w = 170;
    const toolbarTop = toolbar ? toolbar.getBoundingClientRect().top : window.innerHeight;
    const bottomOffset = window.innerHeight - toolbarTop + 8; // 8px above toolbar
    const maxH = Math.max(120, toolbarTop - stage.top - 16);
    fillMenu.style.position = 'fixed';
    fillMenu.style.left = (stage.right - w - 16) + 'px';
    fillMenu.style.right = 'auto';
    fillMenu.style.top = 'auto';
    fillMenu.style.bottom = bottomOffset + 'px';
    fillMenu.style.width = w + 'px';
    fillMenu.style.flexDirection = 'column';
    fillMenu.style.maxHeight = maxH + 'px';
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
      c.globalCompositeOperation = 'source-atop';
      c.fillStyle = 'rgba(220,30,30,0.72)'; c.fillRect(0, 0, cv.width, cv.height);
      npcTinted.set(item.id, cv); draw();
    };
    img.src = item.thumb;
  }
  function buildNpcNeutralTint(item: LibItem): void { // фіолетова тонована мініатюра
    if (!item.thumb || npcNeutralTinted.has(item.id)) return;
    const img = new Image();
    img.onload = () => {
      const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
      const c = cv.getContext('2d'); if (!c) return;
      c.drawImage(img, 0, 0);
      c.globalCompositeOperation = 'source-atop';
      c.fillStyle = 'rgba(140,30,220,0.72)'; c.fillRect(0, 0, cv.width, cv.height);
      npcNeutralTinted.set(item.id, cv); draw();
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
      const neutrals = npcLib.filter((x) => x.cat === 'neutral');
      if (!neutrals.length) {
        const e = document.createElement('div'); e.className = 'npcEmpty';
        e.textContent = 'Немає нейтралів. Створи персонажа з категорією «Нейтрали» у редакторі персонажів.';
        npcList.appendChild(e); return;
      }
      for (const it of neutrals) {
        buildNpcNeutralTint(it);
        if (it.thumb && !npcImages.has(it.id)) {
          const img = new Image(); img.src = it.thumb; npcImages.set(it.id, img);
        }
        const card = document.createElement('div'); card.className = 'npcCard'; card.title = it.name; card.draggable = true;
        if (state.pendingNeutral === it.id) card.classList.add('pending');
        if (it.thumb) { const im = document.createElement('img'); im.src = it.thumb; card.appendChild(im); }
        const nm = document.createElement('div'); nm.className = 'npcName'; nm.textContent = it.name; card.appendChild(nm);
        card.addEventListener('dragstart', (e) => { (e as DragEvent).dataTransfer?.setData('text/neutral-id', it.id); });
        card.addEventListener('click', () => {
          const active = state.pendingNeutral === it.id;
          state.pendingNeutral = active ? null : it.id;
          state.pendingEnemy = null; state.pendingAsset = null;
          if (!active) { state.pathTool = null; updatePathBtns(); } // вибір з бібліотеки вимикає інструменти (спавн-зони тощо)
          npcList.querySelectorAll('.npcCard').forEach((c) => c.classList.remove('pending'));
          if (!active) card.classList.add('pending');
          draw();
        });
        npcList.appendChild(card);
      }
      return;
    }
    const enemies = npcLib.filter((x) => x.cat === 'enemy');
    if (!enemies.length) {
      const e = document.createElement('div'); e.className = 'npcEmpty';
      e.textContent = 'Немає ворогів. Створи персонажа з категорією «Ворог» у редакторі персонажів.';
      npcList.appendChild(e); return;
    }
    for (const it of enemies) {
      buildNpcTint(it);
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
        state.pendingNeutral = null; state.pendingAsset = null;
        if (!active) { state.pathTool = null; updatePathBtns(); } // вибір з бібліотеки вимикає інструменти (спавн-зони тощо)
        npcList.querySelectorAll('.npcCard').forEach((c) => c.classList.remove('pending'));
        if (!active) card.classList.add('pending');
        draw();
      });
      npcList.appendChild(card);
    }
  }
  loadCharLibrary().then((lib) => { npcLib = lib; renderNpc(); }).catch(() => {});

  // Drag ворога / нейтрала з бібліотеки → призначити зоні спавна під курсором.
  canvas.addEventListener('dragover', (e) => e.preventDefault());
  canvas.addEventListener('drop', (e) => {
    e.preventDefault();
    const enemyId = (e as DragEvent).dataTransfer?.getData('text/enemy-id');
    const neutralId = (e as DragEvent).dataTransfer?.getData('text/neutral-id');
    const w = toWorld((e as DragEvent).offsetX, (e as DragEvent).offsetY);
    const gs = state.grid, k = gs * Math.SQRT1_2;
    const fcx = Math.floor((w.x - w.y) / gs), fcy = Math.floor(w.y / k);
    const lv = level();
    if (enemyId) {
      const idx = lv.enemySpawns.findIndex((z) => { const p = z.split(','); const acx = Number(p[0]), acy = Number(p[1]); return fcx >= acx && fcx <= acx + 2 && fcy >= acy && fcy <= acy + 2; });
      if (idx < 0) { setStatus('Кинь на червону зону спавна'); return; }
      pushUndo();
      const p = lv.enemySpawns[idx].split(',');
      lv.enemySpawns[idx] = `${Number(p[0])},${Number(p[1])},${enemyId}`;
      save(); draw(); setStatus('Ворога призначено зоні');
    } else if (neutralId) {
      const idx = lv.neutralSpawns.findIndex((z) => { const p = z.split(','); const acx = Number(p[0]), acy = Number(p[1]); return fcx >= acx && fcx <= acx + 2 && fcy >= acy && fcy <= acy + 2; });
      if (idx < 0) { setStatus('Кинь на фіолетову зону спавна'); return; }
      pushUndo();
      const p = lv.neutralSpawns[idx].split(',');
      lv.neutralSpawns[idx] = `${Number(p[0])},${Number(p[1])},${neutralId}`;
      save(); draw(); setStatus('Нейтрала призначено зоні');
    }
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
    // Merged spawn button: LMB = act, RMB = toggle label
    const spawnBtn = $<HTMLButtonElement>('spawnBtn');
    let _spawnMode: 'add' | 'del' = 'add';
    if (spawnBtn) {
      spawnBtn.textContent = 'Додати стартову';
      spawnBtn.addEventListener('contextmenu', (ev) => {
        ev.preventDefault();
        _spawnMode = _spawnMode === 'add' ? 'del' : 'add';
        spawnBtn.textContent = _spawnMode === 'add' ? 'Додати стартову' : 'Прибрати стартову';
        spawnBtn.classList.remove('on');
        if (state.pathTool === 'spawn') { state.pathTool = null; updatePathBtns(); draw(); }
      });
      spawnBtn.addEventListener('click', () => {
        if (_spawnMode === 'add') {
          const lv = level();
          if (state.pathTool === 'spawn') { state.pathTool = null; updatePathBtns(); draw(); return; }
          if (lv.spawns.length >= 5) { setStatus('Максимум 5 точок спавна'); return; }
          pushUndo(); const w = toWorld(canvas.width / 2, state.origin.y);
          lv.spawns.push({ x: Math.round(w.x), y: 0 }); lv.spawn = lv.spawns[0];
          state.spawnSel = lv.spawns.length - 1;
          state.pathTool = 'spawn'; updatePathBtns();
          save(); refreshSpawnUI(); draw();
          setStatus(`Тицьни на колайдер — там зʼявиться спавн ${state.spawnSel + 1}`);
        } else {
          const lv = level(); if (lv.spawns.length <= 1) { setStatus('Має лишитись хоча б 1 спавн'); return; }
          pushUndo(); lv.spawns.splice(state.spawnSel, 1);
          state.spawnSel = Math.min(state.spawnSel, lv.spawns.length - 1); lv.spawn = lv.spawns[0];
          save(); refreshSpawnUI(); draw();
        }
      });
    }
    // Merged enemy button: LMB = act current mode, RMB = toggle label
    const enemyBtn = $<HTMLButtonElement>('enemyBtn');
    let _enemyMode: 'add' | 'erase' = 'add';
    if (enemyBtn) {
      enemyBtn.textContent = 'Додати ворогів';
      enemyBtn.addEventListener('contextmenu', (ev) => {
        ev.preventDefault();
        _enemyMode = _enemyMode === 'add' ? 'erase' : 'add';
        enemyBtn.textContent = _enemyMode === 'add' ? 'Додати ворогів' : 'Прибрати ворогів';
        enemyBtn.classList.remove('on');
        if (state.pathTool === 'enemy' || state.pathTool === 'enemyErase') { state.pathTool = null; updatePathBtns(); draw(); }
      });
      enemyBtn.addEventListener('click', () => {
        const tool: 'enemy' | 'enemyErase' = _enemyMode === 'add' ? 'enemy' : 'enemyErase';
        state.pathTool = state.pathTool === tool ? null : tool;
        updatePathBtns();
      });
    }
    // Neutral button: LMB = act current mode, RMB = toggle label
    const neutralBtn = $<HTMLButtonElement>('neutralBtn');
    let _neutralMode: 'add' | 'erase' = 'add';
    if (neutralBtn) {
      neutralBtn.textContent = 'Додати нейтрала';
      neutralBtn.addEventListener('contextmenu', (ev) => {
        ev.preventDefault();
        _neutralMode = _neutralMode === 'add' ? 'erase' : 'add';
        neutralBtn.textContent = _neutralMode === 'add' ? 'Додати нейтрала' : 'Прибрати нейтрала';
        neutralBtn.classList.remove('on');
        if (state.pathTool === 'neutral' || state.pathTool === 'neutralErase') { state.pathTool = null; updatePathBtns(); draw(); }
      });
      neutralBtn.addEventListener('click', () => {
        const tool: 'neutral' | 'neutralErase' = _neutralMode === 'add' ? 'neutral' : 'neutralErase';
        state.pathTool = state.pathTool === tool ? null : tool;
        updatePathBtns();
      });
    }
    refreshSpawnUI();
  }

  function buildLevelDoc(): unknown {
    const lv = level();
    const used = state.assets.filter((a) => lv.placed.some((p) => p.asset === a.id));
    const doc: Record<string, unknown> = { name: lv.name, placed: lv.placed, collider: lv.collider, enemySpawns: lv.enemySpawns, neutralSpawns: lv.neutralSpawns, grid: state.grid, spawn: lv.spawns[0] ?? lv.spawn, spawns: lv.spawns, start: lv.start, end: lv.end, parallax: ensureParallax(lv), assets: used };
    if (lv.atmosphere) doc.atmosphere = lv.atmosphere;
    if (lv.camZones?.length) doc.camZones = lv.camZones;
    return doc;
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
  // Збирач файлів рівня для спільної публікації (один коміт на всі редактори, src/publish.ts).
  // У standalone level.html це єдиний збирач; у studio.html — поряд із персонажами/локаціями/картами.
  registerPublisher(async () => {
    const level = buildLevelDoc();
    idbSet('zag_level', level).catch(() => {});
    const behaviors = await gatherBehaviors();
    return {
      'public/level.json': JSON.stringify(level),
      'public/studio-data/level-assets.json': JSON.stringify(state.assets),
      'public/studio-data/level-layouts.json': JSON.stringify({ levels: state.levels, cur: state.cur }),
      // Поведінки НПС — щоб дерева ворогів цього рівня працювали на всіх пристроях.
      'public/studio-data/behaviors.json': JSON.stringify(behaviors),
    };
  });
  wirePublishButton($<HTMLButtonElement>('toGame'), setStatus);
  $<HTMLButtonElement>('mobSave')?.addEventListener('click', () => $<HTMLButtonElement>('saveLevelBtn')?.click());
  $<HTMLButtonElement>('mobPublish')?.addEventListener('click', () => $<HTMLButtonElement>('toGame')?.click());
  $<HTMLButtonElement>('mobSync')?.addEventListener('click', () => {
    setStatus('Синхронізую з GitHub…');
    pullLevelData().then(({ assets: remoteAssets, layouts: remoteLayouts }) => {
      // Форс-синхронізація: remote перемагає незалежно від часових міток.
      const remoteLevels = (remoteLayouts?.levels as Level[] | undefined)?.map((lv) => { migrateLevel(lv); return lv; }) ?? [];
      if (remoteLevels.length) {
        const curId = state.levels[state.cur]?.id;
        // Форс-замінюємо remote поверх local (ігноруємо LWW — кнопка ручна).
        const remoteMap = new Map(remoteLevels.map((lv) => [lv.id, lv]));
        state.levels = state.levels.map((lv) => remoteMap.get(lv.id) ?? lv);
        for (const rl of remoteLevels) if (!state.levels.find((l) => l.id === rl.id)) state.levels.push(rl);
        const i = curId ? state.levels.findIndex((lv) => lv.id === curId) : 0;
        state.cur = i >= 0 ? i : 0;
        state.grid = level().grid;
        idbSet('zag_levels', { levels: state.levels, cur: state.cur }).catch(() => {});
        refreshLevels(); draw();
      }
      const remoteFiltered = (remoteAssets ?? []).filter((r) => !deletedIds.has((r as Asset).id));
      const { merged, added } = mergeLevelAssets(state.assets, remoteFiltered);
      if (added > 0) {
        state.assets = merged as Asset[];
        for (const as of state.assets.slice(-added)) loadImg(as);
        idbSet('zag_assets', state.assets).catch(() => {});
        refreshAssets();
      }
      setStatus(`Синхронізовано: ${remoteLevels.length} рівнів, ${remoteFiltered.length} ассетів`);
    }).catch(() => setStatus('Помилка синхронізації'));
  });

  // Висоту тулбару/AI-панелей задає ЄДИНИЙ писар у rig/main.ts через CSS-змінну
  // --panel-h (вимірює видимий таймлайн і застосовує до всіх панелей). Тут лише
  // ре-рендер канви при зміні видимості/розміру.
  window.addEventListener('levelTabActivated', () => {
    resize(); draw();
    // Бібліотека НПС кешується в пам'яті й вантажиться раз на старті. Якщо створили
    // ворога/нейтрала в редакторі персонажів у цій же сесії — форсуємо перечитування,
    // інакше список лишається стабільно порожнім до перезавантаження сторінки.
    loadCharLibrary(true).then((lib) => { npcLib = lib; renderNpc(); }).catch(() => {});
  });
  window.addEventListener('resize', () => { resize(); draw(); });

  load().then(() => {
    resize(); refreshLevels(); refreshCatSelect(); refreshAssets(); refreshSel(); draw();
    wireSpawnControls();
    if (state.camView) { snapCamView(); $('camViewBtn')?.classList.add('on'); }
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
