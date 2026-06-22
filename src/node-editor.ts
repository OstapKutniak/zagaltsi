// src/node-editor.ts — Shared canvas node editor (location building logic + NPC behavior)

export type NodeCat = 'root' | 'condition' | 'behavior' | 'function';

interface PortDef { label: string }
interface ConfigDef { type: 'number' | 'text'; label: string; default: string | number }

export interface NodeTypeDef {
  cat: NodeCat; label: string; color: string;
  inPorts: PortDef[]; outPorts: PortDef[];
  config?: Record<string, ConfigDef>;
}

export const NODE_TYPES: Record<string, NodeTypeDef> = {
  player_distance: {
    cat: 'condition', label: 'Гравець на відстані', color: '#1e5a9e',
    inPorts: [{ label: '▶' }], outPorts: [{ label: 'Так' }, { label: 'Ні' }],
    config: { steps: { type: 'number', label: 'Кроків', default: 3 } },
  },
  run_to_player:  { cat: 'behavior', label: 'Бігти на гравця',  color: '#7a2e00', inPorts: [{ label: '▶' }], outPorts: [{ label: 'Готово' }] },
  walk_to_player: { cat: 'behavior', label: 'Йти на гравця',    color: '#7a2e00', inPorts: [{ label: '▶' }], outPorts: [{ label: 'Готово' }] },
  range_attack:   { cat: 'behavior', label: 'Дальня атака',     color: '#7a2e00', inPorts: [{ label: '▶' }], outPorts: [{ label: 'Готово' }] },
  melee_attack:   { cat: 'behavior', label: 'Ближня атака',     color: '#7a2e00', inPorts: [{ label: '▶' }], outPorts: [{ label: 'Готово' }] },
  dialog_menu: {
    cat: 'function', label: 'Діалогове меню', color: '#1a6e3a',
    inPorts: [{ label: '▶' }], outPorts: [{ label: 'Варіант 1' }, { label: 'Варіант 2' }],
    config: { buttons: { type: 'number', label: 'Варіантів', default: 2 } },
  },
};

export const NODE_CATEGORIES: { id: string; label: string; types: string[] }[] = [
  { id: 'condition', label: 'Умови',     types: ['player_distance'] },
  { id: 'behavior',  label: 'Поведінка', types: ['run_to_player', 'walk_to_player', 'range_attack', 'melee_attack'] },
  { id: 'function',  label: 'Функції',   types: ['dialog_menu'] },
];

export interface GraphNode {
  id: string; type: string; cat: NodeCat; label: string;
  x: number; y: number; config: Record<string, string | number>;
}
export interface GraphEdge { fromId: string; fromPort: number; toId: string; toPort: number; }
export interface NodeGraph { nodes: GraphNode[]; edges: GraphEdge[]; }

// ── Layout constants ────────────────────────────────────────────────────────────
const NW = 168;
const HDR = 26;
const PR = PORT_ROW_H_CONST();
const PR_R = 5;
const PAD_T = 8;
const PAD_B = 8;
const CFG_H = 22;

function PORT_ROW_H_CONST() { return 20; }

function bodyH(type: string): number {
  const def = NODE_TYPES[type]; if (!def) return 24;
  return PAD_T + Math.max(def.inPorts.length, def.outPorts.length) * PR
    + (def.config ? Object.keys(def.config).length : 0) * CFG_H + PAD_B;
}
function nodeH(n: GraphNode): number { return n.cat === 'root' ? HDR + 8 : HDR + bodyH(n.type); }
function iPP(n: GraphNode, i: number) { return { x: n.x, y: n.y + HDR + PAD_T + i * PR + PR / 2 }; }
function oPP(n: GraphNode, i: number) { return { x: n.x + NW, y: n.y + HDR + PAD_T + i * PR + PR / 2 }; }

export class NodeEditor {
  private cvs: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  graph: NodeGraph = { nodes: [], edges: [] };
  onChange?: (g: NodeGraph) => void;

  private pan = { x: 80, y: 40 };
  private zoom = 1;

  private dn: { id: string; ox: number; oy: number; wx0: number; wy0: number } | null = null;
  private de: { fromId: string; fromPort: number; mx: number; my: number } | null = null;
  private pan0: { mx: number; my: number; px: number; py: number } | null = null;

  private menuEl: HTMLElement | null = null;
  private pWx = 0; private pWy = 0;

  allowedCats: string[];
  private _uid = Date.now();
  private uid = (): string => (++this._uid).toString(36);

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

  acceptDrop(label: string, type: string, clientX: number, clientY: number): void {
    const r = this.cvs.getBoundingClientRect();
    const wx = (clientX - r.left - this.pan.x) / this.zoom;
    const wy = (clientY - r.top - this.pan.y) / this.zoom;
    this.graph.nodes.push({ id: this.uid(), type, cat: 'root', label, x: wx - NW / 2, y: wy - HDR / 2, config: {} });
    this.draw(); this.onChange?.(this.graph);
  }

  getGraph(): NodeGraph { return JSON.parse(JSON.stringify(this.graph)); }
  loadGraph(g: NodeGraph): void { this.graph = JSON.parse(JSON.stringify(g)); this.draw(); }

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
      if (wx >= n.x && wx <= n.x + NW && wy >= n.y && wy <= n.y + nodeH(n)) return n;
    return null;
  }
  private oPA(sx: number, sy: number): { n: GraphNode; i: number } | null {
    for (const n of this.graph.nodes) {
      const def = NODE_TYPES[n.type]; if (!def) continue;
      for (let i = 0; i < def.outPorts.length; i++) {
        const p = oPP(n, i);
        if (Math.hypot(sx - this.sw(p.x), sy - this.sh(p.y)) <= PR_R * this.zoom + 5) return { n, i };
      }
    }
    return null;
  }
  private iPA(sx: number, sy: number): { n: GraphNode; i: number } | null {
    for (const n of this.graph.nodes) {
      const def = NODE_TYPES[n.type]; if (!def) continue;
      for (let i = 0; i < def.inPorts.length; i++) {
        const p = iPP(n, i);
        if (Math.hypot(sx - this.sw(p.x), sy - this.sh(p.y)) <= PR_R * this.zoom + 5) return { n, i };
      }
    }
    return null;
  }
  private closeAt(sx: number, sy: number): GraphNode | null {
    const wx = this.ww(sx), wy = this.wh(sy);
    for (const n of this.graph.nodes)
      if (wx >= n.x + NW - 20 && wx <= n.x + NW - 4 && wy >= n.y + 4 && wy <= n.y + 20) return n;
    return null;
  }
  private cfgAt(sx: number, sy: number): { n: GraphNode; key: string } | null {
    const wx = this.ww(sx), wy = this.wh(sy);
    for (const n of this.graph.nodes) {
      const def = NODE_TYPES[n.type]; if (!def?.config) continue;
      let cy = n.y + HDR + PAD_T + Math.max(def.inPorts.length, def.outPorts.length) * PR;
      for (const key of Object.keys(def.config)) {
        if (wx >= n.x + 4 && wx <= n.x + NW - 4 && wy >= cy && wy <= cy + CFG_H) return { n, key };
        cy += CFG_H;
      }
    }
    return null;
  }

  // ── draw ──────────────────────────────────────────────────────────────────────
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
      const fn = this.graph.nodes.find(n => n.id === e.fromId);
      const tn = this.graph.nodes.find(n => n.id === e.toId);
      if (!fn || !tn) continue;
      const fp = oPP(fn, e.fromPort), tp = iPP(tn, e.toPort);
      const fsx = this.sw(fp.x), fsy = this.sh(fp.y), tsx = this.sw(tp.x), tsy = this.sh(tp.y);
      x.strokeStyle = (NODE_TYPES[fn.type]?.color ?? '#666') + 'cc'; x.lineWidth = 2; x.setLineDash([]);
      x.beginPath(); x.moveTo(fsx, fsy);
      const mx = (fsx + tsx) / 2;
      x.bezierCurveTo(mx, fsy, mx, tsy, tsx, tsy); x.stroke();
    }

    if (this.de) {
      const fn = this.graph.nodes.find(n => n.id === this.de!.fromId);
      if (fn) {
        const fp = oPP(fn, this.de.fromPort);
        x.strokeStyle = (NODE_TYPES[fn.type]?.color ?? '#666') + '77'; x.lineWidth = 2;
        x.setLineDash([5, 4]);
        x.beginPath(); x.moveTo(this.sw(fp.x), this.sh(fp.y));
        const mx = (this.sw(fp.x) + this.de.mx) / 2;
        x.bezierCurveTo(mx, this.sh(fp.y), mx, this.de.my, this.de.mx, this.de.my);
        x.stroke(); x.setLineDash([]);
      }
    }

    for (const n of this.graph.nodes) this.drawNode(n);

    if (!this.graph.nodes.length) {
      x.fillStyle = 'rgba(255,255,255,0.18)';
      x.font = '14px system-ui, sans-serif'; x.textAlign = 'center';
      x.fillText('Перетягни картку сюди  ·  ПКМ — додати вузол', w / 2, h / 2);
    }
  }

  private drawNode(n: GraphNode): void {
    const x = this.ctx;
    const def = NODE_TYPES[n.type];
    const nh = nodeH(n);
    const sx = this.sw(n.x), sy = this.sh(n.y);
    const sw = NW * this.zoom, sh = nh * this.zoom;
    const hcol = n.cat === 'root' ? '#454545' : (def?.color ?? '#454545');
    const r = Math.max(2, 7 * this.zoom);

    x.fillStyle = hcol;
    this.rr(sx, sy, sw, HDR * this.zoom, r, r, 0, 0); x.fill();
    x.fillStyle = '#2a2a2a';
    this.rr(sx, sy + HDR * this.zoom, sw, (nh - HDR) * this.zoom, 0, 0, r, r); x.fill();
    x.strokeStyle = 'rgba(255,255,255,0.1)'; x.lineWidth = 1;
    this.rr(sx, sy, sw, sh, r, r, r, r); x.stroke();

    const fs = Math.max(9, Math.round(11 * this.zoom));
    x.fillStyle = '#fff'; x.font = `600 ${fs}px system-ui, sans-serif`; x.textAlign = 'left';
    x.fillText(n.label, sx + 8 * this.zoom, sy + HDR * this.zoom * 0.68);

    const bx = sx + sw - 20 * this.zoom, by = sy + 5 * this.zoom, bs = 14 * this.zoom;
    x.fillStyle = 'rgba(255,255,255,0.15)';
    this.rr(bx, by, bs, bs, 3, 3, 3, 3); x.fill();
    x.fillStyle = '#bbb'; x.font = `${Math.max(8, Math.round(10 * this.zoom))}px system-ui, sans-serif`; x.textAlign = 'center';
    x.fillText('×', bx + bs / 2, by + bs * 0.76);

    if (!def) return;

    const pfs = Math.max(8, Math.round(9 * this.zoom));
    for (let i = 0; i < def.inPorts.length; i++) {
      const p = iPP(n, i), px = this.sw(p.x), py = this.sh(p.y);
      x.fillStyle = '#444'; x.beginPath(); x.arc(px, py, PR_R * this.zoom, 0, Math.PI * 2); x.fill();
      x.strokeStyle = '#888'; x.lineWidth = 1.5; x.stroke();
      x.fillStyle = 'rgba(255,255,255,0.55)'; x.textAlign = 'left'; x.font = `${pfs}px system-ui, sans-serif`;
      x.fillText(def.inPorts[i].label, px + (PR_R + 3) * this.zoom, py + 4 * this.zoom);
    }
    for (let i = 0; i < def.outPorts.length; i++) {
      const p = oPP(n, i), px = this.sw(p.x), py = this.sh(p.y);
      x.fillStyle = hcol; x.beginPath(); x.arc(px, py, PR_R * this.zoom, 0, Math.PI * 2); x.fill();
      x.strokeStyle = '#ccc'; x.lineWidth = 1.5; x.stroke();
      x.fillStyle = 'rgba(255,255,255,0.85)'; x.textAlign = 'right'; x.font = `${pfs}px system-ui, sans-serif`;
      x.fillText(def.outPorts[i].label, px - (PR_R + 3) * this.zoom, py + 4 * this.zoom);
    }

    if (def.config) {
      let cy = n.y + HDR + PAD_T + Math.max(def.inPorts.length, def.outPorts.length) * PR;
      for (const [key, cd] of Object.entries(def.config)) {
        const psx = this.sw(n.x + 6), psy = this.sh(cy);
        const cfs = Math.max(8, Math.round(9 * this.zoom));
        x.fillStyle = 'rgba(255,255,255,0.4)'; x.font = `${cfs}px system-ui, sans-serif`; x.textAlign = 'left';
        const lbl = cd.label + ': ';
        x.fillText(lbl, psx, psy + 14 * this.zoom);
        x.fillStyle = '#fff'; x.font = `600 ${cfs}px system-ui, sans-serif`;
        x.fillText(String(n.config[key] ?? cd.default), psx + x.measureText(lbl).width, psy + 14 * this.zoom);
        cy += CFG_H;
      }
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

  // ── events ───────────────────────────────────────────────────────────────────
  private wire(): void {
    const cvs = this.cvs;
    const sig = { signal: this._ac.signal };

    cvs.addEventListener('mousedown', (e) => {
      const { x: sx, y: sy } = this.exy(e);
      if (e.button === 1 || (e.button === 0 && e.altKey)) {
        e.preventDefault();
        this.pan0 = { mx: e.clientX, my: e.clientY, px: this.pan.x, py: this.pan.y }; return;
      }
      if (e.button === 2) { e.preventDefault(); this.openMenu(sx, sy, e.clientX, e.clientY); return; }
      if (e.button !== 0) return;
      this.closeMenu();
      const cn = this.closeAt(sx, sy); if (cn) { this.delNode(cn.id); return; }
      const op = this.oPA(sx, sy); if (op) { this.de = { fromId: op.n.id, fromPort: op.i, mx: sx, my: sy }; return; }
      const cf = this.cfgAt(sx, sy); if (cf) { this.editCfg(cf.n, cf.key); return; }
      const dn = this.nodeAt(sx, sy);
      if (dn) this.dn = { id: dn.id, ox: dn.x, oy: dn.y, wx0: this.ww(sx), wy0: this.wh(sy) };
    }, sig);

    cvs.addEventListener('mousemove', (e) => {
      const { x: sx, y: sy } = this.exy(e);
      if (this.pan0) {
        this.pan.x = this.pan0.px + e.clientX - this.pan0.mx;
        this.pan.y = this.pan0.py + e.clientY - this.pan0.my;
        this.draw(); return;
      }
      if (this.de) { this.de.mx = sx; this.de.my = sy; this.draw(); return; }
      if (this.dn) {
        const n = this.graph.nodes.find(nd => nd.id === this.dn!.id);
        if (n) { n.x = this.dn.ox + this.ww(sx) - this.dn.wx0; n.y = this.dn.oy + this.wh(sy) - this.dn.wy0; this.draw(); }
      }
    }, sig);

    cvs.addEventListener('mouseup', (e) => {
      const { x: sx, y: sy } = this.exy(e);
      this.pan0 = null;
      if (this.de) {
        const ip = this.iPA(sx, sy);
        if (ip && ip.n.id !== this.de.fromId) {
          this.graph.edges = this.graph.edges.filter(ed => !(ed.toId === ip.n.id && ed.toPort === ip.i));
          this.graph.edges.push({ fromId: this.de.fromId, fromPort: this.de.fromPort, toId: ip.n.id, toPort: ip.i });
          this.onChange?.(this.graph);
        }
        this.de = null; this.draw();
      }
      if (this.dn) { this.dn = null; this.onChange?.(this.graph); }
    }, sig);

    cvs.addEventListener('wheel', (e) => {
      e.preventDefault();
      const { x: sx, y: sy } = this.exy(e);
      const f = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      const wx = this.ww(sx), wy = this.wh(sy);
      this.zoom = Math.max(0.3, Math.min(2.5, this.zoom * f));
      this.pan.x = sx - wx * this.zoom; this.pan.y = sy - wy * this.zoom;
      this.draw();
    }, { passive: false, signal: this._ac.signal });

    cvs.addEventListener('contextmenu', e => e.preventDefault(), sig);
    cvs.addEventListener('dragover',  e => e.preventDefault(), sig);
    cvs.addEventListener('drop', e => {
      e.preventDefault();
      const burl = e.dataTransfer?.getData('text/building-url');
      if (burl) { this.acceptDrop(e.dataTransfer?.getData('text/building-name') || 'Споруда', 'building', e.clientX, e.clientY); return; }
      const npcId = e.dataTransfer?.getData('text/npc-id');
      if (npcId) { this.acceptDrop(e.dataTransfer?.getData('text/npc-name') || 'НПС', 'npc:' + npcId, e.clientX, e.clientY); }
    }, sig);
  }

  private editCfg(n: GraphNode, key: string): void {
    const def = NODE_TYPES[n.type]?.config?.[key]; if (!def) return;
    const inp = prompt(`${def.label}:`, String(n.config[key] ?? def.default)); if (inp === null) return;
    n.config[key] = def.type === 'number' ? (parseFloat(inp) || def.default) : inp;
    this.draw(); this.onChange?.(this.graph);
  }

  private delNode(id: string): void {
    this.graph.nodes = this.graph.nodes.filter(n => n.id !== id);
    this.graph.edges = this.graph.edges.filter(e => e.fromId !== id && e.toId !== id);
    this.draw(); this.onChange?.(this.graph);
  }

  private openMenu(sx: number, sy: number, clientX: number, clientY: number): void {
    this.closeMenu();
    this.pWx = this.ww(sx); this.pWy = this.wh(sy);
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
    const close = (ev: MouseEvent) => { if (!el.contains(ev.target as Node)) { this.closeMenu(); document.removeEventListener('mousedown', close); } };
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
    this.graph.nodes.push({ id: this.uid(), type, cat: def.cat, label: def.label, x: wx - NW / 2, y: wy - nodeH(dummy) / 2, config });
    this.draw(); this.onChange?.(this.graph);
  }

  closeMenu(): void { if (this.menuEl) { this.menuEl.remove(); this.menuEl = null; } }
}
