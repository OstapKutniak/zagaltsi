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
import { dialogsKey, loadPublishedDialogs, type DialogDoc } from '../dialogs';
import { loadLocationsForGame, loadWorldsForGame } from '../world/worldData';
import { CATALOG } from '../inventory';
import {
  type Quest, type QuestStore, type QuestAcq, type QuestObjective, type ObjectiveKind,
  type QuestSuccess, type QuestFail, loadQuests, newQuestId, newObjectiveId,
} from './quests';
import { pushQuest, tombstoneQuest, watchQuestNodes } from './contentSync';

const INPUT_CSS = 'background:var(--rail);color:var(--ink);border:1px solid var(--line);border-radius:6px;padding:5px 8px;font-size:13px;font-family:inherit;outline:none;width:100%;box-sizing:border-box';

function lbl(t: string): HTMLElement {
  const e = document.createElement('label');
  e.textContent = t;
  e.style.cssText = 'font-size:12px;color:var(--muted);font-weight:600';
  return e;
}

// ── Дрібні хелпери форми (для розширеного редактора квестів) ──────────────────
function fieldWrap(labelText: string, control: HTMLElement): HTMLElement {
  const w = document.createElement('div');
  w.style.cssText = 'display:flex;flex-direction:column;gap:3px';
  w.appendChild(lbl(labelText));
  w.appendChild(control);
  return w;
}
function selRow(labelText: string, opts: [string, string][], value: string, onChange: (v: string) => void): HTMLElement {
  const s = document.createElement('select'); s.style.cssText = INPUT_CSS;
  for (const [v, l] of opts) { const o = document.createElement('option'); o.value = v; o.textContent = l; s.appendChild(o); }
  s.value = value;
  s.addEventListener('change', () => onChange(s.value));
  return fieldWrap(labelText, s);
}
function numRow(labelText: string, value: number | undefined, onChange: (v: number) => void): HTMLElement {
  const i = document.createElement('input'); i.type = 'number'; i.style.cssText = INPUT_CSS;
  i.value = value != null ? String(value) : '';
  i.addEventListener('input', () => onChange(Number(i.value) || 0));
  return fieldWrap(labelText, i);
}
function textRow(labelText: string, value: string | undefined, onChange: (v: string) => void): HTMLElement {
  const i = document.createElement('input'); i.type = 'text'; i.style.cssText = INPUT_CSS;
  i.value = value ?? '';
  i.addEventListener('input', () => onChange(i.value));
  return fieldWrap(labelText, i);
}
function sectionEl(t: string): HTMLElement {
  const e = document.createElement('div'); e.textContent = t;
  e.style.cssText = 'font-size:11px;font-weight:800;color:var(--ink);letter-spacing:.05em;margin-top:10px;border-top:1px solid var(--line);padding-top:8px';
  return e;
}

// Списки опцій для селектів квесту.
const ACQ_OPTS: [QuestAcq, string][] = [
  ['auto', 'Одразу відомий (без видачі)'],
  ['tg_encounter', 'TG-сповіщення + НПС у поточній локації'],
  ['location_npc', 'НПС у конкретній локації'],
  ['travel', 'Енкаунтер при переході між локаціями'],
  ['level', 'НПС/тригер у бітемап-рівні'],
  ['board', 'Дошка оголошень у локації (береш сам)'],
  ['item', 'Підбір предмета відкриває квест'],
  ['chain', 'Після завершення іншого квесту'],
];
const OBJ_OPTS: [ObjectiveKind, string][] = [
  ['talk', 'Поговорити з НПС'],
  ['kill', 'Здолати ворогів'],
  ['reach', 'Дійти до локації'],
  ['collect', 'Зібрати предмети'],
  ['survive', 'Вижити (сек)'],
  ['escort', 'Супроводити НПС'],
  ['custom', 'Довільна ціль (текст)'],
];
const SUCCESS_OPTS: [QuestSuccess, string][] = [
  ['objectives', 'Виконано всі цілі'],
  ['dialog_positive', 'Діалог завершено позитивно'],
  ['reach', 'Досягнуто цілі-локації'],
  ['custom', 'Вручну / скриптом'],
];
const FAIL_OPTS: [QuestFail, string][] = [
  ['none', 'Не провалюється'],
  ['dialog_negative', 'Діалог завершено негативно'],
  ['player_death', 'Смерть гравця'],
  ['timeout', 'Вичерпано час'],
  ['abandon', 'Гравець відмовився'],
];
const NONE_OPT: [string, string] = ['', '— нема'];

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
// Список рівнів (для селекта у способі «level»): IDB студії → опублікований layout.
async function loadLevelsList(): Promise<{ id: string; name: string }[]> {
  let store = await idbGet<{ levels?: { id?: string; name: string }[] }>('zag_levels').catch(() => null);
  if (!store?.levels?.length) {
    try { const r = await fetch(`${import.meta.env.BASE_URL}studio-data/level-layouts.json`); if (r.ok) store = await r.json() as typeof store; } catch { /* ignore */ }
  }
  return (store?.levels ?? []).map((l) => ({ id: l.id || 'L:' + l.name, name: l.name || (l.id ?? '?') }));
}

function initQuestsPanel(panel: HTMLElement): void {
  let store: QuestStore = { quests: [] };
  let sel: string | null = null;
  // Довідники для селектів (вантажимо один раз, перемальовуємо панель, коли приїхали).
  let chars: { id: string; name: string }[] = [];
  let locs: { id: string; name: string }[] = [];
  let nodes: { id: string; label: string }[] = [];
  let levels: { id: string; name: string }[] = [];

  let saveTimer = 0;
  const save = (): void => {
    store.updatedAt = Date.now();
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => { void idbSet('zag_quests', store); }, 250);
  };
  const touch = (q: Quest): void => { q.updatedAt = Date.now(); save(); pushQuest(q); };
  const charOpts = (): [string, string][] => [NONE_OPT, ...chars.map((c) => [c.id, c.name] as [string, string])];
  const locOpts = (): [string, string][] => [NONE_OPT, ...locs.map((l) => [l.id, l.name] as [string, string])];
  const nodeOpts = (): [string, string][] => [NONE_OPT, ...nodes.map((n) => [n.id, n.label] as [string, string])];
  const lvlOpts = (): [string, string][] => [NONE_OPT, ...levels.map((l) => [l.id, l.name] as [string, string])];
  const itemOpts = (): [string, string][] => [NONE_OPT, ...CATALOG.map((i) => [i.id, i.name] as [string, string])];

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

  // Хто дає (НПС) + діалог видачі — для способів отримання через персонажа.
  function npcRows(q: Quest): HTMLElement {
    const box = document.createElement('div'); box.style.cssText = 'display:flex;flex-direction:column;gap:6px';
    const giver = document.createElement('select'); giver.style.cssText = INPUT_CSS;
    for (const [v, l] of charOpts()) { const o = document.createElement('option'); o.value = v; o.textContent = l; giver.appendChild(o); }
    giver.value = q.giver ?? '';
    box.appendChild(fieldWrap('Хто дає (НПС)', giver));
    const dlg = document.createElement('select'); dlg.style.cssText = INPUT_CSS;
    box.appendChild(fieldWrap('Діалог видачі (кінцівка positive = взяти)', dlg));
    const fillDialogs = async (charId: string): Promise<void> => {
      dlg.innerHTML = '';
      const d0 = document.createElement('option'); d0.value = ''; d0.textContent = '— перший наявний'; dlg.appendChild(d0);
      if (!charId) return;
      let docs: DialogDoc[] = [];
      try { const local = await idbGet<DialogDoc[]>(dialogsKey(charId)); if (Array.isArray(local)) docs = local; } catch { /* ignore */ }
      try { const pub = await loadPublishedDialogs(); for (const d of pub[charId] ?? []) if (!docs.some((x) => x.id === d.id)) docs.push(d); } catch { /* ignore */ }
      for (const d of docs) { const o = document.createElement('option'); o.value = d.id; o.textContent = `${d.id} — ${d.name}`; dlg.appendChild(o); }
      dlg.value = q.dialogId ?? '';
    };
    void fillDialogs(giver.value);
    giver.addEventListener('change', () => { q.giver = giver.value || undefined; touch(q); void fillDialogs(giver.value); });
    dlg.addEventListener('change', () => { q.dialogId = dlg.value || undefined; touch(q); });
    return box;
  }

  // Конфіг способу отримання — залежить від q.acq.
  function acqConfig(q: Quest): HTMLElement {
    const box = document.createElement('div'); box.style.cssText = 'display:flex;flex-direction:column;gap:6px';
    const acq: QuestAcq = q.acq ?? (q.giver ? 'tg_encounter' : 'auto');
    if (acq === 'tg_encounter' || acq === 'location_npc' || acq === 'board') {
      box.appendChild(selRow('Локація', locOpts(), q.locationId ?? '', (v) => { q.locationId = v || undefined; touch(q); }));
    }
    if (acq === 'travel') {
      box.appendChild(selRow('Звідки (вузол)', nodeOpts(), q.edgeFrom ?? '', (v) => { q.edgeFrom = v || undefined; touch(q); }));
      box.appendChild(selRow('Куди (вузол)', nodeOpts(), q.edgeTo ?? '', (v) => { q.edgeTo = v || undefined; touch(q); }));
    }
    if (acq === 'level') {
      box.appendChild(selRow('Рівень', lvlOpts(), q.levelId ?? '', (v) => { q.levelId = v || undefined; touch(q); }));
      box.appendChild(textRow('Тригер у рівні (необовʼязково)', q.triggerId, (v) => { q.triggerId = v || undefined; touch(q); }));
    }
    if (acq === 'item') {
      box.appendChild(selRow('Предмет-тригер', itemOpts(), q.itemId ?? '', (v) => { q.itemId = v || undefined; touch(q); }));
    }
    if (acq === 'chain') {
      const opts: [string, string][] = [NONE_OPT, ...store.quests.filter((x) => x.id !== q.id).map((x) => [x.id, x.title || x.id] as [string, string])];
      box.appendChild(selRow('Після квесту', opts, q.prevQuestId ?? '', (v) => { q.prevQuestId = v || undefined; touch(q); }));
    }
    if (acq === 'tg_encounter' || acq === 'location_npc' || acq === 'travel' || acq === 'level') {
      box.appendChild(npcRows(q));
    }
    return box;
  }

  // Рядок однієї цілі (кроку) квесту.
  function objectiveRow(q: Quest, o: QuestObjective): HTMLElement {
    const row = document.createElement('div');
    row.style.cssText = 'border:1px solid var(--line);border-radius:6px;padding:6px;display:flex;flex-direction:column;gap:4px';
    row.appendChild(selRow('Тип кроку', OBJ_OPTS, o.kind, (v) => { o.kind = v as ObjectiveKind; touch(q); renderProps(); }));
    if (o.kind === 'talk' || o.kind === 'kill' || o.kind === 'escort') {
      row.appendChild(selRow('Кого', charOpts(), o.target ?? '', (v) => { o.target = v || undefined; touch(q); }));
    } else if (o.kind === 'reach') {
      row.appendChild(selRow('Куди', nodeOpts(), o.target ?? '', (v) => { o.target = v || undefined; touch(q); }));
    } else if (o.kind === 'collect') {
      row.appendChild(selRow('Предмет', itemOpts(), o.target ?? '', (v) => { o.target = v || undefined; touch(q); }));
    }
    if (o.kind === 'kill' || o.kind === 'collect' || o.kind === 'survive') {
      row.appendChild(numRow(o.kind === 'survive' ? 'Скільки секунд' : 'Скільки', o.count, (v) => { o.count = v; touch(q); }));
    }
    row.appendChild(textRow('Опис на дошці', o.desc, (v) => { o.desc = v; touch(q); }));
    const del = document.createElement('button'); del.textContent = '– крок';
    del.style.cssText = 'align-self:flex-end;font-size:11px;padding:2px 8px';
    del.addEventListener('click', () => { q.objectives = (q.objectives ?? []).filter((x) => x !== o); touch(q); renderProps(); });
    row.appendChild(del);
    return row;
  }

  function renderProps(): void {
    const q = store.quests.find((x) => x.id === sel);
    if (!q) { props.style.display = 'none'; return; }
    props.style.display = 'flex';
    props.innerHTML = '';

    // ── Основне ──
    props.appendChild(textRow('Назва (на нотатці дошки)', q.title, (v) => { q.title = v; touch(q); renderList(); }));
    props.appendChild(lbl('Текст (розгортається по кліку на нотатку)'));
    const text = document.createElement('textarea');
    text.style.cssText = INPUT_CSS + ';min-height:90px;resize:vertical'; text.value = q.text;
    text.addEventListener('input', () => { q.text = text.value; touch(q); });
    props.appendChild(text);
    props.appendChild(selRow('Тип', [['main', 'Головний'], ['side', 'Побічний']], q.cat, (v) => { q.cat = v as Quest['cat']; touch(q); renderList(); }));

    // ── Отримання ──
    props.appendChild(sectionEl('ОТРИМАННЯ'));
    props.appendChild(selRow('Спосіб', ACQ_OPTS, q.acq ?? (q.giver ? 'tg_encounter' : 'auto'), (v) => { q.acq = v as QuestAcq; touch(q); renderProps(); }));
    props.appendChild(acqConfig(q));

    // ── Виконання ──
    props.appendChild(sectionEl('ВИКОНАННЯ'));
    props.appendChild(lbl('Цілі (кроки)'));
    for (const o of q.objectives ?? []) props.appendChild(objectiveRow(q, o));
    const addObj = document.createElement('button'); addObj.textContent = '+ крок';
    addObj.style.cssText = 'align-self:flex-start;font-size:11px;padding:3px 10px';
    addObj.addEventListener('click', () => { (q.objectives ??= []).push({ id: newObjectiveId(), kind: 'talk', desc: '' }); touch(q); renderProps(); });
    props.appendChild(addObj);
    props.appendChild(selRow('Умова успіху', SUCCESS_OPTS, q.successOn ?? 'objectives', (v) => { q.successOn = v as QuestSuccess; touch(q); }));
    props.appendChild(selRow('Умова провалу', FAIL_OPTS, q.failOn ?? 'none', (v) => { q.failOn = v as QuestFail; touch(q); renderProps(); }));
    if ((q.failOn ?? 'none') === 'timeout') props.appendChild(numRow('Час, сек', q.timeoutSec, (v) => { q.timeoutSec = v; touch(q); }));

    // ── Нагорода ──
    props.appendChild(sectionEl('НАГОРОДА'));
    const rw = (q.reward ??= {});
    props.appendChild(numRow('Золото', rw.gold, (v) => { rw.gold = v || undefined; touch(q); }));
    props.appendChild(numRow('Досвід', rw.xp, (v) => { rw.xp = v || undefined; touch(q); }));
    props.appendChild(selRow('Предмет', itemOpts(), rw.itemId ?? '', (v) => { rw.itemId = v || undefined; touch(q); }));
    props.appendChild(textRow('Нотатка (напр. репутація)', rw.note, (v) => { rw.note = v || undefined; touch(q); }));

    const del = document.createElement('button');
    del.textContent = 'Видалити квест';
    del.style.cssText = 'width:100%;padding:6px;font-size:12px;margin-top:10px';
    del.addEventListener('click', () => {
      if (!confirm(`Видалити «${q.title}»?`)) return;
      store.quests = store.quests.filter((x) => x.id !== q.id);
      tombstoneQuest(q.id);
      sel = null; save(); renderList(); renderProps();
    });
    props.appendChild(del);
  }

  const add = document.createElement('button');
  add.textContent = 'Новий квест';
  add.style.cssText = 'width:100%;padding:6px;font-size:12px';
  add.addEventListener('click', () => {
    const q: Quest = { id: newQuestId(), title: 'Новий квест', text: '', cat: 'side', acq: 'auto', updatedAt: Date.now() };
    store.quests.push(q); sel = q.id; save(); pushQuest(q); renderList(); renderProps();
  });

  panel.appendChild(add); panel.appendChild(list); panel.appendChild(props);

  registerPublisher(() => ({ 'public/studio-data/quests.json': JSON.stringify(store, null, 2) }));
  const refreshIfOpen = (): void => { if (sel) renderProps(); };
  void loadQuests().then((s) => { store = s; renderList(); });

  // Живі правки з гри/Літопису/іншої вкладки студії (Firebase). Застосовуємо
  // ноду лише якщо вона НОВІША за локальну копію (LWW) — так власне відлуння
  // не перетирає квест, який редагуєш просто зараз.
  watchQuestNodes((nodes) => {
    let dirty = false;
    for (const n of nodes) {
      const idx = store.quests.findIndex((x) => x.id === n.id);
      const localAt = idx >= 0 ? (store.quests[idx].updatedAt ?? 0) : -1;
      const nodeAt = n.updatedAt ?? 0;
      if ((n as { deleted?: boolean }).deleted) {
        if (idx >= 0 && nodeAt > localAt) { store.quests.splice(idx, 1); if (sel === n.id) sel = null; dirty = true; }
      } else if (nodeAt > localAt) {
        if (idx >= 0) store.quests[idx] = n as Quest; else store.quests.push(n as Quest);
        dirty = true;
      }
    }
    if (dirty) { void idbSet('zag_quests', store); renderList(); refreshIfOpen(); }
  });
  void loadCharLibrary().then((lib) => { chars = lib.filter((x) => x.cat === 'enemy' || x.cat === 'neutral' || x.cat === 'char').map((c) => ({ id: c.id, name: c.name })); refreshIfOpen(); });
  void loadLocationsForGame().then((l) => { locs = l.map((x) => ({ id: x.id, name: x.name })); refreshIfOpen(); }).catch(() => {});
  void loadWorldsForGame().then((ws) => { nodes = ws.flatMap((w) => w.nodes.map((n) => ({ id: n.id, label: n.label || n.id }))); refreshIfOpen(); }).catch(() => {});
  void loadLevelsList().then((ls) => { levels = ls; refreshIfOpen(); }).catch(() => {});
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
