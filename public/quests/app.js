'use strict';
/* Літопис v2 — текстовий симулятор і редактор квестів світу Загальців.
   Усе локально (localStorage) + живий синк квестів із грою/студією через Firebase.
   v2: типізовані цілі (як у грі: talk/kill/reach/collect/survive/escort/custom),
   гілкові діалоги з діями «Видати квест»/«Здати квест» (здача — лише коли всі цілі
   виконані), вкладка «Активні квести» з галочками, дошки оголошень (плітка/завдання/
   інше), НПС просто в локації (не тільки в спорудах). */

const KEY = 'zag_litopys_v1';
const uid = (p) => (p || 'x') + Math.random().toString(36).slice(2, 8);

// Типи цілей — 1:1 з ObjectiveKind гри (src/story/quests.ts), щоб синк був прямий.
const KINDS = ['talk', 'kill', 'reach', 'collect', 'survive', 'escort', 'custom'];
const KIND_LABEL = { talk: 'поговорити', kill: 'вбити', reach: 'дійти', collect: 'зібрати', survive: 'вижити', escort: 'супроводити', custom: 'інше' };
const KIND_HAS_COUNT = { kill: true, collect: true, survive: true };

// ── Карта: координати з worlds.json (той самий світ, що в грі) ────────────────
const SEED_XY = {
  n_peresolykha: [-420, 40], n_hreblya: [-260, -60], n_dub: [-120, -160], n_balka: [-330, -190],
  n_krynytsia: [-180, 130], n_korchma: [-40, 40], n_duplyany: [120, -40], n_pasika: [250, -160],
  n_zavod: [60, 185], n_brody: [290, 120], n_kaplytsia: [460, 30], n_bahno: [470, -130],
};
const SEED_REGIONS = () => ([
  { id: 'r_tykhoplav', name: 'Тихоплав', desc: 'Загрузла заплава. Цього літа жито взялося ріжками.', x: -300, y: 60 },
  { id: 'r_verkhovyna', name: 'Верховина', desc: 'Високі полонини. Шлях туди ще не проторовано.', x: -40, y: -120 },
  { id: 'r_polonyny', name: 'Чорні Полонини', desc: 'Кажуть, там і вдень темно.', x: 230, y: -30 },
  { id: 'r_solekamin', name: 'Солекамінь', desc: 'Соляні копальні. Зачинено.', x: 40, y: 150 },
]);
const SEED_REGION_EDGES = () => ([
  { a: 'r_tykhoplav', b: 'r_verkhovyna' }, { a: 'r_verkhovyna', b: 'r_polonyny' },
  { a: 'r_tykhoplav', b: 'r_solekamin' }, { a: 'r_solekamin', b: 'r_polonyny' },
]);

// ── Болванка світу (засів) ───────────────────────────────────────────────────
function seed() {
  const L = (id, name, desc, buildings, paths, extra) => Object.assign({ id, name, desc, buildings: buildings || [], paths: paths || [], npcs: [], boards: [] }, extra || {});
  const reply = (label, say, more) => ({ id: uid('r'), label, say: say || '', replies: more || [] });
  const npc = (name, text, replies) => ({ id: uid('npc'), name, dlg: { text: text || '', replies: replies || [] } });
  const bld = (name, desc, npcs) => ({ id: uid('bld'), name, desc: desc || '', npcs: npcs || [] });
  const path = (to, enc) => ({ to, encounter: enc || null });

  // Квести (типізовані цілі). id фіксовані — на них посилаються діалоги/дошки.
  // turnin: 'dialog' = здається реплікою в НПС; 'auto' = закривається сам, щойно всі цілі.
  const q1 = { id: 'q_khudoba', title: 'Худоба втекла!', cat: 'побічний', state: 'idle', turnin: 'dialog', steps: [
    { oid: 'q_khudoba_o0', kind: 'talk', text: 'Поговорити з господарем Панасом у Дуплянах', done: false },
    { oid: 'q_khudoba_o1', kind: 'reach', text: 'Піти слідом на Пасіку-Борть', done: false },
    { oid: 'q_khudoba_o2', kind: 'kill', count: 1, text: 'Здолати те, що чинить розор', done: false },
    { oid: 'q_khudoba_o3', kind: 'custom', text: 'Повернути худобу господарю', done: false },
  ] };
  const q2 = { id: 'q_sil', title: 'Сіль із багна', cat: 'побічний', state: 'idle', turnin: 'dialog', steps: [
    { oid: 'q_sil_o0', kind: 'reach', text: 'Дістатись Солоного Багна', done: false },
    { oid: 'q_sil_o1', kind: 'collect', count: 3, text: 'Зібрати три грудки солі-інею', done: false },
    { oid: 'q_sil_o2', kind: 'talk', text: 'Віднести сіль чумаку Свириду', done: false },
  ] };

  const locations = [
    L('n_peresolykha', 'Пересолиха', 'Село чумаків. Тут солять усе — рибу, гриби й чутки.',
      [ bld('Соляна комора', 'Діжки з сіллю попід стелю. Пахне морем, якого тут ніхто не бачив.',
          [ npc('Чумак Свирид', 'Сіль? Є. Але дешевше — чутки. Кажи, чого прийшов.',
              [ reply('Купити чутку', 'Кажуть, у Полудневій Заводі знову недолічились дитини.'),
                reply('Спитати про дорогу', 'До Греблі — понад ровом. Тільки не вночі, чуєш?'),
                Object.assign(reply('Здати: Сіль із багна', 'Ого, справжня сіль-іней! Тримай пів кисета мідяків.'), { action: { type: 'turnin', questId: 'q_sil' } }) ]) ]) ],
      [ path('n_hreblya'), path('n_krynytsia') ]),

    L('n_hreblya', 'Гребля Мельника', 'Млин, що меле не зерно, а туман.',
      [ bld('Млин', 'Колесо крутиться, хоч води під ним давно нема.',
          [ npc('Мельник', 'Заходь, як не боїшся борошна, що не з зерна.',
              [ reply('Спитати, що він меле', 'Те, що люди хочуть забути. За це й платять.') ]) ]) ],
      [ path('n_peresolykha'), path('n_dub'), path('n_korchma') ]),

    L('n_dub', 'Дуб-Боржник', 'У дупло кидали монети на удачу. Тепер він вимагає борг.',
      [ bld('Дупло', 'Темна щілина в стовбурі. Зсередини тягне холодом і мідяками.',
          [ npc('Голос із дупла', 'Ти кидав монету. Я пам’ятаю. Борг зростає щоночі.',
              [ reply('Віддати монету', 'Мало. Але поки що досить.'),
                reply('Піти геть', 'Я зачекаю. Я вмію чекати.') ]) ]) ],
      [ path('n_hreblya'), path('n_balka'), path('n_duplyany') ]),

    L('n_balka', 'Дідова Балка', 'Межовий дід. Носи дари — і межі вночі не зсунуться.',
      [ bld('Межовий камінь', 'Старий камінь із витесаним хрестом-стрілкою.',
          [ npc('Межовий дід', 'Дар приніс? Ні? То й межа твоя — не твоя.',
              [ reply('Покласти хліб', 'Добре. Цієї ночі поле лишиться там, де було.') ]) ]) ],
      [ path('n_dub') ]),

    L('n_krynytsia', 'Криниця-Повторюшка', 'Віддає не воду, а слова. Уночі відповідає сама.',
      [ bld('Цямрина', 'Обкладена мокрим каменем. Знизу — не видно дна.',
          [ npc('Відлуння', '…хто там? хто там? хто там?',
              [ reply('Назвати ім’я', '…назад воно вже не твоє.') ]) ]) ],
      [ path('n_peresolykha'), path('n_korchma') ]),

    L('n_korchma', 'Корчма при Броді', 'Вдовиця Ярина наливає. Хтось каже — останню.',
      [ bld('Шинок', 'Тепло, чадно, пахне юшкою й свічкою за упокій.',
          [ npc('Вдовиця Ярина', 'Сідай, чужинцю. Остання чарка — за рахунок закладу. Тільки не питай, чия.',
              [ reply('Спитати про Дуб-Боржник', 'Той дуб? Не ходи туди з порожніми руками. Він рахує.',
                  [ reply('А якщо боргу не платити?', 'Тоді він сам прийде по своє. Коренями.') ]),
                reply('Замовити ще', 'Наливаю. Але це вже твій борг.') ]) ]) ],
      [ path('n_hreblya'), path('n_krynytsia'), path('n_duplyany'),
        path('n_zavod', { who: 'Заплакана молодиця', line: 'Пане… ви не бачили мою Одарку? Вона пішла по воду опівдні й не вернулась.' }) ],
      { boards: [ { id: 'bd_korchma', name: 'Дошка при вході', posts: [
          { id: uid('p'), kind: 'gossip', text: 'Мельник знову міняв мішки вночі. Хто бачив — мовчить.' },
          { id: uid('p'), kind: 'task', text: 'Чумакам потрібна сіль-іней із Солоного Багна. Плата чесна.', questId: 'q_sil' },
          { id: uid('p'), kind: 'note', text: 'За брід після заходу сонця корчма відповідальності не несе.' },
        ] } ] }),

    L('n_duplyany', 'Дупляни', 'Село бортників. Мед, віск і мовчазна віра.',
      [ bld('Хата господаря', 'На покуті — образ, завішений рушником. Господар не підводить очей.',
          [ npc('Господар Панас', 'Худоба втекла вночі. Уся. Наче хтось відчинив і покликав.',
              [ Object.assign(reply('Взятися відшукати', 'Дякую, чоловіче. Слід повів на Пасіку.'), { action: { type: 'give', questId: 'q_khudoba' } }),
                // Видно ЛИШЕ коли квест активний; вибір = виконати talk-ціль o0.
                Object.assign(reply('Розпитати про слід', 'Копита йшли рівно, як під вуздою. А поруч — босі ступні. Великі.'), { cond: { questId: 'q_khudoba', state: 'active' }, action: { type: 'obj', questId: 'q_khudoba', oid: 'q_khudoba_o0' } }),
                Object.assign(reply('Худоба вдома, господарю', 'Вернулась?! Ох… тримай, заслужив. І нікому не кажи, ЩО ти там бачив.'), { action: { type: 'turnin', questId: 'q_khudoba' } }) ]) ]) ],
      [ path('n_korchma'), path('n_dub'), path('n_pasika'), path('n_brody') ],
      { npcs: [ npc('Пастушок', 'Дядьку, а правда, що вночі хтось ходив селом і співав без рота?',
          [ reply('Розпитати малого', 'Я чув! Через сон. Пісня була як мамина, тільки навпаки.'),
            // Приклад репліки-за-умовою: зʼявляється лише при активній «Худобі».
            Object.assign(reply('Питав про худобу?', 'Бачив! Щось гнало корів до Пасіки, а само не ступало по землі.'), { cond: { questId: 'q_khudoba', state: 'active' } }) ]) ] }),

    L('n_pasika', 'Пасіка-Борть', 'Борті розорено. Слід — майже на двох ногах.',
      [ bld('Розорена борть', 'Колоди розтрощені, віск здертий пазурами завбільшки з долоню.', []) ],
      [ path('n_duplyany'), path('n_bahno') ]),

    L('n_zavod', 'Полуднева Заводь', 'Опівдні біля води зникають діти.',
      [ bld('Очеретяний берег', 'Вода стоїть, як олива. Опівдні тінь під нею не збігається з твоєю.', []) ],
      [ path('n_korchma'), path('n_brody') ]),

    L('n_brody', 'Гнилі Броди', 'Затонуле село. В очереті хтось тріщить надвечір.',
      [ bld('Очерет', 'Стебла вищі за людину. Десь усередині — рух.',
          [ npc('Хтось у очереті', '*тріск… тріск…*',
              [ reply('Підійти ближче', '*тиша. а тоді — сплеск за спиною.*') ]) ]) ],
      [ path('n_zavod'), path('n_duplyany'), path('n_kaplytsia') ]),

    L('n_kaplytsia', 'Капличка-на-палях', 'Стоїть посеред води, бо на сушу її не пускає.',
      [ bld('Капличка', 'Хилиться на палях. Свічка всередині горить, хоч зайти нема кому.', []) ],
      [ path('n_brody'), path('n_bahno') ]),

    L('n_bahno', 'Солоне Багно', 'Сіль виступає інеєм, що не тане. Тут загрузла валка.',
      [ bld('Загрузла валка', 'Вози по осі в солоній твані. Волів нема — тільки збруя.', []) ],
      [ path('n_pasika'), path('n_kaplytsia') ]),
  ];

  // Координати точок + належність до краю (карта регіону Тихоплав).
  for (const l of locations) {
    const c = SEED_XY[l.id];
    l.x = c ? c[0] : 0; l.y = c ? c[1] : 0;
    l.regionId = 'r_tykhoplav';
  }
  return { v: 3, title: 'Карпатський край', startId: 'n_korchma', regions: SEED_REGIONS(), regionEdges: SEED_REGION_EDGES(), locations, quests: [q1, q2] };
}

// ── Міграція старих даних у localStorage ─────────────────────────────────────
function migrate(w) {
  if (!w) return w;
  if (w.v < 2) {
    for (const l of w.locations || []) {
      l.npcs = l.npcs || [];
      l.boards = l.boards || [];
      for (const b of l.buildings || []) {
        for (const n of b.npcs || []) migrateNpc(n);
      }
      for (const n of l.npcs) migrateNpc(n);
    }
    for (const q of w.quests || []) {
      q.state = q.state || 'idle';
      q.turnin = q.turnin || 'dialog';
      for (const s of q.steps || []) { s.kind = s.kind || 'custom'; }
    }
    w.v = 2;
  }
  if (w.v < 3) {
    // Карта: глобальні краї + координати точок (відомі — з worlds.json, решта — сіткою).
    w.regions = w.regions || SEED_REGIONS();
    w.regionEdges = w.regionEdges || SEED_REGION_EDGES();
    let gi = 0;
    for (const l of w.locations || []) {
      if (l.x == null || l.y == null) {
        const c = SEED_XY[l.id];
        if (c) { l.x = c[0]; l.y = c[1]; }
        else { l.x = -350 + (gi % 5) * 180; l.y = -180 + Math.floor(gi / 5) * 150; gi++; }
      }
      l.regionId = l.regionId || 'r_tykhoplav';
    }
    w.v = 3;
  }
  return w;
}
function migrateNpc(n) {
  if (n.dlg) return;
  n.dlg = {
    text: (n.lines || []).filter(Boolean).join('\n\n'),
    replies: (n.actions || []).map((a) => ({ id: a.id || uid('r'), label: a.label || '', say: a.say || '', replies: [] })),
  };
  delete n.lines; delete n.actions;
}

// ── Сховище ──────────────────────────────────────────────────────────────────
function load() {
  try { const s = localStorage.getItem(KEY); if (s) return migrate(JSON.parse(s)); } catch (e) { /* ignore */ }
  const w = seed(); save(w); return w;
}
function save(w) {
  try { localStorage.setItem(KEY, JSON.stringify(w || W)); } catch (e) { /* ignore */ }
  schedulePushWorld(); // світ (локації/НПС/діалоги/дошки) — у спільний шар Firebase
}

let W = load();
const ui = { route: { t: 'location', id: W.startId }, history: [], edit: false, tab: 'play', mapSel: null, mapMode: null };

// ── Хелпери ──────────────────────────────────────────────────────────────────
const $ = (s) => document.querySelector(s);
const view = () => $('#view');
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const locById = (id) => W.locations.find((l) => l.id === id);
const bldById = (loc, bid) => (loc.buildings || []).find((b) => b.id === bid);
// НПС: у споруді (bId) або просто в локації (bId === '-').
function npcRef(locId, bId, nId) {
  const l = locById(locId); if (!l) return null;
  const list = bId === '-' ? (l.npcs || []) : ((bldById(l, bId) || {}).npcs || []);
  return list.find((n) => n.id === nId) || null;
}
const questById = (id) => W.quests.find((q) => q.id === id);
const questDone = (q) => (q.steps || []).length > 0 && q.steps.every((s) => s.done);
// Вузол дерева діалогу за шляхом 'r1.r2' ('' = корінь). Повертає {text, replies}.
function dlgNode(npc, pathStr) {
  let node = npc.dlg, text = npc.dlg.text;
  if (pathStr) for (const rid of pathStr.split('.')) {
    const r = (node.replies || []).find((x) => x.id === rid);
    if (!r) return { text, replies: node.replies || [], broken: true };
    text = r.say; node = r;
  }
  return { text, replies: node.replies || [] };
}
function kindChip(s, editAttr) {
  const cnt = KIND_HAS_COUNT[s.kind] && s.count ? ' ' + s.count : '';
  const cls = s.kind === 'kill' ? ' k-kill' : s.kind === 'talk' ? ' k-talk' : s.kind === 'reach' ? ' k-reach' : '';
  return `<span class="kind-chip${cls}"${editAttr ? ` data-edit="${editAttr}"` : ''}>${KIND_LABEL[s.kind] || s.kind}${cnt}</span>`;
}

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
  ui.tab = (t === 'quests' || t === 'quest') ? 'quests' : (t === 'map') ? 'map' : (t === 'active') ? 'active' : (t === 'karta') ? 'karta' : 'play';
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('on', b.dataset.tab === ui.tab));
  $('#btn-back').classList.toggle('hidden', ui.history.length === 0);
}

function render(dir) {
  const v = view();
  v.className = 'view';
  const r = ui.route;
  let html = '';
  if (r.t === 'location') html = renderLocation(r);
  else if (r.t === 'building') html = renderBuilding(r);
  else if (r.t === 'npc') html = renderNpc(r);
  else if (r.t === 'board') html = renderBoard(r);
  else if (r.t === 'encounter') html = renderEncounter(r);
  else if (r.t === 'quests') html = renderQuests();
  else if (r.t === 'quest') html = renderQuest(r);
  else if (r.t === 'active') html = renderActive();
  else if (r.t === 'karta') html = renderKarta(r);
  else if (r.t === 'map') html = renderMap();
  v.innerHTML = html;
  void v.offsetWidth;
  v.classList.add(dir === 'l' ? 'enter-l' : dir === 'f' ? 'enter-f' : 'enter-r');
  v.scrollTop = 0;
  setCrumbs();
}

function setCrumbs() {
  const r = ui.route; let c = '';
  if (r.t === 'location') c = `<b>${esc((locById(r.id) || {}).name || '?')}</b>`;
  else if (r.t === 'building') { const l = locById(r.locId), b = bldById(l, r.bId); c = `${esc(l.name)} · <b>${esc(b ? b.name : '?')}</b>`; }
  else if (r.t === 'npc') { const l = locById(r.locId); const n = npcRef(r.locId, r.bId, r.nId); c = `${esc(l ? l.name : '')} · <b>${esc(n ? n.name : '?')}</b>`; }
  else if (r.t === 'board') { const l = locById(r.locId); const bd = ((l || {}).boards || []).find((x) => x.id === r.bdId); c = `${esc(l ? l.name : '')} · <b>${esc(bd ? bd.name : 'Дошка')}</b>`; }
  else if (r.t === 'encounter') c = `<b>По дорозі…</b>`;
  else if (r.t === 'quests') c = `<b>Квести</b>`;
  else if (r.t === 'quest') c = `<b>${esc((questById(r.id) || {}).title || '')}</b>`;
  else if (r.t === 'active') c = `<b>Активні квести</b>`;
  else if (r.t === 'karta') { const g = r.regionId ? regById(r.regionId) : null; c = `Карта · <b>${esc(g ? g.name : W.title)}</b>`; }
  else if (r.t === 'map') c = `<b>Локації · ${esc(W.title)}</b>`;
  $('#crumbs').innerHTML = c;
}

function ed(attr, tag, cls, text, ph) {
  const t = text && String(text).length ? esc(text) : (ui.edit ? `<span style="opacity:.5">${esc(ph || 'дописати…')}</span>` : '');
  return `<${tag} class="${cls} editable" data-edit="${attr}">${t}</${tag}>`;
}
function editBanner() {
  return ui.edit ? `<div class="edit-banner">Режим редагування: тапни текст — змінити; чіп типу цілі — теж тапається. ＋ додати, ✕ видалити.</div>` : '';
}

// ── Вью: Карта (глобальна = краї; всередині краю = локації + шляхи) ──────────
const regById = (id) => (W.regions || []).find((g) => g.id === id);
function renderKarta(r) {
  const regionId = r.regionId || null;
  const reg = regionId ? regById(regionId) : null;
  let h = editBanner();
  if (regionId) {
    h += ed(`reg:${regionId}:name`, 'div', 'title', reg ? reg.name : '?', 'Назва краю');
    if (reg) h += ed(`reg:${regionId}:desc`, 'div', 'subtitle', reg.desc, 'Опис краю');
  } else {
    h += ed('world:title', 'div', 'title', W.title, 'Назва світу');
    h += `<div class="subtitle">${ui.edit ? 'Тап по точці — вибрати · тап по порожньому — нова точка · тап по лінії — прибрати шлях' : 'Тапни край — відкриється його карта'}</div>`;
  }
  // Дії над вибраною точкою
  if (ui.edit && ui.mapSel) {
    const isReg = ui.mapSel.kind === 'reg';
    h += `<div class="mini-row">
      <button class="mini-btn" data-kact="open">Відкрити</button>
      <button class="mini-btn" data-kact="connect">З'єднати…</button>
      <button class="mini-btn" data-kact="move">Перемістити…</button>
      <button class="mini-btn" data-kact="rename">Назва…</button>
      ${isReg ? `<button class="mini-btn" data-kact="desc">Опис…</button>` : ''}
      <button class="mini-btn" style="color:var(--danger)" data-kact="del">Видалити</button>
    </div>`;
  }
  if (ui.edit && ui.mapMode) {
    h += `<div class="karta-hint" style="color:var(--gold)">${ui.mapMode === 'connect' ? 'Тапни другу точку — з’єднати' : 'Тапни місце на карті — туди переміститься'}</div>`;
  }
  h += `<div class="karta-wrap">${kartaSvg(regionId)}</div>`;
  if (!ui.edit) h += `<div class="karta-hint">${regionId ? 'Тап по точці — відкрити локацію' : ''}</div>`;
  return h;
}
function kartaSvg(regionId) {
  const pts = regionId
    ? W.locations.filter((l) => (l.regionId || 'r_tykhoplav') === regionId)
        .map((l) => ({ id: l.id, kind: 'loc', x: l.x || 0, y: l.y || 0, label: l.name }))
    : (W.regions || []).map((g) => ({ id: g.id, kind: 'reg', x: g.x || 0, y: g.y || 0, label: g.name }));
  // Ребра: у краї — з paths (унікальні пари в межах краю); глобально — regionEdges.
  const edges = [];
  if (regionId) {
    const inReg = new Set(pts.map((p) => p.id));
    const seen = new Set();
    for (const l of W.locations) {
      if (!inReg.has(l.id)) continue;
      for (const p of l.paths || []) {
        if (!inReg.has(p.to)) continue;
        const key = [l.id, p.to].sort().join('|');
        if (seen.has(key)) continue; seen.add(key);
        edges.push([l.id, p.to]);
      }
    }
  } else {
    for (const e of W.regionEdges || []) edges.push([e.a, e.b]);
  }
  const P = 130;
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const minX = (xs.length ? Math.min(...xs) : 0) - P, maxX = (xs.length ? Math.max(...xs) : 0) + P;
  const minY = (ys.length ? Math.min(...ys) : 0) - P, maxY = (ys.length ? Math.max(...ys) : 0) + P;
  const w = Math.max(300, maxX - minX), hh = Math.max(240, maxY - minY);
  const R = Math.max(w, hh) * 0.026;
  const fs = R * 1.15, fs2 = R * 0.85;
  const at = (id) => pts.find((p) => p.id === id);
  let s = `<svg class="karta-svg" viewBox="${minX} ${minY} ${w} ${hh}" style="aspect-ratio:${w}/${hh}" xmlns="http://www.w3.org/2000/svg">`;
  for (const [a, b] of edges) {
    const A = at(a), B = at(b); if (!A || !B) continue;
    s += `<line class="edge-hit" data-edge="${a}|${b}" x1="${A.x}" y1="${A.y}" x2="${B.x}" y2="${B.y}"></line>`;
    s += `<line class="edge" x1="${A.x}" y1="${A.y}" x2="${B.x}" y2="${B.y}" style="pointer-events:none"></line>`;
  }
  for (const p of pts) {
    const sel = ui.mapSel && ui.mapSel.id === p.id;
    s += `<g class="pt${sel ? ' sel' : ''}" data-pt="${p.kind}:${p.id}">
      <circle cx="${p.x}" cy="${p.y}" r="${R}"></circle>
      <text x="${p.x}" y="${p.y + R + fs}" font-size="${fs}">${esc(p.label)}</text>
      ${p.kind === 'reg' ? `<text class="sub" x="${p.x}" y="${p.y + R + fs + fs2 + 3}" font-size="${fs2}">край</text>` : ''}
    </g>`;
  }
  s += `</svg>`;
  return s;
}
// Координати тапу в системі карти (svg зі style aspect-ratio = viewBox → лінійно).
function kartaPoint(e) {
  const svg = document.querySelector('.karta-svg'); if (!svg) return null;
  const rect = svg.getBoundingClientRect(); const vb = svg.viewBox.baseVal;
  return {
    x: vb.x + (e.clientX - rect.left) / rect.width * vb.width,
    y: vb.y + (e.clientY - rect.top) / rect.height * vb.height,
  };
}
// З'єднати дві точки (край: шляхи в ОБИДВА боки; глобально: одне ребро).
function kartaConnect(A, B, regionId) {
  if (regionId && A.kind === 'loc' && B.kind === 'loc') {
    const la = locById(A.id), lb = locById(B.id);
    if (la && lb) {
      if (!(la.paths || []).some((p) => p.to === B.id)) (la.paths = la.paths || []).push({ to: B.id, encounter: null });
      if (!(lb.paths || []).some((p) => p.to === A.id)) (lb.paths = lb.paths || []).push({ to: A.id, encounter: null });
    }
  } else if (!regionId && A.kind === 'reg' && B.kind === 'reg') {
    const key = [A.id, B.id].sort().join('|');
    if (!(W.regionEdges || []).some((x) => [x.a, x.b].sort().join('|') === key)) {
      (W.regionEdges = W.regionEdges || []).push({ a: A.id, b: B.id });
    }
  }
}
function kartaDisconnect(a, b, regionId) {
  if (regionId) {
    const la = locById(a), lb = locById(b);
    if (la) la.paths = (la.paths || []).filter((p) => p.to !== b);
    if (lb) lb.paths = (lb.paths || []).filter((p) => p.to !== a);
  } else {
    const key = [a, b].sort().join('|');
    W.regionEdges = (W.regionEdges || []).filter((x) => [x.a, x.b].sort().join('|') !== key);
  }
}
// Кліки по карті (обидва режими). Повертає true, якщо оброблено.
function kartaClick(e, ptEl, edgeEl, bgEl) {
  const r = ui.route; const regionId = r.regionId || null;
  if (!ui.edit) {
    if (!ptEl) return true;
    const [kind, id] = ptEl.dataset.pt.split(':');
    if (kind === 'reg') { go({ t: 'karta', regionId: id }); return true; }
    ui.history = []; go({ t: 'location', id }); return true;
  }
  const mp = kartaPoint(e);
  if (ui.mapMode === 'move' && ui.mapSel && mp) {
    const o = ui.mapSel.kind === 'reg' ? regById(ui.mapSel.id) : locById(ui.mapSel.id);
    if (o) { o.x = Math.round(mp.x); o.y = Math.round(mp.y); }
    ui.mapMode = null; save(); render('f'); return true;
  }
  if (ptEl) {
    const [kind, id] = ptEl.dataset.pt.split(':');
    if (ui.mapMode === 'connect' && ui.mapSel && ui.mapSel.id !== id) {
      kartaConnect(ui.mapSel, { kind, id }, regionId);
      ui.mapMode = null; save(); render('f'); return true;
    }
    ui.mapSel = (ui.mapSel && ui.mapSel.id === id) ? null : { kind, id };
    ui.mapMode = null; render('f'); return true;
  }
  if (edgeEl) {
    const [a, b] = edgeEl.dataset.edge.split('|');
    if (confirm('Прибрати з’єднання?')) { kartaDisconnect(a, b, regionId); save(); render('f'); }
    return true;
  }
  if (bgEl && mp) { // порожнє місце → нова точка
    if (regionId) {
      const l = { id: uid('loc'), name: 'Нова локація', desc: '', buildings: [], paths: [], npcs: [], boards: [], x: Math.round(mp.x), y: Math.round(mp.y), regionId };
      W.locations.push(l); ui.mapSel = { kind: 'loc', id: l.id };
    } else {
      const g = { id: uid('reg'), name: 'Новий край', desc: '', x: Math.round(mp.x), y: Math.round(mp.y) };
      (W.regions = W.regions || []).push(g); ui.mapSel = { kind: 'reg', id: g.id };
    }
    save(); render('f'); return true;
  }
  return true;
}
// Дії над вибраною точкою (кнопки над картою).
function kartaAction(act) {
  const sel = ui.mapSel; if (!sel) return;
  const r = ui.route; const regionId = r.regionId || null;
  if (act === 'open') {
    if (sel.kind === 'reg') { ui.mapSel = null; return go({ t: 'karta', regionId: sel.id }); }
    return go({ t: 'location', id: sel.id });
  }
  if (act === 'connect') { ui.mapMode = 'connect'; return render('f'); }
  if (act === 'move') { ui.mapMode = 'move'; return render('f'); }
  if (act === 'rename') {
    const o = sel.kind === 'reg' ? regById(sel.id) : locById(sel.id);
    if (o) editText('Назва', o.name, false, (v) => { o.name = v; });
    return;
  }
  if (act === 'desc' && sel.kind === 'reg') {
    const g = regById(sel.id);
    if (g) editText('Опис краю', g.desc || '', true, (v) => { g.desc = v; });
    return;
  }
  if (act === 'del') {
    if (sel.kind === 'loc') {
      if (!confirm('Видалити локацію з усім вмістом?')) return;
      W.locations = W.locations.filter((l) => l.id !== sel.id);
      for (const l of W.locations) l.paths = (l.paths || []).filter((p) => p.to !== sel.id);
      tombstoneLocFb(sel.id);
    } else {
      const has = W.locations.some((l) => (l.regionId || 'r_tykhoplav') === sel.id);
      if (has) { alert('У краї є локації — спершу перенеси або видали їх.'); return; }
      W.regions = (W.regions || []).filter((g) => g.id !== sel.id);
      W.regionEdges = (W.regionEdges || []).filter((x) => x.a !== sel.id && x.b !== sel.id);
    }
    ui.mapSel = null; save(); render('f'); return;
  }
  if (regionId) { /* no-op — заглушка для лінтера */ }
}

// ── Вью: Локація ─────────────────────────────────────────────────────────────
function renderLocation(r) {
  const l = locById(r.id); if (!l) return `<div class="empty">Локації нема</div>`;
  let h = editBanner();
  h += ed(`loc:${l.id}:name`, 'div', 'title', l.name, 'Назва локації');
  h += ed(`loc:${l.id}:desc`, 'div', 'narr', l.desc, 'Опис локації — що бачить гравець');

  // Люди просто в локації
  if ((l.npcs || []).length || ui.edit) {
    h += `<div class="section-label">Люди</div>`;
    (l.npcs || []).forEach((n) => {
      h += `<div class="card" data-go="npc:${l.id}:-:${n.id}">
        <div class="glyph">☗</div>
        <div class="body"><div class="name">${esc(n.name)}</div><div class="meta">${esc((n.dlg.text || '').slice(0, 80))}</div></div>
        ${ui.edit ? `<button class="del-btn edit-only" data-del="npc:${l.id}:-:${n.id}">✕</button>` : '<div class="chev">›</div>'}
      </div>`;
    });
    h += `<div class="card add edit-only" data-add="npc:${l.id}:-"><div class="name">＋ Людина в локації</div></div>`;
  }

  // Споруди + дошки
  h += `<div class="section-label">Споруди</div>`;
  (l.buildings || []).forEach((b) => {
    h += `<div class="card" data-go="building:${l.id}:${b.id}">
      <div class="glyph">◈</div>
      <div class="body"><div class="name">${esc(b.name)}</div>${b.desc ? `<div class="meta">${esc(b.desc)}</div>` : ''}</div>
      ${ui.edit ? `<button class="del-btn edit-only" data-del="bld:${l.id}:${b.id}">✕</button>` : '<div class="chev">›</div>'}
    </div>`;
  });
  (l.boards || []).forEach((bd) => {
    h += `<div class="card" data-go="board:${l.id}:${bd.id}">
      <div class="glyph">▤</div>
      <div class="body"><div class="name">${esc(bd.name)}</div><div class="meta">оголошень: ${(bd.posts || []).length}</div></div>
      ${ui.edit ? `<button class="del-btn edit-only" data-del="board:${l.id}:${bd.id}">✕</button>` : '<div class="chev">›</div>'}
    </div>`;
  });
  if (!(l.buildings || []).length && !(l.boards || []).length && !ui.edit) h += `<div class="meta" style="color:var(--dim);font-family:var(--serif);padding:2px 4px 8px">Тут поки порожньо.</div>`;
  h += `<div class="card add edit-only" data-add="bld:${l.id}"><div class="name">＋ Споруда</div></div>`;
  h += `<div class="card add edit-only" data-add="board:${l.id}"><div class="name">＋ Дошка оголошень</div></div>`;

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
      <div class="body"><div class="name">${esc(n.name)}</div><div class="meta">${esc((n.dlg.text || '').slice(0, 80))}</div></div>
      ${ui.edit ? `<button class="del-btn edit-only" data-del="npc:${l.id}:${b.id}:${n.id}">✕</button>` : '<div class="chev">›</div>'}
    </div>`;
  });
  if (!(b.npcs || []).length && !ui.edit) h += `<div class="meta" style="color:var(--dim);font-family:var(--serif);padding:2px 4px 8px">Нікого.</div>`;
  h += `<div class="card add edit-only" data-add="npc:${l.id}:${b.id}"><div class="name">＋ Мешканець</div></div>`;
  return h;
}

// ── Вью: НПС — гілковий діалог ───────────────────────────────────────────────
// Гра: route.path = 'r1.r2' — де ми в дереві. Відповіді ведуть углиб (через go →
// «назад» природно повертає на крок розмови). Редагування: все дерево одразу.
function renderNpc(r) {
  const n = npcRef(r.locId, r.bId, r.nId); if (!n) return `<div class="empty">Нема кого</div>`;
  const base = `${r.locId}:${r.bId}:${n.id}`;
  let h = editBanner();
  h += ed(`npc:${base}:name`, 'div', 'title', n.name, 'Ім’я');

  if (ui.edit) return h + renderDlgEditor(n, base);

  // Режим гри: поточний вузол
  const path = r.path || '';
  const node = dlgNode(n, path);
  h += `<div class="line npc"><div class="who">каже</div><div class="text">${esc(node.text || '…')}</div></div>`;
  h += `<div class="section-label">Відповісти</div>`;
  let any = false;
  for (const rep of node.replies) {
    const vis = replyVisible(rep);
    if (vis === 'hidden') continue;
    any = true;
    const tag = rep.action ? (rep.action.type === 'give'
      ? `<span class="qtag">квест</span>`
      : `<span class="qtag turnin">здати</span>`) : '';
    if (vis === 'locked') {
      h += `<div class="choice locked"><span class="arrow">▸</span>${esc(rep.label)}${tag}<div class="qstate">ще не все виконано — глянь «Активні»</div></div>`;
    } else {
      h += `<button class="choice" data-reply="${rep.id}"><span class="arrow">▸</span>${esc(rep.label)}${tag}</button>`;
    }
  }
  if (!any) h += `<div class="meta" style="color:var(--dim);font-family:var(--serif)">Розмову вичерпано.</div>`;
  if (path) h += `<button class="choice" data-reply=".."><span class="arrow">↩</span>Перепитати</button>`;
  return h;
}
// Видимість відповіді. Спершу умова показу (cond: квест у заданому стані) — це
// «фраза зʼявляється лише коли квест активний» тощо. Далі за дією: give ховаємо
// коли вже взято/здано; obj (виконати ціль) — лише коли квест активний і ціль ще
// не виконана; turnin — лише в активного (заблоковано, поки цілі не всі).
function replyVisible(rep) {
  if (rep.cond) {
    const q = questById(rep.cond.questId);
    if (!q || (q.state || 'idle') !== rep.cond.state) return 'hidden';
  }
  if (!rep.action) return 'ok';
  const q = questById(rep.action.questId);
  if (!q) return 'hidden';
  if (rep.action.type === 'give') return q.state === 'idle' ? 'ok' : 'hidden';
  if (rep.action.type === 'obj') {
    if (q.state !== 'active') return 'hidden';
    const s = (q.steps || []).find((x) => x.oid === rep.action.oid);
    return s && !s.done ? 'ok' : 'hidden';
  }
  if (q.state !== 'active') return 'hidden';
  return questDone(q) ? 'ok' : 'locked';
}
// Редактор дерева діалогу: рекурсивні ряди з відступом.
function renderDlgEditor(n, base) {
  let h = `<div class="line npc"><div class="who">вітання</div>`;
  h += ed(`dlgtext:${base}`, 'div', 'text', n.dlg.text, 'Що НПС каже першим') + `</div>`;
  h += `<div class="section-label">Дерево відповідей</div><div class="dlg-tree">`;
  h += renderReplyRows(n.dlg.replies || [], base, '');
  h += `</div>` + addReplyRow(base, '');
  return h;
}
function renderReplyRows(replies, base, path) {
  let h = '';
  for (const rep of replies) {
    const p = path ? path + '.' + rep.id : rep.id;
    const q = rep.action ? questById(rep.action.questId) : null;
    let tag = '';
    if (rep.action) {
      const verb = rep.action.type === 'give' ? 'видати' : rep.action.type === 'obj' ? 'ціль' : 'здати';
      let what = q ? q.title : '?';
      if (rep.action.type === 'obj' && q) { const s = (q.steps || []).find((x) => x.oid === rep.action.oid); what = s ? s.text : what; }
      tag = `<span class="qtag${rep.action.type === 'turnin' ? ' turnin' : ''}">${verb}: ${esc(what)}</span>`;
    }
    // Тег умови показу (fраза видна лише при заданому стані квеста).
    if (rep.cond) {
      const cq = questById(rep.cond.questId);
      const st = rep.cond.state === 'active' ? 'активний' : rep.cond.state === 'done' ? 'виконаний' : 'не взятий';
      tag += ` <span class="qtag" style="color:#9ec7e8">якщо «${esc(cq ? cq.title : '?')}» ${st}</span>`;
    }
    h += `<div class="reply-row">
      <div class="rhead">${ed(`rlabel:${base}:${p}`, 'div', 'name', rep.label, 'Репліка гравця')}${tag}
        <button class="mini-btn edit-only" data-rcond="${base}:${p}" title="Показувати лише при стані квеста">умова</button>
        <button class="del-btn edit-only" data-del="reply:${base}:${p}">✕</button></div>
      <div class="line player" style="margin:6px 0 8px"><div class="who">нпс відповість</div>${ed(`rsay:${base}:${p}`, 'div', 'text', rep.say, 'Відповідь НПС')}</div>`;
    h += renderReplyRows(rep.replies || [], base, p);
    h += addReplyRow(base, p);
    h += `</div>`;
  }
  return h;
}
function addReplyRow(base, path) {
  return `<div class="mini-row edit-only">
    <button class="mini-btn" data-add="reply:${base}:${path}">＋ Відповідь</button>
    <button class="mini-btn" data-add="replyg:${base}:${path}">＋ Видати квест</button>
    <button class="mini-btn" data-add="replyt:${base}:${path}">＋ Здати квест</button>
    <button class="mini-btn" data-add="replyo:${base}:${path}">＋ Виконати ціль</button>
  </div>`;
}

// ── Вью: Дошка оголошень ─────────────────────────────────────────────────────
const POST_KIND = { gossip: 'плітка', task: 'завдання', note: 'інше' };
function renderBoard(r) {
  const l = locById(r.locId); const bd = ((l || {}).boards || []).find((x) => x.id === r.bdId);
  if (!bd) return `<div class="empty">Дошки нема</div>`;
  const base = `${l.id}:${bd.id}`;
  let h = editBanner();
  h += ed(`bdname:${base}`, 'div', 'title', bd.name, 'Назва дошки');
  h += `<div class="subtitle">Оголошення прибиті цвяхами й воском.</div>`;
  (bd.posts || []).forEach((p) => {
    const q = p.questId ? questById(p.questId) : null;
    h += `<div class="post"><div class="prow">
      <span class="kind-chip${p.kind === 'task' ? ' k-reach' : ''}" ${ui.edit ? `data-pkind="${base}:${p.id}"` : ''}>${POST_KIND[p.kind] || p.kind}</span>
      ${ui.edit ? `<span style="flex:1"></span><button class="del-btn edit-only" data-del="post:${base}:${p.id}">✕</button>` : ''}
    </div>`;
    h += ed(`ptext:${base}:${p.id}`, 'div', 'ptext', p.text, 'Текст оголошення');
    if (p.kind === 'task' && q && !ui.edit) {
      if (q.state === 'idle') h += `<button class="take-btn" data-take="${q.id}">Взяти завдання: ${esc(q.title)}</button>`;
      else if (q.state === 'active') h += `<div class="qstate active" style="margin-top:8px">завдання взято — «${esc(q.title)}» в Активних</div>`;
      else h += `<div class="qstate done" style="margin-top:8px">виконано: «${esc(q.title)}»</div>`;
    }
    if (p.kind === 'task' && !q && ui.edit) h += `<div class="qstate" style="margin-top:6px">тапни чіп, щоб обрати квест</div>`;
    h += `</div>`;
  });
  h += `<div class="card add edit-only" data-add="post:${base}"><div class="name">＋ Оголошення</div></div>`;
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

// ── Вью: Квести (редактор усіх) ──────────────────────────────────────────────
function renderQuests() {
  let h = editBanner();
  h += `<div class="title">Квести</div><div class="subtitle">Усі ланцюги. Стан скидається кнопкою в квесті.</div>`;
  (W.quests || []).forEach((q) => {
    const done = (q.steps || []).filter((s) => s.done).length;
    const st = q.state === 'active' ? '· активний' : q.state === 'done' ? '· виконано' : '';
    h += `<div class="card" data-go="quest:${q.id}">
      <div class="glyph">✦</div>
      <div class="body"><div class="name">${esc(q.title)}</div>
        <div class="meta">${esc(q.cat || 'квест')} · ${done}/${(q.steps || []).length} ${st}</div></div>
      ${ui.edit ? `<button class="del-btn edit-only" data-del="quest:${q.id}">✕</button>` : '<div class="chev">›</div>'}
    </div>`;
  });
  h += `<div class="card add edit-only" data-add="quest"><div class="name">＋ Квест</div></div>`;
  return h;
}
function renderQuest(r) {
  const q = questById(r.id); if (!q) return `<div class="empty">Нема квеста</div>`;
  let h = editBanner();
  h += ed(`quest:${q.id}:title`, 'div', 'title', q.title, 'Назва квеста');
  h += `<span class="tag editable" data-edit="quest:${q.id}:cat">${esc(q.cat || 'квест')}</span> `;
  h += `<span class="tag">${q.state === 'active' ? 'активний' : q.state === 'done' ? 'виконано' : 'не взято'}</span> `;
  // Режим здачі: тап циклить діалог ↔ одразу (авто-закриття по останній цілі).
  h += `<span class="tag" data-qmode="${q.id}" style="cursor:pointer">здача: ${q.turnin === 'auto' ? 'одразу по виконанню' : 'через діалог'}</span>`;
  h += `<div class="section-label">Цілі</div><div class="quest">`;
  h += questSteps(q, true);
  h += `</div><div class="card add edit-only" data-add="step:${q.id}"><div class="name">＋ Ціль</div></div>`;
  if (!ui.edit) {
    h += `<div class="mini-row" style="margin-top:14px">`;
    if (q.state !== 'idle') h += `<button class="mini-btn" data-qreset="${q.id}">↺ Скинути стан (тест заново)</button>`;
    if (q.state === 'idle') h += `<button class="mini-btn" data-take="${q.id}">Взяти вручну</button>`;
    h += `</div>`;
    h += `<div class="subtitle">Галочки — симуляція подій гри (вбив/дійшов/зібрав). «Здати» відкриється в діалозі, коли все виконано.</div>`;
  }
  return h;
}
function questSteps(q, editable) {
  let h = '';
  (q.steps || []).forEach((s, i) => {
    h += `<div class="step ${s.done ? 'done' : ''}" data-step="${q.id}:${i}">
      <div class="mark">${s.done ? '✓' : '○'}</div>
      ${kindChip(s, ui.edit && editable ? `stepkind:${q.id}:${i}` : '')}
      <div class="${ui.edit && editable ? 'editable' : ''}" style="flex:1" ${ui.edit && editable ? `data-edit="step:${q.id}:${i}"` : ''}>${esc(s.text)}</div>
      ${ui.edit && editable ? `<button class="del-btn edit-only" data-del="step:${q.id}:${i}">✕</button>` : ''}
    </div>`;
  });
  return h;
}

// ── Вью: Активні квести ──────────────────────────────────────────────────────
function renderActive() {
  let h = editBanner();
  h += `<div class="title">Активні квести</div>`;
  const act = W.quests.filter((q) => q.state === 'active');
  const done = W.quests.filter((q) => q.state === 'done');
  if (!act.length) h += `<div class="empty">Нема активних. Візьми завдання в НПС («квест» у розмові) або з дошки оголошень.</div>`;
  for (const q of act) {
    h += `<div class="quest"><h3>${esc(q.title)}</h3><span class="tag">${esc(q.cat || 'квест')}</span>`;
    h += questSteps(q, false);
    h += questDone(q)
      ? `<div class="qstate done" style="margin-top:8px">Усе виконано — час здавати тому, хто чекає.</div>`
      : `<div class="qstate" style="margin-top:8px">Тапай галочки — симулюй події гри.</div>`;
    h += `</div>`;
  }
  if (done.length) {
    h += `<div class="section-label">Завершені</div>`;
    for (const q of done) h += `<div class="card" data-go="quest:${q.id}"><div class="glyph">✓</div><div class="body"><div class="name">${esc(q.title)}</div></div><div class="chev">›</div></div>`;
  }
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

// ── Модалки ──────────────────────────────────────────────────────────────────
function sheet(html, wire) {
  const m = $('#modal');
  m.innerHTML = `<div class="backdrop"></div><div class="sheet">${html}</div>`;
  m.classList.add('show');
  const close = () => { m.classList.remove('show'); m.innerHTML = ''; };
  m.querySelector('.backdrop').onclick = close;
  wire(m.querySelector('.sheet'), close);
}
function editText(title, cur, multiline, cb) {
  sheet(`<h4>${esc(title)}</h4>
    ${multiline ? `<textarea>${esc(cur)}</textarea>` : `<input type="text" value="${esc(cur)}">`}
    <div class="row"><button class="cancel">Скасувати</button><button class="save">Зберегти</button></div>`, (s, close) => {
    const field = s.querySelector('textarea, input');
    setTimeout(() => field.focus(), 50);
    s.querySelector('.cancel').onclick = close;
    s.querySelector('.save').onclick = () => { cb(field.value); close(); save(); render('f'); };
  });
}
function flashSay(text, who) {
  sheet(`<div class="line npc"><div class="who">${esc(who || 'у відповідь')}</div><div class="text">${esc(text)}</div></div>
    <div class="row"><button class="save">Далі</button></div>`, (s, close) => { s.querySelector('.save').onclick = close; });
}
// Вибір квеста (для дій видати/здати та для оголошення-завдання)
function pickQuest(title, cb) {
  const items = W.quests.map((q) => `<button class="pick" data-q="${q.id}" style="text-align:left">${esc(q.title)}</button>`).join('');
  sheet(`<h4>${esc(title)}</h4><div class="pick-list">${items || '<div class="empty">Спершу створи квест у вкладці «Квести»</div>'}</div>
    <div class="row"><button class="cancel">Скасувати</button></div>`, (s, close) => {
    s.querySelector('.cancel').onclick = close;
    // close ПЕРЕД cb: колбек може відкрити наступний шит (ланцюжок вибору) —
    // закриття після нього стирало б щойно відкриту модалку.
    s.querySelectorAll('[data-q]').forEach((b) => { b.onclick = () => { close(); cb(b.dataset.q); save(); render('f'); }; });
  });
}
// Вибір цілі квеста (для дії «виконати ціль»)
function pickObjective(qid, cb) {
  const q = questById(qid); if (!q) return;
  const items = (q.steps || []).map((s) => `<button class="pick" data-o="${s.oid}" style="text-align:left">${esc(KIND_LABEL[s.kind] || s.kind)}: ${esc(s.text)}</button>`).join('');
  sheet(`<h4>Яку ціль виконує ця репліка?</h4><div class="pick-list">${items || '<div class="empty">У квеста нема цілей</div>'}</div>
    <div class="row"><button class="cancel">Скасувати</button></div>`, (s, close) => {
    s.querySelector('.cancel').onclick = close;
    s.querySelectorAll('[data-o]').forEach((b) => { b.onclick = () => { close(); cb(b.dataset.o); save(); render('f'); }; });
  });
}
// Вибір стану квеста (для умови показу репліки)
function pickState(cb) {
  const opts = [ ['active', 'квест активний'], ['done', 'квест виконаний'], ['idle', 'квест не взято'], ['', 'зняти умову'] ];
  const items = opts.map(([v, l]) => `<button class="pick" data-s="${v}" style="text-align:left">${l}</button>`).join('');
  sheet(`<h4>Коли показувати репліку?</h4><div class="pick-list">${items}</div>
    <div class="row"><button class="cancel">Скасувати</button></div>`, (s, close) => {
    s.querySelector('.cancel').onclick = close;
    s.querySelectorAll('[data-s]').forEach((b) => { b.onclick = () => { close(); cb(b.dataset.s); save(); render('f'); }; });
  });
}
// Редагування цілі: тип + кількість + текст
function editStepSheet(q, i) {
  const s0 = q.steps[i];
  const chips = KINDS.map((k) => `<button class="pick${s0.kind === k ? ' on' : ''}" data-k="${k}">${KIND_LABEL[k]}</button>`).join('');
  sheet(`<h4>Ціль квеста</h4>
    <div class="pick-row">${chips}</div>
    <label class="fld">Кількість (для вбити/зібрати/вижити)</label>
    <input type="number" class="cnt" value="${s0.count || ''}" placeholder="—" min="1">
    <label class="fld">Опис цілі (як на дошці)</label>
    <textarea>${esc(s0.text)}</textarea>
    <div class="row"><button class="cancel">Скасувати</button><button class="save">Зберегти</button></div>`, (sh, close) => {
    let kind = s0.kind;
    sh.querySelectorAll('[data-k]').forEach((b) => { b.onclick = () => { kind = b.dataset.k; sh.querySelectorAll('[data-k]').forEach((x) => x.classList.toggle('on', x === b)); }; });
    sh.querySelector('.cancel').onclick = close;
    sh.querySelector('.save').onclick = () => {
      s0.kind = kind;
      const c = parseInt(sh.querySelector('.cnt').value, 10);
      if (KIND_HAS_COUNT[kind] && c > 0) s0.count = c; else delete s0.count;
      s0.text = sh.querySelector('textarea').value;
      touchQuest(q); close(); render('f');
    };
  });
}

// ── Дії гри: взяти / здати квест ─────────────────────────────────────────────
function giveQuest(qid) {
  const q = questById(qid); if (!q || q.state !== 'idle') return;
  q.state = 'active';
  save();
  flashSay(`Нове завдання: «${q.title}». Дивись вкладку «Активні».`, 'літопис');
}
function turninQuest(qid) {
  const q = questById(qid); if (!q || q.state !== 'active' || !questDone(q)) return;
  q.state = 'done';
  save();
  flashSay(doneMessage(q), 'літопис');
}
function doneMessage(q) {
  const rw = (q._game && q._game.reward) || {};
  const parts = [];
  if (rw.gold) parts.push(rw.gold + ' золота');
  if (rw.xp) parts.push(rw.xp + ' досвіду');
  if (rw.itemId) parts.push('предмет: ' + rw.itemId);
  if (rw.note) parts.push(rw.note);
  return parts.length ? `Квест «${q.title}» завершено. Нагорода: ${parts.join(', ')}.` : `Квест «${q.title}» завершено.`;
}
// Виконати конкретну ціль (напр. «розмова з НПС = talk-ціль»). Якщо квест у режимі
// «одразу по виконанню» і це була остання ціль — закриваємо квест тут же.
function completeObjective(qid, oid) {
  const q = questById(qid); if (!q || q.state !== 'active') return;
  const s = (q.steps || []).find((x) => x.oid === oid); if (!s || s.done) return;
  s.done = true;
  const auto = maybeAutoComplete(q);
  save();
  if (!auto) flashSay(`Виконано: ${s.text}`, 'літопис');
}
// true, якщо квест закрився сам (turnin='auto' і всі цілі готові).
function maybeAutoComplete(q) {
  if (q.state !== 'active' || q.turnin !== 'auto' || !questDone(q)) return false;
  q.state = 'done';
  save();
  flashSay(doneMessage(q), 'літопис');
  return true;
}

// ── Редагування: шляхи data-edit ─────────────────────────────────────────────
function applyEdit(pathStr) {
  const p = pathStr.split(':');
  const kind = p[0];
  const openM = (title, get, set, multi) => editText(title, get(), multi !== false, (v) => set(v));
  if (kind === 'world' && p[1] === 'title') return openM('Назва світу', () => W.title, (v) => W.title = v, false);
  if (kind === 'reg') { const g = regById(p[1]); if (!g) return;
    if (p[2] === 'name') return openM('Назва краю', () => g.name, (v) => g.name = v, false);
    if (p[2] === 'desc') return openM('Опис краю', () => g.desc || '', (v) => g.desc = v, true); }
  if (kind === 'loc') { const l = locById(p[1]);
    if (p[2] === 'name') return openM('Назва локації', () => l.name, (v) => l.name = v, false);
    if (p[2] === 'desc') return openM('Опис локації', () => l.desc, (v) => l.desc = v, true); }
  if (kind === 'bld') { const l = locById(p[1]), b = bldById(l, p[2]);
    if (p[3] === 'name') return openM('Назва споруди', () => b.name, (v) => b.name = v, false);
    if (p[3] === 'desc') return openM('Опис споруди', () => b.desc, (v) => b.desc = v, true); }
  if (kind === 'npc') { const n = npcRef(p[1], p[2], p[3]);
    if (p[4] === 'name') return openM('Ім’я', () => n.name, (v) => n.name = v, false); }
  if (kind === 'dlgtext') { const n = npcRef(p[1], p[2], p[3]);
    return openM('Вітання НПС', () => n.dlg.text, (v) => n.dlg.text = v, true); }
  if (kind === 'rlabel' || kind === 'rsay') { const n = npcRef(p[1], p[2], p[3]);
    const rep = replyByPath(n, p[4]); if (!rep) return;
    if (kind === 'rlabel') return openM('Репліка гравця', () => rep.label, (v) => rep.label = v, false);
    return openM('Відповідь НПС', () => rep.say, (v) => rep.say = v, true); }
  if (kind === 'bdname') { const bd = boardRef(p[1], p[2]); return openM('Назва дошки', () => bd.name, (v) => bd.name = v, false); }
  if (kind === 'ptext') { const bd = boardRef(p[1], p[2]); const post = bd.posts.find((x) => x.id === p[3]);
    return openM('Текст оголошення', () => post.text, (v) => post.text = v, true); }
  if (kind === 'enc') { const l = locById(p[1]), pt = l.paths[+p[2]]; if (!pt.encounter) pt.encounter = { who: '', line: '' };
    if (p[3] === 'who') return openM('Хто перестрів', () => pt.encounter.who, (v) => pt.encounter.who = v, false);
    if (p[3] === 'line') return openM('Що каже', () => pt.encounter.line, (v) => pt.encounter.line = v, true); }
  if (kind === 'quest') { const q = questById(p[1]);
    if (p[2] === 'title') return openM('Назва квеста', () => q.title, (v) => { q.title = v; touchQuest(q); }, false);
    if (p[2] === 'cat') return openM('Тип', () => q.cat, (v) => { q.cat = v; touchQuest(q); }, false); }
  if (kind === 'step') { const q = questById(p[1]); return editStepSheet(q, +p[2]); }
  if (kind === 'stepkind') { const q = questById(p[1]); return editStepSheet(q, +p[2]); }
}
function replyByPath(n, pathStr) {
  let list = n.dlg.replies, rep = null;
  for (const rid of (pathStr || '').split('.')) {
    rep = (list || []).find((x) => x.id === rid); if (!rep) return null;
    list = rep.replies;
  }
  return rep;
}
function boardRef(locId, bdId) { const l = locById(locId); return ((l || {}).boards || []).find((x) => x.id === bdId); }

// Додавання
function applyAdd(pathStr) {
  const p = pathStr.split(':');
  const k = p[0];
  if (k === 'bld') { const l = locById(p[1]); l.buildings.push({ id: uid('bld'), name: 'Нова споруда', desc: '', npcs: [] }); }
  else if (k === 'board') { const l = locById(p[1]); (l.boards = l.boards || []).push({ id: uid('bd'), name: 'Дошка оголошень', posts: [] }); }
  else if (k === 'post') { const bd = boardRef(p[1], p[2]); bd.posts.push({ id: uid('p'), kind: 'gossip', text: '' }); }
  else if (k === 'npc') {
    const l = locById(p[1]);
    const list = p[2] === '-' ? (l.npcs = l.npcs || []) : bldById(l, p[2]).npcs;
    list.push({ id: uid('npc'), name: 'Хтось', dlg: { text: '', replies: [] } });
  }
  else if (k === 'reply' || k === 'replyg' || k === 'replyt' || k === 'replyo') {
    const n = npcRef(p[1], p[2], p[3]);
    const parent = p[4] ? replyByPath(n, p[4]) : null;
    const list = parent ? (parent.replies = parent.replies || []) : n.dlg.replies;
    if (k === 'reply') { list.push({ id: uid('r'), label: 'Нова відповідь', say: '', replies: [] }); }
    else if (k === 'replyo') {
      // «розмова = виконання цілі»: вибрати квест → вибрати ціль → репліка з дією obj
      return pickQuest('Чию ціль виконує ця репліка?', (qid) => {
        pickObjective(qid, (oid) => {
          const q = questById(qid); const s = q && (q.steps || []).find((x) => x.oid === oid);
          list.push({ id: uid('r'), label: s ? s.text : 'Виконати ціль', say: '', replies: [], action: { type: 'obj', questId: qid, oid } });
        });
      });
    }
    else {
      const type = k === 'replyg' ? 'give' : 'turnin';
      return pickQuest(type === 'give' ? 'Який квест видати?' : 'Який квест здавати?', (qid) => {
        const q = questById(qid);
        list.push({ id: uid('r'), label: (type === 'give' ? 'Взяти завдання: ' : 'Здати: ') + (q ? q.title : ''), say: '', replies: [], action: { type, questId: qid } });
      });
    }
  }
  else if (k === 'path') { const l = locById(p[1]); const other = W.locations.find((x) => x.id !== l.id); l.paths.push({ to: other ? other.id : l.id, encounter: null }); }
  else if (k === 'loc') { W.locations.push({ id: uid('loc'), name: 'Нова локація', desc: '', buildings: [], paths: [], npcs: [], boards: [] }); }
  else if (k === 'quest') { const q = { id: uid('q'), title: 'Новий квест', cat: 'побічний', state: 'idle', steps: [] }; W.quests.push(q); pushQuestToFb(q); }
  else if (k === 'step') { const q = questById(p[1]); q.steps.push({ oid: q.id + '_o' + Date.now().toString(36), kind: 'custom', text: 'Нова ціль', done: false }); pushQuestToFb(q); }
  save(); render('f');
}

// Видалення
function applyDel(pathStr) {
  const p = pathStr.split(':');
  const k = p[0];
  if (k === 'bld') { const l = locById(p[1]); l.buildings = l.buildings.filter((b) => b.id !== p[2]); }
  else if (k === 'board') { const l = locById(p[1]); l.boards = (l.boards || []).filter((b) => b.id !== p[2]); }
  else if (k === 'post') { const bd = boardRef(p[1], p[2]); bd.posts = bd.posts.filter((x) => x.id !== p[3]); }
  else if (k === 'npc') {
    const l = locById(p[1]);
    if (p[2] === '-') l.npcs = (l.npcs || []).filter((n) => n.id !== p[3]);
    else { const b = bldById(l, p[2]); b.npcs = b.npcs.filter((n) => n.id !== p[3]); }
  }
  else if (k === 'reply') {
    const n = npcRef(p[1], p[2], p[3]);
    const ids = p[4].split('.'); const last = ids.pop();
    const parent = ids.length ? replyByPath(n, ids.join('.')) : null;
    const list = parent ? parent.replies : n.dlg.replies;
    const idx = list.findIndex((x) => x.id === last);
    if (idx >= 0) list.splice(idx, 1);
  }
  else if (k === 'path') { const l = locById(p[1]); l.paths.splice(+p[2], 1); }
  else if (k === 'loc') { W.locations = W.locations.filter((l) => l.id !== p[1]); tombstoneLocFb(p[1]); }
  else if (k === 'quest') { W.quests = W.quests.filter((q) => q.id !== p[1]); tombstoneQuestFb(p[1]); }
  else if (k === 'step') { const q = questById(p[1]); q.steps.splice(+p[2], 1); pushQuestToFb(q); }
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
  const replyEl = e.target.closest('[data-reply]');
  const takeEl = e.target.closest('[data-take]');
  const qresetEl = e.target.closest('[data-qreset]');
  const pkindEl = e.target.closest('[data-pkind]');
  const rcondEl = e.target.closest('[data-rcond]');
  const qmodeEl = e.target.closest('[data-qmode]');

  // Карта: точки/ребра/порожнє поле + кнопки дій над вибраною точкою.
  const kactEl = e.target.closest('[data-kact]');
  if (ui.route.t === 'karta' && kactEl) { e.stopPropagation(); return kartaAction(kactEl.dataset.kact); }
  const ptEl = e.target.closest('[data-pt]');
  const edgeEl2 = e.target.closest('[data-edge]');
  const svgEl = e.target.closest('.karta-svg');
  if (ui.route.t === 'karta' && (ptEl || edgeEl2 || svgEl)) {
    e.stopPropagation(); return void kartaClick(e, ptEl, edgeEl2, svgEl);
  }

  if (ui.edit && delEl) { e.stopPropagation(); return applyDel(delEl.dataset.del); }
  if (ui.edit && addEl) { e.stopPropagation(); return applyAdd(addEl.dataset.add); }
  if (ui.edit && qmodeEl) { // здача: діалог ↔ одразу по виконанню
    e.stopPropagation();
    const q = questById(qmodeEl.dataset.qmode);
    q.turnin = q.turnin === 'auto' ? 'dialog' : 'auto';
    save(); render('f'); return;
  }
  if (ui.edit && rcondEl) { // умова показу репліки: квест + стан
    e.stopPropagation();
    const parts = rcondEl.dataset.rcond.split(':');
    const n = npcRef(parts[0], parts[1], parts[2]);
    const rep = replyByPath(n, parts[3]); if (!rep) return;
    return pickQuest('Від якого квеста залежить репліка?', (qid) => {
      pickState((st) => {
        if (!st) delete rep.cond; else rep.cond = { questId: qid, state: st };
      });
    });
  }
  if (ui.edit && pkindEl) { // цикл типу оголошення; task → вибір квеста
    e.stopPropagation();
    const [locId, bdId, pid] = pkindEl.dataset.pkind.split(':');
    const bd = boardRef(locId, bdId); const post = bd.posts.find((x) => x.id === pid);
    const order = ['gossip', 'task', 'note'];
    post.kind = order[(order.indexOf(post.kind) + 1) % order.length];
    if (post.kind === 'task') return pickQuest('Яке завдання дає оголошення?', (qid) => { post.questId = qid; });
    delete post.questId; save(); render('f'); return;
  }
  if (ui.edit && resetEl) { if (confirm('Скинути болванку до початкової? Твої правки зникнуть.')) { W = seed(); save(); ui.history = []; ui.route = { t: 'map' }; render('f'); } return; }
  if (ui.edit && editEl) { e.stopPropagation(); return applyEdit(editEl.dataset.edit); }
  // У редагуванні картки-переходи ПРАЦЮЮТЬ (зручно правити вглиб): ✕/＋/текст
  // перехоплені вище, а ігрові кнопки (реплік/взяти/кроки) в edit не рендеряться.

  // ── Гра ──
  if (arriveEl) return replace({ t: 'location', id: arriveEl.dataset.arrive });
  if (qresetEl) { const q = questById(qresetEl.dataset.qreset); q.state = 'idle'; for (const s of q.steps) s.done = false; save(); render('f'); return; }
  if (takeEl) { giveQuest(takeEl.dataset.take); render('f'); return; }
  if (stepEl) {
    const [qid, i] = stepEl.dataset.step.split(':'); const q = questById(qid);
    q.steps[+i].done = !q.steps[+i].done;
    if (q.steps[+i].done) maybeAutoComplete(q); // «одразу по виконанню» — закривається сам
    save(); render('f'); return;
  }

  // Крок діалогу: '..' = перепитати (корінь), інакше — углиб дерева.
  if (replyEl) {
    const r = ui.route; if (r.t !== 'npc') return;
    const rid = replyEl.dataset.reply;
    if (rid === '..') return replace({ t: 'npc', locId: r.locId, bId: r.bId, nId: r.nId, path: '' });
    const n = npcRef(r.locId, r.bId, r.nId);
    const newPath = r.path ? r.path + '.' + rid : rid;
    const rep = replyByPath(n, newPath);
    if (rep && rep.action) {
      if (rep.action.type === 'give') giveQuest(rep.action.questId);
      else if (rep.action.type === 'obj') completeObjective(rep.action.questId, rep.action.oid);
      else turninQuest(rep.action.questId);
    }
    return go({ t: 'npc', locId: r.locId, bId: r.bId, nId: r.nId, path: newPath });
  }

  if (goEl) {
    const parts = goEl.dataset.go.split(':');
    const t = parts[0];
    if (goEl.dataset.start) ui.history = [];
    if (t === 'building') return go({ t: 'building', locId: parts[1], bId: parts[2] });
    if (t === 'npc') return go({ t: 'npc', locId: parts[1], bId: parts[2], nId: parts[3], path: '' });
    if (t === 'board') return go({ t: 'board', locId: parts[1], bdId: parts[2] });
    if (t === 'location') return go({ t: 'location', id: parts[1] });
    if (t === 'quest') return go({ t: 'quest', id: parts[1] });
    if (t === 'travel') {
      const l = locById(parts[1]); const idx = +parts[2]; const p = l.paths[idx];
      if (p.encounter) return go({ t: 'encounter', fromId: parts[1], toId: p.to, pathIdx: idx });
      return go({ t: 'location', id: p.to });
    }
  }
});

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
  ui.mapSel = null; ui.mapMode = null;
  if (t === 'play') ui.route = { t: 'location', id: W.startId };
  else if (t === 'karta') ui.route = { t: 'karta' };
  else if (t === 'active') ui.route = { t: 'active' };
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

// Літопис-квест → ігровий Quest. v2 редагує title/cat/цілі З ТИПАМИ (kind/count) —
// решту багатих полів студії (acq, локація, нагорода, target цілі) НЕ затираємо:
// стартуємо з останньої відомої ігрової ноди (q._game) і накладаємо своє.
function questToGame(q) {
  const base = q._game ? JSON.parse(JSON.stringify(q._game)) : {};
  const prevObjs = base.objectives || [];
  const objectives = (q.steps || []).map((s, i) => {
    const id = s.oid || (q.id + '_o' + i);
    const prev = prevObjs.find((o) => o.id === id) || {};
    const o = Object.assign({}, prev, { id, kind: s.kind || prev.kind || 'custom', desc: s.text || '' });
    if (s.count > 0) o.count = s.count; else delete o.count;
    return o;
  });
  delete base.deleted;
  return Object.assign(base, {
    id: q.id, title: q.title || '', text: q.text || '', cat: catToGame(q.cat),
    acq: base.acq || 'auto', objectives,
    // Режим здачі → успіх гри: «одразу» = objectives (гра закриє сама на останній
    // цілі); «через діалог» = custom (гра ЧЕКАЄ репліки-здачі в НПС — інакше
    // квест завершився б сам і здавати було б нічого).
    successOn: q.turnin === 'auto' ? 'objectives' : 'custom',
    updatedAt: Date.now(),
  });
}
// Ігровий Quest → Літопис-квест. Локальні done/state зберігаємо по збігу oid;
// повну ноду ховаємо в _game, щоб зворотний пуш не втратив багаті поля студії.
function questFromGame(node, prev) {
  const ps = (prev && prev.steps) || [];
  return {
    id: node.id, title: node.title || '', text: node.text || '', cat: catFromGame(node.cat),
    state: (prev && prev.state) || 'idle',
    turnin: node.successOn === 'objectives' ? 'auto' : 'dialog',
    steps: (node.objectives || []).map((o) => {
      const was = ps.find((s) => s.oid === o.id);
      const s = { oid: o.id, kind: o.kind || 'custom', text: o.desc || '', done: !!(was && was.done) };
      if (o.count > 0) s.count = o.count;
      return s;
    }),
    updatedAt: node.updatedAt || 0, _game: node,
  };
}

function pushQuestToFb(q) {
  const node = questToGame(q);
  q.updatedAt = node.updatedAt; // локальний стамп == нода → пул не відлунює назад
  q._game = node;
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
    const t = ui.route.t;
    if (t === 'quests' || t === 'quest' || t === 'active') {
      if (t === 'quest' && !questById(ui.route.id)) ui.route = { t: 'quests' };
      render('f'); syncTab();
    }
  }
}

// ── Синхронізація СВІТУ (локації/НПС/діалоги/дошки) — content/litopys ─────────
// Той самий патерн, що для квестів: per-локація LWW за updatedAt, тумбстоуни на
// видалення, пул поллінгом. Пуш вмикається ЛИШЕ після першого пулу (інакше свіжий
// пристрій із болванкою затер би чужі правки «новішим» updatedAt).
const WPATH = FB_DB + '/content/litopys';
// var (не let): save() смикає schedulePushWorld ще при первинному load()/seed(),
// до виконання цих рядків — var хойститься, undefined тут безпечний (пуш вимкнено).
var _pushEnabled = false;
var _locSig = {};   // locId → підпис останнього відомого стану (щоб пушити лише зміни)
var _metaSig = '';  // підпис назви краю
var _pushTimer = 0;

function schedulePushWorld() {
  if (!_pushEnabled) return;
  clearTimeout(_pushTimer);
  _pushTimer = setTimeout(pushWorldDirty, 700);
}
// Підпис БЕЗ updatedAt — інакше кожен пуш «змінював» би локацію знову.
function locSig(l) { const c = Object.assign({}, l); delete c.updatedAt; return JSON.stringify(c); }

function pushWorldDirty() {
  for (const l of W.locations) {
    const sig = locSig(l);
    if (_locSig[l.id] === sig) continue;
    _locSig[l.id] = sig;
    l.updatedAt = Date.now();
    fetch(`${WPATH}/world/${l.id}.json`, { method: 'PUT', body: JSON.stringify(l) }).catch(() => {});
  }
  // Мета: назва світу + глобальна карта (краї та ребра між ними).
  const ms = JSON.stringify([W.title, W.startId, W.regions, W.regionEdges]);
  if (_metaSig !== ms) {
    _metaSig = ms;
    W.metaAt = Date.now();
    fetch(`${WPATH}/meta.json`, { method: 'PUT', body: JSON.stringify({ title: W.title, startId: W.startId, regions: W.regions || [], regionEdges: W.regionEdges || [], updatedAt: W.metaAt }) }).catch(() => {});
  }
}
function tombstoneLocFb(id) {
  delete _locSig[id];
  if (!_pushEnabled) return;
  fetch(`${WPATH}/world/${id}.json`, { method: 'PUT', body: JSON.stringify({ id, deleted: true, updatedAt: Date.now() }) }).catch(() => {});
}

// Firebase не зберігає порожні масиви — після пулу відновлюємо структуру вглиб.
function normReplies(list) {
  return (list || []).map((r) => {
    const o = { id: r.id, label: r.label || '', say: r.say || '', replies: normReplies(r.replies) };
    if (r.action) o.action = r.action;
    if (r.cond) o.cond = r.cond;
    return o;
  });
}
function normNpc(n) { return { id: n.id, name: n.name || '', dlg: { text: (n.dlg && n.dlg.text) || '', replies: normReplies(n.dlg && n.dlg.replies) } }; }
function normalizeLoc(node) {
  return {
    id: node.id, name: node.name || '', desc: node.desc || '',
    x: node.x ?? 0, y: node.y ?? 0, regionId: node.regionId || 'r_tykhoplav', // точка на карті
    buildings: (node.buildings || []).map((b) => ({ id: b.id, name: b.name || '', desc: b.desc || '', npcs: (b.npcs || []).map(normNpc) })),
    npcs: (node.npcs || []).map(normNpc),
    boards: (node.boards || []).map((bd) => ({ id: bd.id, name: bd.name || '', posts: (bd.posts || []).map((p) => Object.assign({ id: p.id, kind: p.kind || 'gossip', text: p.text || '' }, p.questId ? { questId: p.questId } : {})) })),
    paths: (node.paths || []).map((p) => ({ to: p.to, encounter: p.encounter || null })),
    updatedAt: node.updatedAt || 0,
  };
}

async function pullWorld() {
  let v = null;
  try { const r = await fetch(`${WPATH}.json`); if (r.ok) v = await r.json(); } catch (e) { return; }
  if (!v || typeof v !== 'object') return;
  let dirty = false;
  for (const node of Object.values(v.world || {})) {
    if (!node || typeof node !== 'object' || !node.id) continue;
    const idx = W.locations.findIndex((l) => l.id === node.id);
    const localAt = idx >= 0 ? (W.locations[idx].updatedAt || 0) : -1;
    const nodeAt = node.updatedAt || 0;
    if (node.deleted) {
      if (idx >= 0 && nodeAt > localAt) { W.locations.splice(idx, 1); delete _locSig[node.id]; dirty = true; }
    } else if (nodeAt > localAt) {
      const c = normalizeLoc(node);
      if (idx >= 0) W.locations[idx] = c; else W.locations.push(c);
      _locSig[c.id] = locSig(c);
      dirty = true;
    }
  }
  const meta = v.meta;
  if (meta && (meta.updatedAt || 0) > (W.metaAt || 0)) {
    W.title = meta.title || W.title;
    if (meta.startId && locById(meta.startId)) W.startId = meta.startId;
    if (Array.isArray(meta.regions) || meta.regions) {
      W.regions = Object.values(meta.regions || {}).map((g) => ({ id: g.id, name: g.name || '', desc: g.desc || '', x: g.x ?? 0, y: g.y ?? 0 }));
    }
    W.regionEdges = Object.values(meta.regionEdges || {}).map((x) => ({ a: x.a, b: x.b })).filter((x) => x.a && x.b);
    W.metaAt = meta.updatedAt;
    _metaSig = JSON.stringify([W.title, W.startId, W.regions, W.regionEdges]);
    dirty = true;
  }
  if (dirty) {
    try { localStorage.setItem(KEY, JSON.stringify(W)); } catch (e) { /* ignore */ }
    // Якщо поточна локація зникла — на мапу; інакше перемалювати активний екран.
    const r = ui.route;
    if ((r.t === 'location' && !locById(r.id)) || (r.t !== 'quests' && r.t !== 'quest' && r.t !== 'active')) {
      if (r.t === 'location' && !locById(r.id)) ui.route = { t: 'map' };
      render('f'); syncTab();
    }
  }
}

// ── Модалка-контейнер + SW ────────────────────────────────────────────────────
(function initModal() { const d = document.createElement('div'); d.id = 'modal'; document.body.appendChild(d); })();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

// Старт: спершу ПУЛ світу (свіжіше з Firebase перемагає болванку/старе локальне),
// а тоді — ПУШ УСЬОГО, що після пулу лишилось відмінним (локальні правки, локації,
// яких у ФБ ще нема). Так локальний стан ЗАВЖДИ осідає у Firebase і переживає
// перевстановлення застосунку/зміну пристрою. (Раніше стартові правки не пушились —
// перевстановлення PWA втрачало їх безповоротно.)
render('f'); syncTab();
void pullQuests();
void pullWorld().finally(() => {
  _pushEnabled = true;
  schedulePushWorld(); // сиги знає лише пул → усе інше (локальне) заллється зараз
});
setInterval(() => { void pullQuests(); void pullWorld(); }, 6000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { void pullQuests(); void pullWorld(); } });
