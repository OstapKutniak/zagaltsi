// Вкладений редактор діалогів (дерево-сценарій) — альтернатива нодам для розгалужень.
// Репліка НПС → варіанти гравця (з відступом) → наступна репліка → … Кінцеві варіанти
// тегуються «результатом» (напр. «Домовились»), який стане виходом ноди «Діалог» у поведінці.
//
// Зберігаємо ПЕР-ПЕРСОНАЖА в IDB `zag_dialogs_<charId>` (масив DialogDoc), мерж LWW із
// опублікованим. Публікація — dialogs.json (див. rig/main.ts registerPublisher).

import { idbGet, idbSet } from '../store';
import { mergeByIdLWW } from '../sync';
import {
  type DialogDoc, type DialogLine, dialogsKey, newDialog, newNpcLine, newChoice,
  loadPublishedDialogs, dialogOutcomes,
} from '../dialogs';

let host: HTMLElement | null = null;
let charId = '';
let state: { dialogs: DialogDoc[]; cur: number } = { dialogs: [], cur: 0 };
let saveTimer = 0;

const cur = (): DialogDoc | undefined => state.dialogs[state.cur];

function touchSave(): void {
  const d = cur(); if (d) d.updatedAt = Date.now();
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => { idbSet(dialogsKey(charId), state.dialogs).catch(() => {}); }, 250);
}

// Наступний вільний код діалогу (d1, d2, …).
function nextCode(): string {
  let i = 1; const used = new Set(state.dialogs.map((d) => d.id));
  while (used.has('d' + i)) i++;
  return 'd' + i;
}

// Відкрити/змонтувати редактор для персонажа у контейнер. Тягне local IDB + published (LWW).
export async function mountDialogEditor(container: HTMLElement, id: string, _name: string): Promise<void> {
  // Той самий персонаж і редактор уже живий (перемикання вкладок) — не перечитуємо IDB
  // (щоб не втратити щойно внесені правки до дебаунс-збереження), лише перемальовуємо.
  if (charId === id && host && state.dialogs.length) { host = container; render(); return; }
  host = container; charId = id;
  let local: DialogDoc[] = [];
  try { const l = await idbGet<DialogDoc[]>(dialogsKey(id)); if (Array.isArray(l)) local = l; } catch { /* ignore */ }
  let remote: DialogDoc[] = [];
  try { const m = await loadPublishedDialogs(); if (Array.isArray(m[id])) remote = m[id]; } catch { /* ignore */ }
  state = { dialogs: mergeByIdLWW(local, remote).merged, cur: 0 };
  render();
}

export function unmountDialogEditor(): void { closePreview(); host = null; }

// ── рендер ────────────────────────────────────────────────────────────────────
function render(): void {
  if (!host) return;
  host.innerHTML = '';
  host.style.cssText = 'flex:1;overflow:auto;padding:10px;display:flex;flex-direction:column;gap:10px';

  // Список діалогів (чіпи) + додати
  const bar = document.createElement('div'); bar.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;align-items:center';
  state.dialogs.forEach((d, i) => {
    const chip = document.createElement('button');
    chip.textContent = d.id + ' · ' + d.name;
    chip.style.cssText = `font-size:11px;padding:4px 9px;border-radius:5px;border:1px solid var(--line);cursor:pointer;background:${i === state.cur ? 'var(--accent)' : 'var(--rail)'};color:${i === state.cur ? '#1b1b1b' : 'var(--ink)'}`;
    chip.onclick = () => { state.cur = i; render(); };
    bar.appendChild(chip);
  });
  const add = document.createElement('button'); add.textContent = '+ Новий діалог';
  add.style.cssText = 'font-size:11px;padding:4px 9px;border-radius:5px;border:1px dashed var(--line);cursor:pointer;background:transparent;color:var(--muted)';
  add.onclick = () => { const d = newDialog(nextCode()); state.dialogs.push(d); state.cur = state.dialogs.length - 1; touchSave(); render(); };
  bar.appendChild(add);
  host.appendChild(bar);

  const d = cur();
  if (!d) { const hint = document.createElement('div'); hint.textContent = 'Немає діалогів. Додай новий.'; hint.style.cssText = 'color:var(--muted);font-size:12px'; host.appendChild(hint); return; }

  // Шапка діалогу: назва + код + результати + прев'ю/видалити
  const head = document.createElement('div'); head.style.cssText = 'display:flex;align-items:center;gap:8px;flex-wrap:wrap';
  const codeL = document.createElement('span'); codeL.textContent = 'Код: ' + d.id; codeL.style.cssText = 'font-size:11px;color:var(--muted);font-family:monospace';
  const nameI = document.createElement('input'); nameI.value = d.name; nameI.placeholder = 'Назва';
  nameI.style.cssText = 'flex:1;min-width:120px;background:var(--bg);border:1px solid var(--line);border-radius:4px;color:var(--ink);font-size:12px;padding:3px 6px;font-family:inherit';
  nameI.oninput = () => { d.name = nameI.value; touchSave(); };
  const prev = mkBtn('▶ Прев’ю', () => playPreview(d)); prev.style.background = 'var(--accent)'; prev.style.color = '#1b1b1b';
  const del = mkBtn('Видалити', () => { if (confirm('Видалити діалог ' + d.id + '?')) { state.dialogs.splice(state.cur, 1); state.cur = Math.max(0, state.cur - 1); touchSave(); render(); } });
  head.appendChild(codeL); head.appendChild(nameI); head.appendChild(prev); head.appendChild(del);
  host.appendChild(head);

  const outs = dialogOutcomes(d);
  const outLbl = document.createElement('div');
  outLbl.textContent = outs.length ? 'Результати (виходи ноди): ' + outs.join(' · ') : 'Результатів ще нема — познач кінцеві варіанти';
  outLbl.style.cssText = 'font-size:11px;color:var(--muted)';
  host.appendChild(outLbl);

  // Дерево
  const tree = document.createElement('div'); tree.style.cssText = 'display:flex;flex-direction:column;gap:4px';
  tree.appendChild(renderLine(d.root, true));
  host.appendChild(tree);
}

function mkBtn(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button'); b.textContent = label;
  b.style.cssText = 'font-size:11px;padding:3px 8px;border-radius:5px;border:1px solid var(--line);cursor:pointer;background:var(--rail);color:var(--ink)';
  b.onclick = onClick; return b;
}
function mkText(value: string, onChange: (v: string) => void, ph: string): HTMLTextAreaElement {
  const t = document.createElement('textarea'); t.value = value; t.placeholder = ph; t.rows = 1;
  t.style.cssText = 'flex:1;min-width:120px;resize:vertical;background:var(--bg);border:1px solid var(--line);border-radius:4px;color:var(--ink);font-size:12px;padding:4px 6px;font-family:inherit;line-height:1.3';
  t.oninput = () => { onChange(t.value); touchSave(); };
  return t;
}

// Рекурсивний рендер вузла. NPC-репліка: текст + варіанти. Вибір гравця: текст + або
// результат (кінець), або вкладена наступна репліка НПС.
function renderLine(line: DialogLine, isRoot: boolean): HTMLElement {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;flex-direction:column;gap:4px;border-left:2px solid ' + (line.who === 'npc' ? '#8a5a00' : '#1e5a9e') + ';padding-left:8px';

  const row = document.createElement('div'); row.style.cssText = 'display:flex;align-items:flex-start;gap:6px';
  const tag = document.createElement('span');
  tag.textContent = line.who === 'npc' ? 'НПС' : 'Гравець';
  tag.style.cssText = `flex:0 0 auto;font-size:10px;font-weight:700;padding:3px 6px;border-radius:4px;color:#fff;background:${line.who === 'npc' ? '#8a5a00' : '#1e5a9e'}`;
  row.appendChild(tag);
  row.appendChild(mkText(line.text, (v) => { line.text = v; }, line.who === 'npc' ? 'Що каже НПС' : 'Варіант відповіді'));

  if (!isRoot) {
    const del = mkBtn('✕', () => removeLine(line));
    del.style.cssText += ';flex:0 0 auto;color:var(--muted)';
    row.appendChild(del);
  }
  wrap.appendChild(row);

  if (line.who === 'npc') {
    // Варіанти гравця під реплікою
    const kids = document.createElement('div'); kids.style.cssText = 'display:flex;flex-direction:column;gap:6px;margin-left:10px';
    for (const c of line.children) kids.appendChild(renderLine(c, false));
    wrap.appendChild(kids);
    const addV = mkBtn('+ варіант', () => { line.children.push(newChoice()); touchSave(); render(); });
    addV.style.cssText += ';align-self:flex-start;margin-left:10px';
    wrap.appendChild(addV);
  } else {
    // Вибір гравця: або результат-кінець, або наступна репліка
    const ctrl = document.createElement('div'); ctrl.style.cssText = 'display:flex;align-items:center;gap:6px;margin-left:10px;flex-wrap:wrap';
    if (line.children.length === 0) {
      const oLbl = document.createElement('span'); oLbl.textContent = 'результат:'; oLbl.style.cssText = 'font-size:11px;color:var(--muted)';
      const oInp = document.createElement('input'); oInp.value = line.outcome ?? ''; oInp.placeholder = 'напр. Домовились';
      oInp.style.cssText = 'width:150px;background:var(--bg);border:1px solid var(--line);border-radius:4px;color:var(--ink);font-size:11px;padding:3px 6px;font-family:inherit';
      oInp.oninput = () => { line.outcome = oInp.value.trim() || undefined; touchSave(); };
      oInp.onblur = () => render(); // оновити список результатів угорі
      ctrl.appendChild(oLbl); ctrl.appendChild(oInp);
      ctrl.appendChild(mkBtn('↳ відповідь НПС', () => { line.outcome = undefined; line.children.push(newNpcLine('…')); touchSave(); render(); }));
    } else {
      const kids = document.createElement('div'); kids.style.cssText = 'display:flex;flex-direction:column;gap:6px;flex:1;min-width:200px';
      kids.appendChild(renderLine(line.children[0], false));
      ctrl.appendChild(kids);
    }
    wrap.appendChild(ctrl);
  }
  return wrap;
}

function removeLine(target: DialogLine): void {
  const d = cur(); if (!d) return;
  const rec = (n: DialogLine): boolean => {
    const i = n.children.indexOf(target);
    if (i >= 0) { n.children.splice(i, 1); return true; }
    return n.children.some(rec);
  };
  rec(d.root); touchSave(); render();
}

// ── прев'ю (програти в кульці) ────────────────────────────────────────────────
let previewEl: HTMLElement | null = null;
function closePreview(): void { if (previewEl) { previewEl.remove(); previewEl = null; } }

function playPreview(d: DialogDoc): void {
  closePreview();
  const root = document.createElement('div');
  root.style.cssText = "position:fixed;left:0;right:0;bottom:8%;z-index:9000;display:flex;justify-content:center;gap:14px;align-items:flex-end;pointer-events:none;font-family:'Comic Sans MS','Segoe UI',system-ui,sans-serif";
  const ans = document.createElement('div'); ans.style.cssText = 'display:flex;flex-direction:column;gap:8px;pointer-events:auto;max-width:200px';
  const bubble = document.createElement('div'); bubble.style.cssText = 'position:relative;background:#fff;color:#1b1b1b;border:4px solid #1b1b1b;border-radius:22px;padding:16px 20px;max-width:240px;min-width:140px;font-size:16px;font-weight:600;line-height:1.35;pointer-events:auto';
  const txt = document.createElement('span'); bubble.appendChild(txt);
  const x = document.createElement('button'); x.textContent = '✕'; x.style.cssText = 'position:absolute;top:-14px;right:-14px;width:28px;height:28px;border-radius:50%;background:#1b1b1b;color:#fff;border:0;font-size:16px;cursor:pointer'; x.onclick = closePreview; bubble.appendChild(x);
  root.appendChild(ans); root.appendChild(bubble);
  document.body.appendChild(root); previewEl = root;

  const show = (npc: DialogLine): void => {
    txt.textContent = npc.text;
    ans.innerHTML = '';
    const choices = npc.children;
    if (!choices.length) { const b = mkAns('Далі', closePreview); ans.appendChild(b); return; }
    for (const c of choices) {
      const b = mkAns(c.text || '…', () => {
        if (c.children[0]) show(c.children[0]);
        else { if (c.outcome) flashOutcome(c.outcome); closePreview(); }
      });
      ans.appendChild(b);
    }
  };
  const mkAns = (label: string, onClick: () => void): HTMLButtonElement => {
    const b = document.createElement('button'); b.textContent = label;
    b.style.cssText = 'background:#ff9a1f;color:#1b1b1b;border:3px solid #1b1b1b;border-radius:12px;padding:8px 13px;font:inherit;font-weight:700;font-size:14px;cursor:pointer;text-align:left';
    b.onclick = onClick; return b;
  };
  const flashOutcome = (o: string): void => {
    const t = document.createElement('div'); t.textContent = 'Результат: ' + o;
    t.style.cssText = 'position:fixed;left:50%;bottom:26%;transform:translateX(-50%);z-index:9001;background:#1b1b1b;color:#ff9a1f;padding:8px 14px;border-radius:10px;font:600 14px system-ui;pointer-events:none';
    document.body.appendChild(t); setTimeout(() => t.remove(), 1400);
  };
  show(d.root);
}
