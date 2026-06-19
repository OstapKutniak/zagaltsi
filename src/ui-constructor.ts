// Оверлей «Конструктор»: накриває UI напівпрозорою білою заливкою, обводить
// кожну панель і кнопку помаранчевим і підписує кодом (панель = буква,
// кнопка = буква+цифра). Суто для зручної комунікації «полагодь B3, підніми C».
// Працює з усім DOM, тож один модуль обслуговує обидва редактори.

let overlay: HTMLDivElement | null = null;

const isVisible = (el: Element): boolean => {
  const h = el as HTMLElement;
  return h.offsetWidth > 4 && h.offsetHeight > 4;
};

function addBox(root: HTMLElement, r: DOMRect, label: string, block: boolean): void {
  if (r.width < 6 || r.height < 6) return;
  const box = document.createElement('div');
  box.style.cssText =
    `position:absolute;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;` +
    `border:${block ? 2 : 1}px solid #ff9a1f;border-radius:6px;box-sizing:border-box;` +
    (block ? 'box-shadow:0 0 0 1px rgba(255,154,31,.3) inset;' : '');
  const tag = document.createElement('div');
  tag.textContent = label;
  tag.style.cssText =
    `position:absolute;left:-1px;top:-1px;background:#ff9a1f;color:#1b1b1b;padding:1px 4px;` +
    `border-radius:6px 0 6px 0;font:700 ${block ? 12 : 10}px monospace;`;
  box.appendChild(tag);
  root.appendChild(box);
}

function build(): HTMLDivElement {
  const root = document.createElement('div');
  root.style.cssText =
    'position:fixed;inset:0;z-index:9000;background:rgba(255,255,255,0.5);pointer-events:none;';
  // Блоки — видимі панелі (.pane), iconBar-и та верхні таби.
  const panes = Array.from(document.querySelectorAll('.pane, #iconBar, #topTabs')).filter(isVisible);
  let li = 0;
  for (const pane of panes) {
    const letter = String.fromCharCode(65 + li++);
    addBox(root, pane.getBoundingClientRect(), letter, true);
    const ctrls = Array.from(pane.querySelectorAll('button, select, input[type=range]')).filter(isVisible);
    ctrls.forEach((c, i) => addBox(root, c.getBoundingClientRect(), letter + (i + 1), false));
  }
  return root;
}

// Перемикає оверлей. Повертає новий стан (true = увімкнено).
export function toggleConstructor(): boolean {
  if (overlay) { overlay.remove(); overlay = null; return false; }
  overlay = build();
  document.body.appendChild(overlay);
  return true;
}
