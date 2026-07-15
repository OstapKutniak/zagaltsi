// Bretwalda · генератор українських вкладишів для карт.
// Фон — чистий 300dpi шар із видавничого PDF (Danelag D33, значок прибрано).
// Смужка закриває нижню текстову частину карти в протекторі; арт і назва лишаються рідні.

import { jsPDF } from 'jspdf';

// ---- геометрія повної карти на bg-clean.png (745×1121, 300dpi, бліди 35px) ----
const CARD_X0 = 35;          // лівий край карти
const CARD_X1 = 710;         // правий край
const CARD_Y1 = 1086;        // нижній край
const CARD_W = CARD_X1 - CARD_X0;            // 675 px = ширина карти
const FRAME_XL = 88 - CARD_X0;               // внутрішня межа рамки (координати смужки по X)
const FRAME_XR = 658 - CARD_X0;
const FRAME_YB = 1048;                       // внутрішня межа рамки знизу (повна карта)
const TRIGGER_CY = 663;                      // центр світлої панелі тригера (повна карта)
const BODY_Y0 = 726;                         // верх тексту за замовчуванням (повна карта)
const NUMBER_POS = { x: 263, y: 998 };       // "VK5" (повна карта)
const ICON_POS = { x: 375, y: 1008 };        // центр значка доповнення (повна карта)

interface Preset {
  name: string;
  frameOn: boolean;
  frameColor: string;
  frameStrength: number; // 0..1
  frameInset: number;    // px, зсув межі маски всередину(+)/назовні(-)
  parchWarm: number;     // 0..1 підтеплення пергаменту
  iconMode: 'none' | 'danelag' | 'vk' | 'custom';
  iconData: string | null; // dataURL свого значка
  iconSize: number;      // px на 300dpi полотні
  iconX: number;
  iconY: number;
  iconRound: boolean;
}

type Deck = 'lordship' | 'chronicle';

// Розділи колоди у грі: Lordship cards і Chronicle cards.
// Назви узгоджені з текстами перекладених карток («карти Володінь», «колода Хронік»).
const DECKS: Record<Deck, string> = {
  lordship: 'Карти володінь',
  chronicle: 'Карти хроніки',
};

interface Card {
  id: string;
  presetId: string;
  deck: Deck;
  name: string;    // назва карти, як надрукована (англійською)
  titleUk: string; // назва українською — друкується на вкладиші карт Хроніки
  number: string;
  trigger: string;
  body: string;
  bodySize: number;
  lineGap: number;
  textY: number;
  ink: string;
  red: string;
  heightMm: number;
}

interface State {
  version: 1;
  cardWidthMm: number;          // ширина вертикальних карт (Володіння), мм
  chronicleWidthMm: number;     // ширина горизонтальних карт Хроніки, мм
  presets: Record<string, Preset>;
  cards: Card[];
  selId: string | null;
}

const PXMM = CARD_W / 57; // px на мм за замовчуванням (ширина карти 57 мм)

function defaultPreset(name: string, over: Partial<Preset> = {}): Preset {
  return {
    name, frameOn: false, frameColor: '#7e1d12', frameStrength: 1, frameInset: 0,
    parchWarm: 0, iconMode: 'none', iconData: null, iconSize: 84, iconX: 0, iconY: 0,
    iconRound: true, ...over,
  };
}

function defaultCard(presetId: string, deck: Deck = 'lordship'): Card {
  return {
    id: 'c' + Math.random().toString(36).slice(2, 9),
    presetId, deck, name: '', titleUk: '', number: '', trigger: '', body: '',
    bodySize: 46, lineGap: 49, textY: 0, ink: '#2e1e14', red: '#7a1b16', heightMm: 42,
  };
}

function initialState(): State {
  const presets: Record<string, Preset> = {
    base: defaultPreset('Базова гра', { frameOn: true, frameColor: '#7e1d12' }),
    danelag: defaultPreset('Danelag', { iconMode: 'danelag' }),
    vk: defaultPreset('Vanished Kingdoms', { frameOn: true, frameColor: '#7e1d12', iconMode: 'vk' }),
    artefacts: defaultPreset('Artefacts'),
  };
  const demo = defaultCard('vk');
  demo.name = 'Treason';
  demo.number = 'VK5';
  demo.trigger = 'Перед битвою.';
  demo.body = 'Перед сухопутною битвою\nсплати {монета} 1 ворожого\nпідрозділу (не Правителя),\nі суперник кладе його\nдо свого запасу.';
  return { version: 1, cardWidthMm: 57, chronicleWidthMm: 88, presets, cards: [demo], selId: demo.id };
}

// ---- стан + збереження ----
const LS_KEY = 'bretwalda-tool-v1';
let state: State = loadState();

// Старі збереження/набори: без поля deck — це карти Володінь, без нових полів — типові значення.
function normalizeState(s: State): State {
  if (!s.chronicleWidthMm) s.chronicleWidthMm = 88;
  for (const c of s.cards) {
    if (c.deck !== 'lordship' && c.deck !== 'chronicle') c.deck = 'lordship';
    if (typeof c.titleUk !== 'string') c.titleUk = '';
  }
  return s;
}

function loadState(): State {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const s = JSON.parse(raw) as State;
      if (s && s.version === 1 && Array.isArray(s.cards)) return normalizeState(s);
    }
  } catch { /* зіпсоване збереження — стартуємо заново */ }
  return initialState();
}

let saveTimer = 0;
function save(): void {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(state));
      setStatus('Збережено локально');
    } catch {
      setStatus('Не вдалося зберегти (мало місця?) — збережи набір у файл');
    }
  }, 300);
}

// ---- DOM ----
function el<T extends HTMLElement>(id: string): T {
  const n = document.getElementById(id);
  if (!n) throw new Error('нема #' + id);
  return n as T;
}
const preview = el<HTMLCanvasElement>('preview');
const statusBar = el<HTMLDivElement>('statusBar');
function setStatus(t: string): void { statusBar.textContent = t; }

// ---- ассети ----
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('не завантажилось: ' + src));
    img.src = src;
  });
}

let bgImg: HTMLImageElement;
let danelagIcon: HTMLImageElement;
let vkIcon: HTMLImageElement;
const inlineIcons: Record<string, HTMLImageElement> = {};
const customIconCache = new Map<string, HTMLImageElement>();

async function loadAssets(): Promise<void> {
  const font = new FontFace('Monomakh', 'url(./bretwalda/MonomakhUnicode.otf)');
  await font.load();
  document.fonts.add(font);
  [bgImg, danelagIcon, vkIcon, inlineIcons['монета'], inlineIcons['кубик'], inlineIcons['меч'], inlineIcons['товар'], inlineIcons['рух']] = await Promise.all([
    loadImage('./bretwalda/bg-clean.png'),
    loadImage('./bretwalda/icon-danelag.png'),
    loadImage('./bretwalda/icon-vk.png'),
    loadImage('./bretwalda/coin.png'),
    loadImage('./bretwalda/dice.png'),
    loadImage('./bretwalda/sword.png'),
    loadImage('./bretwalda/goods.png'),
    loadImage('./bretwalda/move.png'),
  ]);
}

// ---- рендер смужки ----
function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Кеш перефарбованого фону: текст правиться щосимвольно, і ганяти піксельний
// прохід на кожне натискання марно — фон залежить лише від пресета і висоти.
const baseCache = new Map<string, HTMLCanvasElement>();

function baseKey(p: Preset, heightMm: number): string {
  return [p.frameOn, p.frameColor, p.frameStrength, p.frameInset, p.parchWarm, heightMm].join('|');
}

function recolor(ctx: CanvasRenderingContext2D, w: number, h: number, stripTop: number, p: Preset): void {
  if (!p.frameOn && p.parchWarm <= 0) return;
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const [cr, cg, cb] = hexRgb(p.frameColor);
  const lc = Math.max(30, 0.299 * cr + 0.587 * cg + 0.114 * cb);
  const kr = cr / lc, kg = cg / lc, kb = cb / lc;
  const xl = FRAME_XL + p.frameInset;
  const xr = FRAME_XR - p.frameInset;
  const yb = FRAME_YB + p.frameInset - stripTop; // у координатах смужки
  const FEATHER = 3;
  const warm = p.parchWarm;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      // відстань "усередину рамки": >0 — рамка, <=0 — пергамент
      const dist = Math.max(xl - x, x - xr, y - yb);
      const a = p.frameOn ? Math.min(1, Math.max(0, dist / FEATHER)) * p.frameStrength : 0;
      const r = d[i], g = d[i + 1], b = d[i + 2];
      if (a > 0) {
        const L = (r + g + b) / 3;
        d[i] = Math.min(255, r * (1 - a) + (L * kr + 10) * a);
        d[i + 1] = Math.min(255, g * (1 - a) + L * kg * a);
        d[i + 2] = Math.min(255, b * (1 - a) + L * kb * a);
      } else if (warm > 0 && dist < -FEATHER) {
        d[i] = Math.min(255, r + 10 * warm);
        d[i + 2] = Math.max(0, b * (1 - 0.10 * warm));
      }
    }
  }
  ctx.putImageData(img, 0, 0);
}

function baseStrip(p: Preset, heightMm: number): HTMLCanvasElement {
  const key = baseKey(p, heightMm);
  const hit = baseCache.get(key);
  if (hit) return hit;
  const hPx = Math.round(heightMm * PXMM);
  const stripTop = CARD_Y1 - hPx;
  const cv = document.createElement('canvas');
  cv.width = CARD_W; cv.height = hPx;
  const ctx = cv.getContext('2d');
  if (ctx) {
    ctx.drawImage(bgImg, CARD_X0, stripTop, CARD_W, hPx, 0, 0, CARD_W, hPx);
    recolor(ctx, CARD_W, hPx, stripTop, p);
  }
  if (baseCache.size > 24) baseCache.clear();
  baseCache.set(key, cv);
  return cv;
}

interface Seg { text?: string; icon?: HTMLImageElement }

function parseLine(line: string): Seg[] {
  const segs: Seg[] = [];
  const re = /\{(монета|кубик|меч|товар|рух)\}/g;
  let last = 0, m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    if (m.index > last) segs.push({ text: line.slice(last, m.index) });
    segs.push({ icon: inlineIcons[m[1]] });
    last = m.index + m[0].length;
  }
  if (last < line.length) segs.push({ text: line.slice(last) });
  return segs;
}

function drawCardStrip(card: Card): HTMLCanvasElement {
  if (card.deck === 'chronicle') return drawChronicleStrip(card);
  const p = state.presets[card.presetId] ?? defaultPreset('?');
  const hPx = Math.round(card.heightMm * PXMM);
  const stripTop = CARD_Y1 - hPx;
  const cv = document.createElement('canvas');
  cv.width = CARD_W; cv.height = hPx;
  const ctx = cv.getContext('2d');
  if (!ctx) return cv;
  ctx.drawImage(baseStrip(p, card.heightMm), 0, 0);

  // значок доповнення
  if (p.iconMode !== 'none') {
    const img = p.iconMode === 'danelag' ? danelagIcon
      : p.iconMode === 'vk' ? vkIcon
      : (p.iconData ? customIconCache.get(p.iconData) : undefined);
    if (img) {
      const s = p.iconSize;
      const cx = ICON_POS.x - CARD_X0 + p.iconX;
      const cy = ICON_POS.y - stripTop + p.iconY;
      ctx.save();
      if (p.iconRound) {
        ctx.beginPath();
        ctx.arc(cx, cy, s / 2, 0, Math.PI * 2);
        ctx.clip();
      }
      ctx.drawImage(img, cx - s / 2, cy - s / 2, s, s);
      ctx.restore();
    }
  }

  // тригер у світлій панелі
  ctx.textBaseline = 'alphabetic';
  if (card.trigger) {
    const ty = TRIGGER_CY - stripTop;
    if (ty > 10) {
      ctx.font = `${card.bodySize + 2}px Monomakh`;
      ctx.fillStyle = card.red;
      const w = ctx.measureText(card.trigger).width;
      ctx.fillText(card.trigger, (CARD_W - w) / 2, ty + (card.bodySize + 2) * 0.35);
    }
  }

  // основний текст
  drawBodyLines(ctx, card, CARD_W, BODY_Y0 - stripTop + card.textY + card.bodySize * 0.8);

  // номер картки
  if (card.number) {
    ctx.font = '30px Monomakh';
    ctx.fillStyle = '#3c2d1e';
    ctx.fillText(card.number, NUMBER_POS.x - CARD_X0, NUMBER_POS.y - stripTop + 24);
  }
  return cv;
}

// центровані рядки тексту зі значками {монета} {кубик} ... — спільне для обох розділів
function drawBodyLines(ctx: CanvasRenderingContext2D, card: Card, areaW: number, startY: number): void {
  ctx.font = `${card.bodySize}px Monomakh`;
  ctx.fillStyle = card.ink;
  let y = startY;
  for (const line of card.body.split('\n')) {
    const segs = parseLine(line);
    let total = 0;
    for (const s of segs) {
      if (s.text) total += ctx.measureText(s.text).width;
      else if (s.icon) {
        const hgt = card.bodySize * (s.icon === inlineIcons['меч'] ? 1.15 : 0.95);
        total += hgt * s.icon.width / s.icon.height + 6;
      }
    }
    let x = (areaW - total) / 2;
    for (const s of segs) {
      if (s.text) {
        ctx.fillText(s.text, x, y);
        x += ctx.measureText(s.text).width;
      } else if (s.icon) {
        const hgt = card.bodySize * (s.icon === inlineIcons['меч'] ? 1.15 : 0.95);
        const wid = hgt * s.icon.width / s.icon.height;
        ctx.drawImage(s.icon, x + 3, y - hgt * 0.82, wid, hgt);
        x += wid + 6;
      }
    }
    y += card.lineGap;
  }
}

// ---- вкладиш карти Хроніки (горизонтальна) ----
// Поки без рідного шаблону: тимчасовий пергаментний фон, розміщення приблизне.
// Смужка — низ карти від верху стрічки з назвою, на всю ширину карти.
function drawChronicleStrip(card: Card): HTMLCanvasElement {
  const w = Math.round(state.chronicleWidthMm * PXMM);
  const h = Math.round(card.heightMm * PXMM);
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  if (!ctx) return cv;

  // тимчасовий пергамент (замінимо шаблоном, коли знайдеться скан)
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#eee1c3');
  g.addColorStop(1, '#ddcca4');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(110, 82, 45, 0.28)';
  ctx.lineWidth = 12;
  ctx.strokeRect(6, 6, w - 12, h - 12);

  ctx.textBaseline = 'alphabetic';

  // назва (українською), як у стрічці назви на карті
  const titleSize = card.bodySize + 10;
  let sepY = 0;
  if (card.titleUk) {
    ctx.font = `${titleSize}px Monomakh`;
    ctx.fillStyle = card.red;
    const tw = ctx.measureText(card.titleUk).width;
    const ty = h * 0.08 + titleSize * 0.8;
    ctx.fillText(card.titleUk, (w - tw) / 2, ty);
    sepY = ty + titleSize * 0.35;
    // пунктирна лінія-роздільник, як на оригіналі
    ctx.fillStyle = card.red;
    ctx.globalAlpha = 0.65;
    for (let x = w * 0.14; x < w * 0.86; x += 12) ctx.fillRect(x, sepY, 5, 4);
    ctx.globalAlpha = 1;
  }

  // текст умови
  const bodyStart = (sepY || h * 0.12) + card.bodySize * 1.25 + card.textY;
  drawBodyLines(ctx, card, w, bodyStart);

  // номер зліва внизу
  if (card.number) {
    ctx.font = '30px Monomakh';
    ctx.fillStyle = '#3c2d1e';
    ctx.fillText(card.number, 44, h - 26);
  }
  return cv;
}

// ---- прев'ю ----
let raf = 0;
function requestRender(): void {
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(renderPreview);
}

function renderPreview(): void {
  const card = selCard();
  if (!card || !bgImg) return;
  const cv = drawCardStrip(card);
  preview.width = cv.width; preview.height = cv.height;
  const ctx = preview.getContext('2d');
  if (ctx) ctx.drawImage(cv, 0, 0);
  preview.style.width = Math.min(620, cv.width) + 'px';
}

function selCard(): Card | null {
  return state.cards.find(c => c.id === state.selId) ?? state.cards[0] ?? null;
}

// ---- бібліотека з мініатюрами, згрупована за доповненнями ----
const thumbImgs = new Map<string, HTMLImageElement>(); // card.id -> <img>

function makeThumb(card: Card): string {
  const cv = drawCardStrip(card);
  const t = document.createElement('canvas');
  const k = 320 / cv.width;
  t.width = 320; t.height = Math.round(cv.height * k);
  const ctx = t.getContext('2d');
  if (ctx) ctx.drawImage(cv, 0, 0, t.width, t.height);
  return t.toDataURL('image/jpeg', 0.75);
}

function renderList(): void {
  const list = el<HTMLDivElement>('cardList');
  list.innerHTML = '';
  thumbImgs.clear();
  for (const [deck, deckName] of Object.entries(DECKS) as [Deck, string][]) {
    const deckCards = state.cards.filter(c => c.deck === deck);
    if (!deckCards.length) continue;
    const deckTitle = document.createElement('div');
    deckTitle.className = 'deckTitle';
    deckTitle.textContent = deckName + ' · ' + deckCards.length;
    list.appendChild(deckTitle);
    for (const [pid, preset] of Object.entries(state.presets)) {
      const cards = deckCards.filter(c => c.presetId === pid);
      if (!cards.length) continue;
      const title = document.createElement('div');
      title.className = 'groupTitle';
      title.textContent = preset.name + ' · ' + cards.length;
      list.appendChild(title);
      const grid = document.createElement('div');
      grid.className = 'groupGrid';
      for (const c of cards) {
        const item = document.createElement('div');
        item.className = 'cardItem' + (c.id === state.selId ? ' sel' : '');
        item.dataset.cardId = c.id;
        const img = document.createElement('img');
        img.src = makeThumb(c);
        img.alt = c.number;
        thumbImgs.set(c.id, img);
        const cap = document.createElement('div');
        cap.className = 'cap';
        const name = document.createElement('b');
        name.textContent = c.name || c.titleUk || c.trigger || 'без назви';
        const num = document.createElement('span');
        num.textContent = c.number;
        cap.append(name, num);
        item.append(img, cap);
        item.onclick = () => { state.selId = c.id; markSelected(); syncControls(); requestRender(); save(); };
        grid.appendChild(item);
      }
      list.appendChild(grid);
    }
  }
}

function markSelected(): void {
  for (const n of document.querySelectorAll<HTMLElement>('.cardItem')) {
    n.classList.toggle('sel', n.dataset.cardId === state.selId);
  }
}

// оновлення мініатюр без перебудови всього списку
let thumbTimer = 0;
function refreshThumbs(scope: 'sel' | 'preset'): void {
  window.clearTimeout(thumbTimer);
  thumbTimer = window.setTimeout(() => {
    const cur = selCard();
    if (!cur) return;
    const targets = scope === 'sel'
      ? [cur]
      : state.cards.filter(c => c.presetId === cur.presetId);
    for (const c of targets) {
      const img = thumbImgs.get(c.id);
      if (img) img.src = makeThumb(c);
    }
  }, 250);
}

// ---- контроли ----
interface Bind {
  id: string;
  get: (c: Card, p: Preset) => string | number | boolean;
  set: (c: Card, p: Preset, v: string) => void;
  kind: 'text' | 'range' | 'color' | 'check';
  presetLevel?: boolean;
}

const binds: Bind[] = [
  { id: 'cName', kind: 'text', get: c => c.name ?? '', set: (c, _p, v) => { c.name = v; } },
  { id: 'cTitle', kind: 'text', get: c => c.titleUk ?? '', set: (c, _p, v) => { c.titleUk = v; } },
  { id: 'cNumber', kind: 'text', get: c => c.number, set: (c, _p, v) => { c.number = v; } },
  { id: 'cTrigger', kind: 'text', get: c => c.trigger, set: (c, _p, v) => { c.trigger = v; } },
  { id: 'cBody', kind: 'text', get: c => c.body, set: (c, _p, v) => { c.body = v; } },
  { id: 'cHeight', kind: 'range', get: c => c.heightMm, set: (c, _p, v) => { c.heightMm = Number(v); } },
  { id: 'cBodySize', kind: 'range', get: c => c.bodySize, set: (c, _p, v) => { c.bodySize = Number(v); } },
  { id: 'cLineGap', kind: 'range', get: c => c.lineGap, set: (c, _p, v) => { c.lineGap = Number(v); } },
  { id: 'cTextY', kind: 'range', get: c => c.textY, set: (c, _p, v) => { c.textY = Number(v); } },
  { id: 'cInk', kind: 'color', get: c => c.ink, set: (c, _p, v) => { c.ink = v; } },
  { id: 'cRed', kind: 'color', get: c => c.red, set: (c, _p, v) => { c.red = v; } },
  { id: 'pFrameOn', kind: 'check', presetLevel: true, get: (_c, p) => p.frameOn, set: (_c, p, v) => { p.frameOn = v === 'true'; } },
  { id: 'pFrameColor', kind: 'color', presetLevel: true, get: (_c, p) => p.frameColor, set: (_c, p, v) => { p.frameColor = v; } },
  { id: 'pFrameStrength', kind: 'range', presetLevel: true, get: (_c, p) => Math.round(p.frameStrength * 100), set: (_c, p, v) => { p.frameStrength = Number(v) / 100; } },
  { id: 'pFrameInset', kind: 'range', presetLevel: true, get: (_c, p) => p.frameInset, set: (_c, p, v) => { p.frameInset = Number(v); } },
  { id: 'pParchWarm', kind: 'range', presetLevel: true, get: (_c, p) => Math.round(p.parchWarm * 100), set: (_c, p, v) => { p.parchWarm = Number(v) / 100; } },
  { id: 'pIconSize', kind: 'range', presetLevel: true, get: (_c, p) => p.iconSize, set: (_c, p, v) => { p.iconSize = Number(v); } },
  { id: 'pIconX', kind: 'range', presetLevel: true, get: (_c, p) => p.iconX, set: (_c, p, v) => { p.iconX = Number(v); } },
  { id: 'pIconY', kind: 'range', presetLevel: true, get: (_c, p) => p.iconY, set: (_c, p, v) => { p.iconY = Number(v); } },
  { id: 'pIconRound', kind: 'check', presetLevel: true, get: (_c, p) => p.iconRound, set: (_c, p, v) => { p.iconRound = v === 'true'; } },
];

function syncControls(): void {
  const c = selCard();
  if (!c) return;
  const p = state.presets[c.presetId] ?? defaultPreset('?');
  for (const b of binds) {
    const input = el<HTMLInputElement>(b.id);
    const v = b.get(c, p);
    if (b.kind === 'check') input.checked = v === true;
    else input.value = String(v);
    const val = document.getElementById(b.id + 'Val');
    if (val) val.textContent = String(v);
  }
  const presetSel = el<HTMLSelectElement>('cPreset');
  presetSel.innerHTML = '';
  for (const [pid, pr] of Object.entries(state.presets)) {
    const o = document.createElement('option');
    o.value = pid; o.textContent = pr.name;
    presetSel.appendChild(o);
  }
  presetSel.value = c.presetId;
  el<HTMLSelectElement>('cDeck').value = c.deck;
  el<HTMLSelectElement>('pIconMode').value = p.iconMode;
  el<HTMLInputElement>('gWidth').value = String(state.cardWidthMm);
  el<HTMLInputElement>('gWidthChron').value = String(state.chronicleWidthMm);
  // Хроніки: є назва українською, нема рядка-тригера (і навпаки для Володінь)
  const chron = c.deck === 'chronicle';
  el<HTMLDivElement>('rowTitle').style.display = chron ? '' : 'none';
  el<HTMLDivElement>('rowTrigger').style.display = chron ? 'none' : '';
}

function hookControls(): void {
  for (const b of binds) {
    const input = el<HTMLInputElement>(b.id);
    // усе живе: range/color/text — 'input', чекбокси — 'change'
    const ev = b.kind === 'check' ? 'change' : 'input';
    input.addEventListener(ev, () => {
      const c = selCard();
      if (!c) return;
      const p = state.presets[c.presetId];
      if (!p) return;
      b.set(c, p, b.kind === 'check' ? String(input.checked) : input.value);
      const val = document.getElementById(b.id + 'Val');
      if (val) val.textContent = input.value;
      if (b.id === 'cName' || b.id === 'cTitle' || b.id === 'cNumber' || b.id === 'cBody' || b.id === 'cTrigger') {
        const img = thumbImgs.get(c.id);
        const cap = document.querySelector(`.cardItem[data-card-id="${c.id}"] .cap b`);
        if (cap) cap.textContent = c.name || c.titleUk || c.trigger || 'без назви';
        const num = document.querySelector(`.cardItem[data-card-id="${c.id}"] .cap span`);
        if (num) num.textContent = c.number;
        if (img) refreshThumbs('sel');
      } else {
        refreshThumbs(b.presetLevel ? 'preset' : 'sel');
      }
      requestRender(); save();
    });
  }

  el<HTMLSelectElement>('cPreset').addEventListener('change', e => {
    const c = selCard(); if (!c) return;
    c.presetId = (e.target as HTMLSelectElement).value;
    renderList(); syncControls(); requestRender(); save();
  });

  el<HTMLSelectElement>('cDeck').addEventListener('change', e => {
    const c = selCard(); if (!c) return;
    c.deck = (e.target as HTMLSelectElement).value as Deck;
    renderList(); syncControls(); requestRender(); save();
  });

  el<HTMLSelectElement>('pIconMode').addEventListener('change', e => {
    const c = selCard(); if (!c) return;
    const p = state.presets[c.presetId]; if (!p) return;
    p.iconMode = (e.target as HTMLSelectElement).value as Preset['iconMode'];
    refreshThumbs('preset'); requestRender(); save();
  });

  el<HTMLInputElement>('gWidth').addEventListener('change', e => {
    state.cardWidthMm = Number((e.target as HTMLInputElement).value) || 57;
    save();
  });

  el<HTMLInputElement>('gWidthChron').addEventListener('change', e => {
    state.chronicleWidthMm = Number((e.target as HTMLInputElement).value) || 88;
    renderList(); requestRender(); save();
  });

  el<HTMLButtonElement>('pIconUpload').onclick = () => el<HTMLInputElement>('pIconFile').click();
  el<HTMLInputElement>('pIconFile').addEventListener('change', async e => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    const c = selCard(); if (!c) return;
    const p = state.presets[c.presetId]; if (!p) return;
    const data = await downscaleImage(f, 300);
    p.iconData = data;
    p.iconMode = 'custom';
    await ensureCustomIcon(data);
    syncControls(); refreshThumbs('preset'); requestRender(); save();
    setStatus('Значок завантажено');
  });

  el<HTMLButtonElement>('addCard').onclick = () => {
    const cur = selCard();
    const c = defaultCard(cur ? cur.presetId : 'base', cur ? cur.deck : 'lordship');
    if (cur) { c.trigger = cur.trigger; c.heightMm = cur.heightMm; }
    state.cards.push(c); state.selId = c.id;
    renderList(); syncControls(); requestRender(); save();
  };

  el<HTMLButtonElement>('dupCard').onclick = () => {
    const cur = selCard(); if (!cur) return;
    const c: Card = { ...cur, id: 'c' + Math.random().toString(36).slice(2, 9) };
    state.cards.push(c); state.selId = c.id;
    renderList(); syncControls(); requestRender(); save();
  };

  el<HTMLButtonElement>('delCard').onclick = () => {
    const cur = selCard(); if (!cur) return;
    if (!confirm('Видалити картку «' + (cur.name || cur.number || 'без назви') + '»?')) return;
    state.cards = state.cards.filter(c => c.id !== cur.id);
    state.selId = state.cards[0]?.id ?? null;
    renderList(); syncControls(); requestRender(); save();
  };

  el<HTMLButtonElement>('exportJson').onclick = () => {
    const blob = new Blob([JSON.stringify(state, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'bretwalda-vkladyshi.json';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  el<HTMLButtonElement>('importJson').onclick = () => el<HTMLInputElement>('importFile').click();
  el<HTMLInputElement>('importFile').addEventListener('change', async e => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    try {
      await applyState(JSON.parse(await f.text()) as State);
      setStatus('Набір відкрито: ' + state.cards.length + ' карток');
    } catch {
      setStatus('Не вдалося прочитати файл набору');
    }
  });

  el<HTMLButtonElement>('loadServer').onclick = async () => {
    if (!confirm('Замінити поточний набір набором із сайту? Локальні зміни зникнуть (можеш спершу зберегти їх у файл).')) return;
    try {
      const r = await fetch('./bretwalda/cards.json?cb=' + Date.now());
      if (!r.ok) throw new Error(String(r.status));
      await applyState(await r.json() as State);
      setStatus('Набір із сайту завантажено: ' + state.cards.length + ' карток');
    } catch {
      setStatus('Не вдалося завантажити набір із сайту');
    }
  };

  el<HTMLButtonElement>('exportPdf').onclick = exportPdf;
}

async function applyState(s: State): Promise<void> {
  if (!s || s.version !== 1 || !Array.isArray(s.cards)) throw new Error('не той формат');
  state = normalizeState(s);
  state.selId = state.cards[0]?.id ?? null;
  baseCache.clear();
  await preloadCustomIcons();
  renderList(); syncControls(); requestRender(); save();
}

function downscaleImage(file: File, maxSide: number): Promise<string> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, maxSide / Math.max(img.width, img.height));
      const cv = document.createElement('canvas');
      cv.width = Math.round(img.width * k);
      cv.height = Math.round(img.height * k);
      const ctx = cv.getContext('2d');
      if (!ctx) { rej(new Error('canvas')); return; }
      ctx.drawImage(img, 0, 0, cv.width, cv.height);
      res(cv.toDataURL('image/png'));
    };
    img.onerror = () => rej(new Error('image'));
    img.src = URL.createObjectURL(file);
  });
}

async function ensureCustomIcon(data: string): Promise<void> {
  if (customIconCache.has(data)) return;
  customIconCache.set(data, await loadImage(data));
}

async function preloadCustomIcons(): Promise<void> {
  for (const p of Object.values(state.presets)) {
    if (p.iconData) await ensureCustomIcon(p.iconData).catch(() => { /* пропускаємо биті */ });
  }
}

// ---- PDF ----
function exportPdf(): void {
  if (!state.cards.length) return;
  setStatus('Готую PDF…');
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  const wMm = state.cardWidthMm;
  const margin = 15, gapX = 15, gapY = 9;
  const cols = [margin, margin + wMm + gapX];
  const colY = [20, 20];

  const cut = (x: number, y: number, w: number, h: number): void => {
    pdf.setDrawColor(0); pdf.setLineWidth(0.2);
    const L = 4;
    for (const cx of [x, x + w]) for (const cy of [y, y + h]) {
      pdf.line(cx, cy === y ? cy - L : cy, cx, cy === y ? cy : cy + L);
      pdf.line(cx === x ? cx - L : cx, cy, cx === x ? cx : cx + L, cy);
    }
  };

  const ruler = (): void => {
    const y = 285, x = margin;
    pdf.setDrawColor(0); pdf.setLineWidth(0.3);
    pdf.line(x, y, x + 50, y);
    for (let t = 0; t <= 50; t += 10) pdf.line(x + t, y - 2, x + t, y);
    pdf.setFontSize(8);
    pdf.text('50 mm (check 100% print scale)', x + 53, y);
  };
  ruler();

  // на аркушах картки йдуть за розділами: спершу Володіння, потім Хроніки
  const ordered = (Object.keys(DECKS) as Deck[]).flatMap(d => state.cards.filter(c => c.deck === d));
  for (const card of ordered) {
    const cv = drawCardStrip(card);
    if (card.deck === 'chronicle') {
      // горизонтальна смужка — ширша за колонку, кладемо на всю ширину аркуша
      const cw = state.chronicleWidthMm;
      const hMm = card.heightMm;
      let y = Math.max(colY[0], colY[1]);
      if (y + hMm > 278) {
        pdf.addPage(); colY[0] = 20; colY[1] = 20; y = 20; ruler();
      }
      pdf.addImage(cv.toDataURL('image/jpeg', 0.93), 'JPEG', margin, y, cw, hMm);
      cut(margin, y, cw, hMm);
      colY[0] = colY[1] = y + hMm + gapY;
      continue;
    }
    const hMm = card.heightMm * (wMm / 57);
    let col = colY[0] <= colY[1] ? 0 : 1;
    if (colY[col] + hMm > 278) {
      if (colY[1 - col] + hMm <= 278) col = 1 - col;
      else {
        pdf.addPage(); colY[0] = 20; colY[1] = 20; col = 0; ruler();
      }
    }
    const x = cols[col], y = colY[col];
    pdf.addImage(cv.toDataURL('image/jpeg', 0.93), 'JPEG', x, y, wMm, hMm);
    cut(x, y, wMm, hMm);
    colY[col] += hMm + gapY;
  }
  pdf.save('bretwalda-vkladyshi.pdf');
  setStatus('PDF збережено: ' + state.cards.length + ' карток');
}

// ---- старт ----
async function main(): Promise<void> {
  setStatus('Завантажую графіку…');
  try {
    await loadAssets();
    await preloadCustomIcons();
  } catch (e) {
    setStatus('Помилка завантаження ассетів: ' + (e as Error).message);
    return;
  }
  // якщо локального збереження ще нема — пробуємо стандартний набір із сайту
  if (!localStorage.getItem(LS_KEY)) {
    try {
      const r = await fetch('./bretwalda/cards.json?cb=' + Date.now());
      if (r.ok) state = normalizeState(await r.json() as State);
      if (state.cards.length) state.selId = state.cards[0].id;
    } catch { /* нема — лишаємо початковий */ }
  }
  renderList();
  syncControls();
  hookControls();
  requestRender();
  setStatus('Готово. Карток: ' + state.cards.length);
}

void main();
