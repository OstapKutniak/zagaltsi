// Редактор Меню (вкладка студії): сторінки меню гри з кнопками-гіперпосиланнями.
// Ліворуч — бібліотека PNG-ассетів (клік = фон сторінки), центр — прев'ю сторінки
// 20:9 (кнопки тягнуться мишею), праворуч — сторінки + властивості кнопки,
// знизу — тулбар із «Мапою переходів» (граф: яка кнопка на яку сторінку веде).
// Дані: MenuDoc → IDB zag_menu → публікація menu.json. Гра (MenuScene) читає їх.

import { idbGet, idbSet } from '../store';
import { registerPublisher, wirePublishButton } from '../publish';

export interface MenuButton {
  id: string; label: string;
  x: number; y: number;      // логічні координати кадру 1280×576
  size: number;              // px шрифту
  target: string;            // 'world' | 'game' | 'section:Назва' | 'page:<id>' | ''
}
export interface MenuPage {
  id: string; name: string;
  bg: string;                // dataURL фону ('' = чорний)
  buttons: MenuButton[];
}
export interface MenuDoc { version: 1; pages: MenuPage[]; updatedAt?: number }

const FRAME_W = 1280, FRAME_H = 576;
const MENU_FONT = 'Georgia, "Times New Roman", serif';

// Вбудовані цілі (не-сторінки) для гіперпосилань.
const FIXED_TARGETS: Array<{ v: string; l: string }> = [
  { v: '', l: '— нікуди (заглушка)' },
  { v: 'world', l: 'Мандри (глобальна карта)' },
  { v: 'game', l: 'Бітемап-рівень (гра)' },
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

  const defaultDoc = (): MenuDoc => ({
    version: 1,
    pages: [{
      id: 'main', name: 'Головна', bg: '',
      buttons: [
        { id: uid(), label: 'Мандри', x: 92, y: 210, size: 34, target: 'world' },
        { id: uid(), label: 'Завдання', x: 92, y: 284, size: 34, target: 'section:Завдання' },
        { id: uid(), label: 'Прогрес', x: 92, y: 358, size: 34, target: 'section:Прогрес' },
        { id: uid(), label: 'Інвентар', x: 92, y: 432, size: 34, target: 'section:Інвентар' },
      ],
    }],
  });

  const state = {
    doc: defaultDoc(),
    cur: 0,
    sel: null as string | null,
    view: 'page' as 'page' | 'map',
    bgImgs: new Map<string, HTMLImageElement>(), // pageId → фон
    assets: [] as Array<{ id: string; name: string; url: string }>,
    drag: null as null | { id: string; ox: number; oy: number },
    lastClick: 0,
    linkFrom: null as null | { pageId: string; btnId: string }, // мапа: тягнемо лінк
    mapRects: [] as Array<{ pageId: string; x: number; y: number; w: number; h: number; btns: Array<{ id: string; y: number; h: number }> }>,
  };
  const page = (): MenuPage => state.doc.pages[state.cur];
  const setStatus = (m: string): void => { const el = $('statusBar'); if (el) el.textContent = m; };

  let saveTimer = 0;
  function save(): void {
    state.doc.updatedAt = Date.now();
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => { void idbSet('zag_menu', state.doc); }, 250);
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
    // кнопки
    for (const b of p.buttons) {
      const bx = f.x + b.x * f.s, by = f.y + b.y * f.s;
      ctx.font = `${b.size * f.s}px ${MENU_FONT}`;
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.shadowColor = '#000'; ctx.shadowBlur = 5 * f.s; ctx.shadowOffsetY = 2 * f.s;
      ctx.fillStyle = state.sel === b.id ? '#ffcf8f' : '#e5d8bc';
      ctx.fillText(b.label, bx, by);
      ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
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
    // назва сторінки
    ctx.font = '12px system-ui'; ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillText('Сторінка: ' + p.name + ' (' + p.id + ')', f.x + 4, f.y - 6);
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
    const b = btnAt(sx, sy);
    if (b) {
      const now = Date.now();
      if (state.sel === b.id && now - state.lastClick < 350) {
        const nl = prompt('Текст кнопки:', b.label);
        if (nl) { b.label = nl; save(); }
      }
      state.lastClick = now;
      state.sel = b.id;
      const fp = toFrame(sx, sy);
      state.drag = { id: b.id, ox: fp.x - b.x, oy: fp.y - b.y };
    } else state.sel = null;
    renderProps(); draw();
  });
  canvas.addEventListener('mousemove', (e) => {
    if (!state.drag || state.view === 'map') return;
    const r = canvas!.getBoundingClientRect();
    const fp = toFrame(e.clientX - r.left, e.clientY - r.top);
    const b = page().buttons.find((x) => x.id === state.drag!.id);
    if (b) { b.x = Math.round(fp.x - state.drag.ox); b.y = Math.round(fp.y - state.drag.oy); draw(); }
  });
  window.addEventListener('mouseup', () => { if (state.drag) { state.drag = null; save(); } });
  window.addEventListener('keydown', (e) => {
    if (!document.getElementById('app')?.className.includes('mode-menu')) return;
    const typing = document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement;
    if (typing) return;
    if (e.key === 'Escape' && state.linkFrom) { state.linkFrom = null; draw(); }
    if ((e.key === 'Delete' || e.key === 'Backspace') && state.sel && state.view === 'page') {
      const p = page();
      p.buttons = p.buttons.filter((b) => b.id !== state.sel);
      state.sel = null; save(); renderProps(); draw();
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
      chip.onclick = () => { state.cur = i; state.sel = null; state.view = 'page'; renderPages(); renderProps(); draw(); };
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
  $('bgBtn')?.addEventListener('click', () => ($('bgInput') as HTMLInputElement)?.click());
  ($('bgInput') as HTMLInputElement | null)?.addEventListener('change', function () {
    const f = this.files?.[0]; if (!f) return;
    const rd = new FileReader();
    rd.onload = () => { page().bg = String(rd.result); state.bgImgs.delete(page().id); save(); draw(); };
    rd.readAsDataURL(f);
    this.value = '';
  });

  // ── Бібліотека PNG-ассетів (ліва панель, скрол) ────────────────────────────
  function renderAssets(): void {
    const list = $('assetList'); if (!list) return;
    list.innerHTML = '';
    for (const a of state.assets) {
      const card = document.createElement('div');
      card.style.cssText = 'background:var(--rail);border:1px solid var(--line);border-radius:8px;padding:4px;cursor:pointer;display:flex;flex-direction:column;gap:2px';
      const im = document.createElement('img');
      im.src = a.url; im.style.cssText = 'width:100%;height:64px;object-fit:contain'; im.draggable = false;
      const nm = document.createElement('div'); nm.textContent = a.name;
      nm.style.cssText = 'font-size:10px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:center';
      card.onclick = () => { page().bg = a.url; state.bgImgs.delete(page().id); save(); draw(); setStatus(`Фон сторінки: ${a.name}`); };
      card.appendChild(im); card.appendChild(nm);
      list.appendChild(card);
    }
  }
  $('addAsset')?.addEventListener('click', () => ($('assetInput') as HTMLInputElement)?.click());
  ($('assetInput') as HTMLInputElement | null)?.addEventListener('change', function () {
    const files = Array.from(this.files ?? []);
    for (const f of files) {
      const rd = new FileReader();
      rd.onload = () => {
        state.assets.push({ id: uid(), name: f.name.replace(/\.\w+$/, ''), url: String(rd.result) });
        void idbSet('zag_menu_assets', state.assets);
        renderAssets();
      };
      rd.readAsDataURL(f);
    }
    this.value = '';
  });

  // ── Публікація ──────────────────────────────────────────────────────────────
  registerPublisher(async () => ({
    'public/studio-data/menu.json': JSON.stringify(state.doc),
  }));
  const exp = $('exportBtn') as HTMLButtonElement | null;
  if (exp) wirePublishButton(exp, setStatus, () => {});

  // ── Завантаження ────────────────────────────────────────────────────────────
  void idbGet<MenuDoc>('zag_menu').then((d) => {
    if (d?.pages?.length) state.doc = d;
    renderPages(); renderProps(); draw();
  }).catch(() => { renderPages(); draw(); });
  void idbGet<typeof state.assets>('zag_menu_assets').then((a) => {
    if (Array.isArray(a)) { state.assets = a; renderAssets(); }
  }).catch(() => {});

  window.addEventListener('menuTabActivated', () => draw());
  draw();
}
