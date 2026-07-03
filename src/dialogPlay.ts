// Програвач ДІАЛОГУ-ДЕРЕВА (DialogDoc з Редактора Історії → Діалоги) поверх гри:
// кулька з реплікою НПС + кнопки-варіанти гравця. Дійшли до кінцівки з outcome →
// віддаємо його в onOutcome ('positive' = погодився, і т.д.). Стиль — як dialogUI.

import type { DialogDoc, DialogLine } from './dialogs';

let active: HTMLElement | null = null;
export function closeDialogPlay(): void { active?.remove(); active = null; }

export function playDialogDoc(
  doc: DialogDoc,
  opts?: { onOutcome?: (o: string) => void; onClose?: () => void },
): void {
  closeDialogPlay();
  const root = document.createElement('div');
  root.style.cssText = 'position:fixed;left:50%;bottom:16%;transform:translateX(-50%);z-index:60;' +
    'max-width:min(560px,86vw);display:flex;flex-direction:column;gap:10px;align-items:center;font-family:Georgia,serif';
  const bubble = document.createElement('div');
  bubble.style.cssText = 'position:relative;background:#f5efdd;color:#241b12;border:3px solid #1b1b1b;' +
    'border-radius:14px;padding:14px 40px 14px 18px;font-size:17px;line-height:1.45;box-shadow:0 8px 22px rgba(0,0,0,.5)';
  const txt = document.createElement('span');
  const x = document.createElement('button');
  x.textContent = '✕';
  x.style.cssText = 'position:absolute;top:6px;right:8px;background:none;border:0;color:#241b12;font-size:15px;cursor:pointer';
  const ans = document.createElement('div');
  ans.style.cssText = 'display:flex;flex-direction:column;gap:6px;width:100%';
  bubble.appendChild(txt); bubble.appendChild(x);
  root.appendChild(bubble); root.appendChild(ans);
  document.body.appendChild(root);
  active = root;

  const done = (outcome?: string): void => {
    closeDialogPlay();
    if (outcome) opts?.onOutcome?.(outcome);
    opts?.onClose?.();
  };
  x.onclick = (): void => done(undefined);

  const mkChoice = (label: string, on: () => void): HTMLButtonElement => {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = 'background:#2b1f16;color:#e5d8bc;border:2px solid #1b1b1b;border-radius:10px;' +
      'padding:9px 14px;font-size:15px;font-family:inherit;cursor:pointer;text-align:left';
    b.onmouseenter = (): void => { b.style.background = '#4a3524'; };
    b.onmouseleave = (): void => { b.style.background = '#2b1f16'; };
    b.onclick = on;
    return b;
  };

  const show = (line: DialogLine): void => {
    txt.textContent = line.text;
    ans.innerHTML = '';
    const choices = line.children.filter((c) => c.who === 'player');
    if (!choices.length) {
      ans.appendChild(mkChoice('Далі', () => done(line.outcome)));
      return;
    }
    for (const c of choices) {
      ans.appendChild(mkChoice(c.text, () => {
        if (c.outcome) { done(c.outcome); return; }
        const next = c.children.find((n) => n.who === 'npc');
        if (next) show(next); else done(undefined);
      }));
    }
  };
  show(doc.root);
}
