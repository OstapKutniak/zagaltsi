'use strict';
/* Літопис — текстовий симулятор і редактор квестів світу Загальців.
   Усе локально (localStorage), окремо від гри. Болванка світу засіяна з worlds.json
   (регіон Тихоплав: 12 локацій + описи + шляхи), плюс кілька будівель/НПС/квест —
   далі все редагується прямо тут кнопками. */

const KEY = 'zag_litopys_v1';
const uid = (p) => (p || 'x') + Math.random().toString(36).slice(2, 8);

// ── Болванка світу (засів) ───────────────────────────────────────────────────
function seed() {
  // Локації Тихоплаву з worlds.json (назва + опис).
  const L = (id, name, desc, buildings, paths) => ({ id, name, desc, buildings: buildings || [], paths: paths || [] });
  const npc = (name, lines, actions) => ({ id: uid('npc'), name, lines: lines || [''], actions: actions || [] });
  const bld = (name, desc, npcs) => ({ id: uid('bld'), name, desc: desc || '', npcs: npcs || [] });
  const act = (label, say) => ({ id: uid('act'), label, say: say || '' });
  const path = (to, enc) => ({ to, encounter: enc || null });

  const locations = [
    L('n_peresolykha', 'Пересолиха', 'Село чумаків. Тут солять усе — рибу, гриби й чутки.',
      [ bld('Соляна комора', 'Діжки з сіллю попід стелю. Пахне морем, якого тут ніхто не бачив.',
          [ npc('Чумак Свирид', ['Сіль? Є. Але дешевше — чутки.', 'Кажи, чого прийшов.'],
              [ act('Купити чутку', 'Кажуть, у Полудневій Заводі знову недолічились дитини.'),
                act('Спитати про дорогу', 'До Греблі — понад ровом. Тільки не вночі, чуєш?') ]) ]) ],
      [ path('n_hreblya'), path('n_krynytsia') ]),

    L('n_hreblya', 'Гребля Мельника', 'Млин, що меле не зерно, а туман.',
      [ bld('Млин', 'Колесо крутиться, хоч води під ним давно нема.',
          [ npc('Мельник', ['Заходь, як не боїшся борошна, що не з зерна.'],
              [ act('Спитати, що він меле', 'Те, що люди хочуть забути. За це й платять.') ]) ]) ],
      [ path('n_peresolykha'), path('n_dub'), path('n_korchma') ]),

    L('n_dub', 'Дуб-Боржник', 'У дупло кидали монети на удачу. Тепер він вимагає борг.',
      [ bld('Дупло', 'Темна щілина в стовбурі. Зсередини тягне холодом і мідяками.',
          [ npc('Голос із дупла', ['Ти кидав монету. Я пам’ятаю.', 'Борг зростає щоночі.'],
              [ act('Віддати монету', 'Мало. Але поки що досить.'),
                act('Піти геть', 'Я зачекаю. Я вмію чекати.') ]) ]) ],
      [ path('n_hreblya'), path('n_balka'), path('n_duplyany') ]),

    L('n_balka', 'Дідова Балка', 'Межовий дід. Носи дари — і межі вночі не зсунуться.',
      [ bld('Межовий камінь', 'Старий камінь із витесаним хрестом-стрілкою.',
          [ npc('Межовий дід', ['Дар приніс? Ні? То й межа твоя — не твоя.'],
              [ act('Покласти хліб', 'Добре. Цієї ночі поле лишиться там, де було.') ]) ]) ],
      [ path('n_dub') ]),

    L('n_krynytsia', 'Криниця-Повторюшка', 'Віддає не воду, а слова. Уночі відповідає сама.',
      [ bld('Цямрина', 'Обкладена мокрим каменем. Знизу — не видно дна.',
          [ npc('Відлуння', ['…хто там? хто там? хто там?'],
              [ act('Назвати ім’я', '…назад воно вже не твоє.') ]) ]) ],
      [ path('n_peresolykha'), path('n_korchma') ]),

    L('n_korchma', 'Корчма при Броді', 'Вдовиця Ярина наливає. Хтось каже — останню.',
      [ bld('Шинок', 'Тепло, чадно, пахне юшкою й свічкою за упокій.',
          [ npc('Вдовиця Ярина', ['Сідай, чужинцю. Остання чарка — за рахунок закладу.', 'Тільки не питай, чия.'],
              [ act('Спитати про Дуб-Боржник', 'Той дуб? Не ходи туди з порожніми руками. Він рахує.'),
                act('Замовити ще', 'Наливаю. Але це вже твій борг.') ]) ]) ],
      [ path('n_hreblya'), path('n_krynytsia'),
        path('n_duplyany'),
        path('n_zavod', { who: 'Заплакана молодиця', line: 'Пане… ви не бачили мою Одарку? Вона пішла по воду опівдні й не вернулась.' }) ]),

    L('n_duplyany', 'Дупляни', 'Село бортників. Мед, віск і мовчазна віра.',
      [ bld('Хата господаря', 'На покуті — образ, завішений рушником. Господар не підводить очей.',
          [ npc('Господар Панас', ['Худоба втекла вночі. Уся. Наче хтось відчинив і покликав.'],
              [ act('Взятися відшукати', 'Дякую, чоловіче. Слід повів на Пасіку.') ]) ]) ],
      [ path('n_korchma'), path('n_dub'), path('n_pasika'), path('n_brody') ]),

    L('n_pasika', 'Пасіка-Борть', 'Борті розорено. Слід — майже на двох ногах.',
      [ bld('Розорена борть', 'Колоди розтрощені, віск здертий пазурами завбільшки з долоню.', []) ],
      [ path('n_duplyany'), path('n_bahno') ]),

    L('n_zavod', 'Полуднева Заводь', 'Опівдні біля води зникають діти.',
      [ bld('Очеретяний берег', 'Вода стоїть, як олива. Опівдні тінь під нею не збігається з твоєю.', []) ],
      [ path('n_korchma'), path('n_brody') ]),

    L('n_brody', 'Гнилі Броди', 'Затонуле село. В очереті хтось тріщить надвечір.',
      [ bld('Очерет', 'Стебла вищі за людину. Десь усередині — рух.',
          [ npc('Хтось у очереті', ['*тріск… тріск…*'],
              [ act('Підійти ближче', '*тиша. а тоді — сплеск за спиною.*') ]) ]) ],
      [ path('n_zavod'), path('n_duplyany'), path('n_kaplytsia') ]),

    L('n_kaplytsia', 'Капличка-на-палях', 'Стоїть посеред води, бо на сушу її не пускає.',
      [ bld('Капличка', 'Хилиться на палях. Свічка всередині горить, хоч зайти нема кому.', []) ],
      [ path('n_brody'), path('n_bahno') ]),

    L('n_bahno', 'Солоне Багно', 'Сіль виступає інеєм, що не тане. Тут загрузла валка.',
      [ bld('Загрузла валка', 'Вози по осі в солоній твані. Волів нема — тільки збруя.', []) ],
      [ path('n_pasika'), path('n_kaplytsia') ]),
  ];

  const quests = [
    { id: uid('q'), title: 'Худоба втекла!', cat: 'побічний', steps: [
      { text: 'Поговорити з господарем Панасом у Дуплянах', done: false },
      { text: 'Піти слідом на Пасіку-Борть', done: false },
      { text: 'Здолати те, що чинить розор', done: false },
      { text: 'Повернути худобу — забрати нагороду', done: false },
    ] },
  ];

  return { title: 'Тихоплав', startId: 'n_korchma', locations, quests };
}

// ── Сховище ──────────────────────────────────────────────────────────────────
function load() {
  try { const s = localStorage.getItem(KEY); if (s) return JSON.parse(s); } catch (e) { /* ignore */ }
  const w = seed(); save(w); return w;
}
function save(w) { try { localStorage.setItem(KEY, JSON.stringify(w || W)); } catch (e) { /* ignore */ } }

let W = load();
const ui = { route: { t: 'location', id: W.startId }, history: [], edit: false, tab: 'play' };

// ── Хелпери ──────────────────────────────────────────────────────────────────
const $ = (s) => document.querySelector(s);
const view = () => $('#view');
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const locById = (id) => W.locations.find((l) => l.id === id);
const bldById = (loc, bid) => (loc.buildings || []).find((b) => b.id === bid);
const npcById = (b, nid) => (b.npcs || []).find((n) => n.id === nid);

// ── Навігація з анімацією ────────────────────────────────────────────────────
function go(route, dir) {
  if (ui.route) ui.history.push(ui.route);
  ui.route = route;
  render(dir || 'r');
  syncTab();
}
function back() {
  if (!ui.history.length) return;
  ui.route = ui.history.pop();
  render('l');
  syncTab();
}
function replace(route) { ui.route = route; render('f'); syncTab(); }

function syncTab() {
  const t = ui.route.t;
  ui.tab = (t === 'quests' || t === 'quest') ? 'quests' : (t === 'map') ? 'map' : 'play';
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('on', b.dataset.tab === ui.tab));
  const bb = $('#btn-back');
  bb.classList.toggle('hidden', ui.history.length === 0);
}

function render(dir) {
  const v = view();
  v.className = 'view'; // reset
  const r = ui.route;
  let html = '';
  if (r.t === 'location') html = renderLocation(r);
  else if (r.t === 'building') html = renderBuilding(r);
  else if (r.t === 'npc') html = renderNpc(r);
  else if (r.t === 'encounter') html = renderEncounter(r);
  else if (r.t === 'quests') html = renderQuests();
  else if (r.t === 'quest') html = renderQuest(r);
  else if (r.t === 'map') html = renderMap();
  v.innerHTML = html;
  // reflow + анімація
  void v.offsetWidth;
  v.classList.add(dir === 'l' ? 'enter-l' : dir === 'f' ? 'enter-f' : 'enter-r');
  v.scrollTop = 0;
  setCrumbs();
}

function setCrumbs() {
  const r = ui.route; let c = '';
  if (r.t === 'location') c = `<b>${esc(locById(r.id) ? locById(r.id).name : '?')}</b>`;
  else if (r.t === 'building') { const l = locById(r.locId), b = bldById(l, r.bId); c = `${esc(l.name)} · <b>${esc(b ? b.name : '?')}</b>`; }
  else if (r.t === 'npc') { const l = locById(r.locId), b = bldById(l, r.bId), n = npcById(b, r.nId); c = `${esc(b.name)} · <b>${esc(n ? n.name : '?')}</b>`; }
  else if (r.t === 'encounter') c = `<b>По дорозі…</b>`;
  else if (r.t === 'quests') c = `<b>Квести</b>`;
  else if (r.t === 'quest') c = `<b>${esc((W.quests.find((q) => q.id === r.id) || {}).title || '')}</b>`;
  else if (r.t === 'map') c = `<b>Локації · ${esc(W.title)}</b>`;
  $('#crumbs').innerHTML = c;
}

// data-edit елемент: клас editable + збережений опис поля
function ed(attr, tag, cls, text, ph) {
  const t = text && String(text).length ? esc(text) : (ui.edit ? `<span style="opacity:.5">${esc(ph || 'дописати…')}</span>` : '');
  return `<${tag} class="${cls} editable" data-edit="${attr}">${t}</${tag}>`;
}

// ── Вью: Локація ─────────────────────────────────────────────────────────────
function renderLocation(r) {
  const l = locById(r.id); if (!l) return `<div class="empty">Локації нема</div>`;
  let h = editBanner();
  h += ed(`loc:${l.id}:name`, 'div', 'title', l.name, 'Назва локації');
  h += ed(`loc:${l.id}:desc`, 'div', 'narr', l.desc, 'Опис локації — що бачить гравець');

  // Споруди
  h += `<div class="section-label">Споруди</div>`;
  (l.buildings || []).forEach((b) => {
    h += `<div class="card" data-go="building:${l.id}:${b.id}">
      <div class="glyph">◈</div>
      <div class="body"><div class="name">${esc(b.name)}</div>${b.desc ? `<div class="meta">${esc(b.desc)}</div>` : ''}</div>
      ${ui.edit ? `<button class="del-btn edit-only" data-del="bld:${l.id}:${b.id}">✕</button>` : '<div class="chev">›</div>'}
    </div>`;
  });
  if (!(l.buildings || []).length && !ui.edit) h += `<div class="meta" style="color:var(--dim);font-family:var(--serif);padding:2px 4px 8px">Тут поки порожньо.</div>`;
  h += `<div class="card add edit-only" data-add="bld:${l.id}"><div class="name">＋ Споруда</div></div>`;

  // Шляхи
  h += `<div class="section-label">Шляхи</div>`;
  (l.paths || []).forEach((p, i) => {
    const dst = locById(p.to);
    h += `<div class="card path" data-go="travel:${l.id}:${i}">
      <div class="glyph">↝</div>
      <div class="body"><div class="name">${esc(dst ? dst.name : '?')}</div>
        <div class="meta">${p.encounter ? 'дорогою — зустріч' : 'дорога вільна'}</div></div>
      ${ui.edit ? `<button class="del-btn edit-only" data-del="path:${l.id}:${i}">✕</button>` : '<div class="chev">›</div>'}
    </div>`;
  });
  h += `<div class="card add edit-only" data-add="path:${l.id}"><div class="name">＋ Шлях</div></div>`;
  return h;
}

// ── Вью: Споруда ─────────────────────────────────────────────────────────────
function renderBuilding(r) {
  const l = locById(r.locId), b = bldById(l, r.bId); if (!b) return `<div class="empty">Споруди нема</div>`;
  let h = editBanner();
  h += ed(`bld:${l.id}:${b.id}:name`, 'div', 'title', b.name, 'Назва споруди');
  h += ed(`bld:${l.id}:${b.id}:desc`, 'div', 'narr', b.desc, 'Опис споруди зсередини');
  h += `<div class="section-label">Мешканці</div>`;
  (b.npcs || []).forEach((n) => {
    h += `<div class="card" data-go="npc:${l.id}:${b.id}:${n.id}">
      <div class="glyph">☗</div>
      <div class="body"><div class="name">${esc(n.name)}</div>
        <div class="meta">${esc((n.lines && n.lines[0]) || '')}</div></div>
      ${ui.edit ? `<button class="del-btn edit-only" data-del="npc:${l.id}:${b.id}:${n.id}">✕</button>` : '<div class="chev">›</div>'}
    </div>`;
  });
  if (!(b.npcs || []).length && !ui.edit) h += `<div class="meta" style="color:var(--dim);font-family:var(--serif);padding:2px 4px 8px">Нікого.</div>`;
  h += `<div class="card add edit-only" data-add="npc:${l.id}:${b.id}"><div class="name">＋ Мешканець</div></div>`;
  return h;
}

// ── Вью: НПС / діалог ────────────────────────────────────────────────────────
function renderNpc(r) {
  const l = locById(r.locId), b = bldById(l, r.bId), n = npcById(b, r.nId); if (!n) return `<div class="empty">Нема кого</div>`;
  let h = editBanner();
  h += ed(`npc:${l.id}:${b.id}:${n.id}:name`, 'div', 'title', n.name, 'Ім’я');
  (n.lines || []).forEach((ln, i) => {
    h += `<div class="line npc"><div class="who">каже</div>`;
    h += ed(`line:${l.id}:${b.id}:${n.id}:${i}`, 'div', 'text', ln, 'Репліка');
    h += (ui.edit ? `<button class="del-btn edit-only" data-del="line:${l.id}:${b.id}:${n.id}:${i}">✕</button>` : '') + `</div>`;
  });
  h += `<div class="card add edit-only" data-add="line:${l.id}:${b.id}:${n.id}"><div class="name">＋ Репліка</div></div>`;

  h += `<div class="section-label">Дії / відповіді</div>`;
  (n.actions || []).forEach((a) => {
    h += `<div class="editable choice" data-edit="act:${l.id}:${b.id}:${n.id}:${a.id}:label" data-say="${a.id}">
      <span class="arrow">▸</span>${esc(a.label)}</div>`;
    if (ui.edit) h += `<div class="line player"><div class="who">відповідь</div>${ed(`act:${l.id}:${b.id}:${n.id}:${a.id}:say`, 'div', 'text', a.say, 'Що станеться / що скаже у відповідь')}<button class="del-btn edit-only" data-del="act:${l.id}:${b.id}:${n.id}:${a.id}">✕</button></div>`;
  });
  h += `<div class="card add edit-only" data-add="act:${l.id}:${b.id}:${n.id}"><div class="name">＋ Дія</div></div>`;
  return h;
}

// ── Вью: дорожня зустріч ─────────────────────────────────────────────────────
function renderEncounter(r) {
  const l = locById(r.fromId); const p = (l.paths || [])[r.pathIdx]; const dst = locById(r.toId);
  const e = p && p.encounter ? p.encounter : { who: 'Незнайомець', line: '…' };
  let h = editBanner();
  h += `<div class="subtitle">По дорозі до ${esc(dst ? dst.name : '?')}</div>`;
  h += ed(`enc:${r.fromId}:${r.pathIdx}:who`, 'div', 'title', e.who, 'Хто перестрів');
  h += `<div class="line npc"><div class="who">каже</div>${ed(`enc:${r.fromId}:${r.pathIdx}:line`, 'div', 'text', e.line, 'Що каже')}</div>`;
  h += `<div class="section-label">Далі</div>`;
  h += `<button class="choice" data-arrive="${r.toId}"><span class="arrow">▸</span>Продовжити шлях</button>`;
  h += `<button class="choice" data-go="location:${r.fromId}"><span class="arrow">↩</span>Повернутись</button>`;
  return h;
}

// ── Вью: Квести ──────────────────────────────────────────────────────────────
function renderQuests() {
  let h = editBanner();
  h += `<div class="title">Квести</div><div class="subtitle">Ланцюги завдань — натисни, щоб розкрити й тестити.</div>`;
  (W.quests || []).forEach((q) => {
    const done = (q.steps || []).filter((s) => s.done).length;
    h += `<div class="card" data-go="quest:${q.id}">
      <div class="glyph">✦</div>
      <div class="body"><div class="name">${esc(q.title)}</div>
        <div class="meta">${esc(q.cat || 'квест')} · ${done}/${(q.steps || []).length}</div></div>
      ${ui.edit ? `<button class="del-btn edit-only" data-del="quest:${q.id}">✕</button>` : '<div class="chev">›</div>'}
    </div>`;
  });
  h += `<div class="card add edit-only" data-add="quest"><div class="name">＋ Квест</div></div>`;
  return h;
}
function renderQuest(r) {
  const q = W.quests.find((x) => x.id === r.id); if (!q) return `<div class="empty">Нема квеста</div>`;
  let h = editBanner();
  h += ed(`quest:${q.id}:title`, 'div', 'title', q.title, 'Назва квеста');
  h += `<span class="tag editable" data-edit="quest:${q.id}:cat">${esc(q.cat || 'квест')}</span>`;
  h += `<div class="section-label">Кроки</div><div class="quest">`;
  (q.steps || []).forEach((s, i) => {
    h += `<div class="step ${s.done ? 'done' : ''}" data-step="${q.id}:${i}">
      <div class="mark">${s.done ? '✓' : '○'}</div>
      <div class="editable" style="flex:1" data-edit="step:${q.id}:${i}">${esc(s.text)}</div>
      ${ui.edit ? `<button class="del-btn edit-only" data-del="step:${q.id}:${i}">✕</button>` : ''}
    </div>`;
  });
  h += `</div><div class="card add edit-only" data-add="step:${q.id}"><div class="name">＋ Крок</div></div>`;
  if (!ui.edit) h += `<div class="subtitle" style="margin-top:14px">Натисни на крок — позначити виконаним (тест ланцюга).</div>`;
  return h;
}

// ── Вью: Мапа локацій ────────────────────────────────────────────────────────
function renderMap() {
  let h = editBanner();
  h += ed(`world:title`, 'div', 'title', W.title, 'Назва краю');
  h += `<div class="subtitle">${W.locations.length} локацій. Натисни — почати мандрівку звідти.</div>`;
  W.locations.forEach((l) => {
    h += `<div class="card" data-go="location:${l.id}" data-start="${l.id}">
      <div class="glyph">⌖</div>
      <div class="body"><div class="name">${esc(l.name)}</div><div class="meta">${esc(l.desc)}</div></div>
      ${ui.edit ? `<button class="del-btn edit-only" data-del="loc:${l.id}">✕</button>` : '<div class="chev">›</div>'}
    </div>`;
  });
  h += `<div class="card add edit-only" data-add="loc"><div class="name">＋ Локація</div></div>`;
  h += `<div class="card add edit-only" data-reset><div class="name" style="color:var(--danger)">↺ Скинути болванку</div></div>`;
  return h;
}

function editBanner() {
  return ui.edit ? `<div class="edit-banner">Режим редагування: тапни будь-який текст, щоб змінити. ＋ додати, ✕ видалити.</div>` : '';
}

// ── Модалка редагування тексту ───────────────────────────────────────────────
function editText(title, cur, multiline, cb) {
  const m = $('#modal');
  m.innerHTML = `<div class="backdrop"></div><div class="sheet"><h4>${esc(title)}</h4>
    ${multiline ? `<textarea>${esc(cur)}</textarea>` : `<input type="text" value="${esc(cur)}">`}
    <div class="row"><button class="cancel">Скасувати</button><button class="save">Зберегти</button></div></div>`;
  m.classList.add('show');
  const field = m.querySelector('textarea, input');
  setTimeout(() => { field.focus(); }, 50);
  const close = () => { m.classList.remove('show'); m.innerHTML = ''; };
  m.querySelector('.backdrop').onclick = close;
  m.querySelector('.cancel').onclick = close;
  m.querySelector('.save').onclick = () => { cb(field.value); close(); save(); render('f'); };
}

// Розбір data-edit шляху й застосування нового значення
function applyEdit(pathStr) {
  const p = pathStr.split(':');
  const kind = p[0];
  const openM = (title, get, set, multi) => editText(title, get(), multi !== false, (v) => set(v));
  if (kind === 'world' && p[1] === 'title') return openM('Назва краю', () => W.title, (v) => W.title = v, false);
  if (kind === 'loc') { const l = locById(p[1]);
    if (p[2] === 'name') return openM('Назва локації', () => l.name, (v) => l.name = v, false);
    if (p[2] === 'desc') return openM('Опис локації', () => l.desc, (v) => l.desc = v, true); }
  if (kind === 'bld') { const l = locById(p[1]), b = bldById(l, p[2]);
    if (p[3] === 'name') return openM('Назва споруди', () => b.name, (v) => b.name = v, false);
    if (p[3] === 'desc') return openM('Опис споруди', () => b.desc, (v) => b.desc = v, true); }
  if (kind === 'npc') { const l = locById(p[1]), b = bldById(l, p[2]), n = npcById(b, p[3]);
    if (p[4] === 'name') return openM('Ім’я', () => n.name, (v) => n.name = v, false); }
  if (kind === 'line') { const l = locById(p[1]), b = bldById(l, p[2]), n = npcById(b, p[3]);
    return openM('Репліка', () => n.lines[+p[4]], (v) => n.lines[+p[4]] = v, true); }
  if (kind === 'act') { const l = locById(p[1]), b = bldById(l, p[2]), n = npcById(b, p[3]);
    const a = n.actions.find((x) => x.id === p[4]);
    if (p[5] === 'label') return openM('Дія (кнопка)', () => a.label, (v) => a.label = v, false);
    if (p[5] === 'say') return openM('Наслідок / відповідь', () => a.say, (v) => a.say = v, true); }
  if (kind === 'enc') { const l = locById(p[1]), pt = l.paths[+p[2]]; if (!pt.encounter) pt.encounter = { who: '', line: '' };
    if (p[3] === 'who') return openM('Хто перестрів', () => pt.encounter.who, (v) => pt.encounter.who = v, false);
    if (p[3] === 'line') return openM('Що каже', () => pt.encounter.line, (v) => pt.encounter.line = v, true); }
  if (kind === 'quest') { const q = W.quests.find((x) => x.id === p[1]);
    if (p[2] === 'title') return openM('Назва квеста', () => q.title, (v) => { q.title = v; touchQuest(q); }, false);
    if (p[2] === 'cat') return openM('Тип', () => q.cat, (v) => { q.cat = v; touchQuest(q); }, false); }
  if (kind === 'step') { const q = W.quests.find((x) => x.id === p[1]);
    return openM('Крок квеста', () => q.steps[+p[2]].text, (v) => { q.steps[+p[2]].text = v; touchQuest(q); }, true); }
}

// Додавання
function applyAdd(pathStr) {
  const p = pathStr.split(':');
  const k = p[0];
  if (k === 'bld') { const l = locById(p[1]); l.buildings.push({ id: uid('bld'), name: 'Нова споруда', desc: '', npcs: [] }); }
  else if (k === 'npc') { const b = bldById(locById(p[1]), p[2]); b.npcs.push({ id: uid('npc'), name: 'Хтось', lines: [''], actions: [] }); }
  else if (k === 'line') { const n = npcById(bldById(locById(p[1]), p[2]), p[3]); n.lines.push(''); }
  else if (k === 'act') { const n = npcById(bldById(locById(p[1]), p[2]), p[3]); n.actions.push({ id: uid('act'), label: 'Нова дія', say: '' }); }
  else if (k === 'path') { const l = locById(p[1]); const other = W.locations.find((x) => x.id !== l.id); l.paths.push({ to: other ? other.id : l.id, encounter: null }); }
  else if (k === 'loc') { const id = uid('loc'); W.locations.push({ id, name: 'Нова локація', desc: '', buildings: [], paths: [] }); }
  else if (k === 'quest') { const q = { id: uid('q'), title: 'Новий квест', cat: 'побічний', steps: [] }; W.quests.push(q); pushQuestToFb(q); }
  else if (k === 'step') { const q = W.quests.find((x) => x.id === p[1]); q.steps.push({ text: 'Новий крок', done: false }); pushQuestToFb(q); }
  save(); render('f');
}

// Видалення
function applyDel(pathStr) {
  const p = pathStr.split(':');
  const k = p[0];
  if (k === 'bld') { const l = locById(p[1]); l.buildings = l.buildings.filter((b) => b.id !== p[2]); }
  else if (k === 'npc') { const b = bldById(locById(p[1]), p[2]); b.npcs = b.npcs.filter((n) => n.id !== p[3]); }
  else if (k === 'line') { const n = npcById(bldById(locById(p[1]), p[2]), p[3]); n.lines.splice(+p[4], 1); }
  else if (k === 'act') { const n = npcById(bldById(locById(p[1]), p[2]), p[3]); n.actions = n.actions.filter((a) => a.id !== p[4]); }
  else if (k === 'path') { const l = locById(p[1]); l.paths.splice(+p[2], 1); }
  else if (k === 'loc') { W.locations = W.locations.filter((l) => l.id !== p[1]); }
  else if (k === 'quest') { W.quests = W.quests.filter((q) => q.id !== p[1]); tombstoneQuestFb(p[1]); }
  else if (k === 'step') { const q = W.quests.find((x) => x.id === p[1]); q.steps.splice(+p[2], 1); pushQuestToFb(q); }
  save(); render('f');
}

// ── Делеговані кліки ──────────────────────────────────────────────────────────
view().addEventListener('click', (e) => {
  const editEl = e.target.closest('[data-edit]');
  const goEl = e.target.closest('[data-go]');
  const delEl = e.target.closest('[data-del]');
  const addEl = e.target.closest('[data-add]');
  const arriveEl = e.target.closest('[data-arrive]');
  const stepEl = e.target.closest('[data-step]');
  const resetEl = e.target.closest('[data-reset]');

  if (ui.edit && delEl) { e.stopPropagation(); return applyDel(delEl.dataset.del); }
  if (ui.edit && addEl) { e.stopPropagation(); return applyAdd(addEl.dataset.add); }
  if (ui.edit && resetEl) { if (confirm('Скинути болванку до початкової? Твої правки зникнуть.')) { W = seed(); save(); ui.history = []; ui.route = { t: 'map' }; render('f'); } return; }
  // У режимі редагування текст → модалка (навіть якщо це choice/картка)
  if (ui.edit && editEl) { e.stopPropagation(); return applyEdit(editEl.dataset.edit); }
  if (ui.edit) return; // у редагуванні навігацію по картках вимикаємо (крім вище)

  // Гра
  if (arriveEl) return replace({ t: 'location', id: arriveEl.dataset.arrive });
  if (stepEl) { const [qid, i] = stepEl.dataset.step.split(':'); const q = W.quests.find((x) => x.id === qid); q.steps[+i].done = !q.steps[+i].done; save(); render('f'); return; }

  // Показ наслідку дії НПС
  const say = e.target.closest('[data-say]');
  if (say && !ui.edit) {
    const n = findNpcByRoute(); const a = n && n.actions.find((x) => x.id === say.dataset.say);
    if (a && a.say) { flashSay(a.say); return; }
  }

  if (goEl) {
    const parts = goEl.dataset.go.split(':');
    const t = parts[0];
    if (goEl.dataset.start) ui.history = []; // старт мандрівки з мапи
    if (t === 'building') return go({ t: 'building', locId: parts[1], bId: parts[2] });
    if (t === 'npc') return go({ t: 'npc', locId: parts[1], bId: parts[2], nId: parts[3] });
    if (t === 'location') return go({ t: 'location', id: parts[1] });
    if (t === 'quest') return go({ t: 'quest', id: parts[1] });
    if (t === 'travel') { // шлях: локація+індекс
      const l = locById(parts[1]); const idx = +parts[2]; const p = l.paths[idx];
      if (p.encounter) return go({ t: 'encounter', fromId: parts[1], toId: p.to, pathIdx: idx });
      return go({ t: 'location', id: p.to });
    }
  }
});

function findNpcByRoute() {
  const r = ui.route; if (r.t !== 'npc') return null;
  const b = bldById(locById(r.locId), r.bId); return npcById(b, r.nId);
}
// Спливна відповідь НПС (тимчасова)
function flashSay(text) {
  const m = $('#modal');
  m.innerHTML = `<div class="backdrop"></div><div class="sheet"><div class="line npc"><div class="who">у відповідь</div><div class="text">${esc(text)}</div></div><div class="row"><button class="save">Далі</button></div></div>`;
  m.classList.add('show');
  const close = () => { m.classList.remove('show'); m.innerHTML = ''; };
  m.querySelector('.backdrop').onclick = close; m.querySelector('.save').onclick = close;
}

// ── Топбар / вкладки / edit ───────────────────────────────────────────────────
$('#btn-back').addEventListener('click', back);
$('#btn-edit').addEventListener('click', () => {
  ui.edit = !ui.edit;
  document.body.classList.toggle('editing', ui.edit);
  $('#btn-edit').classList.toggle('on', ui.edit);
  render('f');
});
document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => {
  const t = b.dataset.tab;
  ui.history = [];
  if (t === 'play') ui.route = { t: 'location', id: W.startId };
  else if (t === 'quests') ui.route = { t: 'quests' };
  else if (t === 'map') ui.route = { t: 'map' };
  render('f'); syncTab();
}));

// Свайп праворуч = назад
(function swipe() {
  const st = $('#stage'); let x0 = null, y0 = null, t0 = 0;
  st.addEventListener('touchstart', (e) => { const t = e.touches[0]; x0 = t.clientX; y0 = t.clientY; t0 = Date.now(); }, { passive: true });
  st.addEventListener('touchend', (e) => {
    if (x0 == null) return; const t = e.changedTouches[0];
    const dx = t.clientX - x0, dy = t.clientY - y0;
    if (dx > 70 && Math.abs(dy) < 50 && (Date.now() - t0) < 600 && x0 < 60) back();
    x0 = null;
  }, { passive: true });
})();

// ── Синхронізація КВЕСТІВ із грою та студією (Firebase REST) ───────────────────
// Спільний живий шар: content/quests/{id} = ігровий Quest із updatedAt. Літопис
// пише сюди на кожну правку квесту й підтягує чужі правки (студія/гра) поллінгом.
// Мердж — по кожному квесту (LWW за updatedAt). SDK не потрібен — чистий REST.
const FB_DB = 'https://horugva-ff8bd-default-rtdb.europe-west1.firebasedatabase.app';
const QPATH = FB_DB + '/content/quests';

const catToGame = (c) => /голов|основн/i.test(c || '') ? 'main' : 'side';
const catFromGame = (c) => c === 'main' ? 'головний' : 'побічний';

// Літопис-квест → ігровий Quest. Літопис редагує лише title/text/cat/кроки —
// решту багатих полів (acq, локація, нагорода, тип/ціль кроку) НЕ знає, тож
// НЕ затираємо їх: стартуємо з останньої відомої ігрової ноди (q._game) і
// накладаємо зверху лише свої поля. Нові квести Літопису → acq 'auto'.
function questToGame(q) {
  const base = q._game ? JSON.parse(JSON.stringify(q._game)) : {};
  const prevObjs = base.objectives || [];
  const objectives = (q.steps || []).map((s, i) => {
    const id = s.oid || (q.id + '_o' + i);
    const prev = prevObjs.find((o) => o.id === id) || {};
    return Object.assign({}, prev, { id, kind: prev.kind || 'custom', desc: s.text || '' });
  });
  delete base.deleted;
  return Object.assign(base, {
    id: q.id, title: q.title || '', text: q.text || '', cat: catToGame(q.cat),
    acq: base.acq || 'auto', objectives, successOn: base.successOn || 'objectives', updatedAt: Date.now(),
  });
}
// Ігровий Quest → Літопис-квест. Зберігаємо локальні done по збігу oid; повну
// ноду ховаємо в _game, щоб зворотний пуш не втратив багаті поля студії.
function questFromGame(node, prev) {
  const ps = (prev && prev.steps) || [];
  return {
    id: node.id, title: node.title || '', text: node.text || '', cat: catFromGame(node.cat),
    steps: (node.objectives || []).map((o) => {
      const was = ps.find((s) => s.oid === o.id);
      return { oid: o.id, text: o.desc || '', done: !!(was && was.done) };
    }),
    updatedAt: node.updatedAt || 0, _game: node,
  };
}

function pushQuestToFb(q) {
  const node = questToGame(q);
  q.updatedAt = node.updatedAt; // локальний стамп == нода → пул не відлунює назад
  fetch(`${QPATH}/${q.id}.json`, { method: 'PUT', body: JSON.stringify(node) }).catch(() => {});
}
function tombstoneQuestFb(id) {
  fetch(`${QPATH}/${id}.json`, { method: 'PUT', body: JSON.stringify({ id, deleted: true, updatedAt: Date.now() }) }).catch(() => {});
}
function touchQuest(q) { pushQuestToFb(q); save(); }

// Підтягнути чужі правки квестів і змерджити (LWW). Оновлює вью, якщо відкрито квести.
async function pullQuests() {
  let val = null;
  try { const r = await fetch(`${QPATH}.json`); if (r.ok) val = await r.json(); } catch (e) { return; }
  if (!val || typeof val !== 'object') return;
  let dirty = false;
  for (const node of Object.values(val)) {
    if (!node || typeof node !== 'object' || !node.id) continue;
    const idx = W.quests.findIndex((x) => x.id === node.id);
    const localAt = idx >= 0 ? (W.quests[idx].updatedAt || 0) : -1;
    const nodeAt = node.updatedAt || 0;
    if (node.deleted) {
      if (idx >= 0 && nodeAt > localAt) { W.quests.splice(idx, 1); dirty = true; }
    } else if (nodeAt > localAt) {
      const conv = questFromGame(node, idx >= 0 ? W.quests[idx] : null);
      if (idx >= 0) W.quests[idx] = conv; else W.quests.push(conv);
      dirty = true;
    }
  }
  if (dirty) {
    save();
    if (ui.route.t === 'quests' || ui.route.t === 'quest') {
      if (ui.route.t === 'quest' && !W.quests.some((q) => q.id === ui.route.id)) ui.route = { t: 'quests' };
      render('f'); syncTab();
    }
  }
}

// ── Модалка-контейнер + SW ────────────────────────────────────────────────────
(function initModal() { const d = document.createElement('div'); d.id = 'modal'; document.body.appendChild(d); })();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

// Старт
render('f'); syncTab();
void pullQuests();
setInterval(() => { void pullQuests(); }, 6000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) void pullQuests(); });
