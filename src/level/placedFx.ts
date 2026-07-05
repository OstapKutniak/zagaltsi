// Спільні «ефекти розміщеного об'єкта» для редакторів Меню і Локацій:
// ПКМ-меню (плановість + анімація + деформація з кейфреймами) у стилі Редактора
// Мандр + Canvas2D-рендер деформованого зображення + хелпери хендлів.
// Математика/типи — ті самі, що в грі (LevelView): animOffset/deformImgPt/deformKf*.

import {
  animOffset, deformImgPt, deformKfAt, deformKfTransform,
  type DeformKf, type PlacedAnim, type PlacedDeform,
} from './LevelView';

export type { PlacedAnim, PlacedDeform, DeformKf };
export { animOffset, deformImgPt, deformKfAt, deformKfTransform };

// ── Дисплейний трансформ об'єкта: анімація або кейфрейм-трансформ поверх бази ──
export interface FxBase { x: number; y: number; rot: number; scale: number }
export function fxDisp(p: FxBase & { anim?: PlacedAnim; deform?: PlacedDeform }, t: number, playing: boolean): FxBase {
  const base = { x: p.x, y: p.y, rot: p.rot, scale: p.scale };
  if (!playing) return base;
  if (p.anim) {
    const o = animOffset(p.anim, t);
    return { ...base, x: p.x + o.dx, y: p.y + o.dy, rot: p.rot + o.rot };
  }
  if (p.deform?.keyframes && p.deform.keyframes.length >= 2) {
    return deformKfTransform(p.deform, t, base);
  }
  return base;
}

// Ефективна деформація на момент t (інтерпольовані кейфрейми) або сира.
export function fxDeformAt(deform: PlacedDeform, t: number, playing: boolean): PlacedDeform {
  if (playing && deform.keyframes && deform.keyframes.length >= 2) return deformKfAt(deform, t);
  return deform;
}

// ── Canvas2D-рендер деформованого зображення ─────────────────────────────────

export interface DeformView {
  W: number; H: number;      // натуральні розміри зображення, px
  deform: PlacedDeform;      // ефективна деформація (кейфрейми вже інтерпольовані)
  x: number; y: number;      // екранний центр об'єкта
  rot: number;               // дисплейний кут, градуси
  kx: number; ky: number;    // масштаб: px зображення → екранні px (без flip)
  flip: number;              // 1 | -1 (дзеркало по X)
  baked?: boolean;           // запечені хендли: меш не обертається, крутиться контент
}

// UV (t,s) → екранна позиція з урахуванням деформації + повного трансформу.
export function deformViewPt(v: DeformView, t: number, s: number): { x: number; y: number } {
  const pos = deformImgPt(v.deform, v.W, v.H, t, s);
  const lx = pos.x * v.kx * v.flip, ly = pos.y * v.ky;
  if (v.baked) return { x: v.x + lx, y: v.y + ly };
  const r = (v.rot * Math.PI) / 180;
  const cosR = Math.cos(r), sinR = Math.sin(r);
  return { x: v.x + lx * cosR - ly * sinR, y: v.y + lx * sinR + ly * cosR };
}

// Один трикутник з афінним UV-відображенням (src → dst, Крамер).
function drawTri(
  ctx: CanvasRenderingContext2D, img: CanvasImageSource,
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

// Деформоване зображення квадосіткою N×N трикутних пар (як у Редакторі Мандр).
export function drawDeformedImage(ctx: CanvasRenderingContext2D, img: CanvasImageSource, v: DeformView, subdiv = 8): void {
  const N = v.deform.subdiv ?? subdiv;
  const { W, H } = v;
  let cosA = 1, sinA = 0;
  if (v.baked) {
    const a = -(v.rot * Math.PI) / 180;
    cosA = Math.cos(a); sinA = Math.sin(a);
  }
  const mkSrc = (t: number, s: number): { x: number; y: number } => {
    if (!v.baked) return { x: t * W, y: s * H };
    const dx = t * W - W / 2, dy = s * H - H / 2;
    return { x: W / 2 + dx * cosA - dy * sinA, y: H / 2 + dx * sinA + dy * cosA };
  };
  for (let row = 0; row < N; row++) {
    for (let col = 0; col < N; col++) {
      const t0 = col / N, t1 = (col + 1) / N;
      const s0 = row / N, s1 = (row + 1) / N;
      const p00 = deformViewPt(v, t0, s0);
      const p10 = deformViewPt(v, t1, s0);
      const p01 = deformViewPt(v, t0, s1);
      const p11 = deformViewPt(v, t1, s1);
      drawTri(ctx, img, mkSrc(t0, s0), mkSrc(t1, s0), mkSrc(t0, s1), p00, p10, p01);
      drawTri(ctx, img, mkSrc(t1, s0), mkSrc(t1, s1), mkSrc(t0, s1), p10, p11, p01);
    }
  }
}

// ── Хендли деформації ────────────────────────────────────────────────────────

export function deformHandleUVs(deform: PlacedDeform): Array<{ t: number; s: number }> {
  if (deform.type === 'persp') return [{ t: 0, s: 0 }, { t: 1, s: 0 }, { t: 1, s: 1 }, { t: 0, s: 1 }];
  const cols = deform.cols ?? 2, rows = deform.rows ?? 2;
  const pts: Array<{ t: number; s: number }> = [];
  for (let ri = 0; ri <= rows; ri++) for (let ci = 0; ci <= cols; ci++) pts.push({ t: ci / cols, s: ri / rows });
  return pts;
}

// Малює кружки-хендли поверх об'єкта (activeIdx — жовтий).
export function drawDeformHandles(ctx: CanvasRenderingContext2D, v: DeformView, activeIdx: number): void {
  deformHandleUVs(v.deform).forEach(({ t, s }, hi) => {
    const sp = deformViewPt(v, t, s);
    const active = activeIdx === hi;
    ctx.beginPath(); ctx.arc(sp.x, sp.y, active ? 7 : 5, 0, Math.PI * 2);
    ctx.fillStyle = active ? '#ffcc00' : '#ffffff'; ctx.fill();
    ctx.strokeStyle = '#333'; ctx.lineWidth = 1.5; ctx.stroke();
  });
}

// Індекс хендла під екранною точкою (або -1).
export function hitDeformHandle(v: DeformView, sx: number, sy: number, r = 10): number {
  const uvs = deformHandleUVs(v.deform);
  for (let hi = 0; hi < uvs.length; hi++) {
    const sp = deformViewPt(v, uvs[hi].t, uvs[hi].s);
    if (Math.hypot(sx - sp.x, sy - sp.y) <= r) return hi;
  }
  return -1;
}

// Дрег хендла: екранна дельта → пікселі зображення (скасовує ротацію/масштаб/flip).
export function applyHandleDrag(
  deform: PlacedDeform, hi: number, origVals: number[],
  dsx: number, dsy: number, rotDeg: number, kx: number, ky: number, flip: number,
): void {
  const rRad = -(rotDeg * Math.PI) / 180;
  const cosR = Math.cos(rRad), sinR = Math.sin(rRad);
  const drx = dsx * cosR - dsy * sinR, dry = dsx * sinR + dsy * cosR;
  const dpx = drx / (kx * flip), dpy = dry / ky;
  if (deform.type === 'persp') {
    if (!deform.corners) deform.corners = new Array(8).fill(0);
    deform.corners[hi * 2] = (origVals[hi * 2] ?? 0) + dpx;
    deform.corners[hi * 2 + 1] = (origVals[hi * 2 + 1] ?? 0) + dpy;
  } else {
    const totalPts = ((deform.cols ?? 2) + 1) * ((deform.rows ?? 2) + 1) * 2;
    if (!deform.pts || deform.pts.length < totalPts) deform.pts = new Array(totalPts).fill(0);
    deform.pts[hi * 2] = (origVals[hi * 2] ?? 0) + dpx;
    deform.pts[hi * 2 + 1] = (origVals[hi * 2 + 1] ?? 0) + dpy;
  }
}

// Записати кейфрейм поточного стану деформації (+ трансформ за галочками).
export function recordDeformKeyframe(deform: PlacedDeform, base: FxBase): number {
  if (!deform.keyframes) deform.keyframes = [];
  const kf: DeformKf = {
    corners: deform.corners ? [...deform.corners] : undefined,
    pts:     deform.pts     ? [...deform.pts]     : undefined,
  };
  if (deform.animPos)   { kf.x = base.x; kf.y = base.y; }
  if (deform.animRot)   { kf.rot = base.rot; }
  if (deform.animScale) { kf.scale = base.scale; }
  deform.keyframes.push(kf);
  return deform.keyframes.length;
}

// ── ПКМ-меню об'єкта: плановість + анімація + деформація + пункти редактора ──

// 7 іменованих планів (1..7) — спільні для редакторів Меню і Локацій.
export const PLAN_NAMES = ['Небо', 'Хмари', 'Найдальший', 'Далекий', 'Середній', 'Близький', 'Найближчий'];

export interface FxMenuOpts {
  title: string;
  objId: string;                       // для збереження стану колапсу секцій
  obj: { anim?: PlacedAnim; deform?: PlacedDeform };
  plan: { get: () => number; set: (v: number) => void; min: number; max: number; hint?: string; names?: string[] };
  getBase: () => FxBase;               // для запису кейфреймів (animPos/Rot/Scale)
  isEditingHandles: () => boolean;
  toggleEditHandles: () => void;
  onSetMoveLine?: () => void;          // «Задати лінію напряму» на канвасі (закриває меню)
  extras?: Array<{ label: string; danger?: boolean; on: () => void } | 'sep'>;
  pushUndo: () => void;
  save: () => void;
  draw: () => void;
  setStatus?: (m: string) => void;
}

let _menuEl: HTMLDivElement | null = null;
let _menuCollapse: Record<string, boolean> = {};
let _menuCollapseFor = '';
let _lastX = 0, _lastY = 0;
const _outside = (e: MouseEvent): void => { if (_menuEl && !_menuEl.contains(e.target as Node)) closeFxObjMenu(); };
export function closeFxObjMenu(): void {
  if (_menuEl) { _menuEl.remove(); _menuEl = null; }
  document.removeEventListener('mousedown', _outside, true);
}

export function openFxObjMenu(clientX: number, clientY: number, o: FxMenuOpts): void {
  _lastX = clientX; _lastY = clientY;
  if (_menuCollapseFor !== o.objId) { _menuCollapse = {}; _menuCollapseFor = o.objId; }
  closeFxObjMenu();
  const p = o.obj;
  const mk = (tag: string, css: string | null, txt?: string): HTMLElement => { const e = document.createElement(tag); if (css) e.style.cssText = css; if (txt != null) e.textContent = txt; return e; };
  const btnCss = (active: boolean): string => `padding:5px 9px;margin:2px;border-radius:6px;border:1px solid ${active ? '#39d0ff' : '#555'};background:${active ? '#1d3b46' : '#3a3a3a'};color:#e8e8e8;cursor:pointer;font:13px sans-serif;`;
  const rebuild = (): void => openFxObjMenu(_lastX, _lastY, o);
  const m = document.createElement('div'); _menuEl = m;
  m.style.cssText = 'position:fixed;z-index:99999;background:#2a2a2a;border:1px solid #444;border-radius:8px;padding:10px;min-width:212px;max-height:calc(100vh - 24px);overflow-y:auto;box-shadow:0 6px 20px rgba(0,0,0,0.5);color:#e8e8e8;font:13px sans-serif;';
  const header = mk('div', 'font-weight:600;margin-bottom:8px;color:#9ad0ff;cursor:move;user-select:none;', '⠿ ' + o.title);
  // Драг меню за хедер
  header.addEventListener('mousedown', (e) => {
    e.preventDefault(); e.stopPropagation();
    const r = m.getBoundingClientRect(); const ox = e.clientX - r.left, oy = e.clientY - r.top;
    const onMove = (ev: MouseEvent): void => {
      const nl = Math.max(4, Math.min(window.innerWidth - r.width - 4, ev.clientX - ox));
      const nt = Math.max(4, Math.min(window.innerHeight - 30, ev.clientY - oy));
      m.style.left = nl + 'px'; m.style.top = nt + 'px';
      _lastX = nl; _lastY = nt;
    };
    const onUp = (): void => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
    document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp);
  });
  m.appendChild(header);

  // Плановість
  m.appendChild(mk('div', 'opacity:0.7;margin:6px 0 2px;', 'Плановість' + (o.plan.hint ? ` (${o.plan.hint})` : '')));
  if (o.plan.names) {
    // Іменовані плани: список-вибір (клік = поставити на цей план)
    const plist = mk('div', 'display:flex;flex-direction:column;gap:2px;');
    for (let v = o.plan.min; v <= o.plan.max; v++) {
      const nm = o.plan.names[v - o.plan.min] ?? String(v);
      const btn = mk('button', btnCss(o.plan.get() === v) + 'text-align:left;', `${v} · ${nm}`);
      btn.onclick = () => { o.pushUndo(); o.plan.set(v); o.save(); o.draw(); rebuild(); };
      plist.appendChild(btn);
    }
    m.appendChild(plist);
  }
  const prow = mk('div', 'display:flex;align-items:center;gap:6px;margin-top:4px;');
  const far = mk('button', btnCss(false), '− Дальше');
  const planVal = mk('span', 'min-width:26px;text-align:center;', String(o.plan.get()));
  const near = mk('button', btnCss(false), 'Ближче +');
  far.onclick = () => { o.pushUndo(); o.plan.set(Math.max(o.plan.min, o.plan.get() - 1)); planVal.textContent = String(o.plan.get()); o.save(); o.draw(); if (o.plan.names) rebuild(); };
  near.onclick = () => { o.pushUndo(); o.plan.set(Math.min(o.plan.max, o.plan.get() + 1)); planVal.textContent = String(o.plan.get()); o.save(); o.draw(); if (o.plan.names) rebuild(); };
  prow.append(far, planVal, near); m.appendChild(prow);

  // Анімація
  m.appendChild(mk('div', 'opacity:0.7;margin:10px 0 2px;', 'Анімація'));
  const arow = mk('div', 'display:flex;flex-wrap:wrap;');
  const none = mk('button', btnCss(!p.anim), 'Немає');
  const rotB = mk('button', btnCss(p.anim?.type === 'rotate'), 'Обертання');
  const movB = mk('button', btnCss(p.anim?.type === 'move'), 'Переміщення');
  none.onclick = () => { o.pushUndo(); delete p.anim; _menuCollapse.anim = false; o.save(); o.draw(); rebuild(); };
  rotB.onclick = () => {
    if (p.anim?.type === 'rotate') { _menuCollapse.anim = !_menuCollapse.anim; rebuild(); }
    else { o.pushUndo(); p.anim = { type: 'rotate', range: p.anim?.range ?? 360, speed: 60 }; _menuCollapse.anim = false; o.save(); o.draw(); rebuild(); }
  };
  movB.onclick = () => {
    if (p.anim?.type === 'move') { _menuCollapse.anim = !_menuCollapse.anim; rebuild(); }
    else { o.pushUndo(); p.anim = { type: 'move', dx: p.anim?.dx ?? 1, dy: p.anim?.dy ?? 0, dist: p.anim?.dist ?? 100, speed: 40, constant: p.anim?.constant ?? false }; _menuCollapse.anim = false; o.save(); o.draw(); rebuild(); }
  };
  arow.append(none, rotB, movB);
  if (p.anim) arow.append(mk('span', 'opacity:0.5;font-size:11px;align-self:center;margin-left:4px;', _menuCollapse.anim ? '▸ налаштування' : '▾'));
  m.appendChild(arow);

  const numRow = (label: string, val: number, on: (v: number) => void): HTMLElement => {
    const r = mk('div', 'display:flex;align-items:center;gap:6px;margin-top:6px;');
    r.appendChild(mk('span', 'min-width:84px;opacity:0.8;', label));
    const inp = document.createElement('input'); inp.type = 'number'; inp.value = String(val);
    inp.style.cssText = 'width:70px;padding:3px 5px;background:#1f1f1f;border:1px solid #555;border-radius:5px;color:#e8e8e8;';
    inp.onchange = () => on(Number(inp.value));
    r.appendChild(inp); return r;
  };

  const an = _menuCollapse.anim ? undefined : p.anim;
  if (an?.type === 'rotate') {
    m.appendChild(numRow('Діапазон, °', an.range ?? 360, (v) => { o.pushUndo(); an.range = v; o.save(); o.draw(); }));
    m.appendChild(numRow('Швидкість, °/с', an.speed, (v) => { o.pushUndo(); an.speed = v; o.save(); o.draw(); }));
    m.appendChild(mk('div', 'opacity:0.55;margin-top:4px;font-size:11px;', '360° = безперервне; менше = туди-сюди'));
  } else if (an?.type === 'move') {
    if (o.onSetMoveLine) {
      const lineBtn = mk('button', btnCss(false) + 'display:block;width:100%;margin-top:6px;', 'Задати лінію напряму →');
      lineBtn.onclick = () => { closeFxObjMenu(); o.onSetMoveLine!(); };
      m.appendChild(lineBtn);
      m.appendChild(mk('div', 'opacity:0.55;margin-top:3px;font-size:11px;', 'довжина лінії = діапазон (' + (an.dist ?? 0) + ' од)'));
    } else {
      m.appendChild(numRow('Напрям X', an.dx ?? 1, (v) => { o.pushUndo(); an.dx = v; o.save(); o.draw(); }));
      m.appendChild(numRow('Напрям Y', an.dy ?? 0, (v) => { o.pushUndo(); an.dy = v; o.save(); o.draw(); }));
      m.appendChild(numRow('Діапазон, од', an.dist ?? 100, (v) => { o.pushUndo(); an.dist = v; o.save(); o.draw(); }));
    }
    m.appendChild(numRow('Швидкість, од/с', an.speed, (v) => { o.pushUndo(); an.speed = v; o.save(); o.draw(); }));
    const cr = mk('label', 'display:flex;align-items:center;gap:6px;margin-top:6px;cursor:pointer;');
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !!an.constant;
    cb.onchange = () => { o.pushUndo(); an.constant = cb.checked; o.save(); o.draw(); };
    cr.append(cb, mk('span', null, 'Постійно (без вороття)')); m.appendChild(cr);
  }

  // Деформація
  m.appendChild(mk('div', 'opacity:0.7;margin:10px 0 2px;', 'Деформація'));
  const dfrow = mk('div', 'display:flex;flex-wrap:wrap;');
  const dfNone = mk('button', btnCss(!p.deform), 'Немає');
  const dfPersp = mk('button', btnCss(p.deform?.type === 'persp'), 'Перспектива');
  const dfFfd = mk('button', btnCss(p.deform?.type === 'ffd'), 'FFD');
  dfNone.onclick = () => { o.pushUndo(); delete p.deform; if (o.isEditingHandles()) o.toggleEditHandles(); _menuCollapse.deform = false; o.save(); o.draw(); rebuild(); };
  dfPersp.onclick = () => {
    if (p.deform?.type === 'persp') { _menuCollapse.deform = !_menuCollapse.deform; rebuild(); }
    else { o.pushUndo(); p.deform = { type: 'persp' }; _menuCollapse.deform = false; o.save(); o.draw(); rebuild(); }
  };
  dfFfd.onclick = () => {
    if (p.deform?.type === 'ffd') { _menuCollapse.deform = !_menuCollapse.deform; rebuild(); }
    else { o.pushUndo(); p.deform = { type: 'ffd', cols: 2, rows: 2 }; _menuCollapse.deform = false; o.save(); o.draw(); rebuild(); }
  };
  dfrow.append(dfNone, dfPersp, dfFfd);
  if (p.deform) dfrow.append(mk('span', 'opacity:0.5;font-size:11px;align-self:center;margin-left:4px;', _menuCollapse.deform ? '▸ налаштування' : '▾'));
  m.appendChild(dfrow);

  if (p.deform?.type === 'ffd' && !_menuCollapse.deform) {
    const df = p.deform;
    m.appendChild(numRow('Стовпці', df.cols ?? 2, (v) => {
      const nc = Math.max(1, Math.min(16, Math.round(v)));
      if (nc !== (df.cols ?? 2)) { o.pushUndo(); df.cols = nc; df.rows = df.rows ?? 2; df.pts = undefined; o.save(); o.draw(); rebuild(); }
    }));
    m.appendChild(numRow('Рядки', df.rows ?? 2, (v) => {
      const nr = Math.max(1, Math.min(16, Math.round(v)));
      if (nr !== (df.rows ?? 2)) { o.pushUndo(); df.rows = nr; df.cols = df.cols ?? 2; df.pts = undefined; o.save(); o.draw(); rebuild(); }
    }));
    m.appendChild(mk('div', 'opacity:0.55;margin-top:3px;font-size:11px;', 'Зміна поділу скидає хендли'));
  }

  if (p.deform && !_menuCollapse.deform) {
    const df = p.deform;
    const editBtn = mk('button', btnCss(o.isEditingHandles()) + 'display:block;width:100%;margin-top:6px;', o.isEditingHandles() ? 'Редагую хендли ✓' : 'Редагувати хендли');
    editBtn.onclick = () => { o.toggleEditHandles(); o.draw(); rebuild(); };
    m.appendChild(editBtn);
    if (df.corners?.some((v) => v !== 0) || df.pts?.some((v) => v !== 0)) {
      const resetBtn = mk('button', 'padding:4px 9px;margin:4px 2px 0;border-radius:6px;border:1px solid #a04040;background:#3a2020;color:#ffaaaa;cursor:pointer;font:12px sans-serif;', 'Скинути хендли');
      resetBtn.onclick = () => { o.pushUndo(); df.corners = undefined; df.pts = undefined; o.save(); o.draw(); rebuild(); };
      m.appendChild(resetBtn);
    }

    // ── Кейфрейм-анімація деформації ──
    m.appendChild(mk('div', 'opacity:0.7;margin:10px 0 3px;', 'Анімація деформації'));
    m.appendChild(numRow('Швидкість, с', df.speed ?? 1, (v) => { o.pushUndo(); df.speed = Math.max(0.05, v); o.save(); o.draw(); }));
    const revRow = mk('label', 'display:flex;align-items:center;gap:6px;margin-top:5px;cursor:pointer;');
    const revCb = document.createElement('input'); revCb.type = 'checkbox'; revCb.checked = !!df.reverse;
    revCb.onchange = () => { o.pushUndo(); df.reverse = revCb.checked; o.save(); o.draw(); };
    revRow.append(revCb, mk('span', null, 'Зворотна (пінг-понг)')); m.appendChild(revRow);
    const mkCheck = (lbl: string, checked: boolean, onChange: (v: boolean) => void): HTMLElement => {
      const r = mk('label', 'display:flex;align-items:center;gap:6px;margin-top:4px;cursor:pointer;');
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = checked;
      cb.onchange = () => onChange(cb.checked);
      r.append(cb, mk('span', null, lbl)); return r;
    };
    m.appendChild(mkCheck('Запечені хендли',      !!df.baked,     (v) => { o.pushUndo(); df.baked     = v || undefined; o.save(); o.draw(); }));
    m.appendChild(mkCheck('Анімувати позицію',   !!df.animPos,   (v) => { o.pushUndo(); df.animPos   = v; o.save(); }));
    m.appendChild(mkCheck('Анімувати обертання', !!df.animRot,   (v) => { o.pushUndo(); df.animRot   = v; o.save(); }));
    m.appendChild(mkCheck('Анімувати масштаб',   !!df.animScale, (v) => { o.pushUndo(); df.animScale = v; o.save(); }));
    const kfCount = df.keyframes?.length ?? 0;
    m.appendChild(mk('div', 'margin-top:6px;font-size:12px;opacity:0.8;', kfCount < 2 ? `Кейфреймів: ${kfCount} · потрібно ≥ 2` : `Кейфреймів: ${kfCount}`));
    const kfBtn = mk('button', btnCss(false) + 'display:block;width:100%;margin-top:4px;', 'Записати кейфрейм (K)');
    kfBtn.onclick = () => {
      o.pushUndo();
      const n = recordDeformKeyframe(df, o.getBase());
      o.save(); o.draw(); o.setStatus?.(`Кейфрейм ${n} записано`); rebuild();
    };
    m.appendChild(kfBtn);
    if (kfCount > 0) {
      const kfResetBtn = mk('button', 'padding:4px 9px;margin-top:4px;border-radius:6px;border:1px solid #a04040;background:#3a2020;color:#ffaaaa;cursor:pointer;font:12px sans-serif;', 'Скинути кейфрейми');
      kfResetBtn.onclick = () => { o.pushUndo(); df.keyframes = []; o.save(); o.draw(); rebuild(); };
      m.appendChild(kfResetBtn);
    }
  }

  // Додаткові пункти конкретного редактора (дзеркало / фон сторінки / видалити …)
  if (o.extras?.length) {
    m.appendChild(mk('div', 'height:1px;background:#444;margin:10px 0 6px;'));
    for (const it of o.extras) {
      if (it === 'sep') { m.appendChild(mk('div', 'height:1px;background:#444;margin:6px 0;')); continue; }
      const b = mk('button', (it.danger
        ? 'padding:5px 9px;margin:2px;border-radius:6px;border:1px solid #a04040;background:#3a2020;color:#ffaaaa;cursor:pointer;font:13px sans-serif;display:block;width:100%;text-align:left;'
        : btnCss(false) + 'display:block;width:100%;text-align:left;'), it.label);
      b.onclick = () => { closeFxObjMenu(); it.on(); };
      m.appendChild(b);
    }
  }

  const cl = mk('button', btnCss(false) + 'display:block;width:100%;margin-top:10px;', 'Закрити');
  cl.onclick = () => closeFxObjMenu(); m.appendChild(cl);

  document.body.appendChild(m);
  const rct = m.getBoundingClientRect();
  let left = clientX, top = clientY;
  if (left + rct.width > window.innerWidth) left = window.innerWidth - rct.width - 8;
  if (top + rct.height > window.innerHeight) top = window.innerHeight - rct.height - 8;
  m.style.left = Math.max(8, left) + 'px'; m.style.top = Math.max(8, top) + 'px';
  setTimeout(() => document.addEventListener('mousedown', _outside, true), 0);
}
