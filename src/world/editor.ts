// World map editor — намальований фон + вузли-локації + лінії-переходи між ними.
import { idbGet, idbSet } from '../store';
import { pullArray, mergeByIdLWW } from '../sync';
import { ghCommit } from '../github';

interface WorldNode {
  id: string;
  label: string;
  x: number; y: number;
  type: 'location' | 'region' | 'stop';
  regionId?: string;
}

interface WorldEdge {
  id: string;
  from: string; to: string;
  levelId: string;
  twoWay: boolean;
}

interface WorldDoc {
  id: string;
  name: string;
  bg: string;
  nodes: WorldNode[];
  edges: WorldEdge[];
  updatedAt?: number; // мітка останньої правки — для синхронізації між компами (LWW)
}

let _init = false;
export function initWorldEditor(prefix: string): void {
  if (_init) return; _init = true;

  const $ = <T extends HTMLElement>(id: string) => document.getElementById(prefix + id) as T;

  const canvas = $<HTMLCanvasElement>('stage');
  const ctx = canvas.getContext('2d')!;

  let _uid = Date.now();
  const uid = () => (++_uid).toString(36);
  const newWorld = (name: string): WorldDoc => ({ id: uid(), name, bg: '', nodes: [], edges: [], updatedAt: Date.now() });

  const state = {
    worlds: [newWorld('Карта 1')] as WorldDoc[],
    cur: 0,
    bgImg: null as HTMLImageElement | null,
    sel: null as string | null,
    selType: null as 'node' | 'edge' | null,
    tool: 'select' as 'select' | 'node' | 'edge',
    edgeStart: null as string | null,
    zoom: 1,
    pan: { x: 0, y: 0 },
    mouse: { x: 0, y: 0 },
    dragNode: null as string | null,
    dragOrig: { nx: 0, ny: 0 },
    dragStartS: { x: 0, y: 0 },
    wasDrag: false,
    panning: false,
    panStart: { mx: 0, my: 0, px: 0, py: 0 },
    undoStack: [] as string[],
    showLabels: true,
    showGrid: true,
    showCamView: false,
    cutting: false,
    cutStart: { x: 0, y: 0 },
    cutEnd: { x: 0, y: 0 },
    roading: false,            // Shift+LMB — прокладання дороги з перехрестями-зупинками
    roadStart: { x: 0, y: 0 }, // екранні координати
    roadEnd: { x: 0, y: 0 },
  };

  const world = (): WorldDoc => state.worlds[state.cur];
  const sc = () => state.zoom;
  const toScreen = (wx: number, wy: number) => ({
    x: canvas.width / 2 + state.pan.x + wx * sc(),
    y: canvas.height / 2 + state.pan.y + wy * sc(),
  });
  const toWorld = (sx: number, sy: number) => ({
    x: (sx - canvas.width / 2 - state.pan.x) / sc(),
    y: (sy - canvas.height / 2 - state.pan.y) / sc(),
  });

  const NODE_R = 14;
  const HIT_R = 18;

  function nodeById(id: string): WorldNode | undefined {
    return world().nodes.find(n => n.id === id);
  }

  function nodeAt(sx: number, sy: number): WorldNode | null {
    if (!world()) return null;
    for (const n of [...world().nodes].reverse()) {
      const p = toScreen(n.x, n.y);
      if ((sx - p.x) ** 2 + (sy - p.y) ** 2 <= HIT_R ** 2) return n;
    }
    return null;
  }

  function edgeAt(sx: number, sy: number): WorldEdge | null {
    if (!world()) return null;
    const nm = new Map(world().nodes.map(n => [n.id, n]));
    for (const e of world().edges) {
      const a = nm.get(e.from), b = nm.get(e.to);
      if (!a || !b) continue;
      const pa = toScreen(a.x, a.y), pb = toScreen(b.x, b.y);
      const dx = pb.x - pa.x, dy = pb.y - pa.y;
      const len2 = dx ** 2 + dy ** 2;
      if (len2 < 1) continue;
      const t = Math.max(0, Math.min(1, ((sx - pa.x) * dx + (sy - pa.y) * dy) / len2));
      const cx = pa.x + t * dx, cy = pa.y + t * dy;
      if ((sx - cx) ** 2 + (sy - cy) ** 2 <= 64) return e;
    }
    return null;
  }

  function pushUndo() {
    state.undoStack.push(JSON.stringify(world()));
    if (state.undoStack.length > 50) state.undoStack.shift();
  }

  function undo() {
    const snap = state.undoStack.pop();
    if (!snap) return;
    state.worlds[state.cur] = JSON.parse(snap);
    state.bgImg = null;
    const bg = world().bg;
    if (bg) { const img = new Image(); img.onload = () => { state.bgImg = img; }; img.src = bg; }
    deselect();
    save();
    renderList();
  }

  function deselect() { state.sel = null; state.selType = null; updateProps(); }

  function select(id: string, type: 'node' | 'edge') {
    state.sel = id; state.selType = type; updateProps();
  }

  function deleteSelected() {
    if (!state.sel) return;
    pushUndo();
    if (state.selType === 'node') {
      world().nodes = world().nodes.filter(n => n.id !== state.sel);
      world().edges = world().edges.filter(e => e.from !== state.sel && e.to !== state.sel);
    } else {
      world().edges = world().edges.filter(e => e.id !== state.sel);
    }
    deselect();
    save();
  }

  // ── Draw ──────────────────────────────────────────────────────────────────

  function draw() {
    const w = canvas.width = canvas.clientWidth;
    const h = canvas.height = canvas.clientHeight;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, w, h);

    if (!world()) { requestAnimationFrame(draw); return; }

    if (state.bgImg) {
      const p = toScreen(0, 0);
      ctx.drawImage(state.bgImg, p.x, p.y, state.bgImg.naturalWidth * sc(), state.bgImg.naturalHeight * sc());
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.07)';
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Тягни PNG карти сюди або клацни «Фон»', w / 2, h / 2);
    }

    if (state.showGrid) {
      ctx.strokeStyle = '#282828';
      ctx.lineWidth = 1;
      const gs = 60 * sc();
      const ox = ((w / 2 + state.pan.x) % gs + gs) % gs;
      const oy = ((h / 2 + state.pan.y) % gs + gs) % gs;
      for (let x = ox; x < w; x += gs) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
      for (let y = oy; y < h; y += gs) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
    }

    const nm = new Map(world().nodes.map(n => [n.id, n]));

    // Edges
    for (const e of world().edges) {
      const a = nm.get(e.from), b = nm.get(e.to);
      if (!a || !b) continue;
      const pa = toScreen(a.x, a.y), pb = toScreen(b.x, b.y);
      const isSel = state.sel === e.id;
      ctx.strokeStyle = isSel ? '#ffcc00' : '#aaaaaa';
      ctx.lineWidth = isSel ? 3 : 2;
      ctx.setLineDash(e.levelId ? [] : [6, 4]);
      ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
      ctx.setLineDash([]);

      if (!e.twoWay) {
        const dx = pb.x - pa.x, dy = pb.y - pa.y;
        const len = Math.hypot(dx, dy);
        if (len > 40) {
          const mx = (pa.x + pb.x) / 2, my = (pa.y + pb.y) / 2;
          const ux = dx / len, uy = dy / len;
          ctx.fillStyle = isSel ? '#ffcc00' : '#aaaaaa';
          ctx.beginPath();
          ctx.moveTo(mx + ux * 8, my + uy * 8);
          ctx.lineTo(mx - ux * 8 - uy * 5, my - uy * 8 + ux * 5);
          ctx.lineTo(mx - ux * 8 + uy * 5, my - uy * 8 - ux * 5);
          ctx.closePath(); ctx.fill();
        }
      }

      if (e.levelId) {
        const mx = (pa.x + pb.x) / 2, my = (pa.y + pb.y) / 2;
        ctx.fillStyle = isSel ? '#ffcc00' : '#888';
        ctx.font = '10px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(e.levelId, mx, my - 8);
      }
    }

    // Edge preview while connecting
    if (state.tool === 'edge' && state.edgeStart) {
      const sn = nm.get(state.edgeStart);
      if (sn) {
        const pa = toScreen(sn.x, sn.y);
        ctx.strokeStyle = '#ff9900';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(state.mouse.x, state.mouse.y);
        ctx.stroke(); ctx.setLineDash([]);
      }
    }

    // Nodes
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 480); // дихання для зупинок
    for (const n of world().nodes) {
      const p = toScreen(n.x, n.y);
      const isSel = state.sel === n.id;
      if (n.type === 'stop') {
        // Привал на перехресті — намет, що підсвічується (пульсує)
        ctx.shadowColor = isSel ? '#ffcc00' : '#3fe6c0';
        ctx.shadowBlur = isSel ? 16 : 8 + pulse * 12;
        ctx.fillStyle = '#2fa890';
        ctx.strokeStyle = isSel ? '#ffcc00' : '#dffff4';
        ctx.lineWidth = isSel ? 2.5 : 1.5;
        const r = NODE_R - 1;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y - r);
        ctx.lineTo(p.x + r, p.y + r * 0.8);
        ctx.lineTo(p.x - r, p.y + r * 0.8);
        ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.shadowBlur = 0;
        // вхід намету
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        ctx.beginPath();
        ctx.moveTo(p.x, p.y - r * 0.2);
        ctx.lineTo(p.x + r * 0.32, p.y + r * 0.8);
        ctx.lineTo(p.x - r * 0.32, p.y + r * 0.8);
        ctx.closePath(); ctx.fill();
      } else {
        ctx.shadowColor = isSel ? '#ffcc00' : 'rgba(0,0,0,0.6)';
        ctx.shadowBlur = isSel ? 14 : 6;
        ctx.fillStyle = n.type === 'region' ? '#5577dd' : '#c89030';
        ctx.strokeStyle = isSel ? '#ffcc00' : '#ffffff';
        ctx.lineWidth = isSel ? 2.5 : 1.5;
        ctx.beginPath(); ctx.arc(p.x, p.y, NODE_R, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.shadowBlur = 0;
      }
      if (state.showLabels) {
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(n.label, p.x, p.y + NODE_R + 13);
      }
    }

    if (state.showCamView) {
      const vw = 1280 * sc(); const vh = 576 * sc();
      const vx = (w - vw) / 2; const vy = (h - vh) / 2;
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

    if (state.cutting) {
      ctx.strokeStyle = '#ff3333'; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
      ctx.beginPath(); ctx.moveTo(state.cutStart.x, state.cutStart.y);
      ctx.lineTo(state.cutEnd.x, state.cutEnd.y); ctx.stroke(); ctx.setLineDash([]);
    }

    if (state.roading) {
      ctx.strokeStyle = '#3fe6c0'; ctx.lineWidth = 3; ctx.setLineDash([8, 5]);
      ctx.beginPath(); ctx.moveTo(state.roadStart.x, state.roadStart.y);
      ctx.lineTo(state.roadEnd.x, state.roadEnd.y); ctx.stroke(); ctx.setLineDash([]);
      // позначки перетинів з наявними шляхами
      const S = toWorld(state.roadStart.x, state.roadStart.y);
      const E = toWorld(state.roadEnd.x, state.roadEnd.y);
      const nm2 = new Map(world().nodes.map(n => [n.id, n]));
      for (const e of world().edges) {
        const a = nm2.get(e.from), b = nm2.get(e.to); if (!a || !b) continue;
        const h = segHit(S.x, S.y, E.x, E.y, a.x, a.y, b.x, b.y);
        if (h) { const ps = toScreen(h.x, h.y); ctx.fillStyle = '#3fe6c0'; ctx.beginPath(); ctx.arc(ps.x, ps.y, 5, 0, Math.PI * 2); ctx.fill(); }
      }
    }

    requestAnimationFrame(draw);
  }

  // ── Mouse events ──────────────────────────────────────────────────────────

  const rect = () => canvas.getBoundingClientRect();

  canvas.addEventListener('mousemove', e => {
    state.mouse.x = e.clientX - rect().left;
    state.mouse.y = e.clientY - rect().top;

    if (state.cutting) {
      state.cutEnd = { x: state.mouse.x, y: state.mouse.y };
      return;
    }

    if (state.roading) {
      state.roadEnd = { x: state.mouse.x, y: state.mouse.y };
      return;
    }

    if (state.panning) {
      state.pan.x = state.panStart.px + e.clientX - state.panStart.mx;
      state.pan.y = state.panStart.py + e.clientY - state.panStart.my;
    }

    if (state.dragNode) {
      const dx = state.mouse.x - state.dragStartS.x;
      const dy = state.mouse.y - state.dragStartS.y;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) state.wasDrag = true;
      if (state.wasDrag) {
        const n = nodeById(state.dragNode);
        if (n) { n.x = state.dragOrig.nx + dx / sc(); n.y = state.dragOrig.ny + dy / sc(); }
      }
    }
  });

  function segIntersects(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): boolean {
    const d1x = bx - ax, d1y = by - ay, d2x = dx - cx, d2y = dy - cy;
    const cross = d1x * d2y - d1y * d2x;
    if (Math.abs(cross) < 1e-10) return false;
    const t = ((cx - ax) * d2y - (cy - ay) * d2x) / cross;
    const u = ((cx - ax) * d1y - (cy - ay) * d1x) / cross;
    return t > 0 && t < 1 && u > 0 && u < 1;
  }

  // Точка перетину відрізка A-B з відрізком C-D; повертає параметр t уздовж A-B та координати.
  function segHit(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): { t: number; x: number; y: number } | null {
    const d1x = bx - ax, d1y = by - ay, d2x = dx - cx, d2y = dy - cy;
    const cross = d1x * d2y - d1y * d2x;
    if (Math.abs(cross) < 1e-10) return null;
    const t = ((cx - ax) * d2y - (cy - ay) * d2x) / cross;
    const u = ((cx - ax) * d1y - (cy - ay) * d1x) / cross;
    if (t > 0 && t < 1 && u > 0 && u < 1) return { t, x: ax + t * d1x, y: ay + t * d1y };
    return null;
  }

  // Shift+LMB: проводимо дорогу. На кожному перетині з наявним шляхом створюється
  // вузол-зупинка (привал), що розрізає той шлях; нова дорога зшиває все в перехрестя.
  function finalizeRoad(): void {
    const S = toWorld(state.roadStart.x, state.roadStart.y);
    const E = toWorld(state.roadEnd.x, state.roadEnd.y);
    if (Math.hypot(state.roadEnd.x - state.roadStart.x, state.roadEnd.y - state.roadStart.y) < 6) return;
    const w = world();
    const nm = new Map(w.nodes.map(n => [n.id, n]));
    const snapR = HIT_R / sc(); // радіус прилипання у світових одиницях
    const nearNode = (px: number, py: number): WorldNode | null => {
      let best: WorldNode | null = null, bd = snapR * snapR;
      for (const n of w.nodes) { const dd = (n.x - px) ** 2 + (n.y - py) ** 2; if (dd <= bd) { bd = dd; best = n; } }
      return best;
    };
    const mkStop = (px: number, py: number): WorldNode => {
      const n: WorldNode = { id: uid(), label: 'Привал', x: px, y: py, type: 'stop' };
      w.nodes.push(n); return n;
    };

    pushUndo();
    // Перетини з наявними шляхами → зупинки + розрізання
    const hits: { t: number; node: WorldNode }[] = [];
    for (const e of [...w.edges]) {
      const a = nm.get(e.from), b = nm.get(e.to);
      if (!a || !b) continue;
      const h = segHit(S.x, S.y, E.x, E.y, a.x, a.y, b.x, b.y);
      if (!h) continue;
      const stop = mkStop(h.x, h.y);
      w.edges = w.edges.filter(x => x.id !== e.id);
      w.edges.push({ id: uid(), from: e.from, to: stop.id, levelId: '', twoWay: e.twoWay });
      w.edges.push({ id: uid(), from: stop.id, to: e.to, levelId: '', twoWay: e.twoWay });
      hits.push({ t: h.t, node: stop });
    }
    hits.sort((p, q) => p.t - q.t);

    // Кінці: прилипають до наявного вузла, інакше — нова зупинка
    const startNode = nearNode(S.x, S.y) ?? mkStop(S.x, S.y);
    const endNode = nearNode(E.x, E.y) ?? mkStop(E.x, E.y);
    const seq = [startNode, ...hits.map(h => h.node), endNode];
    for (let i = 0; i < seq.length - 1; i++) {
      const f = seq[i], t = seq[i + 1];
      if (f.id === t.id) continue;
      const dup = w.edges.some(e => (e.from === f.id && e.to === t.id) || (e.from === t.id && e.to === f.id));
      if (!dup) w.edges.push({ id: uid(), from: f.id, to: t.id, levelId: '', twoWay: false });
    }
    save();
    setStatus(hits.length ? `Перехрестя: +${hits.length} зупинок` : 'Дорогу прокладено');
  }

  canvas.addEventListener('mousedown', e => {
    const mx = e.clientX - rect().left;
    const my = e.clientY - rect().top;

    if (e.button === 0 && e.ctrlKey && state.tool === 'select') {
      e.preventDefault();
      state.cutting = true;
      state.cutStart = { x: mx, y: my };
      state.cutEnd = { x: mx, y: my };
      return;
    }

    if (e.button === 0 && e.shiftKey && state.tool === 'select') {
      e.preventDefault();
      state.roading = true;
      state.roadStart = { x: mx, y: my };
      state.roadEnd = { x: mx, y: my };
      return;
    }

    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      e.preventDefault();
      state.panning = true;
      state.panStart = { mx: e.clientX, my: e.clientY, px: state.pan.x, py: state.pan.y };
      return;
    }
    if (e.button !== 0) return;

    if (state.tool === 'select') {
      const n = nodeAt(mx, my);
      if (n) {
        select(n.id, 'node');
        state.dragNode = n.id;
        state.dragOrig = { nx: n.x, ny: n.y };
        state.dragStartS = { x: mx, y: my };
        state.wasDrag = false;
        return;
      }
      const edge = edgeAt(mx, my);
      if (edge) { select(edge.id, 'edge'); return; }
      deselect();
    }

    if (state.tool === 'node') {
      pushUndo();
      const wp = toWorld(mx, my);
      const n: WorldNode = { id: uid(), label: 'Локація', x: wp.x, y: wp.y, type: 'location' };
      world().nodes.push(n);
      select(n.id, 'node');
      save();
    }

    if (state.tool === 'edge') {
      const n = nodeAt(mx, my);
      if (!n) return;
      if (!state.edgeStart) {
        state.edgeStart = n.id;
        setStatus('Тепер клацни другий вузол');
      } else if (state.edgeStart !== n.id) {
        const alreadyExists = world().edges.some(
          e => (e.from === state.edgeStart && e.to === n.id) || (e.from === n.id && e.to === state.edgeStart),
        );
        if (!alreadyExists) {
          pushUndo();
          const e2: WorldEdge = { id: uid(), from: state.edgeStart, to: n.id, levelId: '', twoWay: false };
          world().edges.push(e2);
          select(e2.id, 'edge');
          save();
        }
        state.edgeStart = null;
        setStatus('');
      }
    }
  });

  canvas.addEventListener('mouseup', e => {
    if (state.roading) {
      state.roading = false;
      finalizeRoad();
      return;
    }
    if (state.cutting) {
      state.cutting = false;
      const nm = new Map(world().nodes.map(n => [n.id, n]));
      const ax = state.cutStart.x, ay = state.cutStart.y;
      const bx = state.cutEnd.x, by = state.cutEnd.y;
      if (Math.hypot(bx - ax, by - ay) > 4) {
        const toDelete = world().edges.filter(edge => {
          const a = nm.get(edge.from), b = nm.get(edge.to); if (!a || !b) return false;
          const pa = toScreen(a.x, a.y), pb = toScreen(b.x, b.y);
          return segIntersects(ax, ay, bx, by, pa.x, pa.y, pb.x, pb.y);
        });
        if (toDelete.length > 0) {
          pushUndo();
          const ids = new Set(toDelete.map(e => e.id));
          world().edges = world().edges.filter(e => !ids.has(e.id));
          deselect(); save();
          setStatus(`Розрізано ${toDelete.length} зʼєднань`);
        }
      }
      return;
    }
    if (e.button === 1 || state.panning) state.panning = false;
    if (state.dragNode) {
      if (state.wasDrag) save();
      state.dragNode = null;
    }
  });

  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const f = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const mx = e.clientX - rect().left;
    const my = e.clientY - rect().top;
    const wx = (mx - canvas.width / 2 - state.pan.x) / state.zoom;
    const wy = (my - canvas.height / 2 - state.pan.y) / state.zoom;
    state.zoom = Math.max(0.1, Math.min(4, state.zoom * f));
    state.pan.x = mx - canvas.width / 2 - wx * state.zoom;
    state.pan.y = my - canvas.height / 2 - wy * state.zoom;
  }, { passive: false });

  window.addEventListener('keydown', e => {
    const app = document.getElementById('app');
    if (!app?.className.includes('mode-world')) return;
    const active = document.activeElement;
    const typing = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement
      || (active instanceof HTMLElement && active.contentEditable === 'true');
    if (e.key === 'Delete' || e.key === 'Backspace') { if (!typing) { e.preventDefault(); deleteSelected(); } }
    if (e.ctrlKey && e.code === 'KeyZ') { e.preventDefault(); undo(); }
    if (!e.ctrlKey && !e.shiftKey && !typing) {
      if (e.code === 'KeyV') setTool('select');
      if (e.code === 'KeyN') setTool('node');
      if (e.code === 'KeyE') setTool('edge');
      if (e.code === 'Escape') {
        if (previewBig) { setPreviewBig(false); return; }
        state.edgeStart = null; setTool('select'); setStatus('');
      }
    }
  });

  // ── Tools ─────────────────────────────────────────────────────────────────

  function setTool(t: typeof state.tool) {
    state.tool = t;
    if (t !== 'edge') state.edgeStart = null;
    updateToolBtns();
    canvas.style.cursor = t === 'select' ? 'default' : 'crosshair';
  }

  function updateToolBtns() {
    for (const t of ['select', 'node', 'edge'] as const)
      $(`tool-${t}`)?.classList.toggle('on', state.tool === t);
  }

  $('tool-select')?.addEventListener('click', () => setTool('select'));
  $('tool-node')?.addEventListener('click', () => setTool('node'));
  $('tool-edge')?.addEventListener('click', () => setTool('edge'));
  $('deleteBtn')?.addEventListener('click', deleteSelected);

  $('undoBtn')?.addEventListener('click', undo);

  const labelsBtn = $('labelsBtn');
  labelsBtn?.addEventListener('click', () => {
    state.showLabels = !state.showLabels;
    labelsBtn.classList.toggle('on', state.showLabels);
  });

  const gridBtn = $('gridBtn');
  gridBtn?.addEventListener('click', () => {
    state.showGrid = !state.showGrid;
    gridBtn.classList.toggle('on', state.showGrid);
  });

  const camViewBtn = $('camViewBtn');
  camViewBtn?.addEventListener('click', () => {
    state.showCamView = !state.showCamView;
    camViewBtn.classList.toggle('on', state.showCamView);
  });

  $('fitBtn')?.addEventListener('click', () => { state.zoom = 1; state.pan = { x: 0, y: 0 }; });

  // ── Background ────────────────────────────────────────────────────────────

  function loadBg(dataUrl: string) {
    pushUndo();
    world().bg = dataUrl;
    const img = new Image();
    img.onload = () => { state.bgImg = img; save(); setStatus('Фон завантажено'); };
    img.src = dataUrl;
  }

  $<HTMLInputElement>('bgInput').addEventListener('change', function () {
    const file = this.files?.[0];
    if (!file) return;
    const r = new FileReader();
    r.onload = () => loadBg(r.result as string);
    r.readAsDataURL(file);
    this.value = '';
  });

  $('bgBtn')?.addEventListener('click', () => $<HTMLInputElement>('bgInput').click());
  $('bgClearBtn')?.addEventListener('click', () => {
    pushUndo();
    world().bg = '';
    state.bgImg = null;
    save();
  });

  canvas.addEventListener('dragover', e => e.preventDefault());
  canvas.addEventListener('drop', e => {
    e.preventDefault();
    const file = e.dataTransfer?.files[0];
    if (file?.type.startsWith('image/')) {
      const r = new FileReader();
      r.onload = () => loadBg(r.result as string);
      r.readAsDataURL(file);
    }
  });

  // ── World list ────────────────────────────────────────────────────────────

  $('addWorld')?.addEventListener('click', () => {
    const w = newWorld(`Карта ${state.worlds.length + 1}`);
    state.worlds.push(w);
    state.cur = state.worlds.length - 1;
    state.bgImg = null;
    deselect();
    renderList();
    save();
  });

  function renderList() {
    const el = $('worldList');
    if (!el) return;
    el.innerHTML = '';
    state.worlds.forEach((w, i) => {
      const card = document.createElement('div');
      card.className = 'libCard' + (i === state.cur ? ' on' : '');
      card.style.cssText = 'padding:6px 8px;cursor:pointer;border-radius:6px;font-size:13px;display:flex;align-items:center;gap:6px';

      const name = document.createElement('span');
      name.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
      name.textContent = w.name;
      name.contentEditable = 'true';
      name.addEventListener('blur', () => { w.name = name.textContent || w.name; save(); });
      name.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); name.blur(); } });
      name.addEventListener('click', e => { if (i === state.cur) e.stopPropagation(); });

      card.addEventListener('click', () => {
        if (document.activeElement === name) return;
        state.cur = i;
        state.bgImg = null;
        const bg = world().bg;
        if (bg) { const img = new Image(); img.onload = () => { state.bgImg = img; }; img.src = bg; }
        deselect();
        renderList();
      });

      const del = document.createElement('button');
      del.textContent = '×';
      del.style.cssText = 'flex:0 0 20px;width:20px;height:20px;padding:0;font-size:14px;line-height:1;opacity:.5;border-radius:4px;background:transparent;border:0;color:inherit;cursor:pointer';
      del.title = 'Видалити карту';
      del.addEventListener('click', e2 => {
        e2.stopPropagation();
        if (state.worlds.length <= 1) return;
        state.worlds.splice(i, 1);
        state.cur = Math.min(state.cur, state.worlds.length - 1);
        state.bgImg = null;
        const bg2 = world().bg;
        if (bg2) { const img = new Image(); img.onload = () => { state.bgImg = img; }; img.src = bg2; }
        deselect();
        renderList();
        save();
      });

      card.append(name, del);
      el.append(card);
    });
  }

  // ── Properties ────────────────────────────────────────────────────────────

  function updateProps() {
    const nodeP = $('nodeProps');
    const edgeP = $('edgeProps');
    const noP = $('noProps');
    if (!nodeP || !edgeP || !noP) return;

    if (!state.sel) {
      nodeP.style.display = 'none';
      edgeP.style.display = 'none';
      noP.style.display = '';
      return;
    }
    noP.style.display = 'none';

    if (state.selType === 'node') {
      edgeP.style.display = 'none';
      nodeP.style.display = 'flex';
      const n = nodeById(state.sel);
      if (!n) return;
      ($<HTMLInputElement>('nodeName')).value = n.label;
      ($<HTMLInputElement>('nodeTypeLocation')).checked = n.type === 'location';
      ($<HTMLInputElement>('nodeTypeRegion')).checked = n.type === 'region';
      ($<HTMLInputElement>('nodeTypeStop')).checked = n.type === 'stop';
      $('nodeRegionRow').style.display = n.type === 'region' ? 'flex' : 'none';
      if (n.regionId) ($<HTMLInputElement>('nodeRegionId')).value = n.regionId;
    }

    if (state.selType === 'edge') {
      nodeP.style.display = 'none';
      edgeP.style.display = 'flex';
      const e = world().edges.find(e2 => e2.id === state.sel);
      if (!e) return;
      ($<HTMLInputElement>('edgeLevelId')).value = e.levelId;
      ($<HTMLInputElement>('edgeTwoWay')).checked = e.twoWay;
    }
  }

  $<HTMLInputElement>('nodeName')?.addEventListener('input', function () {
    const n = nodeById(state.sel!);
    if (n) { n.label = this.value; save(); }
  });

  for (const t of ['Location', 'Region', 'Stop'] as const) {
    $<HTMLInputElement>(`nodeType${t}`)?.addEventListener('change', function () {
      if (!this.checked) return;
      const n = nodeById(state.sel!);
      if (n) { n.type = t.toLowerCase() as 'location' | 'region' | 'stop'; updateProps(); save(); }
    });
  }

  $<HTMLInputElement>('nodeRegionId')?.addEventListener('input', function () {
    const n = nodeById(state.sel!);
    if (n) { n.regionId = this.value; save(); }
  });

  $<HTMLInputElement>('edgeLevelId')?.addEventListener('input', function () {
    const e = world().edges.find(e2 => e2.id === state.sel);
    if (e) { e.levelId = this.value; save(); }
  });

  $<HTMLInputElement>('edgeTwoWay')?.addEventListener('change', function () {
    const e = world().edges.find(e2 => e2.id === state.sel);
    if (e) { e.twoWay = this.checked; save(); }
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
      const lib = document.getElementById('wld-library');
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
    const json = JSON.stringify({ version: 1, worlds: state.worlds }, null, 2);
    ghCommit({ 'public/studio-data/worlds.json': json }, 'studio: update worlds')
      .then(() => {
        btn.textContent = 'Оновлено!';
        setStatus('✔ Оновлено! Гра підтягне за ~1 хв.');
        if (previewFrame) previewFrame.src = 'index.html?t=' + Date.now();
      })
      .catch((e: unknown) => { btn.textContent = 'Помилка'; setStatus('✗ ' + String(e).slice(0, 60)); })
      .finally(() => { setTimeout(() => { btn.disabled = false; btn.textContent = orig; }, 4000); });
  });

  // ── Status + persistence ──────────────────────────────────────────────────

  function setStatus(msg: string) {
    const el = $('statusBar');
    if (el) el.textContent = msg;
  }

  async function save() {
    const w = state.worlds[state.cur];
    if (w) w.updatedAt = Date.now(); // правлять поточну карту → оновлюємо її мітку часу
    await idbSet('zag_worlds', state.worlds);
  }

  async function load() {
    const saved = await idbGet<WorldDoc[]>('zag_worlds');
    if (saved?.length) {
      state.worlds = saved;
      state.cur = 0;
    }
    renderList();
    updateProps();
    // Підтягнути опубліковані карти з репо й злити (LWW) — щоб бачити свіже з інших компів.
    const curId = state.worlds[state.cur]?.id;
    const remote = await pullArray<WorldDoc>('worlds.json', 'worlds');
    if (remote && remote.length) {
      const { merged, changed } = mergeByIdLWW(state.worlds, remote);
      if (changed > 0) {
        state.worlds = merged;
        state.cur = Math.max(0, curId ? merged.findIndex((w) => w.id === curId) : 0);
        if (state.cur < 0) state.cur = 0;
        await idbSet('zag_worlds', state.worlds);
        renderList();
        updateProps();
        setStatus(`Синхронізовано: ${changed} карт з GitHub`);
      }
    }
    const bg = world()?.bg;
    if (bg) { const img = new Image(); img.onload = () => { state.bgImg = img; draw(); }; img.src = bg; }
  }

  window.addEventListener('worldTabActivated', () => {
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;
  });

  load();
  draw();
  updateToolBtns();
}
