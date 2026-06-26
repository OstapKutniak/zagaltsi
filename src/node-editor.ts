// src/node-editor.ts — Shared canvas node editor (location building logic + NPC behavior)
// Blender-подібна взаємодія: G — рух, Shift+D — дублювати, ЛКМ-рамка — виділення,
// Ctrl+ЛКМ — ніж (різати звʼязки), Shift+ЛКМ — reroute-вузол, тягни з будь-якого порту.

export type NodeCat = 'root' | 'condition' | 'behavior' | 'function' | 'reroute' | 'dialog';

interface PortDef { label: string }
interface SelectOption { value: string; label: string; short?: string }
// 'select' — випадайка варіантів; 'list' — рядок «a|b|c» (керує динамічними виходами діалогу).
interface ConfigDef { type: 'number' | 'text' | 'select' | 'list'; label: string; default: string | number; options?: SelectOption[] }

export interface NodeTypeDef {
  cat: NodeCat; label: string; color: string;
  inPorts: PortDef[]; outPorts: PortDef[];
  config?: Record<string, ConfigDef>;
}

export const NODE_TYPES: Record<string, NodeTypeDef> = {
  player_distance: {
    cat: 'condition', label: 'Гравець на відстані', color: '#1e5a9e',
    inPorts: [{ label: '▶' }], outPorts: [{ label: 'Так' }, { label: 'Ні' }],
    config: {
      cmp: {
        type: 'select', label: 'Умова', default: 'lte',
        options: [
          { value: 'lte', short: '≤', label: '≤  менше або дорівнює' },
          { value: 'gte', short: '≥', label: '≥  більше або дорівнює' },
          { value: 'eq',  short: '=', label: '=  дорівнює' },
          { value: 'lt',  short: '<', label: '<  менше' },
          { value: 'gt',  short: '>', label: '>  більше' },
        ],
      },
      steps: { type: 'number', label: 'Кроків', default: 3 },
    },
  },
  health_below: {
    cat: 'condition', label: 'Здоровʼя нижче', color: '#1e5a9e',
    inPorts: [{ label: '▶' }], outPorts: [{ label: 'Так' }, { label: 'Ні' }],
    config: { percent: { type: 'number', label: '%', default: 30 } },
  },
  sees_player: {
    cat: 'condition', label: 'Бачить гравця', color: '#1e5a9e',
    inPorts: [{ label: '▶' }], outPorts: [{ label: 'Так' }, { label: 'Ні' }],
  },
  time_of_day: {
    cat: 'condition', label: 'Час доби', color: '#1e5a9e',
    inPorts: [{ label: '▶' }], outPorts: [{ label: 'День' }, { label: 'Ніч' }],
  },
  // «Потім» — вузол-перехід: після виконаної гілки веде до наступної умови.
  then_next: {
    cat: 'condition', label: 'Потім', color: '#5a5a5a',
    inPorts: [{ label: '▶' }], outPorts: [{ label: 'Далі' }],
  },
  // «Діалог завершено» — Так якщо ворог вже поговорив із гравцем.
  dialog_done: {
    cat: 'condition', label: 'Діалог завершено', color: '#8a5a00',
    inPorts: [{ label: '▶' }], outPorts: [{ label: 'Так' }, { label: 'Ні' }],
  },
  // «Діалог завершено позитивно» — Так якщо розмова скінчилась добром (домовились).
  dialog_positive: {
    cat: 'condition', label: 'Діалог завершено позитивно', color: '#8a5a00',
    inPorts: [{ label: '▶' }], outPorts: [{ label: 'Так' }, { label: 'Ні' }],
  },
  // «Діалог завершено негативно» — Так якщо розмова скінчилась погано.
  dialog_negative: {
    cat: 'condition', label: 'Діалог завершено негативно', color: '#8a5a00',
    inPorts: [{ label: '▶' }], outPorts: [{ label: 'Так' }, { label: 'Ні' }],
  },
  dialog_active: {
    cat: 'condition', label: 'Діалог триває', color: '#8a5a00',
    inPorts: [{ label: '▶' }], outPorts: [{ label: 'Так' }, { label: 'Ні' }],
  },
  stat_check: {
    cat: 'condition', label: 'Характеристика', color: '#1e5a9e',
    inPorts: [{ label: '▶' }], outPorts: [{ label: 'Так' }, { label: 'Ні' }],
    config: {
      stat: {
        type: 'select', label: 'Параметр', default: 'health',
        options: [
          { value: 'health',    short: '♥',  label: '♥  Здоровʼя' },
          { value: 'back_pain', short: '🦴', label: '🦴  Біль у спині' },
          { value: 'anxiety',   short: '⚡', label: '⚡  Тривожність' },
        ],
      },
      cmp: {
        type: 'select', label: 'Умова', default: 'lte',
        options: [
          { value: 'lte', short: '≤', label: '≤  менше або дорівнює' },
          { value: 'gte', short: '≥', label: '≥  більше або дорівнює' },
          { value: 'eq',  short: '=', label: '=  дорівнює' },
          { value: 'lt',  short: '<', label: '<  менше' },
          { value: 'gt',  short: '>', label: '>  більше' },
        ],
      },
      percent: { type: 'number', label: '%', default: 50 },
    },
  },
  // «І (AND)» — обидва підключених джерела А і В мають вернути потрібний вихід.
  and_cond: {
    cat: 'condition', label: 'І (AND)', color: '#1e5a9e',
    inPorts: [{ label: 'А' }, { label: 'В' }], outPorts: [{ label: 'Так' }, { label: 'Ні' }],
  },
  run_to_player:  { cat: 'behavior', label: 'Бігти на гравця',  color: '#7a2e00', inPorts: [{ label: '▶' }], outPorts: [{ label: 'Вихід' }] },
  walk_to_player: { cat: 'behavior', label: 'Йти на гравця',    color: '#7a2e00', inPorts: [{ label: '▶' }], outPorts: [{ label: 'Вихід' }] },
  range_attack:   { cat: 'behavior', label: 'Дальня атака',     color: '#7a2e00', inPorts: [{ label: '▶' }], outPorts: [{ label: 'Вихід' }] },
  melee_attack:   { cat: 'behavior', label: 'Ближня атака',     color: '#7a2e00', inPorts: [{ label: '▶' }], outPorts: [{ label: 'Вихід' }] },
  // «Стати нейтральним» — ворог перестає нападати (домовились після доброго діалогу).
  become_neutral:  { cat: 'behavior', label: 'Стати нейтральним',    color: '#1a6e3a', inPorts: [{ label: '▶' }], outPorts: [{ label: 'Вихід' }] },
  player_stop:     { cat: 'behavior', label: 'Гравець зупиняється',   color: '#7a2e00', inPorts: [{ label: '▶' }], outPorts: [{ label: 'Вихід' }] },
  player_resume:   { cat: 'behavior', label: 'Гравець відновлює рух', color: '#7a2e00', inPorts: [{ label: '▶' }], outPorts: [{ label: 'Вихід' }] },
  wait: {
    cat: 'behavior', label: 'Очікування', color: '#7a2e00',
    inPorts: [{ label: '▶' }], outPorts: [{ label: 'Вихід' }],
    config: { sec: { type: 'number', label: 'Сек', default: 1 } },
  },
  dialog_menu: {
    cat: 'function', label: 'Діалогове меню', color: '#1a6e3a',
    inPorts: [{ label: '▶' }], outPorts: [{ label: 'Варіант 1' }, { label: 'Варіант 2' }],
    config: { buttons: { type: 'number', label: 'Варіантів', default: 2 } },
  },
  // «Почати діалог» — ворог каже фразу; виходи = варіанти відповіді (кожен веде до
  // наступної діалог-ноди). Кількість виходів динамічна — з поля «Відповіді» («a|b|c»).
  dialog: {
    cat: 'dialog', label: 'Діалог', color: '#8a5a00',
    inPorts: [{ label: '▶' }], outPorts: [],
    config: {
      text: { type: 'text', label: 'Фраза', default: 'Гей, чужинцю!' },
      answers: { type: 'list', label: 'Відповіді', default: 'Привіт|Геть з дороги' },
      // «Кінець» — позначає цю репліку як завершення розмови з результатом (для умов
      // «діалог завершено позитивно/негативно»). «—» = не кінець, діалог триває.
      ending: {
        type: 'select', label: 'Кінець', default: 'none',
        options: [
          { value: 'none',     short: '—', label: '—  не кінець' },
          { value: 'positive', short: '✓', label: '✓  завершити позитивно' },
          { value: 'negative', short: '✗', label: '✗  завершити негативно' },
        ],
      },
    },
  },
};

// Варіанти відповіді діалог-ноди (керують її динамічними виходами).
export function dialogAnswers(n: GraphNode): string[] {
  return String(n.config.answers ?? '').split('|').map((s) => s.trim()).filter(Boolean);
}

export const NODE_CATEGORIES: { id: string; label: string; types: string[] }[] = [
  { id: 'condition', label: 'Умови',     types: ['player_distance', 'health_below', 'sees_player', 'time_of_day', 'then_next', 'and_cond', 'dialog_done', 'dialog_positive', 'dialog_negative', 'dialog_active', 'stat_check'] },
  { id: 'behavior',  label: 'Поведінка', types: ['run_to_player', 'walk_to_player', 'wait', 'range_attack', 'melee_attack', 'become_neutral', 'player_stop', 'player_resume'] },
  { id: 'dialog',    label: 'Діалог',    types: ['dialog'] },
  { id: 'function',  label: 'Функції',   types: ['dialog_menu'] },
];

export interface GraphNode {
  id: string; type: string; cat: NodeCat; label: string;
  x: number; y: number; config: Record<string, string | number>;
  thumb?: string; // дата-URL портрета для кореневого (персонаж/будівля) вузла
}
export interface GraphEdge { fromId: string; fromPort: number; toId: string; toPort: number; }
export interface NodeGraph { nodes: GraphNode[]; edges: GraphEdge[]; updatedAt?: number; }

// ── Layout constants ────────────────────────────────────────────────────────────
const NW = 168;
const HDR = 26;
const PR = 20;
const PR_R = 5;
const PAD_T = 8;
const PAD_B = 8;
const CFG_H = 22;
const THUMB = 58;      // висота портрета в кореневому вузлі
const RR = 24;         // розмір reroute-вузла

// Порти будь-якого вузла (узагальнення NODE_TYPES + спец-випадки root/reroute).
function outLabels(n: GraphNode): string[] {
  if (n.cat === 'root') return ['Поведінка'];
  if (n.cat === 'reroute') return ['▶'];
  // Діалог: виходи = варіанти відповіді (динамічні). Без відповідей — один вихід «Далі».
  if (n.type === 'dialog') { const a = dialogAnswers(n); return a.length ? a : ['Далі']; }
  return NODE_TYPES[n.type]?.outPorts.map(p => p.label) ?? [];
}
function inLabels(n: GraphNode): string[] {
  if (n.cat === 'root') return [];
  if (n.cat === 'reroute') return ['▶'];
  return NODE_TYPES[n.type]?.inPorts.map(p => p.label) ?? [];
}
function nodeW(n: GraphNode): number { return n.cat === 'reroute' ? RR : NW; }
// Кількість рядків портів (макс зі входів/виходів) — спільне для геометрії й конфіг-рядків.
function portRows(n: GraphNode): number { return Math.max(inLabels(n).length, outLabels(n).length); }

function bodyH(n: GraphNode): number {
  if (n.cat === 'root') return PAD_T + THUMB + PR + PAD_B;
  const def = NODE_TYPES[n.type]; if (!def) return 24;
  return PAD_T + portRows(n) * PR
    + (def.config ? Object.keys(def.config).length : 0) * CFG_H + PAD_B;
}
function nodeH(n: GraphNode): number {
  if (n.cat === 'reroute') return RR;
  return HDR + bodyH(n);
}
// Y центру i-го порту (root: один порт під портретом; reroute: центр; решта — рядки).
function portY(n: GraphNode, i: number): number {
  if (n.cat === 'reroute') return n.y + RR / 2;
  if (n.cat === 'root') return n.y + HDR + PAD_T + THUMB + PR / 2;
  return n.y + HDR + PAD_T + i * PR + PR / 2;
}
function iPP(n: GraphNode, i: number) { return { x: n.x, y: portY(n, i) }; }
function oPP(n: GraphNode, i: number) { return { x: n.x + nodeW(n), y: portY(n, i) }; }

// Перетин відрізків (для ножа).
function segInt(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): boolean {
  const d = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx);
  if (Math.abs(d) < 1e-6) return false;
  const t = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / d;
  const u = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / d;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

export class NodeEditor {
  private cvs: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  graph: NodeGraph = { nodes: [], edges: [] };
  onChange?: (g: NodeGraph) => void;

  private pan = { x: 80, y: 40 };
  private zoom = 1;

  // dragging an edge: from output (reverse=false) or from input (reverse=true)
  private de: { reverse: boolean; fromId?: string; fromPort?: number; toId?: string; toPort?: number; mx: number; my: number; detached?: boolean } | null = null;
  // звʼязок, кинутий у порожнечу: чекає вибір вузла в меню, щоб одразу під'єднатися
  private pendingDe: { reverse: boolean; fromId?: string; fromPort?: number; toId?: string; toPort?: number; detached?: boolean } | null = null;
  // RMB по лінії зв'язку — вставити ноду між двома кінцями.
  private pendingInsert: GraphEdge | null = null;
  // Лінія, на яку зараз наводить курсор (підсвічується).
  private hoveredEdge: GraphEdge | null = null;
  private drag: { ids: string[]; orig: Map<string, { x: number; y: number }>; wx0: number; wy0: number; moved: boolean } | null = null;
  private grab: { ids: string[]; orig: Map<string, { x: number; y: number }>; ax: number; ay: number } | null = null;
  private box: { sx: number; sy: number } | null = null;
  private knife: { x: number; y: number }[] | null = null;
  private pan0: { mx: number; my: number; px: number; py: number } | null = null;

  private selected = new Set<string>();
  private mouse = { sx: 0, sy: 0 };

  private menuEl: HTMLElement | null = null;
  private _menuClose: ((e: MouseEvent) => void) | null = null;
  private pWx = 0; private pWy = 0;

  allowedCats: string[];
  private _uid = Date.now();
  private uid = (): string => (++this._uid).toString(36);

  private thumbs = new Map<string, HTMLImageElement>();
  private _raf = 0; private _running = false;
  private _ac = new AbortController();

  constructor(canvas: HTMLCanvasElement, allowedCats: string[], onChange?: (g: NodeGraph) => void) {
    this.cvs = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.allowedCats = allowedCats;
    this.onChange = onChange;
    this.wire();
  }

  start(): void {
    if (this._running) return; this._running = true;
    const loop = () => { if (!this._running) return; this.draw(); this._raf = requestAnimationFrame(loop); };
    this._raf = requestAnimationFrame(loop);
  }

  stop(): void {
    this._running = false;
    cancelAnimationFrame(this._raf);
    this.closeMenu();
    this._ac.abort();
  }

  resize(): void {
    const b = this.cvs.getBoundingClientRect();
    this.cvs.width = b.width || this.cvs.clientWidth || 400;
    this.cvs.height = b.height || this.cvs.clientHeight || 200;
    this.draw();
  }

  acceptDrop(label: string, type: string, clientX: number, clientY: number, thumb?: string): void {
    const r = this.cvs.getBoundingClientRect();
    const wx = (clientX - r.left - this.pan.x) / this.zoom;
    const wy = (clientY - r.top - this.pan.y) / this.zoom;
    this.graph.nodes.push({ id: this.uid(), type, cat: 'root', label, x: wx - NW / 2, y: wy - HDR / 2, config: {}, thumb });
    this.draw(); this.onChange?.(this.graph);
  }

  getGraph(): NodeGraph { return JSON.parse(JSON.stringify(this.graph)); }
  loadGraph(g: NodeGraph): void { this.graph = JSON.parse(JSON.stringify(g)); this.selected.clear(); this.draw(); }

  // ── transforms ───────────────────────────────────────────────────────────────
  private sw(wx: number) { return wx * this.zoom + this.pan.x; }
  private sh(wy: number) { return wy * this.zoom + this.pan.y; }
  private ww(sx: number) { return (sx - this.pan.x) / this.zoom; }
  private wh(sy: number) { return (sy - this.pan.y) / this.zoom; }
  private exy(e: MouseEvent) { const r = this.cvs.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }

  // ── hit tests ────────────────────────────────────────────────────────────────
  private nodeAt(sx: number, sy: number): GraphNode | null {
    const wx = this.ww(sx), wy = this.wh(sy);
    for (const n of [...this.graph.nodes].reverse())
      if (wx >= n.x && wx <= n.x + nodeW(n) && wy >= n.y && wy <= n.y + nodeH(n)) return n;
    return null;
  }
  private oPA(sx: number, sy: number): { n: GraphNode; i: number } | null {
    for (const n of this.graph.nodes) {
      const labels = outLabels(n);
      for (let i = 0; i < labels.length; i++) {
        const p = oPP(n, i);
        if (Math.hypot(sx - this.sw(p.x), sy - this.sh(p.y)) <= PR_R * this.zoom + 6) return { n, i };
      }
    }
    return null;
  }
  private iPA(sx: number, sy: number): { n: GraphNode; i: number } | null {
    for (const n of this.graph.nodes) {
      const labels = inLabels(n);
      for (let i = 0; i < labels.length; i++) {
        const p = iPP(n, i);
        if (Math.hypot(sx - this.sw(p.x), sy - this.sh(p.y)) <= PR_R * this.zoom + 6) return { n, i };
      }
    }
    return null;
  }
  private closeAt(sx: number, sy: number): GraphNode | null {
    const wx = this.ww(sx), wy = this.wh(sy);
    for (const n of this.graph.nodes) {
      if (n.cat === 'reroute') continue;
      if (wx >= n.x + nodeW(n) - 20 && wx <= n.x + nodeW(n) - 4 && wy >= n.y + 4 && wy <= n.y + 20) return n;
    }
    return null;
  }
  private cfgAt(sx: number, sy: number): { n: GraphNode; key: string } | null {
    const wx = this.ww(sx), wy = this.wh(sy);
    for (const n of this.graph.nodes) {
      const def = NODE_TYPES[n.type]; if (!def?.config) continue;
      let cy = n.y + HDR + PAD_T + portRows(n) * PR;
      for (const key of Object.keys(def.config)) {
        if (wx >= n.x + 4 && wx <= n.x + NW - 4 && wy >= cy && wy <= cy + CFG_H) return { n, key };
        cy += CFG_H;
      }
    }
    return null;
  }

  // ── draw ──────────────────────────────────────────────────────────────────────
  private edgeAnchors(e: GraphEdge): { fx: number; fy: number; tx: number; ty: number } | null {
    const fn = this.graph.nodes.find(n => n.id === e.fromId);
    const tn = this.graph.nodes.find(n => n.id === e.toId);
    if (!fn || !tn) return null;
    const fp = oPP(fn, e.fromPort), tp = iPP(tn, e.toPort);
    return { fx: this.sw(fp.x), fy: this.sh(fp.y), tx: this.sw(tp.x), ty: this.sh(tp.y) };
  }

  draw(): void {
    const c = this.cvs, x = this.ctx, w = c.width, h = c.height;
    x.clearRect(0, 0, w, h);
    x.fillStyle = '#1e1e1e'; x.fillRect(0, 0, w, h);

    x.strokeStyle = '#2b2b2b'; x.lineWidth = 1;
    const gs = 40 * this.zoom;
    const gox = ((this.pan.x % gs) + gs) % gs, goy = ((this.pan.y % gs) + gs) % gs;
    for (let gx = gox; gx < w; gx += gs) { x.beginPath(); x.moveTo(gx, 0); x.lineTo(gx, h); x.stroke(); }
    for (let gy = goy; gy < h; gy += gs) { x.beginPath(); x.moveTo(0, gy); x.lineTo(w, gy); x.stroke(); }

    for (const e of this.graph.edges) {
      const a = this.edgeAnchors(e); if (!a) continue;
      const fn = this.graph.nodes.find(n => n.id === e.fromId)!;
      const hov = e === this.hoveredEdge;
      // Підсвічена лінія: спершу малюємо товстий білий ореол, потім тонку кольорову поверх.
      if (hov) {
        x.strokeStyle = 'rgba(255,255,255,0.55)'; x.lineWidth = 6; x.setLineDash([]);
        x.beginPath(); x.moveTo(a.fx, a.fy);
        const mx2 = (a.fx + a.tx) / 2;
        x.bezierCurveTo(mx2, a.fy, mx2, a.ty, a.tx, a.ty); x.stroke();
      }
      x.strokeStyle = hov ? '#ffffff' : (this.colorOf(fn)) + 'cc';
      x.lineWidth = hov ? 2.5 : 2; x.setLineDash([]);
      x.beginPath(); x.moveTo(a.fx, a.fy);
      const mx = (a.fx + a.tx) / 2;
      x.bezierCurveTo(mx, a.fy, mx, a.ty, a.tx, a.ty); x.stroke();
    }

    if (this.de) {
      let ax: number, ay: number;
      if (!this.de.reverse) {
        const fn = this.graph.nodes.find(n => n.id === this.de!.fromId);
        if (!fn) { /* skip */ } else { const fp = oPP(fn, this.de.fromPort!); ax = this.sw(fp.x); ay = this.sh(fp.y); this.tempWire(ax, ay, this.de.mx, this.de.my, this.colorOf(fn)); }
      } else {
        const tn = this.graph.nodes.find(n => n.id === this.de!.toId);
        if (tn) { const tp = iPP(tn, this.de.toPort!); ax = this.sw(tp.x); ay = this.sh(tp.y); this.tempWire(this.de.mx, this.de.my, ax, ay, '#888'); }
      }
    }

    for (const n of this.graph.nodes) this.drawNode(n);

    // рамка виділення
    if (this.box) {
      const x0 = Math.min(this.box.sx, this.mouse.sx), y0 = Math.min(this.box.sy, this.mouse.sy);
      const ww = Math.abs(this.mouse.sx - this.box.sx), hh = Math.abs(this.mouse.sy - this.box.sy);
      x.fillStyle = 'rgba(255,154,31,0.12)'; x.fillRect(x0, y0, ww, hh);
      x.strokeStyle = '#ff9a1f'; x.lineWidth = 1; x.setLineDash([4, 3]); x.strokeRect(x0, y0, ww, hh); x.setLineDash([]);
    }

    // ніж
    if (this.knife && this.knife.length > 1) {
      x.strokeStyle = '#ff4040'; x.lineWidth = 2; x.setLineDash([]);
      x.beginPath(); x.moveTo(this.knife[0].x, this.knife[0].y);
      for (const p of this.knife) x.lineTo(p.x, p.y);
      x.stroke();
    }

    if (!this.graph.nodes.length) {
      x.fillStyle = 'rgba(255,255,255,0.18)';
      x.font = '14px system-ui, sans-serif'; x.textAlign = 'center';
      x.fillText('Перетягни картку сюди  ·  ПКМ — додати вузол', w / 2, h / 2);
    }
  }

  private colorOf(n: GraphNode): string {
    if (n.cat === 'root') return '#3d6b8f';
    if (n.cat === 'reroute') return '#777';
    return NODE_TYPES[n.type]?.color ?? '#454545';
  }

  private tempWire(fx: number, fy: number, tx: number, ty: number, color: string): void {
    const x = this.ctx;
    x.strokeStyle = color + '99'; x.lineWidth = 2; x.setLineDash([5, 4]);
    x.beginPath(); x.moveTo(fx, fy);
    const mx = (fx + tx) / 2;
    x.bezierCurveTo(mx, fy, mx, ty, tx, ty); x.stroke(); x.setLineDash([]);
  }

  private getThumb(src: string): HTMLImageElement {
    let img = this.thumbs.get(src);
    if (!img) { img = new Image(); img.onload = () => this.draw(); img.src = src; this.thumbs.set(src, img); }
    return img;
  }

  private drawNode(n: GraphNode): void {
    const x = this.ctx;
    const nh = nodeH(n), nw = nodeW(n);
    const sx = this.sw(n.x), sy = this.sh(n.y);
    const sw = nw * this.zoom, sh = nh * this.zoom;
    const sel = this.selected.has(n.id);
    const r = Math.max(2, 7 * this.zoom);

    // reroute — маленький кружок-перехідник
    if (n.cat === 'reroute') {
      x.fillStyle = '#3a3a3a'; this.rr(sx, sy, sw, sh, r, r, r, r); x.fill();
      x.strokeStyle = sel ? '#ff9a1f' : 'rgba(255,255,255,0.25)'; x.lineWidth = sel ? 2 : 1; this.rr(sx, sy, sw, sh, r, r, r, r); x.stroke();
      this.drawPorts(n);
      return;
    }

    const hcol = this.colorOf(n);
    x.fillStyle = hcol;
    this.rr(sx, sy, sw, HDR * this.zoom, r, r, 0, 0); x.fill();
    x.fillStyle = '#2a2a2a';
    this.rr(sx, sy + HDR * this.zoom, sw, (nh - HDR) * this.zoom, 0, 0, r, r); x.fill();
    x.strokeStyle = sel ? '#ff9a1f' : 'rgba(255,255,255,0.1)'; x.lineWidth = sel ? 2 : 1;
    this.rr(sx, sy, sw, sh, r, r, r, r); x.stroke();

    const fs = Math.max(9, Math.round(11 * this.zoom));
    x.fillStyle = '#fff'; x.font = `600 ${fs}px system-ui, sans-serif`; x.textAlign = 'left';
    x.fillText(n.label, sx + 8 * this.zoom, sy + HDR * this.zoom * 0.68);

    // кнопка ×
    const bx = sx + sw - 20 * this.zoom, by = sy + 5 * this.zoom, bs = 14 * this.zoom;
    x.fillStyle = 'rgba(255,255,255,0.15)';
    this.rr(bx, by, bs, bs, 3, 3, 3, 3); x.fill();
    x.fillStyle = '#bbb'; x.font = `${Math.max(8, Math.round(10 * this.zoom))}px system-ui, sans-serif`; x.textAlign = 'center';
    x.fillText('×', bx + bs / 2, by + bs * 0.76);

    // портрет кореневого вузла (персонаж/будівля)
    if (n.cat === 'root') {
      const tw = THUMB * this.zoom, pad = PAD_T * this.zoom;
      const tx = sx + (sw - tw) / 2, ty = sy + HDR * this.zoom + pad;
      x.fillStyle = '#1c1c1c'; this.rr(tx, ty, tw, tw, 4, 4, 4, 4); x.fill();
      if (n.thumb) {
        const img = this.getThumb(n.thumb);
        if (img.complete && img.naturalWidth) {
          x.save(); this.rr(tx, ty, tw, tw, 4, 4, 4, 4); x.clip();
          const k = Math.min(tw / img.naturalWidth, tw / img.naturalHeight);
          const dw = img.naturalWidth * k, dh = img.naturalHeight * k;
          x.drawImage(img, tx + (tw - dw) / 2, ty + (tw - dh) / 2, dw, dh);
          x.restore();
        }
      } else {
        x.fillStyle = 'rgba(255,255,255,0.25)'; x.font = `${Math.round(20 * this.zoom)}px system-ui`; x.textAlign = 'center';
        x.fillText('☻', tx + tw / 2, ty + tw * 0.62);
      }
      x.strokeStyle = 'rgba(255,255,255,0.12)'; x.lineWidth = 1; this.rr(tx, ty, tw, tw, 4, 4, 4, 4); x.stroke();
    }

    this.drawPorts(n);

    // конфіг-рядки
    const def = NODE_TYPES[n.type];
    if (def?.config) {
      let cy = n.y + HDR + PAD_T + portRows(n) * PR;
      for (const [key, cd] of Object.entries(def.config)) {
        const psx = this.sw(n.x + 6), psy = this.sh(cy);
        const cfs = Math.max(8, Math.round(9 * this.zoom));
        x.fillStyle = 'rgba(255,255,255,0.4)'; x.font = `${cfs}px system-ui, sans-serif`; x.textAlign = 'left';
        const lbl = cd.label + ': ';
        x.fillText(lbl, psx, psy + 14 * this.zoom);
        // select — показуємо короткий гліф/мітку обраного варіанта; інше — як є (обрізаємо довге).
        let shown = String(n.config[key] ?? cd.default);
        if (cd.type === 'select') { const o = cd.options?.find((op) => op.value === shown); shown = o?.short ?? o?.label ?? shown; }
        const maxW = (NW - 12) * this.zoom - x.measureText(lbl).width;
        while (shown.length > 1 && x.measureText(shown).width > maxW) shown = shown.slice(0, -1);
        x.fillStyle = '#fff'; x.font = `600 ${cfs}px system-ui, sans-serif`;
        x.fillText(shown, psx + x.measureText(lbl).width, psy + 14 * this.zoom);
        cy += CFG_H;
      }
    }
  }

  private drawPorts(n: GraphNode): void {
    const x = this.ctx;
    const hcol = this.colorOf(n);
    const pfs = Math.max(8, Math.round(9 * this.zoom));
    const showLbl = n.cat !== 'reroute';
    const ins = inLabels(n), outs = outLabels(n);
    for (let i = 0; i < ins.length; i++) {
      const p = iPP(n, i), px = this.sw(p.x), py = this.sh(p.y);
      x.fillStyle = '#444'; x.beginPath(); x.arc(px, py, PR_R * this.zoom, 0, Math.PI * 2); x.fill();
      x.strokeStyle = '#888'; x.lineWidth = 1.5; x.stroke();
      if (showLbl) { x.fillStyle = 'rgba(255,255,255,0.55)'; x.textAlign = 'left'; x.font = `${pfs}px system-ui, sans-serif`; x.fillText(ins[i], px + (PR_R + 3) * this.zoom, py + 4 * this.zoom); }
    }
    for (let i = 0; i < outs.length; i++) {
      const p = oPP(n, i), px = this.sw(p.x), py = this.sh(p.y);
      x.fillStyle = hcol; x.beginPath(); x.arc(px, py, PR_R * this.zoom, 0, Math.PI * 2); x.fill();
      x.strokeStyle = '#ccc'; x.lineWidth = 1.5; x.stroke();
      if (showLbl) { x.fillStyle = 'rgba(255,255,255,0.85)'; x.textAlign = 'right'; x.font = `${pfs}px system-ui, sans-serif`; x.fillText(outs[i], px - (PR_R + 3) * this.zoom, py + 4 * this.zoom); }
    }
  }

  private rr(x: number, y: number, w: number, h: number, tl: number, tr: number, br: number, bl: number): void {
    const c = this.ctx;
    c.beginPath();
    c.moveTo(x + tl, y);
    c.lineTo(x + w - tr, y); if (tr > 0) c.arcTo(x + w, y, x + w, y + tr, tr); else c.lineTo(x + w, y);
    c.lineTo(x + w, y + h - br); if (br > 0) c.arcTo(x + w, y + h, x + w - br, y + h, br); else c.lineTo(x + w, y + h);
    c.lineTo(x + bl, y + h); if (bl > 0) c.arcTo(x, y + h, x, y + h - bl, bl); else c.lineTo(x, y + h);
    c.lineTo(x, y + tl); if (tl > 0) c.arcTo(x, y, x + tl, y, tl); else c.lineTo(x, y);
    c.closePath();
  }

  // ── edge helpers ───────────────────────────────────────────────────────────────
  private connect(fromId: string, fromPort: number, toId: string, toPort: number): void {
    if (fromId === toId) return;
    const toNode = this.graph.nodes.find(n => n.id === toId);
    // звичайний вхід приймає один звʼязок; reroute — кілька (щоб злити кілька шляхів в один вхід)
    if (toNode?.cat !== 'reroute') this.graph.edges = this.graph.edges.filter(ed => !(ed.toId === toId && ed.toPort === toPort));
    this.graph.edges.push({ fromId, fromPort, toId, toPort });
    this.onChange?.(this.graph);
  }

  // ── events ───────────────────────────────────────────────────────────────────
  private wire(): void {
    const cvs = this.cvs;
    const sig = { signal: this._ac.signal };

    cvs.addEventListener('mousedown', (e) => {
      const { x: sx, y: sy } = this.exy(e);
      this.mouse = { sx, sy };
      // завершити активний grab/duplicate кліком
      if (this.grab) { this.grab = null; this.onChange?.(this.graph); return; }
      if (e.button === 1 || (e.button === 0 && e.altKey)) {
        e.preventDefault();
        this.pan0 = { mx: e.clientX, my: e.clientY, px: this.pan.x, py: this.pan.y }; return;
      }
      if (e.button === 2) {
        e.preventDefault();
        this.openMenu(sx, sy, e.clientX, e.clientY, this.edgeAt(sx, sy) ?? undefined);
        return;
      }
      if (e.button !== 0) return;
      this.closeMenu();

      // Ctrl — ніж (різати звʼязки)
      if (e.ctrlKey) { this.knife = [{ x: sx, y: sy }]; return; }

      // порти спершу (щоб не плутати з тілом вузла)
      const op = this.oPA(sx, sy);
      if (op) { this.de = { reverse: false, fromId: op.n.id, fromPort: op.i, mx: sx, my: sy }; return; }
      const ip = this.iPA(sx, sy);
      if (ip) {
        // якщо у вхід уже входить звʼязок — відчепити його й тягнути від джерела (як у Blender)
        const ex = this.graph.edges.find(ed => ed.toId === ip.n.id && ed.toPort === ip.i);
        if (ex) {
          this.graph.edges = this.graph.edges.filter(ed => ed !== ex);
          this.de = { reverse: false, fromId: ex.fromId, fromPort: ex.fromPort, mx: sx, my: sy, detached: true };
        } else {
          this.de = { reverse: true, toId: ip.n.id, toPort: ip.i, mx: sx, my: sy };
        }
        return;
      }

      const cn = this.closeAt(sx, sy); if (cn) { this.delNodes([cn.id]); return; }
      const cf = this.cfgAt(sx, sy); if (cf) { this.editCfg(cf.n, cf.key, e.clientX, e.clientY); return; }

      // Shift на порожньому — reroute-вузол, який одразу тягнемо
      if (e.shiftKey && !this.nodeAt(sx, sy)) {
        const wx = this.ww(sx), wy = this.wh(sy);
        const id = this.uid();
        this.graph.nodes.push({ id, type: 'reroute', cat: 'reroute', label: '', x: wx - RR / 2, y: wy - RR / 2, config: {} });
        this.selected = new Set([id]);
        this.drag = { ids: [id], orig: new Map([[id, { x: wx - RR / 2, y: wy - RR / 2 }]]), wx0: wx, wy0: wy, moved: true };
        this.onChange?.(this.graph);
        return;
      }

      const dn = this.nodeAt(sx, sy);
      if (dn) {
        if (!this.selected.has(dn.id)) this.selected = new Set([dn.id]);
        const ids = [...this.selected];
        const orig = new Map(ids.map(id => { const nn = this.graph.nodes.find(n => n.id === id)!; return [id, { x: nn.x, y: nn.y }]; }));
        this.drag = { ids, orig, wx0: this.ww(sx), wy0: this.wh(sy), moved: false };
      } else {
        // порожнє — рамкове виділення
        this.box = { sx, sy };
        if (!e.shiftKey) this.selected.clear();
      }
    }, sig);

    cvs.addEventListener('mousemove', (e) => {
      const { x: sx, y: sy } = this.exy(e);
      this.mouse = { sx, sy };
      // Hover по лінії — підсвічуємо лише коли нічого не тягнемо.
      if (!this.de && !this.drag && !this.grab && !this.knife && !this.pan0) {
        this.hoveredEdge = this.edgeAt(sx, sy);
      } else {
        this.hoveredEdge = null;
      }
      if (this.pan0) { this.pan.x = this.pan0.px + e.clientX - this.pan0.mx; this.pan.y = this.pan0.py + e.clientY - this.pan0.my; return; }
      if (this.knife) {
        this.knife.push({ x: sx, y: sy });
        this.cutAlong(this.knife[this.knife.length - 2], this.knife[this.knife.length - 1]);
        return;
      }
      if (this.grab) { this.applyMove(this.grab.ids, this.grab.orig, this.ww(sx) - this.grab.ax, this.wh(sy) - this.grab.ay); return; }
      if (this.de) { this.de.mx = sx; this.de.my = sy; return; }
      if (this.drag) {
        const dxw = this.ww(sx) - this.drag.wx0, dyw = this.wh(sy) - this.drag.wy0;
        if (Math.abs(dxw) > 2 || Math.abs(dyw) > 2) this.drag.moved = true;
        if (this.drag.moved) this.applyMove(this.drag.ids, this.drag.orig, dxw, dyw);
        // Тягнемо вільний вузол над зв'язком → підсвічуємо лінію (вставимо при відпусканні).
        const insn = this.insertableDragNode();
        this.hoveredEdge = insn ? this.edgeUnderNode(insn) : null;
      }
    }, sig);

    cvs.addEventListener('mouseup', (e) => {
      const { x: sx, y: sy } = this.exy(e);
      this.pan0 = null;
      if (this.knife) { this.knife = null; return; }
      if (this.de) {
        let connected = false;
        if (!this.de.reverse) { const ip = this.iPA(sx, sy); if (ip) { this.connect(this.de.fromId!, this.de.fromPort!, ip.n.id, ip.i); connected = true; } }
        else { const op = this.oPA(sx, sy); if (op) { this.connect(op.n.id, op.i, this.de.toId!, this.de.toPort!); connected = true; } }
        if (!connected) {
          // кинули в порожнечу — меню вибору вузла, у який одразу під'єднати (як link-drag у Blender)
          const pend = this.de; this.de = null;
          this.openMenu(sx, sy, e.clientX, e.clientY);
          this.pendingDe = pend;
          return;
        }
        this.de = null; return;
      }
      if (this.box) {
        const x0 = Math.min(this.box.sx, sx), y0 = Math.min(this.box.sy, sy);
        const x1 = Math.max(this.box.sx, sx), y1 = Math.max(this.box.sy, sy);
        for (const n of this.graph.nodes) {
          const nsx = this.sw(n.x), nsy = this.sh(n.y), nsw = nodeW(n) * this.zoom, nsh = nodeH(n) * this.zoom;
          if (nsx + nsw >= x0 && nsx <= x1 && nsy + nsh >= y0 && nsy <= y1) this.selected.add(n.id);
        }
        this.box = null; return;
      }
      if (this.drag) {
        if (this.drag.moved) {
          // Кинули вільний вузол на зв'язок → вставляємо його між кінцями (як у Blender).
          const insn = this.insertableDragNode();
          const overEdge = insn ? this.edgeUnderNode(insn) : null;
          if (insn && overEdge) this.insertNodeIntoEdge(insn, overEdge);
          this.onChange?.(this.graph);
        }
        this.hoveredEdge = null;
        this.drag = null;
      }
    }, sig);

    cvs.addEventListener('wheel', (e) => {
      e.preventDefault();
      const { x: sx, y: sy } = this.exy(e);
      const f = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      const wx = this.ww(sx), wy = this.wh(sy);
      this.zoom = Math.max(0.3, Math.min(2.5, this.zoom * f));
      this.pan.x = sx - wx * this.zoom; this.pan.y = sy - wy * this.zoom;
    }, { passive: false, signal: this._ac.signal });

    cvs.addEventListener('contextmenu', e => e.preventDefault(), sig);
    cvs.addEventListener('dragover',  e => e.preventDefault(), sig);
    cvs.addEventListener('drop', e => {
      e.preventDefault();
      const bid = e.dataTransfer?.getData('text/building-id');
      if (bid) { this.acceptDrop(e.dataTransfer?.getData('text/building-name') || 'Споруда', 'building', e.clientX, e.clientY); return; }
      const npcId = e.dataTransfer?.getData('text/npc-id');
      if (npcId) { this.acceptDrop(e.dataTransfer?.getData('text/npc-name') || 'НПС', 'npc:' + npcId, e.clientX, e.clientY, e.dataTransfer?.getData('text/npc-thumb') || undefined); }
    }, sig);

    // Клавіатура — лише поки панель активна (host-редактори при відкритій панелі мовчать)
    window.addEventListener('keydown', (e) => {
      if (!this._running) return;
      const tag = (document.activeElement?.tagName ?? '').toUpperCase();
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (e.code === 'KeyG') { e.preventDefault(); this.startGrab(); return; }
      if (e.shiftKey && e.code === 'KeyD') { e.preventDefault(); this.duplicateSelected(); return; }
      if (e.code === 'Delete' || e.code === 'Backspace') { e.preventDefault(); if (this.selected.size) this.delNodes([...this.selected]); return; }
      if (e.code === 'Escape') {
        if (this.grab) { this.applyMove(this.grab.ids, this.grab.orig, 0, 0); this.grab = null; }
        this.de = null; this.box = null; this.knife = null;
      }
    }, sig);
  }

  private applyMove(ids: string[], orig: Map<string, { x: number; y: number }>, dx: number, dy: number): void {
    for (const id of ids) { const n = this.graph.nodes.find(nd => nd.id === id); const o = orig.get(id); if (n && o) { n.x = o.x + dx; n.y = o.y + dy; } }
  }

  private startGrab(): void {
    if (!this.selected.size) { const n = this.nodeAt(this.mouse.sx, this.mouse.sy); if (n) this.selected = new Set([n.id]); }
    if (!this.selected.size) return;
    const ids = [...this.selected];
    const orig = new Map(ids.map(id => { const n = this.graph.nodes.find(nd => nd.id === id)!; return [id, { x: n.x, y: n.y }]; }));
    this.grab = { ids, orig, ax: this.ww(this.mouse.sx), ay: this.wh(this.mouse.sy) };
  }

  private duplicateSelected(): void {
    if (!this.selected.size) return;
    const map = new Map<string, string>();
    const dups: GraphNode[] = [];
    for (const id of this.selected) {
      const n = this.graph.nodes.find(nd => nd.id === id); if (!n) continue;
      const nid = this.uid(); map.set(id, nid);
      dups.push({ ...n, id: nid, config: { ...n.config }, x: n.x + 24, y: n.y + 24 });
    }
    // звʼязки всередині виділення копіюються теж
    for (const e of this.graph.edges) if (map.has(e.fromId) && map.has(e.toId)) this.graph.edges.push({ fromId: map.get(e.fromId)!, fromPort: e.fromPort, toId: map.get(e.toId)!, toPort: e.toPort });
    this.graph.nodes.push(...dups);
    this.selected = new Set(dups.map(d => d.id));
    this.onChange?.(this.graph);
    this.startGrab();
  }

  // Повертає зв'язок, найближчий до екранної точки (у межах 10 px), або null.
  private edgeAt(sx: number, sy: number): GraphEdge | null {
    const THRESH = 10;
    for (const e of this.graph.edges) {
      const a = this.edgeAnchors(e); if (!a) continue;
      const mx = (a.fx + a.tx) / 2;
      let px = a.fx, py = a.fy;
      for (let s = 1; s <= 24; s++) {
        const t = s / 24, it = 1 - t;
        const bx = it * it * it * a.fx + 3 * it * it * t * mx + 3 * it * t * t * mx + t * t * t * a.tx;
        const by = it * it * it * a.fy + 3 * it * it * t * a.fy + 3 * it * t * t * a.ty + t * t * t * a.ty;
        if (Math.hypot(sx - bx, sy - by) <= THRESH) return e;
        // також перевіряємо сегмент між двома сусідніми семплами (заповнюємо пропуски)
        if (s > 1 && segInt(sx - THRESH, sy, sx + THRESH, sy, px, py, bx, by)) return e;
        px = bx; py = by;
      }
    }
    return null;
  }

  // Зв'язок, чия лінія проходить ПІД тілом вузла (для вставки drag-and-drop, як у Blender).
  // Ігноруємо зв'язки, що вже торкаються цього вузла. Повертає перший знайдений або null.
  private edgeUnderNode(n: GraphNode): GraphEdge | null {
    const sx0 = this.sw(n.x), sy0 = this.sh(n.y);
    const sx1 = sx0 + nodeW(n) * this.zoom, sy1 = sy0 + nodeH(n) * this.zoom;
    for (const e of this.graph.edges) {
      if (e.fromId === n.id || e.toId === n.id) continue;
      const a = this.edgeAnchors(e); if (!a) continue;
      const mx = (a.fx + a.tx) / 2;
      for (let s = 0; s <= 16; s++) {
        const t = s / 16, it = 1 - t;
        const bx = it * it * it * a.fx + 3 * it * it * t * mx + 3 * it * t * t * mx + t * t * t * a.tx;
        const by = it * it * it * a.fy + 3 * it * it * t * a.fy + 3 * it * t * t * a.ty + t * t * t * a.ty;
        if (bx >= sx0 && bx <= sx1 && by >= sy0 && by <= sy1) return e;
      }
    }
    return null;
  }

  // Вставити вузол у наявний зв'язок: джерело→вхід0 вузла, вихід0 вузла→ціль.
  private insertNodeIntoEdge(n: GraphNode, e: GraphEdge): void {
    this.graph.edges = this.graph.edges.filter((ed) => ed !== e);
    this.connect(e.fromId, e.fromPort, n.id, 0);
    this.connect(n.id, 0, e.toId, e.toPort);
  }

  // Чи можна вставити цей вузол у зв'язок: він одинокий у виділенні, ще ні з чим не
  // з'єднаний і має вхід та вихід (root без входів — не можна).
  private insertableDragNode(): GraphNode | null {
    if (!this.drag || this.drag.ids.length !== 1) return null;
    const n = this.graph.nodes.find((nd) => nd.id === this.drag!.ids[0]);
    if (!n || !inLabels(n).length || !outLabels(n).length) return null;
    if (this.graph.edges.some((ed) => ed.fromId === n.id || ed.toId === n.id)) return null;
    return n;
  }

  private cutAlong(a: { x: number; y: number }, b: { x: number; y: number }): void {
    const before = this.graph.edges.length;
    this.graph.edges = this.graph.edges.filter(e => {
      const an = this.edgeAnchors(e); if (!an) return true;
      let px = an.fx, py = an.fy; const mx = (an.fx + an.tx) / 2;
      for (let s = 1; s <= 12; s++) {
        const t = s / 12, it = 1 - t;
        const bx = it * it * it * an.fx + 3 * it * it * t * mx + 3 * it * t * t * mx + t * t * t * an.tx;
        const by = it * it * it * an.fy + 3 * it * it * t * an.fy + 3 * it * t * t * an.ty + t * t * t * an.ty;
        if (segInt(a.x, a.y, b.x, b.y, px, py, bx, by)) return false;
        px = bx; py = by;
      }
      return true;
    });
    if (this.graph.edges.length !== before) this.onChange?.(this.graph);
  }

  private editCfg(n: GraphNode, key: string, clientX: number, clientY: number): void {
    const def = NODE_TYPES[n.type]?.config?.[key]; if (!def) return;
    if (def.type === 'select') { this.openSelect(n, key, def.options ?? [], clientX, clientY); return; }
    const hint = def.type === 'list' ? `${def.label} (через | ):` : `${def.label}:`;
    const inp = prompt(hint, String(n.config[key] ?? def.default)); if (inp === null) return;
    n.config[key] = def.type === 'number' ? (parseFloat(inp) || def.default) : inp;
    this.onChange?.(this.graph);
  }

  // Випадайка варіантів для config-поля типу 'select'.
  private openSelect(n: GraphNode, key: string, options: SelectOption[], clientX: number, clientY: number): void {
    this.closeMenu();
    const el = document.createElement('div');
    const lx = Math.min(clientX, window.innerWidth - 220), ly = Math.min(clientY, window.innerHeight - (options.length * 32 + 16));
    el.style.cssText = `position:fixed;left:${lx}px;top:${ly}px;background:#2d2d2d;border:1px solid #4a4a4a;border-radius:8px;padding:4px;z-index:9999;min-width:200px;box-shadow:0 6px 20px rgba(0,0,0,.7)`;
    this.menuEl = el;
    const cur = String(n.config[key] ?? '');
    for (const opt of options) {
      this.mBtn(el, opt.label, () => { n.config[key] = opt.value; this.onChange?.(this.graph); this.closeMenu(); }, opt.value === cur ? '#ff9a1f' : undefined);
    }
    document.body.appendChild(el);
    const close = (ev: MouseEvent) => { if (!el.contains(ev.target as Node)) this.closeMenu(); };
    this._menuClose = close;
    setTimeout(() => document.addEventListener('mousedown', close), 0);
  }

  private delNodes(ids: string[]): void {
    const set = new Set(ids);
    this.graph.nodes = this.graph.nodes.filter(n => !set.has(n.id));
    this.graph.edges = this.graph.edges.filter(e => !set.has(e.fromId) && !set.has(e.toId));
    for (const id of ids) this.selected.delete(id);
    this.onChange?.(this.graph);
  }

  private openMenu(sx: number, sy: number, clientX: number, clientY: number, insertEdge?: GraphEdge): void {
    this.closeMenu(); // скидає pendingInsert — тому встановлюємо після
    this.pWx = this.ww(sx); this.pWy = this.wh(sy);
    if (insertEdge) this.pendingInsert = insertEdge; // встановити ПІСЛЯ closeMenu
    const cats = NODE_CATEGORIES.filter(c => this.allowedCats.includes(c.id));

    const el = document.createElement('div');
    const lx = Math.min(clientX, window.innerWidth - 200), ly = Math.min(clientY, window.innerHeight - 280);
    el.style.cssText = `position:fixed;left:${lx}px;top:${ly}px;background:#2d2d2d;border:1px solid #4a4a4a;border-radius:8px;padding:4px;z-index:9999;min-width:170px;box-shadow:0 6px 20px rgba(0,0,0,.7)`;
    this.menuEl = el;

    const showCats = () => {
      el.innerHTML = '';
      for (const cat of cats) this.mBtn(el, cat.label, () => showTypes(cat.types));
    };
    const showTypes = (types: string[]) => {
      el.innerHTML = '';
      this.mBtn(el, '← Назад', showCats, '#777');
      const hr = document.createElement('div'); hr.style.cssText = 'border-top:1px solid #3a3a3a;margin:3px 4px'; el.appendChild(hr);
      for (const t of types) {
        const def = NODE_TYPES[t]; if (!def) continue;
        this.mBtn(el, def.label, () => { this.addNode(t, this.pWx, this.pWy); this.closeMenu(); }, def.color);
      }
    };

    showCats();
    document.body.appendChild(el);
    const close = (ev: MouseEvent) => { if (!el.contains(ev.target as Node)) this.closeMenu(); };
    this._menuClose = close;
    setTimeout(() => document.addEventListener('mousedown', close), 0);
  }

  private mBtn(parent: HTMLElement, label: string, onClick: () => void, color?: string): void {
    const btn = document.createElement('button');
    btn.style.cssText = 'display:flex;align-items:center;width:100%;text-align:left;padding:6px 10px;border-radius:5px;font-size:12px;background:transparent;border:0;cursor:pointer;gap:7px;';
    btn.style.color = color === '#777' ? '#888' : '#e8e8e8';
    if (color && color !== '#777') {
      const dot = document.createElement('span');
      dot.style.cssText = `flex:0 0 8px;width:8px;height:8px;border-radius:50%;background:${color};`;
      btn.appendChild(dot);
    }
    btn.appendChild(document.createTextNode(label));
    btn.onmouseenter = () => { btn.style.background = '#3a3a3a'; };
    btn.onmouseleave = () => { btn.style.background = 'transparent'; };
    btn.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
    parent.appendChild(btn);
  }

  private addNode(type: string, wx: number, wy: number): void {
    const def = NODE_TYPES[type]; if (!def) return;
    const config: Record<string, string | number> = {};
    if (def.config) for (const [k, cd] of Object.entries(def.config)) config[k] = cd.default;
    const dummy = { id: '', type, cat: def.cat, label: def.label, x: 0, y: 0, config } as GraphNode;
    const id = this.uid();
    this.graph.nodes.push({ id, type, cat: def.cat, label: def.label, x: wx - NW / 2, y: wy - nodeH(dummy) / 2, config });
    // якщо вузол створено через link-drag — одразу під'єднуємо кинутий звʼязок
    if (this.pendingDe) {
      const pd = this.pendingDe; this.pendingDe = null;
      if (!pd.reverse) this.connect(pd.fromId!, pd.fromPort!, id, 0);
      else this.connect(id, 0, pd.toId!, pd.toPort!);
    }
    // якщо вузол вставлено по RMB на лінію — розриваємо зв'язок і вставляємо нову ноду між кінцями
    if (this.pendingInsert) {
      const pe = this.pendingInsert; this.pendingInsert = null;
      this.graph.edges = this.graph.edges.filter((ed) => ed !== pe);
      this.connect(pe.fromId, pe.fromPort, id, 0);       // джерело → вхід 0 нової ноди
      this.connect(id, 0, pe.toId, pe.toPort);            // вихід 0 нової ноди → ціль
    }
    this.onChange?.(this.graph);
  }

  closeMenu(): void {
    if (this._menuClose) { document.removeEventListener('mousedown', this._menuClose); this._menuClose = null; }
    if (this.menuEl) { this.menuEl.remove(); this.menuEl = null; }
    // меню закрили без вибору — кинутий звʼязок відкидаємо (і зберігаємо відчеплення)
    if (this.pendingDe) { const pd = this.pendingDe; this.pendingDe = null; if (pd.detached) this.onChange?.(this.graph); }
    this.pendingInsert = null; // скасовуємо вставку якщо ноду не обрали
  }
}
