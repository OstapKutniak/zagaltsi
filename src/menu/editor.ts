// Редактор Меню (вкладка студії): сторінки меню гри з кнопками-гіперпосиланнями.
// Ліворуч — бібліотека PNG-ассетів (клік = фон сторінки), центр — прев'ю сторінки
// 20:9 (кнопки тягнуться мишею), праворуч — сторінки + властивості кнопки,
// знизу — тулбар із «Мапою переходів» (граф: яка кнопка на яку сторінку веде).
// Дані: MenuDoc → IDB zag_menu → публікація menu.json. Гра (MenuScene) читає їх.

import { idbGet, idbSet } from '../store';
import { registerPublisher, wirePublishButton } from '../publish';
import { initStoryEditor } from '../story/editor';
import { keyDataUrl } from '../rig/keyer';
import type { PlacedAnim, PlacedDeform } from '../level/LevelView';
import {
  fxDisp, fxDeformAt, drawDeformedImage, drawDeformHandles, hitDeformHandle,
  applyHandleDrag, recordDeformKeyframe, openFxObjMenu, PLAN_NAMES, type DeformView,
} from '../level/placedFx';
import { type Atmosphere, type LayerKey, weatherToggles, type WeatherPhase } from '../level/atmosphere';
import { buildAtmospherePanel } from '../level/atmospherePanel';
import { drawFogLayerCanvas, drawRainCanvas, drawVignetteCanvas, applyColorBalanceCanvas } from '../level/atmoPreview';

export interface MenuButton {
  id: string; label: string;
  x: number; y: number;      // логічні координати кадру 1280×576
  size: number;              // px шрифту
  target: string;            // 'world' | 'game' | 'section:Назва' | 'page:<id>' | ''
}
// Розміщений на сторінці PNG-об'єкт (декор). Плановість = depth (менше — далі/ззаду,
// за персонажем; більше — ближче). Анімація/деформація — як у редакторі рівнів
// (типи спільні), додаються наступним етапом.
export interface MenuObject {
  id: string;
  url: string;               // dataURL зображення (вбудований, як bg — щоб гра малювала без окремих ассетів)
  name?: string;
  x: number; y: number;      // центр, логічні координати 1280×576
  scale: number;
  rot?: number;              // градуси
  flip?: boolean;            // дзеркалення по X
  depth: number;             // плановість: 1..7 (5 = рівень персонажа/вогню)
  anim?: PlacedAnim;         // майбутнє: обертання/дрейф
  deform?: PlacedDeform;     // майбутнє: перспектива/FFD + кейфрейми
}
// Ефекти сцени меню — усе, що раніше було зашито в код MenuScene, тепер редаговане:
// персонаж біля вогню, вогнище, вікно дощу (прямокутник + шибки), блискавка.
export interface MenuFx {
  char: { on: boolean; x: number; y: number; scale: number };
  fire: { on: boolean; x: number; y: number; scale: number; glow: number };
  rain: { on: boolean; x0: number; y0: number; x1: number; y1: number; panes: boolean; dir: number; alpha: number; speed: number };
  bolt: { on: boolean; every: number; vary: number; bright: number };
}
// Дефолти = значення, під які зведено лобі (та сама хатина).
export const DEFAULT_FX: MenuFx = {
  char: { on: true, x: 800, y: 205, scale: 1.55 },
  fire: { on: true, x: 640, y: 492, scale: 1, glow: 0.16 },
  rain: { on: true, x0: 595, y0: 140, x1: 682, y1: 285, panes: true, dir: -25, alpha: 0.5, speed: 1600 },
  bolt: { on: true, every: 11, vary: 0.77, bright: 1 },
};
// Персонаж сторінки: позиція/масштаб/анімація (до 5 на сторінку; ПКМ — анімація).
export interface MenuChar {
  id: string; x: number; y: number; scale: number;
  anim: string;              // 'sit' | 'idle' | 'walk' | 'run' ...
  flip?: boolean;
}
export interface MenuPage {
  id: string; name: string;
  bg: string;                // dataURL фону ('' = чорний)
  buttons: MenuButton[];
  objects?: MenuObject[];    // розміщені PNG-об'єкти (декор) із плановістю
  fx?: MenuFx;               // ефекти сцени (нема — гра бере DEFAULT_FX)
  chars?: MenuChar[];        // персонажі сторінки (нема — легасі fx.char)
  atmosphere?: Atmosphere;   // плановість/погода/віньєтка/баланс — як у Мандрах
}
export interface MenuDoc { version: 1; pages: MenuPage[]; updatedAt?: number }

const FRAME_W = 1280, FRAME_H = 576;
const MENU_FONT = 'Georgia, "Times New Roman", serif';

// Вбудовані цілі (не-сторінки) для гіперпосилань.
const FIXED_TARGETS: Array<{ v: string; l: string }> = [
  { v: '', l: '— нікуди (заглушка)' },
  { v: 'world', l: 'Мандри (глобальна карта)' },
  { v: 'game', l: 'Бітемап-рівень (гра)' },
  { v: 'khorugva', l: 'Хоругва (паті)' },
  { v: 'quests', l: 'Завдання' },
  { v: 'achievements', l: 'Досягнення' },
  { v: 'inventory', l: 'Інвентар (спорядження)' },
  { v: 'section:Завдання', l: 'Розділ: Завдання' },
  { v: 'section:Прогрес', l: 'Розділ: Прогрес' },
  { v: 'section:Інвентар', l: 'Розділ: Інвентар' },
];

let _init = false;
export function initMenuEditor(prefix: string): void {
  if (_init) return; _init = true;
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(prefix + id) as T | null;
  const canvas = $('stage') as HTMLCanvasElement | null;
  if (!canvas) return;
  const ctx = canvas.getContext('2d')!;

  let _uid = Date.now();
  const uid = (): string => (++_uid).toString(36);

  // Усі 6 розділів гри — окремі сторінки редактора (декор/атмосфера/персонажі
  // сторінки застосовуються у грі при морфі в цей розділ). 'main' = Житло (лобі).
  const SECTION_PAGES: Array<{ id: string; name: string }> = [
    { id: 'main', name: 'Житло' },
    { id: 'world', name: 'Мандри' },
    { id: 'khorugva', name: 'Хоругва' },
    { id: 'quests', name: 'Завдання' },
    { id: 'achievements', name: 'Досягнення' },
    { id: 'inventory', name: 'Інвентар' },
  ];
  // Дефолт = СПРАВЖНЄ меню гри (як хардкод ITEMS у MenuScene) — інакше публікація
  // дефолтної сторінки «з'їдала» кнопки Хоругва/Досягнення.
  const defaultDoc = (): MenuDoc => {
    const doc: MenuDoc = { version: 1, pages: [] };
    ensurePages(doc);
    return doc;
  };
  // Доводить документ до повного набору розділів (додає відсутні сторінки).
  function ensurePages(doc: MenuDoc): boolean {
    let changed = false;
    // Легасі-назва головної сторінки: «Головна» → «Житло» (це і є розділ Житло).
    const main = doc.pages.find((p) => p.id === 'main');
    if (main && main.name === 'Головна') { main.name = 'Житло'; changed = true; }
    for (const sp of SECTION_PAGES) {
      if (doc.pages.some((p) => p.id === sp.id)) continue;
      const page: MenuPage = { id: sp.id, name: sp.name, bg: '', buttons: [] };
      if (sp.id === 'main') {
        // Ті самі 6 пунктів, що й хардкод ITEMS у MenuScene, тими ж координатами.
        page.buttons = [
          { id: uid(), label: 'Житло', x: 92, y: 176, size: 34, target: 'home' },
          { id: uid(), label: 'Мандри', x: 92, y: 244, size: 34, target: 'world' },
          { id: uid(), label: 'Хоругва', x: 92, y: 312, size: 34, target: 'khorugva' },
          { id: uid(), label: 'Завдання', x: 92, y: 380, size: 34, target: 'quests' },
          { id: uid(), label: 'Досягнення', x: 92, y: 448, size: 34, target: 'achievements' },
          { id: uid(), label: 'Інвентар', x: 92, y: 516, size: 34, target: 'inventory' },
        ];
        doc.pages.unshift(page);
      } else doc.pages.push(page);
      changed = true;
    }
    return changed;
  }

  const state = {
    doc: defaultDoc(),
    cur: 0,
    sel: null as string | null,
    view: 'page' as 'page' | 'map',
    preview: true, // чисте прев'ю 20:9 (без рамок/підписів/гізмо редактора) — УВІМК за замовчуванням: одразу видно фактичний кадр гри; вимкни кнопкою, щоб редагувати
    bgImgs: new Map<string, HTMLImageElement>(), // pageId → фон
    assets: [] as Array<{ id: string; name: string; url: string }>,
    drag: null as null | { id: string; ox: number; oy: number },
    dragFx: null as null | { kind: 'char' | 'fire' | 'rain' | 'rainSize'; ox: number; oy: number },
    charThumb: null as HTMLImageElement | null, // портрет персонажа для гізмо
    lastClick: 0,
    linkFrom: null as null | { pageId: string; btnId: string }, // мапа: тягнемо лінк
    mapRects: [] as Array<{ pageId: string; x: number; y: number; w: number; h: number; btns: Array<{ id: string; y: number; h: number }> }>,
    // Розміщені PNG-об'єкти сторінки
    selObj: null as string | null,
    dragObj: null as null | { id: string; ox: number; oy: number },
    resizeObj: null as null | { id: string; cx: number; cy: number; startDist: number; startScale: number },
    objImgs: new Map<string, HTMLImageElement>(), // objId → зображення
    // Деформація: редагування хендлів обраного об'єкта (як у Редакторі Мандр)
    deformEdit: null as string | null,
    deformHandleIdx: -1,
    deformDragSx0: 0, deformDragSy0: 0,
    deformDragOrigVals: [] as number[],
    // «Задати лінію напряму» анімації переміщення (координати кадру)
    moveLine: null as null | { id: string; x0?: number; y0?: number; x1?: number; y1?: number },
    // Персонажі сторінки
    selChar: null as string | null,
    dragChar: null as null | { id: string; ox: number; oy: number },
    // Клавіатурні трансформації G/R/S (об'єкт/кнопка/персонаж) + вісь X/Z
    kbMode: null as null | 'G' | 'R' | 'S',
    kbAxis: null as null | 'x' | 'z',
    kbStart: { mx: 0, my: 0, ang: 0, dist: 1 },
    kbOrig: null as null | { x: number; y: number; rot: number; scale: number; size: number },
    // Прев'ю атмосфери (кнопкою можна вимкнути)
    showAtm: true,
  };
  const page = (): MenuPage => state.doc.pages[state.cur];
  const objs = (): MenuObject[] => (page().objects ??= []);
  const chars = (): MenuChar[] => (page().chars ??= []);
  const lastMouse = { x: 0, y: 0 }; // остання позиція миші на канвасі (для G/R/S)
  const selectedChar = (): MenuChar | null => chars().find((c) => c.id === state.selChar) ?? null;

  // Ціль клавіатурної трансформації: виділений об'єкт / персонаж / кнопка.
  type KbTarget = { kind: 'obj'; o: MenuObject } | { kind: 'char'; c: MenuChar } | { kind: 'btn'; b: MenuButton };
  function kbTarget(): KbTarget | null {
    const o = objs().find((x) => x.id === state.selObj);
    if (o) return { kind: 'obj', o };
    const c = selectedChar();
    if (c) return { kind: 'char', c };
    const b = page().buttons.find((x) => x.id === state.sel);
    if (b) return { kind: 'btn', b };
    return null;
  }

  // ── Годинник анімацій об'єктів (грає, поки не тягнемо/не редагуємо хендли) ──
  let animClock = 0; let animRaf = 0; let animLast = 0;
  const hasFx = (): boolean => objs().some((o) => o.anim || ((o.deform?.keyframes?.length ?? 0) >= 2));
  const fxPlaying = (): boolean =>
    hasFx() && canvas!.offsetWidth > 0 && !state.dragObj && !state.resizeObj && !state.dragChar
    && state.deformEdit == null && !state.moveLine && !state.kbMode && state.view === 'page';
  function tickAnim(ts: number): void {
    animRaf = 0;
    if (!fxPlaying()) { animLast = 0; return; }
    if (animLast) animClock += Math.min((ts - animLast) / 1000, 0.1);
    animLast = ts;
    draw();
    animRaf = requestAnimationFrame(tickAnim);
  }
  function ensureAnimLoop(): void {
    if (fxPlaying() && !animRaf) { animLast = 0; animRaf = requestAnimationFrame(tickAnim); }
  }
  // fx поточної сторінки (створюється з дефолтів при першому доступі)
  const fx = (): MenuFx => (page().fx ??= JSON.parse(JSON.stringify(DEFAULT_FX)) as MenuFx);
  const setStatus = (m: string): void => { const el = $('statusBar'); if (el) el.textContent = m; };

  let saveTimer = 0;
  function save(): void {
    state.doc.updatedAt = Date.now();
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => { void idbSet('zag_menu', state.doc); }, 250);
  }

  // ── Контекстне меню (DOM-попап) ──────────────────────────────────────────────
  let ctxEl: HTMLDivElement | null = null;
  function closeCtx(): void { ctxEl?.remove(); ctxEl = null; }
  function showCtxMenu(clientX: number, clientY: number, items: Array<{ label: string; on: () => void } | 'sep'>): void {
    closeCtx();
    const m = document.createElement('div');
    m.style.cssText = 'position:fixed;z-index:9999;min-width:190px;background:#1d1d1f;border:1px solid #3a3a3a;border-radius:8px;padding:4px;box-shadow:0 8px 28px rgba(0,0,0,.55);font-size:13px;color:#e5d8bc';
    for (const it of items) {
      if (it === 'sep') { const s = document.createElement('div'); s.style.cssText = 'height:1px;background:#3a3a3a;margin:4px 2px'; m.appendChild(s); continue; }
      const b = document.createElement('div');
      b.textContent = it.label;
      b.style.cssText = 'padding:6px 10px;border-radius:5px;cursor:pointer;white-space:nowrap';
      b.onmouseenter = () => { b.style.background = 'var(--accent)'; b.style.color = '#1b1b1b'; };
      b.onmouseleave = () => { b.style.background = ''; b.style.color = '#e5d8bc'; };
      b.onclick = () => { closeCtx(); it.on(); };
      m.appendChild(b);
    }
    document.body.appendChild(m);
    // тримаємо в межах вікна
    const r = m.getBoundingClientRect();
    m.style.left = Math.min(clientX, window.innerWidth - r.width - 6) + 'px';
    m.style.top = Math.min(clientY, window.innerHeight - r.height - 6) + 'px';
    ctxEl = m;
  }
  window.addEventListener('mousedown', (e) => { if (ctxEl && !ctxEl.contains(e.target as Node)) closeCtx(); }, true);
  window.addEventListener('scroll', closeCtx, true);

  // Розмістити ассет як об'єкт на поточній сторінці (дефолт — центр кадру).
  function placeObject(asset: { name: string; url: string }, naturalH: number, fx = 640, fy = 300): void {
    const targetH = 230; // бажана логічна висота за замовчуванням
    const sc = naturalH ? Math.min(1.5, Math.round(targetH / naturalH * 1000) / 1000) : 0.5;
    const o: MenuObject = { id: uid(), url: asset.url, name: asset.name, x: Math.round(fx), y: Math.round(fy), scale: sc, rot: 0, flip: false, depth: 3 };
    objs().push(o); state.selObj = o.id; state.sel = null;
    save(); renderProps(); draw();
    setStatus(`Розміщено «${asset.name}» · тягни — рух, кут — масштаб, ПКМ — план/анімація/деформація`);
  }

  // ── Кадр 20:9 вписаний у канвас ─────────────────────────────────────────────
  function frameRect(): { x: number; y: number; w: number; h: number; s: number } {
    const W = canvas!.width, H = canvas!.height;
    const s = Math.min((W - 40) / FRAME_W, (H - 40) / FRAME_H);
    const w = FRAME_W * s, h = FRAME_H * s;
    return { x: (W - w) / 2, y: (H - h) / 2, w, h, s };
  }
  const toFrame = (sx: number, sy: number): { x: number; y: number } => {
    const f = frameRect();
    return { x: (sx - f.x) / f.s, y: (sy - f.y) / f.s };
  };

  function ensureBg(p: MenuPage): void {
    if (!p.bg || state.bgImgs.has(p.id)) return;
    const im = new Image(); im.onload = () => draw(); im.src = p.bg;
    state.bgImgs.set(p.id, im);
  }

  // ── Рендер ──────────────────────────────────────────────────────────────────
  function draw(): void {
    if (!canvas!.offsetWidth) { requestAnimationFrame(draw); return; }
    canvas!.width = canvas!.clientWidth; canvas!.height = canvas!.clientHeight;
    ctx.fillStyle = '#141414'; ctx.fillRect(0, 0, canvas!.width, canvas!.height);
    if (state.view === 'map') { drawMap(); return; }
    const f = frameRect();
    const p = page();
    // кадр
    ctx.fillStyle = '#0b0a0d'; ctx.fillRect(f.x, f.y, f.w, f.h);
    ensureBg(p);
    const bg = state.bgImgs.get(p.id);
    if (bg?.complete && bg.naturalWidth) {
      const sc = Math.max(f.w / bg.naturalWidth, f.h / bg.naturalHeight);
      const bw = bg.naturalWidth * sc, bh = bg.naturalHeight * sc;
      ctx.save(); ctx.beginPath(); ctx.rect(f.x, f.y, f.w, f.h); ctx.clip();
      ctx.drawImage(bg, f.x + (f.w - bw) / 2, f.y + (f.h - bh) / 2, bw, bh);
      ctx.restore();
    }
    ctx.strokeStyle = 'var(--line)'; ctx.strokeStyle = '#3a3a3a'; ctx.lineWidth = 1;
    ctx.strokeRect(f.x, f.y, f.w, f.h);
    // розміщені об'єкти (декор) — між фоном і кнопками, у порядку плановості
    ctx.save(); ctx.beginPath(); ctx.rect(f.x, f.y, f.w, f.h); ctx.clip();
    drawObjects(f, state.preview);
    drawChars(f, state.preview);
    drawAtmPreview(f);
    ctx.restore();
    // кнопки
    for (const b of p.buttons) {
      const bx = f.x + b.x * f.s, by = f.y + b.y * f.s;
      ctx.font = `${b.size * f.s}px ${MENU_FONT}`;
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.shadowColor = '#000'; ctx.shadowBlur = 5 * f.s; ctx.shadowOffsetY = 2 * f.s;
      ctx.fillStyle = (state.sel === b.id && !state.preview) ? '#ffcf8f' : '#e5d8bc';
      ctx.fillText(b.label, bx, by);
      ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
      if (state.preview) continue; // прев'ю: лише самі написи кнопок, без чрому
      if (state.sel === b.id) {
        const m = ctx.measureText(b.label);
        ctx.strokeStyle = '#ffcf8f'; ctx.setLineDash([4, 3]);
        ctx.strokeRect(bx - 4, by - b.size * f.s * 0.62, m.width + 8, b.size * f.s * 1.24);
        ctx.setLineDash([]);
      }
      // маленька позначка цілі
      const tgt = b.target.startsWith('page:')
        ? '→ ' + (state.doc.pages.find((pp) => pp.id === b.target.slice(5))?.name ?? '?')
        : b.target ? '→ ' + b.target : '→ —';
      ctx.font = `${11 * f.s}px system-ui`; ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillText(tgt, bx, by + b.size * f.s * 0.85);
    }
    drawFxGizmos(f, state.preview);
    if (state.preview) return; // прев'ю: без назви сторінки
    // назва сторінки
    ctx.font = '12px system-ui'; ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillText('Сторінка: ' + p.name + ' (' + p.id + ')', f.x + 4, f.y - 6);
  }

  // ── Прев'ю атмосфери сторінки: туман/дощ/віньєтка/баланс у межах кадру ──────
  function drawAtmPreview(f: { x: number; y: number; w: number; h: number }): void {
    if (!state.showAtm) return;
    const atm = page().atmosphere;
    if (!atm) return;
    const tNow = performance.now() / 1000;
    const wx = atm.weather?.enabled ? (atm.weather.phases[0] as WeatherPhase | undefined) : undefined;
    const fogOn = wx ? weatherToggles(wx).fog && !!wx.fogLayers : false;
    if (fogOn) {
      for (const lk of ['sky', 'clouds', 'bg', 'frontbg', 'map', 'foreground'] as LayerKey[]) {
        const fl = wx!.fogLayers![lk];
        if (fl) drawFogLayerCanvas(ctx, canvas!.width, canvas!.height, fl, 1, tNow);
      }
    }
    if (atm.vignette?.enabled) drawVignetteCanvas(ctx, f.x, f.y, f.w, f.h, atm.vignette);
    if (wx) drawRainCanvas(ctx, canvas!.width, canvas!.height, wx, 1, tNow);
    if (atm.colorBalance?.enabled) applyColorBalanceCanvas(ctx, canvas!, atm.colorBalance);
    // погода/туман анімовані — тримаємо RAF-перемальовування
    if (wx || fogOn) requestAnimationFrame(() => { if (state.view === 'page') draw(); });
  }

  // ── Гізмо ефектів: вікно дощу (рамка), вогнище (пляма), персонаж (портрет) ──
  function drawFxGizmos(f: { x: number; y: number; s: number }, preview = false): void {
    const e = fx();
    const X = (v: number): number => f.x + v * f.s;
    const Y = (v: number): number => f.y + v * f.s;
    ctx.save();
    // Вікно дощу (у прев'ю — лише штрихи дощу, без рамки/куточка/підпису)
    if (e.rain.on) {
      const x0 = X(e.rain.x0), y0 = Y(e.rain.y0), w = (e.rain.x1 - e.rain.x0) * f.s, h = (e.rain.y1 - e.rain.y0) * f.s;
      if (!preview) {
        ctx.strokeStyle = 'rgba(120,200,255,0.9)'; ctx.lineWidth = 1.5; ctx.setLineDash([6, 4]);
        ctx.strokeRect(x0, y0, w, h);
        if (e.rain.panes) { // хрестовина 2×2
          ctx.beginPath();
          ctx.moveTo(x0 + w / 2, y0); ctx.lineTo(x0 + w / 2, y0 + h);
          ctx.moveTo(x0, y0 + h / 2); ctx.lineTo(x0 + w, y0 + h / 2);
          ctx.stroke();
        }
        ctx.setLineDash([]);
      }
      // штрихи дощу-прев'ю
      ctx.strokeStyle = 'rgba(120,200,255,0.35)';
      const ang = Math.tan(e.rain.dir * Math.PI / 180);
      for (let i = 0; i < 6; i++) {
        const rx = x0 + w * (i + 0.5) / 6, ry = y0 + h * ((i * 0.37) % 1);
        ctx.beginPath(); ctx.moveTo(rx, ry); ctx.lineTo(rx + 10 * ang, ry + 10); ctx.stroke();
      }
      if (!preview) {
        // куточок-ресайз
        ctx.fillStyle = 'rgba(120,200,255,0.95)';
        ctx.fillRect(x0 + w - 5, y0 + h - 5, 10, 10);
        ctx.fillStyle = 'rgba(120,200,255,0.8)'; ctx.font = '10px system-ui'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        ctx.fillText('дощ (вікно)', x0, y0 - 4);
      }
    }
    // Вогнище (світлова пляма — реальний вигляд; у прев'ю без кільця/підпису)
    if (e.fire.on) {
      const cx0 = X(e.fire.x), cy0 = Y(e.fire.y), r = 26 * e.fire.scale * f.s;
      const g = ctx.createRadialGradient(cx0, cy0 - r * 0.4, 2, cx0, cy0 - r * 0.4, r * 1.6);
      g.addColorStop(0, 'rgba(255,190,90,0.75)'); g.addColorStop(1, 'rgba(255,120,30,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(cx0, cy0 - r * 0.4, r * 1.6, 0, Math.PI * 2); ctx.fill();
      if (!preview) {
        ctx.strokeStyle = 'rgba(255,170,70,0.9)'; ctx.setLineDash([4, 3]);
        ctx.beginPath(); ctx.arc(cx0, cy0, 8 * f.s, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(255,170,70,0.85)'; ctx.font = '10px system-ui'; ctx.textAlign = 'center';
        ctx.fillText('вогнище', cx0, cy0 + 8 * f.s + 12);
      }
    }
    // Легасі-персонаж fx.char — лише коли сторінка не має власних chars[]
    if (e.char.on && !chars().length) {
      const cx0 = X(e.char.x), cy0 = Y(e.char.y);
      const H = 150 * e.char.scale * f.s;
      const th = state.charThumb;
      if (th?.complete && th.naturalWidth) {
        const W2 = H * th.naturalWidth / th.naturalHeight;
        ctx.globalAlpha = preview ? 1 : 0.85;
        ctx.drawImage(th, cx0 - W2 / 2, cy0 - H / 2, W2, H);
        ctx.globalAlpha = 1;
      } else if (!preview) {
        // силует: голова + тулуб (лише в режимі редагування — у прев'ю без арту нічого)
        ctx.fillStyle = 'rgba(220,205,170,0.35)';
        ctx.beginPath(); ctx.arc(cx0, cy0 - H * 0.32, H * 0.14, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.roundRect(cx0 - H * 0.14, cy0 - H * 0.16, H * 0.28, H * 0.6, H * 0.08); ctx.fill();
      }
      if (!preview) {
        ctx.strokeStyle = 'rgba(255,207,143,0.8)'; ctx.setLineDash([4, 3]);
        ctx.strokeRect(cx0 - H * 0.3, cy0 - H / 2, H * 0.6, H);
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(255,207,143,0.85)'; ctx.font = '10px system-ui'; ctx.textAlign = 'center';
        ctx.fillText('персонаж', cx0, cy0 + H / 2 + 12);
      }
    }
    ctx.restore();
  }

  // Гізмо під курсором (координати кадру). Порядок: кут дощу → вогонь → персонаж → вікно.
  function fxAt(px: number, py: number): 'char' | 'fire' | 'rain' | 'rainSize' | null {
    const e = fx();
    if (e.rain.on && Math.abs(px - e.rain.x1) < 9 && Math.abs(py - e.rain.y1) < 9) return 'rainSize';
    if (e.fire.on && Math.hypot(px - e.fire.x, py - e.fire.y) < 26) return 'fire';
    if (e.char.on && !chars().length) {
      const H = 150 * e.char.scale;
      if (Math.abs(px - e.char.x) < H * 0.3 && Math.abs(py - e.char.y) < H / 2) return 'char';
    }
    if (e.rain.on && px >= e.rain.x0 && px <= e.rain.x1 && py >= e.rain.y0 && py <= e.rain.y1) return 'rain';
    return null;
  }

  function btnAt(sx: number, sy: number): MenuButton | null {
    const f = frameRect(); const p = page();
    for (const b of [...p.buttons].reverse()) {
      const bx = f.x + b.x * f.s, by = f.y + b.y * f.s;
      ctx.font = `${b.size * f.s}px ${MENU_FONT}`;
      const w = ctx.measureText(b.label).width;
      const h = b.size * f.s * 1.3;
      if (sx >= bx - 6 && sx <= bx + w + 6 && sy >= by - h / 2 && sy <= by + h / 2) return b;
    }
    return null;
  }

  // ── Розміщені PNG-об'єкти ────────────────────────────────────────────────────
  function ensureObjImg(o: MenuObject): HTMLImageElement {
    let im = state.objImgs.get(o.id);
    if (!im) { im = new Image(); im.onload = () => draw(); im.src = o.url; state.objImgs.set(o.id, im); }
    return im;
  }
  // Габарити об'єкта в координатах кадру (натуральний розмір × scale).
  function objBox(o: MenuObject): { w: number; h: number } {
    const im = ensureObjImg(o);
    const iw = im.naturalWidth || 128, ih = im.naturalHeight || 128;
    return { w: iw * o.scale, h: ih * o.scale };
  }
  // Об'єкт під курсором (координати кадру), зверху вниз за плановістю.
  function objAt(px: number, py: number): MenuObject | null {
    const list = [...objs()].sort((a, b) => b.depth - a.depth); // спершу передні
    for (const o of list) {
      const { w, h } = objBox(o);
      if (Math.abs(px - o.x) <= w / 2 && Math.abs(py - o.y) <= h / 2) return o;
    }
    return null;
  }
  function selectedObj(): MenuObject | null { return objs().find((o) => o.id === state.selObj) ?? null; }
  // Дисплейна DeformView об'єкта (для рендера/хендлів/хіт-тесту хендлів).
  function objDeformView(o: MenuObject, f: { x: number; y: number; s: number }, playing: boolean): DeformView | null {
    if (!o.deform) return null;
    const im = ensureObjImg(o);
    const iw = im.naturalWidth || 128, ih = im.naturalHeight || 128;
    const d = fxDisp({ x: o.x, y: o.y, rot: o.rot ?? 0, scale: o.scale, anim: o.anim, deform: o.deform }, animClock, playing);
    return {
      W: iw, H: ih,
      deform: fxDeformAt(o.deform, animClock, playing),
      x: f.x + d.x * f.s, y: f.y + d.y * f.s,
      rot: d.rot, kx: d.scale * f.s, ky: d.scale * f.s,
      flip: o.flip ? -1 : 1, baked: o.deform.baked,
    };
  }

  // Малюємо об'єкти сторінки (сортовані за плановістю). Виділений — рамка + кут-ресайз.
  function drawObjects(f: { x: number; y: number; s: number }, preview: boolean): void {
    const list = [...objs()].sort((a, b) => a.depth - b.depth); // ззаду наперед
    const playing = fxPlaying();
    for (const o of list) {
      const im = ensureObjImg(o);
      const { w, h } = objBox(o);
      const d = fxDisp({ x: o.x, y: o.y, rot: o.rot ?? 0, scale: o.scale, anim: o.anim, deform: o.deform }, animClock, playing);
      const cx = f.x + d.x * f.s, cy = f.y + d.y * f.s;
      const dw = (im.naturalWidth || 128) * d.scale * f.s, dh = (im.naturalHeight || 128) * d.scale * f.s;
      if (o.deform && im.complete && im.naturalWidth) {
        // Деформація (перспектива/FFD, кейфрейми) — квадосітка як у Редакторі Мандр
        const v = objDeformView(o, f, playing && state.deformEdit !== o.id)!;
        drawDeformedImage(ctx, im, v);
        if (!preview && state.deformEdit === o.id) drawDeformHandles(ctx, v, state.deformHandleIdx);
      } else {
        ctx.save();
        ctx.translate(cx, cy);
        if (d.rot) ctx.rotate(d.rot * Math.PI / 180);
        if (o.flip) ctx.scale(-1, 1);
        if (im.complete && im.naturalWidth) ctx.drawImage(im, -dw / 2, -dh / 2, dw, dh);
        else { ctx.fillStyle = 'rgba(200,180,140,0.25)'; ctx.fillRect(-dw / 2, -dh / 2, dw, dh); }
        ctx.restore();
      }
      if (!preview && state.selObj === o.id && state.deformEdit !== o.id) {
        const bx = f.x + o.x * f.s, by = f.y + o.y * f.s;
        const bw = w * f.s, bh = h * f.s;
        ctx.save();
        ctx.translate(bx, by);
        if (o.rot) ctx.rotate(o.rot * Math.PI / 180);
        ctx.strokeStyle = '#7fd0ff'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 3]);
        ctx.strokeRect(-bw / 2, -bh / 2, bw, bh); ctx.setLineDash([]);
        ctx.fillStyle = '#7fd0ff'; ctx.fillRect(bw / 2 - 5, bh / 2 - 5, 10, 10); // кут-ресайз
        ctx.restore();
        ctx.fillStyle = 'rgba(127,208,255,0.85)'; ctx.font = '10px system-ui'; ctx.textAlign = 'center';
        const fxMark = o.anim ? ' · анім' : o.deform?.keyframes?.length ? ' · кф' : '';
        ctx.fillText(`${o.name ?? 'об\'єкт'} · план ${o.depth}${fxMark}`, bx, by - bh / 2 - 6);
      }
    }
    // Лінія напряму руху (режим «Задати лінію»)
    if (state.moveLine?.x0 !== undefined) {
      const L = state.moveLine;
      const x0 = f.x + L.x0! * f.s, y0 = f.y + L.y0! * f.s;
      const x1 = f.x + (L.x1 ?? L.x0!) * f.s, y1 = f.y + (L.y1 ?? L.y0!) * f.s;
      ctx.strokeStyle = '#39d0ff'; ctx.fillStyle = '#39d0ff'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      const ang = Math.atan2(y1 - y0, x1 - x0);
      ctx.beginPath(); ctx.moveTo(x1, y1);
      ctx.lineTo(x1 - 12 * Math.cos(ang - 0.4), y1 - 12 * Math.sin(ang - 0.4));
      ctx.lineTo(x1 - 12 * Math.cos(ang + 0.4), y1 - 12 * Math.sin(ang + 0.4));
      ctx.closePath(); ctx.fill();
    }
    ensureAnimLoop();
  }
  // Кут-ресайз виділеного об'єкта під курсором? (у координатах кадру)
  function objResizeAt(px: number, py: number): MenuObject | null {
    const o = selectedObj(); if (!o) return null;
    const { w, h } = objBox(o);
    // кут без урахування повороту (спрощено) — правий нижній
    if (Math.abs(px - (o.x + w / 2)) < 8 && Math.abs(py - (o.y + h / 2)) < 8) return o;
    return null;
  }

  // ── МАПА ПЕРЕХОДІВ: картки сторінок + стрілки гіперпосилань ────────────────
  function drawMap(): void {
    const W = canvas!.width, H = canvas!.height;
    ctx.fillStyle = '#161616'; ctx.fillRect(0, 0, W, H);
    ctx.font = '13px system-ui'; ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.textAlign = 'left';
    ctx.fillText('МАПА ПЕРЕХОДІВ: клік по кнопці в картці → клік по сторінці-цілі = гіперпосилання. Подвійний клік по картці — відкрити сторінку.', 14, 20);

    // розкладка карток сіткою
    const CW = 220, GAP = 26;
    const perRow = Math.max(1, Math.floor((W - GAP) / (CW + GAP)));
    state.mapRects = [];
    state.doc.pages.forEach((p, i) => {
      const col = i % perRow, row = Math.floor(i / perRow);
      const x = GAP + col * (CW + GAP);
      const y = 44 + row * 190;
      const btns: Array<{ id: string; y: number; h: number }> = [];
      const h = 34 + p.buttons.length * 22 + 10;
      // картка
      ctx.fillStyle = i === state.cur ? '#26202e' : '#1d1d1f';
      ctx.strokeStyle = i === state.cur ? '#cbb98a' : '#3a3a3a';
      ctx.lineWidth = i === state.cur ? 2 : 1;
      ctx.beginPath(); ctx.roundRect(x, y, CW, h, 8); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#e5d8bc'; ctx.font = 'bold 14px system-ui'; ctx.textAlign = 'left';
      ctx.fillText(p.name, x + 10, y + 21);
      p.buttons.forEach((b, bi) => {
        const by = y + 34 + bi * 22;
        const isLinking = state.linkFrom?.btnId === b.id;
        ctx.fillStyle = isLinking ? '#ffcf8f' : 'rgba(255,255,255,0.75)';
        ctx.font = '12px system-ui';
        ctx.fillText('• ' + b.label, x + 12, by + 14);
        btns.push({ id: b.id, y: by, h: 20 });
      });
      state.mapRects.push({ pageId: p.id, x, y, w: CW, h, btns });
    });
    // стрілки page-лінків
    ctx.strokeStyle = 'rgba(203,185,138,0.7)'; ctx.fillStyle = 'rgba(203,185,138,0.7)'; ctx.lineWidth = 1.6;
    for (const rect of state.mapRects) {
      const p = state.doc.pages.find((pp) => pp.id === rect.pageId)!;
      p.buttons.forEach((b, bi) => {
        if (!b.target.startsWith('page:')) return;
        const dst = state.mapRects.find((r) => r.pageId === b.target.slice(5));
        if (!dst) return;
        const sx = rect.x + rect.w, sy = rect.btns[bi].y + 10;
        const dx = dst.x, dy = dst.y + 16;
        const mx = (sx + dx) / 2;
        ctx.beginPath(); ctx.moveTo(sx, sy);
        ctx.bezierCurveTo(mx, sy, mx, dy, dx, dy); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(dx, dy); ctx.lineTo(dx - 8, dy - 4); ctx.lineTo(dx - 8, dy + 4); ctx.closePath(); ctx.fill();
      });
    }
    if (state.linkFrom) {
      ctx.fillStyle = '#ffcf8f'; ctx.font = '13px system-ui';
      ctx.fillText('Обери сторінку-ціль… (Esc — скасувати)', 14, H - 14);
    }
  }

  // ── Взаємодія ───────────────────────────────────────────────────────────────
  canvas.addEventListener('mousedown', (e) => {
    const r = canvas!.getBoundingClientRect();
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    if (state.view === 'map') {
      // клік по кнопці → почати лінк; по картці-цілі → завершити
      for (const rect of state.mapRects) {
        if (sx < rect.x || sx > rect.x + rect.w || sy < rect.y || sy > rect.y + rect.h) continue;
        const hitBtn = rect.btns.find((b) => sy >= b.y && sy <= b.y + b.h);
        if (state.linkFrom && rect.pageId !== state.linkFrom.pageId) {
          // завершення лінка на цій сторінці
          const src = state.doc.pages.find((p) => p.id === state.linkFrom!.pageId);
          const btn = src?.buttons.find((b) => b.id === state.linkFrom!.btnId);
          if (btn) { btn.target = 'page:' + rect.pageId; save(); setStatus(`«${btn.label}» → ${rect.pageId}`); }
          state.linkFrom = null; draw(); renderProps(); return;
        }
        if (hitBtn) { state.linkFrom = { pageId: rect.pageId, btnId: hitBtn.id }; draw(); return; }
        // подвійний клік по картці — відкрити сторінку
        const now = Date.now();
        if (now - state.lastClick < 350) {
          state.cur = state.doc.pages.findIndex((p) => p.id === rect.pageId);
          state.view = 'page'; state.sel = null;
          renderPages(); renderProps(); draw(); return;
        }
        state.lastClick = now;
        state.cur = state.doc.pages.findIndex((p) => p.id === rect.pageId);
        renderPages(); draw();
        return;
      }
      state.linkFrom = null; draw();
      return;
    }
    if (state.preview) return; // прев'ю read-only: без вибору/перетягування
    const fp = toFrame(sx, sy);
    // 0а) активна клавіатурна трансформація (G/R/S) — клік підтверджує
    if (state.kbMode) { state.kbMode = null; state.kbAxis = null; state.kbOrig = null; save(); draw(); return; }
    // 0) режим «Задати лінію напряму» анімації переміщення — старт лінії
    if (state.moveLine) {
      state.moveLine.x0 = fp.x; state.moveLine.y0 = fp.y;
      state.moveLine.x1 = fp.x; state.moveLine.y1 = fp.y;
      draw(); return;
    }
    // 0б) редагування хендлів деформації — клік по хендлу починає його дрег
    if (state.deformEdit) {
      const od = objs().find((x) => x.id === state.deformEdit);
      if (od?.deform) {
        const v = objDeformView(od, frameRect(), false)!;
        const hi = hitDeformHandle(v, sx, sy);
        if (hi >= 0) {
          state.deformHandleIdx = hi;
          state.deformDragSx0 = sx; state.deformDragSy0 = sy;
          state.deformDragOrigVals = [...(od.deform.type === 'persp' ? (od.deform.corners ?? new Array(8).fill(0)) : (od.deform.pts ?? []))];
          return;
        }
      }
    }
    // 1) кут-ресайз виділеного об'єкта
    const ro = objResizeAt(fp.x, fp.y);
    if (ro) {
      state.resizeObj = { id: ro.id, cx: ro.x, cy: ro.y, startDist: Math.hypot(fp.x - ro.x, fp.y - ro.y) || 1, startScale: ro.scale };
      setStatus('Масштаб об\'єкта'); return;
    }
    // 2) кнопки меню (пріоритет над об'єктами — це головний контент меню)
    const b = btnAt(sx, sy);
    if (b) {
      const now = Date.now();
      if (state.sel === b.id && now - state.lastClick < 350) {
        const nl = prompt('Текст кнопки:', b.label);
        if (nl) { b.label = nl; save(); }
      }
      state.lastClick = now;
      state.sel = b.id; state.selObj = null;
      state.drag = { id: b.id, ox: fp.x - b.x, oy: fp.y - b.y };
    } else {
      // 3) персонаж сторінки
      const ch = charAt(fp.x, fp.y);
      if (ch) {
        state.selChar = ch.id; state.sel = null; state.selObj = null;
        state.dragChar = { id: ch.id, ox: fp.x - ch.x, oy: fp.y - ch.y };
        setStatus('Персонаж · тягни / G / S / M · ПКМ — анімація');
      } else {
        // 4) розміщений об'єкт
        const o = objAt(fp.x, fp.y);
        if (o) {
          state.selObj = o.id; state.sel = null; state.selChar = null;
          state.dragObj = { id: o.id, ox: fp.x - o.x, oy: fp.y - o.y };
          setStatus(`Об'єкт: ${o.name ?? ''} · ПКМ — план/анімація/деформація`);
        } else {
          // 5) гізмо ефектів: тягнути персонажа/вогонь/вікно дощу
          const kind = fxAt(fp.x, fp.y);
          if (kind) {
            const e = fx();
            const ref = kind === 'char' ? e.char : kind === 'fire' ? e.fire
              : kind === 'rainSize' ? { x: e.rain.x1, y: e.rain.y1 } : { x: e.rain.x0, y: e.rain.y0 };
            state.dragFx = { kind, ox: fp.x - ref.x, oy: fp.y - ref.y };
            setStatus(kind === 'rainSize' ? 'Розмір вікна дощу' : kind === 'rain' ? 'Вікно дощу' : kind === 'fire' ? 'Вогнище' : 'Персонаж');
          }
          state.sel = null; state.selObj = null; state.selChar = null;
        }
      }
    }
    renderProps(); draw();
  });
  // ПКМ по полотну: якщо під курсором об'єкт — повне меню як у Редакторі Мандр
  // (плановість + анімація + деформація з кейфреймами) + пункти меню-редактора.
  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (state.view !== 'page' || state.preview) return;
    const r = canvas!.getBoundingClientRect();
    const fp = toFrame(e.clientX - r.left, e.clientY - r.top);
    // ПКМ по персонажу — вибір анімації/дзеркало/видалити
    const ch = charAt(fp.x, fp.y);
    if (ch) {
      state.selChar = ch.id; state.sel = null; state.selObj = null; draw();
      showCtxMenu(e.clientX, e.clientY, [
        ...CHAR_ANIMS.map((a) => ({
          label: (ch.anim === a.v ? '✓ ' : '') + a.l,
          on: () => { ch.anim = a.v; save(); renderCharsPanel(); draw(); },
        })),
        'sep' as const,
        { label: ch.flip ? 'Скасувати дзеркало' : 'Дзеркалити', on: () => { ch.flip = !ch.flip; save(); draw(); } },
        { label: 'Масштаб…', on: () => { const v = prompt('Масштаб персонажа:', String(ch.scale)); if (v !== null) { ch.scale = Math.max(0.2, Number(v) || ch.scale); save(); draw(); } } },
        { label: 'Видалити персонажа', on: () => { page().chars = chars().filter((c) => c.id !== ch.id); if (state.selChar === ch.id) state.selChar = null; save(); renderCharsPanel(); draw(); } },
      ]);
      return;
    }
    const o = objAt(fp.x, fp.y) ?? selectedObj();
    if (!o) return;
    state.selObj = o.id; state.sel = null; renderProps(); draw();
    openFxObjMenu(e.clientX, e.clientY, {
      title: o.name ?? 'Об\'єкт',
      objId: o.id,
      obj: o,
      plan: {
        get: () => o.depth, set: (v) => { o.depth = v; },
        min: 1, max: 7, names: PLAN_NAMES,
      },
      getBase: () => ({ x: o.x, y: o.y, rot: o.rot ?? 0, scale: o.scale }),
      isEditingHandles: () => state.deformEdit === o.id,
      toggleEditHandles: () => { state.deformEdit = state.deformEdit === o.id ? null : o.id; },
      onSetMoveLine: () => { state.moveLine = { id: o.id }; setStatus('Проведи лінію напряму руху на кадрі'); draw(); },
      extras: [
        { label: o.flip ? 'Скасувати дзеркало' : 'Дзеркалити', on: () => { o.flip = !o.flip; save(); draw(); } },
        { label: 'Обертання…', on: () => { const v = prompt('Кут повороту (градуси):', String(o.rot ?? 0)); if (v !== null) { o.rot = Number(v) || 0; save(); draw(); } } },
        { label: 'Масштаб…', on: () => { const v = prompt('Масштаб (1 = натуральний):', String(o.scale)); if (v !== null) { o.scale = Math.max(0.02, Number(v) || o.scale); save(); draw(); } } },
        'sep',
        { label: 'Видалити об\'єкт', danger: true, on: () => { page().objects = objs().filter((x) => x.id !== o.id); state.objImgs.delete(o.id); if (state.selObj === o.id) state.selObj = null; if (state.deformEdit === o.id) state.deformEdit = null; save(); draw(); } },
      ],
      pushUndo: () => {},
      save, draw,
      setStatus,
    });
  });
  canvas.addEventListener('mousemove', (e) => {
    if (state.view === 'map') return;
    const r = canvas!.getBoundingClientRect();
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    lastMouse.x = sx; lastMouse.y = sy;
    const fp = toFrame(sx, sy);
    if (state.moveLine?.x0 !== undefined) {
      state.moveLine.x1 = fp.x; state.moveLine.y1 = fp.y; draw(); return;
    }
    if (state.deformHandleIdx >= 0 && state.deformEdit) {
      const od = objs().find((x) => x.id === state.deformEdit);
      if (od?.deform) {
        const f = frameRect();
        applyHandleDrag(
          od.deform, state.deformHandleIdx, state.deformDragOrigVals,
          sx - state.deformDragSx0, sy - state.deformDragSy0,
          od.rot ?? 0, od.scale * f.s, od.scale * f.s, od.flip ? -1 : 1,
        );
        draw(); return;
      }
    }
    if (state.dragFx) {
      const ef = fx();
      const nx = Math.round(fp.x - state.dragFx.ox), ny = Math.round(fp.y - state.dragFx.oy);
      if (state.dragFx.kind === 'char') { ef.char.x = nx; ef.char.y = ny; }
      else if (state.dragFx.kind === 'fire') { ef.fire.x = nx; ef.fire.y = ny; }
      else if (state.dragFx.kind === 'rain') {
        const w = ef.rain.x1 - ef.rain.x0, h = ef.rain.y1 - ef.rain.y0;
        ef.rain.x0 = nx; ef.rain.y0 = ny; ef.rain.x1 = nx + w; ef.rain.y1 = ny + h;
      } else { // rainSize — тягнемо нижній правий кут
        ef.rain.x1 = Math.max(ef.rain.x0 + 16, nx); ef.rain.y1 = Math.max(ef.rain.y0 + 16, ny);
      }
      draw(); return;
    }
    if (state.resizeObj) {
      const o = objs().find((x) => x.id === state.resizeObj!.id);
      if (o) {
        const d = Math.hypot(fp.x - state.resizeObj.cx, fp.y - state.resizeObj.cy) || 1;
        o.scale = Math.max(0.02, Math.round(state.resizeObj.startScale * (d / state.resizeObj.startDist) * 1000) / 1000);
        draw();
      }
      return;
    }
    if (state.dragObj) {
      const o = objs().find((x) => x.id === state.dragObj!.id);
      if (o) { o.x = Math.round(fp.x - state.dragObj.ox); o.y = Math.round(fp.y - state.dragObj.oy); draw(); }
      return;
    }
    if (state.dragChar) {
      const c = chars().find((x) => x.id === state.dragChar!.id);
      if (c) { c.x = Math.round(fp.x - state.dragChar.ox); c.y = Math.round(fp.y - state.dragChar.oy); draw(); }
      return;
    }
    // Клавіатурна трансформація G/R/S: рух миші застосовує до цілі (з віссю X/Z)
    if (state.kbMode && state.kbOrig) {
      const t = kbTarget();
      if (t) {
        const f = frameRect();
        const dx = (sx - state.kbStart.mx) / f.s, dy = (sy - state.kbStart.my) / f.s;
        if (state.kbMode === 'G') {
          const nx = state.kbOrig.x + (state.kbAxis === 'z' ? 0 : dx);
          const ny = state.kbOrig.y + (state.kbAxis === 'x' ? 0 : dy);
          if (t.kind === 'obj') { t.o.x = Math.round(nx); t.o.y = Math.round(ny); }
          else if (t.kind === 'char') { t.c.x = Math.round(nx); t.c.y = Math.round(ny); }
          else { t.b.x = Math.round(nx); t.b.y = Math.round(ny); }
        } else if (state.kbMode === 'R' && t.kind === 'obj') {
          const cx = f.x + t.o.x * f.s, cy = f.y + t.o.y * f.s;
          const a = Math.atan2(sy - cy, sx - cx) * 180 / Math.PI;
          t.o.rot = Math.round(state.kbOrig.rot + a - state.kbStart.ang);
        } else if (state.kbMode === 'S') {
          const cx = t.kind === 'obj' ? t.o.x : t.kind === 'char' ? t.c.x : t.b.x;
          const cy = t.kind === 'obj' ? t.o.y : t.kind === 'char' ? t.c.y : t.b.y;
          const scx = f.x + cx * f.s, scy = f.y + cy * f.s;
          const ratio = Math.max(0.05, Math.hypot(sx - scx, sy - scy) / state.kbStart.dist);
          if (t.kind === 'obj') t.o.scale = Math.max(0.02, Math.round(state.kbOrig.scale * ratio * 1000) / 1000);
          else if (t.kind === 'char') t.c.scale = Math.max(0.2, Math.round(state.kbOrig.scale * ratio * 100) / 100);
          else t.b.size = Math.max(10, Math.min(96, Math.round(state.kbOrig.size * ratio)));
        }
        draw(); return;
      }
    }
    if (!state.drag) return;
    const b = page().buttons.find((x) => x.id === state.drag!.id);
    if (b) { b.x = Math.round(fp.x - state.drag.ox); b.y = Math.round(fp.y - state.drag.oy); draw(); }
  });
  window.addEventListener('mouseup', () => {
    if (state.moveLine?.x0 !== undefined) {
      const L = state.moveLine;
      const o = objs().find((x) => x.id === L.id);
      const ddx = (L.x1 ?? L.x0!) - L.x0!, ddy = (L.y1 ?? L.y0!) - L.y0!;
      const len = Math.hypot(ddx, ddy);
      if (o && len > 2) {
        o.anim = { type: 'move', dx: ddx / len, dy: ddy / len, dist: Math.round(len), speed: o.anim?.speed ?? 40, constant: o.anim?.constant ?? false };
        save(); setStatus('Напрям руху задано');
      }
      state.moveLine = null; draw(); return;
    }
    if (state.deformHandleIdx >= 0) { save(); state.deformHandleIdx = -1; draw(); return; }
    if (state.drag) { state.drag = null; save(); }
    if (state.dragFx) { state.dragFx = null; save(); setStatus(''); }
    if (state.dragObj) { state.dragObj = null; save(); }
    if (state.dragChar) { state.dragChar = null; save(); }
    if (state.resizeObj) { state.resizeObj = null; save(); setStatus(''); }
  });
  window.addEventListener('keydown', (e) => {
    if (!document.getElementById('app')?.className.includes('mode-menu')) return;
    const typing = document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement;
    if (typing) return;
    if (e.key === 'Escape' && state.linkFrom) { state.linkFrom = null; draw(); }
    if ((e.key === 'Delete' || e.key === 'Backspace') && state.view === 'page') {
      if (state.sel) {
        const p = page();
        p.buttons = p.buttons.filter((b) => b.id !== state.sel);
        state.sel = null; save(); renderProps(); draw();
      } else if (state.selObj) {
        page().objects = objs().filter((o) => o.id !== state.selObj);
        state.objImgs.delete(state.selObj); state.selObj = null; save(); draw();
      } else if (state.selChar) {
        page().chars = chars().filter((c) => c.id !== state.selChar);
        state.selChar = null; save(); renderCharsPanel(); draw();
      }
    }
    // G/R/S — клавіатурні трансформації виділеного (об'єкт/персонаж/кнопка), як у Мандрах.
    // X/Z під час G — вісь; M — дзеркало; клік/Enter — підтвердити, Esc — скасувати.
    if (state.view === 'page' && !state.preview && !state.kbMode
        && (e.code === 'KeyG' || e.code === 'KeyR' || e.code === 'KeyS')) {
      const t = kbTarget();
      if (t) {
        e.preventDefault();
        const f = frameRect();
        const px = t.kind === 'obj' ? t.o.x : t.kind === 'char' ? t.c.x : t.b.x;
        const py = t.kind === 'obj' ? t.o.y : t.kind === 'char' ? t.c.y : t.b.y;
        const scx = f.x + px * f.s, scy = f.y + py * f.s;
        state.kbMode = e.code === 'KeyG' ? 'G' : e.code === 'KeyR' ? 'R' : 'S';
        state.kbAxis = null;
        state.kbStart = {
          mx: lastMouse.x, my: lastMouse.y,
          ang: Math.atan2(lastMouse.y - scy, lastMouse.x - scx) * 180 / Math.PI,
          dist: Math.max(8, Math.hypot(lastMouse.x - scx, lastMouse.y - scy)),
        };
        state.kbOrig = {
          x: px, y: py,
          rot: t.kind === 'obj' ? (t.o.rot ?? 0) : 0,
          scale: t.kind === 'obj' ? t.o.scale : t.kind === 'char' ? t.c.scale : 1,
          size: t.kind === 'btn' ? t.b.size : 0,
        };
        setStatus(`${state.kbMode} — рухай мишею · X/Z — вісь · клік — підтвердити · Esc — скасувати`);
      }
    } else if (state.kbMode && (e.code === 'KeyX' || e.code === 'KeyZ')) {
      state.kbAxis = e.code === 'KeyX' ? 'x' : 'z';
    } else if (state.kbMode && (e.key === 'Enter' || e.code === 'Space')) {
      state.kbMode = null; state.kbAxis = null; state.kbOrig = null; save(); draw();
    } else if (state.kbMode && e.key === 'Escape') {
      // скасувати: повернути оригінальні значення
      const t = kbTarget();
      if (t && state.kbOrig) {
        if (t.kind === 'obj') { t.o.x = state.kbOrig.x; t.o.y = state.kbOrig.y; t.o.rot = state.kbOrig.rot; t.o.scale = state.kbOrig.scale; }
        else if (t.kind === 'char') { t.c.x = state.kbOrig.x; t.c.y = state.kbOrig.y; t.c.scale = state.kbOrig.scale; }
        else { t.b.x = state.kbOrig.x; t.b.y = state.kbOrig.y; t.b.size = state.kbOrig.size; }
      }
      state.kbMode = null; state.kbAxis = null; state.kbOrig = null; draw();
      return;
    }
    // M — дзеркало виділеного об'єкта/персонажа
    if (e.code === 'KeyM' && state.view === 'page' && !state.preview) {
      const o = selectedObj();
      if (o) { o.flip = !o.flip; save(); draw(); }
      else { const c = selectedChar(); if (c) { c.flip = !c.flip; save(); draw(); } }
    }
    // Плановість виділеного об'єкта: [ / ] — назад/вперед
    if (state.selObj && state.view === 'page' && (e.key === '[' || e.key === ']')) {
      const o = selectedObj();
      if (o) { o.depth = Math.max(1, Math.min(7, o.depth + (e.key === ']' ? 1 : -1))); save(); draw(); setStatus(`План: ${o.depth}`); }
    }
    // K — записати кейфрейм деформації виділеного об'єкта
    if (e.code === 'KeyK' && state.selObj && state.view === 'page') {
      const o = selectedObj();
      if (o?.deform) {
        const n = recordDeformKeyframe(o.deform, { x: o.x, y: o.y, rot: o.rot ?? 0, scale: o.scale });
        save(); draw(); setStatus(`Кейфрейм ${n} записано · K — додати ще`);
      } else setStatus('Спочатку додай деформацію (ПКМ по об\'єкту)');
    }
    // Esc — вийти з редагування хендлів / скасувати лінію напряму
    if (e.key === 'Escape' && (state.deformEdit || state.moveLine)) {
      state.deformEdit = null; state.moveLine = null; draw();
    }
  });

  // ── Права панель: сторінки + властивості кнопки ─────────────────────────────
  function renderPages(): void {
    const list = $('pageList'); if (!list) return;
    list.innerHTML = '';
    state.doc.pages.forEach((p, i) => {
      const chip = document.createElement('button');
      chip.textContent = p.name;
      chip.style.cssText = `font-size:12px;padding:4px 10px;border-radius:5px;border:1px solid var(--line);cursor:pointer;background:${i === state.cur ? 'var(--accent)' : 'var(--rail)'};color:${i === state.cur ? '#1b1b1b' : 'var(--ink)'}`;
      chip.onclick = () => { state.cur = i; state.sel = null; state.selObj = null; state.selChar = null; state.view = 'page'; renderPages(); renderProps(); renderFx(); renderAtmPanel(); renderCharsPanel(); draw(); };
      chip.ondblclick = () => { const n = prompt('Назва сторінки:', p.name); if (n) { p.name = n; save(); renderPages(); } };
      list.appendChild(chip);
    });
  }

  function renderProps(): void {
    const no = $('noBtn'), props = $('btnProps');
    const b = page().buttons.find((x) => x.id === state.sel);
    if (!no || !props) return;
    if (!b) { no.style.display = ''; props.style.display = 'none'; return; }
    no.style.display = 'none'; props.style.display = 'flex';
    ($('btnLabel') as HTMLInputElement).value = b.label;
    ($('btnSize') as HTMLInputElement).value = String(b.size);
    const sel = $('btnTarget') as HTMLSelectElement;
    sel.innerHTML = '';
    for (const t of FIXED_TARGETS) { const o = document.createElement('option'); o.value = t.v; o.textContent = t.l; sel.appendChild(o); }
    for (const p of state.doc.pages) {
      if (p.id === page().id) continue;
      const o = document.createElement('option'); o.value = 'page:' + p.id; o.textContent = 'Сторінка: ' + p.name; sel.appendChild(o);
    }
    sel.value = b.target;
  }
  ($('btnLabel') as HTMLInputElement | null)?.addEventListener('input', function () {
    const b = page().buttons.find((x) => x.id === state.sel); if (b) { b.label = this.value; save(); draw(); }
  });
  ($('btnSize') as HTMLInputElement | null)?.addEventListener('input', function () {
    const b = page().buttons.find((x) => x.id === state.sel); if (b) { b.size = Number(this.value); save(); draw(); }
  });
  ($('btnTarget') as HTMLSelectElement | null)?.addEventListener('change', function () {
    const b = page().buttons.find((x) => x.id === state.sel); if (b) { b.target = this.value; save(); draw(); }
  });
  $('btnDelete')?.addEventListener('click', () => {
    const p = page(); p.buttons = p.buttons.filter((b) => b.id !== state.sel);
    state.sel = null; save(); renderProps(); draw();
  });

  // ── Ефекти сцени: повзунки ↔ fx поточної сторінки ───────────────────────────
  function renderFx(): void {
    const e = fx();
    const set = (id: string, v: number | boolean): void => {
      const el = $(id) as HTMLInputElement | null; if (!el) return;
      if (typeof v === 'boolean') el.checked = v;
      else { el.value = String(v); const vs = $(id + 'V'); if (vs) vs.textContent = String(Math.round(v * 100) / 100); }
    };
    set('fxCharOn', e.char.on); set('fxCharScale', e.char.scale);
    set('fxFireOn', e.fire.on); set('fxFireScale', e.fire.scale); set('fxFireGlow', e.fire.glow);
    set('fxRainOn', e.rain.on); set('fxRainPanes', e.rain.panes); set('fxRainDir', e.rain.dir);
    set('fxRainAlpha', e.rain.alpha); set('fxRainSpeed', e.rain.speed);
    set('fxBoltOn', e.bolt.on); set('fxBoltEvery', e.bolt.every); set('fxBoltVary', e.bolt.vary); set('fxBoltBright', e.bolt.bright);
  }
  function wireFxNum(id: string, apply: (v: number) => void): void {
    const el = $(id) as HTMLInputElement | null; if (!el) return;
    el.addEventListener('input', () => { apply(Number(el.value)); const vs = $(id + 'V'); if (vs) vs.textContent = el.value; save(); draw(); });
  }
  function wireFxChk(id: string, apply: (v: boolean) => void): void {
    const el = $(id) as HTMLInputElement | null; if (!el) return;
    el.addEventListener('change', () => { apply(el.checked); save(); draw(); });
  }
  wireFxChk('fxCharOn', (v) => { fx().char.on = v; });
  wireFxNum('fxCharScale', (v) => { fx().char.scale = v; });
  wireFxChk('fxFireOn', (v) => { fx().fire.on = v; });
  wireFxNum('fxFireScale', (v) => { fx().fire.scale = v; });
  wireFxNum('fxFireGlow', (v) => { fx().fire.glow = v; });
  wireFxChk('fxRainOn', (v) => { fx().rain.on = v; });
  wireFxChk('fxRainPanes', (v) => { fx().rain.panes = v; });
  wireFxNum('fxRainDir', (v) => { fx().rain.dir = v; });
  wireFxNum('fxRainAlpha', (v) => { fx().rain.alpha = v; });
  wireFxNum('fxRainSpeed', (v) => { fx().rain.speed = v; });
  wireFxChk('fxBoltOn', (v) => { fx().bolt.on = v; });
  wireFxNum('fxBoltEvery', (v) => { fx().bolt.every = v; });
  wireFxNum('fxBoltVary', (v) => { fx().bolt.vary = v; });
  wireFxNum('fxBoltBright', (v) => { fx().bolt.bright = v; });
  // Портрет персонажа для гізмо — thumb героя з бібліотеки персонажів.
  void idbGet<Array<{ cat?: string; thumb?: string }>>('zag_char_lib').then((lib) => {
    const hero = lib?.find((x) => (x.cat ?? 'char') === 'char' && x.thumb);
    if (hero?.thumb) { const im = new Image(); im.onload = () => draw(); im.src = hero.thumb; state.charThumb = im; }
  }).catch(() => { /* без портрета — силует */ });

  // ── Тулбар ──────────────────────────────────────────────────────────────────
  $('addBtn')?.addEventListener('click', () => {
    const b: MenuButton = { id: uid(), label: 'Кнопка', x: 92, y: 210 + page().buttons.length * 60, size: 34, target: '' };
    page().buttons.push(b); state.sel = b.id; save(); renderProps(); draw();
  });
  $('addPage')?.addEventListener('click', () => {
    const name = prompt('Назва нової сторінки:', 'Сторінка ' + (state.doc.pages.length + 1));
    if (!name) return;
    state.doc.pages.push({ id: 'p' + uid(), name, bg: '', buttons: [] });
    state.cur = state.doc.pages.length - 1; state.sel = null;
    save(); renderPages(); renderProps(); draw();
  });
  $('mapBtn')?.addEventListener('click', () => {
    state.view = state.view === 'map' ? 'page' : 'map';
    ($('mapBtn') as HTMLButtonElement).classList.toggle('on', state.view === 'map');
    const hint = $('stageHint');
    if (hint) hint.textContent = state.view === 'map'
      ? 'клік по кнопці → клік по сторінці-цілі = гіперпосилання · подвійний клік — відкрити сторінку'
      : 'клік — вибрати кнопку · тягни — перемістити · подвійний клік — текст · Del — видалити';
    draw();
  });
  // «Конструктор»: увімкнено = режим редагування (гізмо/рамки/трансформації);
  // вимкнено = чисте прев'ю 20:9, як бачить гравець.
  const CONSTR_HINT = 'конструктор: клік — вибрати · тягни / G — рух (X/Z — вісь) · R — оберт · S — масштаб · M — дзеркало · ПКМ — меню · Del — видалити';
  $('previewBtn')?.addEventListener('click', () => {
    state.preview = !state.preview;
    if (state.preview) { state.view = 'page'; state.sel = null; state.selObj = null; state.selChar = null; state.kbMode = null; }
    ($('previewBtn') as HTMLButtonElement).classList.toggle('on', !state.preview);
    const hint = $('stageHint');
    if (hint) hint.textContent = state.preview
      ? 'чисте прев\'ю 20:9 — як бачить гравець · натисни «Конструктор», щоб редагувати'
      : CONSTR_HINT;
    renderProps(); draw();
  });
  // Старт у прев'ю (конструктор вимкнено) — одразу видно фактичний кадр гри.
  ($('previewBtn') as HTMLButtonElement | null)?.classList.toggle('on', !state.preview);
  { const hint = $('stageHint'); if (hint && state.preview) hint.textContent = 'чисте прев\'ю 20:9 — як бачить гравець · натисни «Конструктор», щоб редагувати'; }
  $('bgBtn')?.addEventListener('click', () => ($('bgInput') as HTMLInputElement)?.click());
  ($('bgInput') as HTMLInputElement | null)?.addEventListener('change', function () {
    const f = this.files?.[0]; if (!f) return;
    const rd = new FileReader();
    rd.onload = () => { page().bg = String(rd.result); state.bgImgs.delete(page().id); save(); draw(); };
    rd.readAsDataURL(f);
    this.value = '';
  });

  // ── Бібліотека PNG-ассетів — той самий механізм карток, що в інших редакторах:
  // .libCard-грід, ✕ на картці, тягни картку у кадр, кинь PNG на порожню картку,
  // середня кнопка — ренейм, ПКМ — меню (розмістити / фон сторінки / видалити).
  function saveAssets(): void { void idbSet('zag_menu_assets', state.assets); }
  // Тогл «✂ Фон» — вирізати рівний фон у завантажуваних PNG (як у Мандрах/Персонажах).
  const keyBgOn = (): boolean => $('keyBgBtn')?.classList.contains('on') ?? false;
  $('keyBgBtn')?.addEventListener('click', (e) => (e.currentTarget as HTMLElement).classList.toggle('on'));
  function addAssetFiles(files: File[], atX?: number, atY?: number): void {
    for (const f of files) {
      if (!f.type.startsWith('image/')) continue;
      const rd = new FileReader();
      rd.onload = () => void keyDataUrl(String(rd.result), keyBgOn()).then((url) => {
        const a = { id: uid(), name: f.name.replace(/\.\w+$/, ''), url };
        state.assets.push(a);
        saveAssets(); renderAssets();
        if (atX !== undefined) {
          const im = new Image();
          im.onload = () => placeObject(a, im.naturalHeight, atX, atY);
          im.src = a.url;
        }
      });
      rd.readAsDataURL(f);
    }
  }

  // ── Атмосфера сторінки (спільна панель) ─────────────────────────────────────
  const MN_ATM_LABELS: Partial<Record<LayerKey, string>> = {
    sky: 'Небо (план 1)', clouds: 'Хмари (план 2)', bg: 'Найдальший (план 3)',
    frontbg: 'Далекий (план 4)', map: 'Середній (план 5)', foreground: 'Близький/Найближчий (6–7)',
  };
  function renderAtmPanel(): void {
    const box = $('atmPanel'); if (!box) return;
    buildAtmospherePanel(box, () => (page().atmosphere ??= {}), () => save(), { labels: MN_ATM_LABELS });
  }

  // ── Персонажі сторінки ──────────────────────────────────────────────────────
  const CHAR_ANIMS: Array<{ v: string; l: string }> = [
    { v: 'sit', l: 'Сидить' }, { v: 'idle', l: 'Стоїть' },
    { v: 'walk', l: 'Йде' }, { v: 'run', l: 'Біжить' },
  ];
  function renderCharsPanel(): void {
    const box = $('charsPanel'); if (!box) return;
    box.innerHTML = '';
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:4px;align-items:center';
    const lbl = document.createElement('span'); lbl.textContent = 'Кількість:'; lbl.style.cssText = 'color:var(--muted);font-size:12px';
    row.appendChild(lbl);
    for (let n = 0; n <= 5; n++) {
      const b = document.createElement('button');
      b.textContent = String(n);
      const cur = chars().length;
      b.style.cssText = `flex:1;padding:4px 0;border-radius:5px;border:1px solid var(--line);cursor:pointer;font-size:12px;background:${cur === n ? 'var(--accent)' : 'var(--rail)'};color:${cur === n ? '#1b1b1b' : 'var(--ink)'}`;
      b.onclick = () => { setCharCount(n); };
      row.appendChild(b);
    }
    box.appendChild(row);
    const hint = document.createElement('div');
    hint.textContent = chars().length
      ? 'Тягни персонажа у вьюпорті (конструктор) · ПКМ — анімація/дзеркало · G/S/M'
      : 'Нема персонажів — гра покаже легасі-персонажа біля вогнища (Житло)';
    hint.style.cssText = 'font-size:11px;color:var(--muted)';
    box.appendChild(hint);
  }
  function setCharCount(n: number): void {
    const list = chars();
    while (list.length > n) {
      const rm = list.pop();
      if (rm && state.selChar === rm.id) state.selChar = null;
    }
    let i = list.length;
    while (list.length < n) {
      list.push({ id: uid(), x: 420 + i * 130, y: 400, scale: 1.4, anim: i === 0 ? 'sit' : 'idle' });
      i++;
    }
    save(); renderCharsPanel(); draw();
  }
  // Персонаж під курсором (координати кадру) — прямокутник як у fx-гізмо.
  function charAt(px: number, py: number): MenuChar | null {
    for (const c of [...chars()].reverse()) {
      const H = 150 * c.scale;
      if (Math.abs(px - c.x) < H * 0.3 && Math.abs(py - c.y) < H / 2) return c;
    }
    return null;
  }
  function drawChars(f: { x: number; y: number; s: number }, preview: boolean): void {
    const list = chars();
    if (!list.length) return;
    const th = state.charThumb;
    list.forEach((c, i) => {
      const cx = f.x + c.x * f.s, cy = f.y + c.y * f.s;
      const H = 150 * c.scale * f.s;
      ctx.save();
      if (th?.complete && th.naturalWidth) {
        const W2 = H * th.naturalWidth / th.naturalHeight;
        ctx.translate(cx, cy);
        if (c.flip) ctx.scale(-1, 1);
        ctx.globalAlpha = preview ? 1 : 0.9;
        ctx.drawImage(th, -W2 / 2, -H / 2, W2, H);
      } else if (!preview) {
        ctx.fillStyle = 'rgba(220,205,170,0.35)';
        ctx.beginPath(); ctx.arc(cx, cy - H * 0.32, H * 0.14, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.roundRect(cx - H * 0.14, cy - H * 0.16, H * 0.28, H * 0.6, H * 0.08); ctx.fill();
      }
      ctx.restore();
      if (!preview) {
        const sel = state.selChar === c.id;
        ctx.strokeStyle = sel ? '#ffcf8f' : 'rgba(255,207,143,0.45)'; ctx.setLineDash([4, 3]);
        ctx.strokeRect(cx - H * 0.3, cy - H / 2, H * 0.6, H);
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(255,207,143,0.85)'; ctx.font = '10px system-ui'; ctx.textAlign = 'center';
        const animL = CHAR_ANIMS.find((a) => a.v === c.anim)?.l ?? c.anim;
        ctx.fillText(`персонаж ${i + 1} · ${animL}`, cx, cy + H / 2 + 12);
      }
    });
  }
  function startAssetRename(a: typeof state.assets[0]): void {
    const v = prompt('Назва ассета:', a.name);
    if (v?.trim()) { a.name = v.trim(); saveAssets(); renderAssets(); }
  }
  function renderAssets(): void {
    const list = $('assetList'); if (!list) return;
    list.innerHTML = '';
    for (const a of state.assets) {
      const card = document.createElement('div'); card.className = 'libCard';
      card.title = 'ЛКМ — розмістити · тягни у кадр · ПКМ — меню · середня — ренейм';
      const im = document.createElement('img'); im.src = a.url; im.draggable = false;
      const nm = document.createElement('div'); nm.className = 'libName'; nm.textContent = a.name;
      const del = document.createElement('button'); del.className = 'libDel'; del.textContent = '×'; del.title = 'Видалити';
      del.addEventListener('click', (ev) => {
        ev.stopPropagation();
        state.assets = state.assets.filter((x) => x.id !== a.id);
        saveAssets(); renderAssets();
      });
      card.append(im, nm, del);
      // ЛКМ — розмістити об'єктом на сторінці; ПКМ — меню (розмістити / фон / видалити).
      card.addEventListener('click', () => placeObject(a, im.naturalHeight));
      card.addEventListener('contextmenu', (ev) => {
        ev.preventDefault();
        showCtxMenu(ev.clientX, ev.clientY, [
          { label: 'Розмістити на сторінці', on: () => placeObject(a, im.naturalHeight) },
          { label: 'Зробити фоном сторінки', on: () => { page().bg = a.url; state.bgImgs.delete(page().id); save(); draw(); setStatus(`Фон сторінки: ${a.name}`); } },
          { label: 'Перейменувати', on: () => startAssetRename(a) },
          'sep',
          { label: 'Видалити ассет', on: () => {
            state.assets = state.assets.filter((x) => x.id !== a.id);
            saveAssets(); renderAssets();
          } },
        ]);
      });
      // Середня кнопка — ренейм (як у Редакторі Мандр)
      card.addEventListener('mousedown', (ev) => { if (ev.button === 1) { ev.preventDefault(); ev.stopPropagation(); startAssetRename(a); } });
      card.addEventListener('auxclick', (ev) => { if (ev.button === 1) ev.preventDefault(); });
      // Тягни картку у кадр — розмістити у точці дропу
      card.draggable = true;
      card.addEventListener('dragstart', (ev) => {
        (ev as DragEvent).dataTransfer?.setData('text/menu-asset-id', a.id);
      });
      list.appendChild(card);
    }
    // Порожні картки: клік — вибрати файли, дроп PNG — додати в бібліотеку.
    const empties = Math.max(4, 12 - state.assets.length);
    for (let i = 0; i < empties; i++) {
      const e = document.createElement('div'); e.className = 'libCard empty';
      e.title = 'Клік — додати PNG · або кинь файли сюди';
      e.addEventListener('click', () => ($('assetInput') as HTMLInputElement)?.click());
      e.addEventListener('dragover', (ev) => { ev.preventDefault(); (ev as DragEvent).dataTransfer!.dropEffect = 'copy'; e.style.borderColor = 'var(--accent)'; });
      e.addEventListener('dragleave', () => { e.style.borderColor = ''; });
      e.addEventListener('drop', (ev) => {
        ev.preventDefault(); e.style.borderColor = '';
        addAssetFiles(Array.from((ev as DragEvent).dataTransfer?.files ?? []));
      });
      list.appendChild(e);
    }
  }
  $('addAsset')?.addEventListener('click', () => ($('assetInput') as HTMLInputElement)?.click());
  ($('assetInput') as HTMLInputElement | null)?.addEventListener('change', function () {
    addAssetFiles(Array.from(this.files ?? []));
    this.value = '';
  });
  // Дроп на канвас: картка з бібліотеки → розмістити у точці; PNG-файл → додати і розмістити.
  canvas.addEventListener('dragover', (e) => e.preventDefault());
  canvas.addEventListener('drop', (e) => {
    e.preventDefault();
    if (state.view !== 'page' || state.preview) return;
    const r = canvas!.getBoundingClientRect();
    const fp = toFrame(e.clientX - r.left, e.clientY - r.top);
    const aid = e.dataTransfer?.getData('text/menu-asset-id');
    if (aid) {
      const a = state.assets.find((x) => x.id === aid);
      if (a) {
        const im = new Image();
        im.onload = () => placeObject(a, im.naturalHeight, fp.x, fp.y);
        im.src = a.url;
      }
      return;
    }
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length) addAssetFiles(files, fp.x, fp.y);
  });

  // ── Публікація ──────────────────────────────────────────────────────────────
  registerPublisher(async () => ({
    'public/studio-data/menu.json': JSON.stringify(state.doc),
  }));
  const exp = $('exportBtn') as HTMLButtonElement | null;
  if (exp) wirePublishButton(exp, setStatus, () => {});

  // ── Завантаження ────────────────────────────────────────────────────────────
  // LWW: локальна IDB-копія проти опублікованої menu.json — виграє свіжіша
  // (щоб стара локальна копія не воскрешала обрізане/старе меню після лікування).
  void Promise.all([
    idbGet<MenuDoc>('zag_menu').catch(() => null),
    fetch(`${import.meta.env.BASE_URL}studio-data/menu.json?t=${Date.now()}`)
      .then((r) => (r.ok ? r.json() as Promise<MenuDoc> : null)).catch(() => null),
  ]).then(([local, pub]) => {
    const best = [local, pub].filter((d): d is MenuDoc => !!d?.pages?.length)
      .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0];
    if (best) {
      state.doc = best;
      if (best === pub) void idbSet('zag_menu', pub); // осідає локально
    }
    // Доводимо до повного набору розділів (Житло/Мандри/Хоругва/Завдання/Досягнення/Інвентар)
    if (ensurePages(state.doc)) save();
    renderPages(); renderProps(); renderFx(); renderAtmPanel(); renderCharsPanel(); draw();
  }).catch(() => { renderPages(); renderFx(); renderAtmPanel(); renderCharsPanel(); draw(); });
  renderAssets(); // одразу порожні картки-плейсхолдери (клік/дроп — додати PNG)
  void idbGet<typeof state.assets>('zag_menu_assets').then((a) => {
    if (Array.isArray(a)) { state.assets = a; }
    renderAssets();
  }).catch(() => {});

  window.addEventListener('menuTabActivated', () => draw());
  draw();

  // Редактор Історії: перемикач [Меню|Квести|Бот|Діалоги] у правій панелі.
  // Меню-редактор стає першим розділом; квести/бот/діалоги — поряд.
  initStoryEditor();
}
