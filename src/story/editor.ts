// Редактор Історії — вкладка студії (колишній «Редактор Меню») з перемикачем
// чотирьох розділів у правій панелі:
//   [Меню] — наявний редактор сторінок меню (його секції лишаються як були);
//   [Квести] — список квестів (нотатки на дошці «Завдання» у грі);
//   [Бот] — тексти/кнопки Telegram-бота (bot-config.json);
//   [Діалоги] — діалоги НПС (той самий mountDialogEditor, вибір персонажа).
// Дані квестів: IDB zag_quests → публікація studio-data/quests.json.

import { idbGet, idbSet } from '../store';
import { registerPublisher } from '../publish';
import { initBotEditor } from '../bot/editor';
import { mountDialogEditor, unmountDialogEditor } from '../rig/dialogEditor';
import { loadCharLibrary } from '../charlib';
import { type Quest, type QuestStore, loadQuests, newQuestId } from './quests';

const INPUT_CSS = 'background:var(--rail);color:var(--ink);border:1px solid var(--line);border-radius:6px;padding:5px 8px;font-size:13px;font-family:inherit;outline:none;width:100%;box-sizing:border-box';

function lbl(t: string): HTMLElement {
  const e = document.createElement('label');
  e.textContent = t;
  e.style.cssText = 'font-size:12px;color:var(--muted);font-weight:600';
  return e;
}

let _init = false;
export function initStoryEditor(): void {
  if (_init) return; _init = true;
  const pane = document.getElementById('mn-right')?.querySelector('.pane') as HTMLElement | null;
  if (!pane) return;

  // ── Обгортаємо наявний вміст (редактор меню) у панель «Меню» ────────────────
  const menuPanel = document.createElement('div');
  menuPanel.style.cssText = 'display:flex;flex-direction:column';
  while (pane.firstChild) menuPanel.appendChild(pane.firstChild);

  const questsPanel = document.createElement('div');
  questsPanel.style.cssText = 'display:none;flex-direction:column;gap:6px';
  const botPanel = document.createElement('div');
  botPanel.style.cssText = 'display:none;flex-direction:column;gap:6px';
  const dialogsPanel = document.createElement('div');
  dialogsPanel.style.cssText = 'display:none;flex-direction:column;gap:6px';

  // ── Перемикач розділів ──────────────────────────────────────────────────────
  const sw = document.createElement('div');
  sw.style.cssText = 'display:flex;gap:4px;margin-bottom:8px;flex-wrap:wrap';
  const panels: Record<string, HTMLElement> = { 'Меню': menuPanel, 'Квести': questsPanel, 'Бот': botPanel, 'Діалоги': dialogsPanel };
  const btns: Record<string, HTMLButtonElement> = {};
  const show = (name: string): void => {
    for (const [n, p] of Object.entries(panels)) {
      p.style.display = n === name ? 'flex' : 'none';
      btns[n].style.background = n === name ? 'var(--accent)' : 'var(--rail)';
      btns[n].style.color = n === name ? '#1b1b1b' : 'var(--ink)';
    }
    if (name !== 'Діалоги') unmountDialogEditor();
  };
  for (const name of Object.keys(panels)) {
    const b = document.createElement('button');
    b.textContent = name;
    b.style.cssText = 'flex:1;min-width:70px;padding:6px 4px;font-size:12px;border-radius:6px';
    b.addEventListener('click', () => show(name));
    btns[name] = b; sw.appendChild(b);
  }
  pane.appendChild(sw);
  pane.appendChild(menuPanel); pane.appendChild(questsPanel);
  pane.appendChild(botPanel); pane.appendChild(dialogsPanel);

  initQuestsPanel(questsPanel);
  initBotEditor(botPanel);
  initDialogsPanel(dialogsPanel);
  show('Меню');
}

// ── Квести ─────────────────────────────────────────────────────────────────────
function initQuestsPanel(panel: HTMLElement): void {
  let store: QuestStore = { quests: [] };
  let sel: string | null = null;

  let saveTimer = 0;
  const save = (): void => {
    store.updatedAt = Date.now();
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => { void idbSet('zag_quests', store); }, 250);
  };

  const list = document.createElement('div');
  list.style.cssText = 'display:flex;flex-direction:column;gap:4px';
  const props = document.createElement('div');
  props.style.cssText = 'display:none;flex-direction:column;gap:6px;margin-top:6px';

  function renderList(): void {
    list.innerHTML = '';
    for (const q of store.quests) {
      const row = document.createElement('button');
      row.textContent = (q.cat === 'main' ? '★ ' : '') + (q.title || '(без назви)');
      row.style.cssText = 'text-align:left;padding:6px 8px;font-size:13px;border-radius:6px;' +
        (q.id === sel ? 'background:var(--accent);color:#1b1b1b' : 'background:var(--rail);color:var(--ink)');
      row.addEventListener('click', () => { sel = q.id; renderList(); renderProps(); });
      list.appendChild(row);
    }
  }

  function renderProps(): void {
    const q = store.quests.find((x) => x.id === sel);
    if (!q) { props.style.display = 'none'; return; }
    props.style.display = 'flex';
    props.innerHTML = '';

    props.appendChild(lbl('Назва (на нотатці дошки)'));
    const title = document.createElement('input');
    title.type = 'text'; title.style.cssText = INPUT_CSS; title.value = q.title;
    title.addEventListener('input', () => { q.title = title.value; q.updatedAt = Date.now(); save(); renderList(); });
    props.appendChild(title);

    props.appendChild(lbl('Текст (розгортається по кліку на нотатку)'));
    const text = document.createElement('textarea');
    text.style.cssText = INPUT_CSS + ';min-height:110px;resize:vertical'; text.value = q.text;
    text.addEventListener('input', () => { q.text = text.value; q.updatedAt = Date.now(); save(); });
    props.appendChild(text);

    props.appendChild(lbl('Тип'));
    const cat = document.createElement('select');
    cat.style.cssText = INPUT_CSS;
    for (const [v, l] of [['main', 'Головний'], ['side', 'Побічний']] as const) {
      const o = document.createElement('option'); o.value = v; o.textContent = l; cat.appendChild(o);
    }
    cat.value = q.cat;
    cat.addEventListener('change', () => { q.cat = cat.value as Quest['cat']; q.updatedAt = Date.now(); save(); renderList(); });
    props.appendChild(cat);

    const del = document.createElement('button');
    del.textContent = 'Видалити квест';
    del.style.cssText = 'width:100%;padding:6px;font-size:12px';
    del.addEventListener('click', () => {
      if (!confirm(`Видалити «${q.title}»?`)) return;
      store.quests = store.quests.filter((x) => x.id !== q.id);
      sel = null; save(); renderList(); renderProps();
    });
    props.appendChild(del);
  }

  const add = document.createElement('button');
  add.textContent = 'Новий квест';
  add.style.cssText = 'width:100%;padding:6px;font-size:12px';
  add.addEventListener('click', () => {
    const q: Quest = { id: newQuestId(), title: 'Новий квест', text: '', cat: 'side', updatedAt: Date.now() };
    store.quests.push(q); sel = q.id; save(); renderList(); renderProps();
  });

  panel.appendChild(add); panel.appendChild(list); panel.appendChild(props);

  registerPublisher(() => ({ 'public/studio-data/quests.json': JSON.stringify(store, null, 2) }));
  void loadQuests().then((s) => { store = s; renderList(); });
}

// ── Діалоги (перенесено з поведінки ворогів; у рігу лишилося як прев'ю) ───────
function initDialogsPanel(panel: HTMLElement): void {
  panel.appendChild(lbl('Персонаж (чиї діалоги)'));
  const sel = document.createElement('select');
  sel.style.cssText = INPUT_CSS;
  panel.appendChild(sel);
  const host = document.createElement('div');
  host.style.cssText = 'display:flex;flex-direction:column;gap:6px;margin-top:6px';
  panel.appendChild(host);

  void loadCharLibrary().then((lib) => {
    const chars = lib.filter((c) => c.cat === 'enemy' || c.cat === 'neutral' || c.cat === 'char');
    if (!chars.length) {
      const hint = document.createElement('div');
      hint.textContent = 'Бібліотека персонажів порожня';
      hint.style.cssText = 'color:var(--muted);font-size:12px';
      panel.appendChild(hint);
      return;
    }
    for (const c of chars) {
      const o = document.createElement('option'); o.value = c.id; o.textContent = c.name; sel.appendChild(o);
    }
    const mount = (): void => {
      const c = chars.find((x) => x.id === sel.value) ?? chars[0];
      host.innerHTML = '';
      void mountDialogEditor(host, c.id, c.name);
    };
    sel.addEventListener('change', mount);
    mount();
  });
}
