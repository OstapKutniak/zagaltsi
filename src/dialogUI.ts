// Ігровий діалог: мультяшна кулька (як у коміксах) з по-буквенним текстом,
// ліворуч — кнопки варіантів відповіді. Клік по відповіді веде графом до наступної
// діалог-ноди (edge з відповідного виходу). Дані — той самий NodeGraph поведінки.
//
// Хвіст кульки — ДИНАМІЧНИЙ: SVG-крива (bezier), що щокадру тягнеться від кульки до
// рота персонажа (getAnchor повертає його екранну точку наживо, бо камера рухається).
// Тож із кого говорять — з того й виходить «бульбашка», під будь-яким кутом.

import type { NodeGraph, GraphNode } from './node-editor';
import { dialogAnswers } from './node-editor';

let active = false;
export function isDialogActive(): boolean { return active; }

let styleInjected = false;
function injectStyle(): void {
  if (styleInjected) return; styleInjected = true;
  const s = document.createElement('style');
  s.textContent = `
.zag-dlg{position:fixed;inset:0;z-index:5000;pointer-events:none;
  font-family:'Comic Sans MS','Segoe UI',system-ui,sans-serif}
.zag-dlg svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none}
.zag-dlg .ans{position:absolute;display:flex;flex-direction:column;gap:8px;pointer-events:auto;max-width:180px}
.zag-dlg .ans button{background:#ff9a1f;color:#1b1b1b;border:3px solid #1b1b1b;border-radius:12px;
  padding:9px 14px;font:inherit;font-weight:700;font-size:15px;cursor:pointer;box-shadow:2px 3px 0 #1b1b1b;
  transition:transform .06s;text-align:left}
.zag-dlg .ans button:hover{transform:translate(-1px,-1px)}
.zag-dlg .ans button:active{transform:translate(1px,2px);box-shadow:1px 1px 0 #1b1b1b}
.zag-dlg .bubble{position:absolute;background:#fff;color:#1b1b1b;border:4px solid #1b1b1b;border-radius:22px;
  padding:16px 20px;max-width:220px;min-width:140px;font-size:17px;font-weight:600;line-height:1.35;
  box-shadow:4px 5px 0 rgba(0,0,0,.35);pointer-events:auto;cursor:pointer}
.zag-dlg .bubble .x{position:absolute;top:-14px;right:-14px;width:28px;height:28px;border-radius:50%;
  background:#1b1b1b;color:#fff;border:0;font-size:16px;line-height:28px;text-align:center;cursor:pointer;padding:0}
`;
  document.head.appendChild(s);
}

const SVGNS = 'http://www.w3.org/2000/svg';

// Шлях гнучкого хвоста: від краю кульки (база) двома кубічними кривими сходиться в
// кінчику (рот персонажа). База — на тому боці кульки (низ/верх), що ближчий до рота.
function tailPath(b: DOMRect, tip: { x: number; y: number }): string {
  const below = tip.y >= b.top + b.height / 2;       // рот нижче центра кульки → хвіст знизу
  const baseY = below ? b.bottom - 4 : b.top + 4;     // −4: ховаємо базу під бортик кульки
  const cx = Math.max(b.left + 20, Math.min(b.right - 20, tip.x)); // центр бази тягнеться за ротом
  const half = 15;
  const x1 = cx - half, x2 = cx + half;
  const my = (baseY + tip.y) / 2;
  // Контрольні точки дають S-подібний органічний вигин до рота.
  return `M ${x1} ${baseY} C ${x1} ${my}, ${tip.x - 6} ${my}, ${tip.x} ${tip.y}`
       + ` C ${tip.x + 6} ${my}, ${x2} ${my}, ${x2} ${baseY} Z`;
}

export function openDialog(
  graph: NodeGraph,
  startId: string,
  opts?: { getAnchor?: () => { x: number; y: number } | null; onClose?: () => void; onOutcome?: (o: 'positive' | 'negative') => void },
): void {
  if (active) return;
  const byId = (id: string): GraphNode | undefined => graph.nodes.find((n) => n.id === id);
  const start = byId(startId);
  if (!start) { opts?.onClose?.(); return; }
  injectStyle();
  active = true;

  const root = document.createElement('div'); root.className = 'zag-dlg';
  const svg = document.createElementNS(SVGNS, 'svg');
  const tail = document.createElementNS(SVGNS, 'path');
  tail.setAttribute('fill', '#fff');
  tail.setAttribute('stroke', '#1b1b1b');
  tail.setAttribute('stroke-width', '4');
  tail.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(tail);
  const ans  = document.createElement('div'); ans.className  = 'ans';
  const bubble = document.createElement('div'); bubble.className = 'bubble';
  const txt = document.createElement('span');
  const closeBtn = document.createElement('button'); closeBtn.className = 'x'; closeBtn.textContent = '✕';
  bubble.appendChild(txt); bubble.appendChild(closeBtn);
  // svg ПЕРШИМ — кулька малюється поверх, ховаючи базу хвоста (безшовний стик).
  root.appendChild(svg); root.appendChild(ans); root.appendChild(bubble);
  document.body.appendChild(root);

  // Результат розмови: ставиться, коли доходимо до репліки, позначеної як «Кінець».
  let outcome: 'positive' | 'negative' | null = null;
  let lastAnchor: { x: number; y: number } | null = null;
  let raf = 0;

  // Щокадру: ставимо кульку над ротом, кнопки збоку, і малюємо хвіст до рота.
  function place(): void {
    const anchor = opts?.getAnchor?.() ?? lastAnchor;
    if (anchor) lastAnchor = anchor;
    const W = window.innerWidth, H = window.innerHeight;
    const bw = bubble.offsetWidth, bh = bubble.offsetHeight;
    const aw = ans.offsetWidth, ah = ans.offsetHeight;
    if (anchor) {
      const GAP = 56; // довжина хвоста над головою
      const bx = Math.max(8, Math.min(W - bw - 8, anchor.x - bw / 2));
      const by = Math.max(8, Math.min(H - bh - 8, anchor.y - GAP - bh));
      bubble.style.left = bx + 'px'; bubble.style.top = by + 'px';
      // кнопки — ліворуч від кульки; якщо не влазять — праворуч
      let ax = bx - aw - 14;
      if (ax < 8) ax = bx + bw + 14;
      ax = Math.max(8, Math.min(W - aw - 8, ax));
      const ay = Math.max(8, Math.min(H - ah - 8, by + bh - ah));
      ans.style.left = ax + 'px'; ans.style.top = ay + 'px';
      tail.setAttribute('d', tailPath(bubble.getBoundingClientRect(), anchor));
      tail.style.display = '';
    } else {
      // без прив'язки (немає координат) — центр унизу, без хвоста
      const bx = (W - bw) / 2, by = H * 0.72;
      bubble.style.left = bx + 'px'; bubble.style.top = by + 'px';
      ans.style.left = Math.max(8, bx - aw - 14) + 'px';
      ans.style.top = Math.max(8, by + bh - ah) + 'px';
      tail.style.display = 'none';
    }
    raf = requestAnimationFrame(place);
  }
  place(); // одразу поставити на місце (без мигання в (0,0)), далі само-перезапуск через rAF

  let timer = 0;
  function close(): void {
    if (!active) return;
    active = false;
    clearInterval(timer);
    cancelAnimationFrame(raf);
    root.remove();
    if (outcome) opts?.onOutcome?.(outcome);
    opts?.onClose?.();
  }
  closeBtn.onclick = (e) => { e.stopPropagation(); close(); };

  // наступна діалог-нода з виходу port (інакше — кінець розмови)
  function nextDialog(n: GraphNode, port: number): GraphNode | null {
    const e = graph.edges.find((ed) => ed.fromId === n.id && ed.fromPort === port);
    const t = e ? byId(e.toId) : undefined;
    return t && t.type === 'dialog' ? t : null;
  }

  function show(node: GraphNode): void {
    const full = String(node.config.text ?? '');
    const answers = dialogAnswers(node);
    const ending = String(node.config.ending ?? 'none');
    if (ending === 'positive' || ending === 'negative') outcome = ending; // ця репліка = кінець розмови
    ans.innerHTML = '';
    txt.textContent = '';
    let i = 0;
    clearInterval(timer);

    const renderButtons = (): void => {
      ans.innerHTML = '';
      const labels = answers.length ? answers : ['Далі'];
      labels.forEach((label, idx) => {
        const b = document.createElement('button');
        b.textContent = label;
        b.onclick = () => { const nx = nextDialog(node, idx); if (nx) show(nx); else close(); };
        ans.appendChild(b);
      });
    };
    const finish = (): void => { clearInterval(timer); txt.textContent = full; renderButtons(); };

    timer = window.setInterval(() => {
      txt.textContent = full.slice(0, ++i);
      if (i >= full.length) finish();
    }, 28);

    // клік по кульці — показати весь текст одразу (пропустити друк)
    bubble.onclick = () => { if (i < full.length) finish(); };
  }

  show(start);
}
