// Ігровий діалог: мультяшна кулька (як у коміксах) з по-буквенним текстом,
// ліворуч — кнопки варіантів відповіді. Клік по відповіді веде графом до наступної
// діалог-ноди (edge з відповідного виходу). Дані — той самий NodeGraph поведінки.

import type { NodeGraph, GraphNode } from './node-editor';
import { dialogAnswers } from './node-editor';

let active = false;
export function isDialogActive(): boolean { return active; }

let styleInjected = false;
function injectStyle(): void {
  if (styleInjected) return; styleInjected = true;
  const s = document.createElement('style');
  s.textContent = `
.zag-dlg{position:fixed;left:0;right:0;bottom:8%;display:flex;justify-content:center;align-items:flex-end;
  gap:14px;z-index:5000;pointer-events:none;font-family:'Comic Sans MS','Segoe UI',system-ui,sans-serif;padding:0 16px}
.zag-dlg .ans{display:flex;flex-direction:column;gap:8px;pointer-events:auto;max-width:38%}
.zag-dlg .ans button{background:#ff9a1f;color:#1b1b1b;border:3px solid #1b1b1b;border-radius:12px;
  padding:9px 14px;font:inherit;font-weight:700;font-size:15px;cursor:pointer;box-shadow:2px 3px 0 #1b1b1b;
  transition:transform .06s;text-align:left}
.zag-dlg .ans button:hover{transform:translate(-1px,-1px)}
.zag-dlg .ans button:active{transform:translate(1px,2px);box-shadow:1px 1px 0 #1b1b1b}
.zag-dlg .bubble{position:relative;background:#fff;color:#1b1b1b;border:4px solid #1b1b1b;border-radius:22px;
  padding:16px 20px;max-width:46%;min-width:180px;font-size:18px;font-weight:600;line-height:1.35;
  box-shadow:4px 5px 0 rgba(0,0,0,.35);pointer-events:auto;cursor:pointer}
.zag-dlg .bubble::after{content:'';position:absolute;left:-4px;bottom:-22px;width:34px;height:34px;
  background:#fff;border-left:4px solid #1b1b1b;border-bottom:4px solid #1b1b1b;
  border-bottom-left-radius:8px;transform:skewX(24deg)}
.zag-dlg .bubble .x{position:absolute;top:-14px;right:-14px;width:28px;height:28px;border-radius:50%;
  background:#1b1b1b;color:#fff;border:0;font-size:16px;line-height:28px;text-align:center;cursor:pointer;padding:0}
.zag-dlg .cursor{opacity:.4}
`;
  document.head.appendChild(s);
}

export function openDialog(graph: NodeGraph, startId: string, onClose?: () => void): void {
  if (active) return;
  const byId = (id: string): GraphNode | undefined => graph.nodes.find((n) => n.id === id);
  const start = byId(startId);
  if (!start) { onClose?.(); return; }
  injectStyle();
  active = true;

  const root = document.createElement('div'); root.className = 'zag-dlg';
  const ans = document.createElement('div'); ans.className = 'ans';
  const bubble = document.createElement('div'); bubble.className = 'bubble';
  const txt = document.createElement('span');
  const closeBtn = document.createElement('button'); closeBtn.className = 'x'; closeBtn.textContent = '✕';
  bubble.appendChild(txt); bubble.appendChild(closeBtn);
  root.appendChild(ans); root.appendChild(bubble);
  document.body.appendChild(root);

  let timer = 0;
  function close(): void {
    if (!active) return;
    active = false;
    clearInterval(timer);
    root.remove();
    onClose?.();
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
