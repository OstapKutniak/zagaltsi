import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js';
import {
  getDatabase, ref, push, set, update, remove, onValue,
  onChildAdded, onChildChanged, onChildRemoved
} from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-database.js';

// ── FIREBASE ────────────────────────────────────────────────
const firebaseConfig = {
  apiKey: 'AIzaSyBvg2av881ZTi9op-bzwicL70vh2UENItw',
  authDomain: 'horugva-ff8bd.firebaseapp.com',
  databaseURL: 'https://horugva-ff8bd-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'horugva-ff8bd',
  storageBucket: 'horugva-ff8bd.firebasestorage.app',
  messagingSenderId: '1011491870660',
  appId: '1:1011491870660:web:e02210da9c21bb38a5b691',
};
const db = getDatabase(initializeApp(firebaseConfig));
const TX_PATH = 'finance/transactions';
const ACC_PATH = 'finance/accounts';
const CUR_SUFFIX = { UAH: 'UAH', USD: '$', EUR: 'EUR', PLN: 'zł' };
const isSavings = n => /лежить|скарбничк|заощад/i.test(n || '');

// ── CONST ──────────────────────────────────────────────────
const MONTHS = ['Січень','Лютий','Березень','Квітень','Травень','Червень','Липень','Серпень','Вересень','Жовтень','Листопад','Грудень'];
const MONTHS_GEN = ['січня','лютого','березня','квітня','травня','червня','липня','серпня','вересня','жовтня','листопада','грудня'];
const WEEKDAYS = ['Неділя','Понеділок','Вівторок','Середа','Четвер','П\'ятниця','Субота'];

const ICONS = {
  bowl:'<path d="M3 11h18a9 9 0 01-18 0z"/><path d="M8 11V8M12 11V6.5M16 11V8"/>',
  bus:'<rect x="4" y="4" width="16" height="13" rx="2"/><path d="M4 11h16"/><circle cx="8" cy="18" r="1.3" class="fill"/><circle cx="16" cy="18" r="1.3" class="fill"/>',
  phone:'<path d="M5 4l3-1 2 4-2 2a12 12 0 005 5l2-2 4 2-1 3a2 2 0 01-2 1A16 16 0 014 6a2 2 0 011-2z"/>',
  ticket:'<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M9 6v12"/><path d="M9 9h0M9 13h0"/>',
  gift:'<rect x="4" y="10" width="16" height="10" rx="1"/><path d="M3 10h18M12 10v10M8 10a2 2 0 110-4c2 0 4 4 4 4M16 10a2 2 0 100-4c-2 0-4 4-4 4"/>',
  beer:'<path d="M7 8h8v11a2 2 0 01-2 2H9a2 2 0 01-2-2z"/><path d="M15 10h2a2 2 0 012 2v3a2 2 0 01-2 2h-2"/><path d="M8 8a2 2 0 011-3 2 2 0 013 0 2 2 0 013 3"/>',
  bag:'<path d="M6 8h12l-1 12H7z"/><path d="M9 8a3 3 0 016 0"/>',
  owl:'<path d="M5 9a4 4 0 014-4h6a4 4 0 014 4v3a7 7 0 01-14 0z"/><circle cx="9.5" cy="10" r="1.6" class="fill"/><circle cx="14.5" cy="10" r="1.6" class="fill"/><path d="M9 16l3 2 3-2"/>',
  health:'<rect x="4" y="4" width="16" height="16" rx="5"/><path d="M12 9v6M9 12h6"/>',
  plane:'<path d="M2 12l20-8-8 20-2-8-10-4z"/>',
  wand:'<path d="M4 20l9-9"/><path d="M15 4l.9 2.1L18 7l-2.1.9L15 10l-.9-2.1L12 7l2.1-.9z" class="fill"/>',
  percent:'<path d="M5 19L19 5"/><circle cx="7.5" cy="7.5" r="2"/><circle cx="16.5" cy="16.5" r="2"/>',
  laptop:'<rect x="4" y="5" width="16" height="11" rx="1"/><path d="M2 20h20"/>',
  cube:'<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5"/>',
  building:'<rect x="6" y="3" width="12" height="18" rx="1"/><path d="M9.5 7h1M13.5 7h1M9.5 11h1M13.5 11h1M9.5 15h1M13.5 15h1"/>',
  coins:'<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v6c0 1.7 3 3 7 3s7-1.3 7-3V6"/><path d="M5 12v6c0 1.7 3 3 7 3s7-1.3 7-3v-6"/>',
  printer:'<path d="M6 9V3h12v6"/><rect x="4" y="9" width="16" height="8" rx="1"/><rect x="7" y="14" width="10" height="6"/>',
  dice:'<rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="9" cy="9" r="1.2" class="fill"/><circle cx="12" cy="12" r="1.2" class="fill"/><circle cx="15" cy="15" r="1.2" class="fill"/>',
  game:'<rect x="2" y="7" width="20" height="10" rx="5"/><path d="M6 11v3M4.5 12.5h3"/><circle cx="16" cy="11" r="1" class="fill"/><circle cx="18.5" cy="13.5" r="1" class="fill"/>',
  money:'<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/>',
  wallet:'<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18"/><circle cx="17" cy="14" r="1.3" class="fill"/>',
  card:'<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 9h20"/>',
  scooter:'<circle cx="6" cy="18" r="2"/><circle cx="18" cy="18" r="2"/><path d="M14 6h3l-3 11M14 6l-6 12"/>',
  tag:'<path d="M3 12l9-9 9 9-9 9z"/><circle cx="12" cy="9" r="1.5" class="fill"/>',
  arrow_up:'<path d="M12 19V5M5 12l7-7 7 7"/>',
  arrow_down:'<path d="M12 5v14M5 12l7 7 7-7"/>',
  arrows:'<path d="M4 9h13l-4-4M20 15H7l4 4"/>',
  ops:'<path d="M6 2h12v20l-3-2-3 2-3-2-3 2z"/><path d="M9 7h6M9 11h6"/>',
  pencil:'<path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>',
  chart:'<path d="M3 3v18h18"/><path d="M7 14l3-4 3 3 4-6"/>',
};
const ic = k => `<svg viewBox="0 0 24 24">${ICONS[k] || ICONS.tag}</svg>`;

const STYLE = [
  ['їжа','#2D9CDB','bowl'],['кафе','#2D9CDB','bowl'],['продукт','#2D9CDB','bowl'],['ресторан','#2D9CDB','bowl'],['піца','#2D9CDB','bowl'],
  ['транспорт','#F2994A','bus'],['добир','#F2994A','bus'],['проїзд','#F2994A','bus'],['таксі','#F2994A','bus'],
  ['самокат','#9B51E0','scooter'],
  ['щомісяч','#5D4037','phone'],['підписк','#5D4037','phone'],
  ['дозвілл','#EB5C8B','ticket'],['розваг','#EB5C8B','ticket'],['кіно','#EB5C8B','ticket'],['відвід','#EB5C8B','ticket'],
  ['подарун','#F2C94C','gift'],['квіт','#F2C94C','gift'],
  ['випивк','#9E9D24','beer'],['алко','#9E9D24','beer'],['бар','#9E9D24','beer'],['напо','#9E9D24','beer'],
  ['придбан','#9B51E0','bag'],['покупк','#9B51E0','bag'],['одяг','#9B51E0','bag'],['потреб','#9B51E0','bag'],
  ['навчан','#7E8BD9','owl'],['освіт','#7E8BD9','owl'],['виклада','#B39DDB','owl'],
  ['здоров','#1ABC9C','health'],['ліки','#1ABC9C','health'],['лікар','#1ABC9C','health'],['психотер','#1ABC9C','health'],['адалім','#1ABC9C','health'],
  ['поїздк','#4CAF7D','plane'],['подорож','#4CAF7D','plane'],['житло','#4CAF7D','plane'],
  ['борг','#2F80ED','percent'],
  ['геймдев','#EB3B7E','laptop'],['геймдизайн','#EB3B7E','laptop'],
  ['візуаліз','#9CCC9C','cube'],
  ['архдизайн','#E0B84D','building'],
  ['стипенд','#D7B98E','coins'],
  ['друк','#607D8B','printer'],['k.o.d','#F0A0A0','printer'],['kod','#F0A0A0','printer'],
  ['продаж','#C9BE7E','dice'],
  ['спільняк','#9E9E9E','game'],
  ['зарплат','#27AE60','money'],
  ['готівк','#27AE60','wallet'],['монобанк','#2D9CDB','card'],['карт','#2D9CDB','card'],['рахунок','#2D9CDB','card'],['кешбек','#1ABC9C','wallet'],
  ['інше','#EB5757','wand'],['друге','#EB5757','wand'],
];
function catStyle(name) {
  const key = (name || '').toLowerCase();
  for (const [k, c, i] of STYLE) if (key.includes(k)) return { color: c, icon: ic(i) };
  let h = 0; for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return { color: `hsl(${h} 52% 56%)`, icon: ic('tag') };
}
const parentCat = n => (n || 'Інше').split(' (')[0].trim();
const subCat = n => { const m = (n || '').match(/\(([^)]*)\)/); return m ? m[1].trim() : ''; };

// ── STATE ──────────────────────────────────────────────────
let txMap = {};
let accountsList = [];
let selectedAccounts = null;
let state = { tab: 'categories', catDir: 'expense', ovDir: 'expense', period: 'month', cursor: new Date() };
let catsByDir = { expense: [], income: [] };
let catsParent = { expense: [], income: [] };
let subsByDir = { expense: new Map(), income: new Map() };
let accountsAll = [];
let editingTx = null;
let formState = {};
let pickerResolve = null;
let openRecId = null;
let renderTimer = null;
let importedUpTo = null;
let ovExpanded = new Set();
let accActionCurrent = null;
let catFilter = null;

// ── INIT ───────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  if ('serviceWorker' in navigator)
    navigator.serviceWorker.register('/zagaltsi/finance/sw.js', { scope: '/zagaltsi/finance/' }).catch(() => {});
  bindEvents();
  subscribe();
  renderAll();
});

// ── SYNC ───────────────────────────────────────────────────
function subscribe() {
  const r = ref(db, TX_PATH);
  onChildAdded(r,   s => { txMap[s.key] = { id: s.key, ...s.val() }; scheduleRender(); });
  onChildChanged(r, s => { txMap[s.key] = { id: s.key, ...s.val() }; scheduleRender(); });
  onChildRemoved(r, s => { delete txMap[s.key]; scheduleRender(); });
  onValue(ref(db, ACC_PATH), s => { accountsList = s.val() || []; scheduleRender(); });
  onValue(ref(db, 'finance/meta/importedUpTo'), s => { importedUpTo = s.val() || null; });
}
function scheduleRender() { clearTimeout(renderTimer); renderTimer = setTimeout(renderAll, 80); }

async function saveTx(tx) { await set(push(ref(db, TX_PATH)), tx); }
async function updateTx(id, tx) { await update(ref(db, `${TX_PATH}/${id}`), tx); }
async function deleteTx(id) { await remove(ref(db, `${TX_PATH}/${id}`)); }

// ── LIVE BALANCE ───────────────────────────────────────────
// accountsList.balance = snapshot at import time; delta = sum of new ops after that date
function computeLiveBalance(accName) {
  const snap = accountsList.find(a => a.name === accName);
  if (!snap) return null;
  let delta = 0;
  Object.values(txMap).forEach(t => {
    if (importedUpTo && new Date(t.date).getTime() <= importedUpTo) return;
    const amt = Number(t.amount);
    if (t.type === 'expense' && t.account === accName) delta -= amt;
    else if (t.type === 'income' && t.account === accName) delta += amt;
    else if (t.type === 'transfer') {
      if (t.account === accName) delta -= amt;
      if (t.category === accName) delta += amt;
    }
  });
  return snap.balance + delta;
}

// ── DERIVED ────────────────────────────────────────────────
function rebuildLookups() {
  const ce = new Set(), ci = new Set(), pe = new Set(), pi = new Set(), acc = new Set();
  const se = new Map(), si = new Map();
  const addSub = (map, parent, sub) => { if (!sub) return; if (!map.has(parent)) map.set(parent, new Set()); map.get(parent).add(sub); };
  Object.values(txMap).forEach(t => {
    if (t.account) acc.add(t.account);
    if (t.type === 'expense') { if (t.category) { ce.add(t.category); pe.add(parentCat(t.category)); addSub(se, parentCat(t.category), subCat(t.category)); } }
    else if (t.type === 'income') { if (t.category) { ci.add(t.category); pi.add(parentCat(t.category)); addSub(si, parentCat(t.category), subCat(t.category)); } }
    else if (t.type === 'transfer') { if (t.category) acc.add(t.category); }
  });
  accountsList.forEach(a => acc.add(a.name));
  catsByDir = { expense: [...ce], income: [...ci] };
  catsParent = { expense: [...pe], income: [...pi] };
  subsByDir = { expense: se, income: si };
  accountsAll = [...acc];
}

function inPeriod(t) {
  const d = new Date(t.date);
  if (state.period === 'all') return true;
  if (state.period === 'year') return d.getFullYear() === state.cursor.getFullYear();
  return d.getFullYear() === state.cursor.getFullYear() && d.getMonth() === state.cursor.getMonth();
}
function inFilter(t) {
  if (!selectedAccounts) return true;
  if (selectedAccounts.has(t.account)) return true;
  if (t.type === 'transfer' && selectedAccounts.has(t.category)) return true;
  return false;
}
function periodTxs() { return Object.values(txMap).filter(t => inPeriod(t) && inFilter(t)); }

// ── RENDER ─────────────────────────────────────────────────
function renderAll() {
  rebuildLookups();
  renderHeader();
  if (state.tab === 'categories') renderCategories();
  else if (state.tab === 'records') renderRecords();
  else if (state.tab === 'accounts') renderAccounts();
  else if (state.tab === 'overview') renderOverview();
  document.getElementById('fab').classList.toggle('show', state.tab === 'categories' || state.tab === 'records');
}

function renderHeader() {
  let net;
  if (accountsList.length) net = accountsList.reduce((s, a) => s + (Number(a.uah) || 0), 0);
  else { net = 0; Object.values(txMap).forEach(t => { if (t.type === 'expense') net -= Number(t.amount); else if (t.type === 'income') net += Number(t.amount); }); }
  document.getElementById('total-amount').innerHTML = `${fmt(net)} <span>UAH</span>`;

  const c = state.cursor;
  let label, day;
  if (state.period === 'all') { label = 'ВЕСЬ ЧАС'; day = '∞'; }
  else if (state.period === 'year') { label = String(c.getFullYear()); day = '365'; }
  else { label = `${MONTHS[c.getMonth()].toUpperCase()} ${c.getFullYear()}`; day = String(new Date(c.getFullYear(), c.getMonth() + 1, 0).getDate()); }
  document.getElementById('month-label').textContent = label;
  document.getElementById('daycount').textContent = day;
}

// ── CATEGORIES ─────────────────────────────────────────────
function renderCategories() {
  const dir = state.catDir;
  const txs = periodTxs();
  const sums = new Map();
  txs.filter(t => t.type === dir).forEach(t => {
    const p = parentCat(t.category); sums.set(p, (sums.get(p) || 0) + Number(t.amount));
  });
  const names = [...new Set([...catsParent[dir], ...sums.keys()])];
  const catList = names.map(n => ({ name: n, v: sums.get(n) || 0 }))
                       .sort((a, b) => b.v - a.v || a.name.localeCompare(b.name));

  const expTotal = txs.filter(t => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0);
  const incTotal = txs.filter(t => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0);
  const segs = catList.filter(x => x.v > 0).map(x => ({ v: x.v, c: catStyle(x.name).color }));
  const main = dir === 'expense' ? expTotal : incTotal;
  const sub  = dir === 'expense' ? incTotal : expTotal;
  const mc = dir === 'expense' ? 'var(--exp)' : 'var(--inc)';
  const sc = dir === 'expense' ? 'var(--inc)' : 'var(--exp)';

  const donut = `<div class="donut-cell" id="donut-cell">
    <div class="donut">${donutSVG(segs)}
      <div class="donut-center">
        <div class="donut-label">${dir === 'expense' ? 'Витрати' : 'Доходи'}</div>
        <div class="donut-main" style="color:${mc}">${fmt(main)} <span>UAH</span></div>
        <div class="donut-sub" style="color:${sc}">${fmt(sub)} <span>UAH</span></div>
      </div>
    </div></div>`;

  const cats = catList.map(x => {
    const st = catStyle(x.name);
    return `<button class="cat ${x.v ? '' : 'zero'}" style="--c:${st.color}" data-cat="${escAttr(x.name)}">
      <div class="cat-name">${esc(x.name)}</div>
      <div class="cat-circle">${st.icon}</div>
      <div class="cat-amt">${fmt(x.v)} <span>UAH</span></div>
    </button>`;
  }).join('');

  const grid = document.getElementById('cat-grid');
  grid.innerHTML = donut + cats;
  document.getElementById('donut-cell').onclick = () => {
    state.catDir = dir === 'expense' ? 'income' : 'expense';
    renderCategories();
  };

  // Short tap → add form; long press → category detail sheet
  grid.querySelectorAll('.cat').forEach(el => {
    let lpTimer = null, activated = false;
    const startLP = () => { lpTimer = setTimeout(() => { activated = true; openCatSheet(el.dataset.cat, dir, catList); }, 500); };
    const cancelLP = () => clearTimeout(lpTimer);
    el.addEventListener('touchstart', startLP, { passive: true });
    el.addEventListener('touchend', cancelLP, { passive: true });
    el.addEventListener('touchmove', cancelLP, { passive: true });
    el.addEventListener('mousedown', startLP);
    el.addEventListener('mouseup', cancelLP);
    el.addEventListener('mouseleave', cancelLP);
    el.onclick = () => { if (activated) { activated = false; return; } openForm(null, el.dataset.cat, state.catDir); };
  });
}

function donutSVG(segs) {
  const size = 200, stroke = 22, r = (size - stroke) / 2, C = 2 * Math.PI * r, cx = size / 2;
  const total = segs.reduce((s, x) => s + x.v, 0);
  if (total <= 0)
    return `<svg viewBox="0 0 ${size} ${size}"><circle cx="${cx}" cy="${cx}" r="${r}" fill="none" stroke="#eee" stroke-width="${stroke}"/></svg>`;
  const gap = segs.length > 1 ? 2 : 0;
  let off = 0;
  const parts = segs.map(s => {
    const len = C * s.v / total;
    const dash = Math.max(len - gap, 0.6);
    const c = `<circle cx="${cx}" cy="${cx}" r="${r}" fill="none" stroke="${s.c}" stroke-width="${stroke}" stroke-dasharray="${dash} ${C - dash}" stroke-dashoffset="${-off}" transform="rotate(-90 ${cx} ${cx})"/>`;
    off += len; return c;
  });
  return `<svg viewBox="0 0 ${size} ${size}">${parts.join('')}</svg>`;
}

// ── CATEGORY DETAIL SHEET ──────────────────────────────────
function openCatSheet(catName, dir, catList) {
  const txs = periodTxs();
  const catTxs = txs.filter(t => t.type === dir && parentCat(t.category) === catName);
  const total = catTxs.reduce((s, t) => s + Number(t.amount), 0);
  const count = catTxs.length;
  const periodTotal = txs.filter(t => t.type === dir).reduce((s, t) => s + Number(t.amount), 0);
  const pct = periodTotal ? Math.round(total / periodTotal * 100) : 0;
  const st = catStyle(catName);

  const subMap = new Map();
  catTxs.forEach(t => { const s = subCat(t.category); if (s) subMap.set(s, (subMap.get(s) || 0) + Number(t.amount)); });
  const subs = [...subMap.entries()].sort((a, b) => b[1] - a[1]);

  const el = document.getElementById('cat-action-overlay');
  el.querySelector('.cas-head').style.background = st.color;
  el.querySelector('.cas-ic').innerHTML = st.icon;
  el.querySelector('.cas-name').textContent = catName;
  el.querySelector('.cas-count').textContent = `${count} операцій`;
  el.querySelector('.cas-total-val').textContent = `${fmt(total)} UAH`;
  el.querySelector('.cas-pct').textContent = `${pct}%`;
  el.querySelector('.cas-period-val').textContent = `${fmt(periodTotal)} UAH`;

  const subsEl = el.querySelector('.cas-subs');
  subsEl.innerHTML = subs.map(([name, v]) => {
    const sp = total ? Math.round(v / total * 100) : 0;
    const sst = catStyle(name);
    return `<div class="cas-sub-row">
      <div class="cas-sub-ic" style="--c:${sst.color}">${sst.icon}</div>
      <div class="cas-sub-body">
        <div class="cas-sub-top"><span>${esc(name)}</span><span>${fmt(v)} <span class="cas-cur">UAH</span></span></div>
        <div class="ov-bar-bg"><div class="ov-bar" style="--c:${st.color};width:${sp}%"></div><span class="ov-pct">${sp}%</span></div>
      </div>
    </div>`;
  }).join('');

  el.querySelector('.cas-ops-btn').onclick = () => {
    closeCatSheet();
    catFilter = catName;
    state.tab = 'records';
    syncTabs(); renderAll();
  };
  el.classList.add('open');
}
function closeCatSheet() { document.getElementById('cat-action-overlay').classList.remove('open'); }

// ── RECORDS ────────────────────────────────────────────────
const CARD_MINI = '<svg viewBox="0 0 24 24" style="width:15px;height:15px;vertical-align:-2px;stroke:#aaa;fill:none;stroke-width:1.6"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 9h20"/></svg>';

function renderRecords() {
  const filtered = catFilter
    ? periodTxs().filter(t => parentCat(t.category) === catFilter)
    : periodTxs();
  const txs = filtered.sort((a, b) => new Date(b.date) - new Date(a.date));
  const el = document.getElementById('rec-list');

  // Category filter chip
  const chip = document.getElementById('rec-cat-chip');
  if (chip) {
    if (catFilter) {
      const st = catStyle(catFilter);
      chip.innerHTML = `<span class="rcc-ic" style="--c:${st.color}">${st.icon}</span><span>${esc(catFilter)}</span><button class="rcc-x" id="rcc-x">✕</button>`;
      chip.style.display = 'flex';
      document.getElementById('rcc-x').onclick = () => { catFilter = null; renderAll(); };
    } else {
      chip.style.display = 'none';
    }
  }

  if (!txs.length) { el.innerHTML = `<div class="empty"><div class="ic">📭</div>Немає операцій за період</div>`; return; }

  const groups = {};
  txs.forEach(t => {
    const d = new Date(t.date);
    const k = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    (groups[k] = groups[k] || { d, items: [] }).items.push(t);
  });

  el.innerHTML = Object.values(groups).map(g => {
    const net = g.items.reduce((s, t) => s + (t.type === 'income' ? Number(t.amount) : t.type === 'expense' ? -Number(t.amount) : 0), 0);
    const col = net > 0 ? 'var(--inc)' : net < 0 ? 'var(--exp)' : 'var(--text2)';
    return `<div class="rec-day">
      <div class="rec-day-head">
        <div class="rec-day-left">
          <span class="rec-day-num">${g.d.getDate()}</span>
          <span class="rec-day-meta">${relDay(g.d)}<br>${MONTHS_GEN[g.d.getMonth()].toUpperCase()} ${g.d.getFullYear()}</span>
        </div>
        <span class="rec-day-total" style="color:${col}">${fmt(Math.abs(net))} UAH</span>
      </div>
      ${g.items.map(recItem).join('')}
    </div>`;
  }).join('');

  el.querySelectorAll('.rec-item').forEach(it => {
    it.onclick = e => {
      if (e.target.closest('.rec-act-btn')) return;
      const id = it.dataset.id;
      if (openRecId === id) { it.classList.remove('open'); openRecId = null; }
      else { el.querySelectorAll('.rec-item.open').forEach(x => x.classList.remove('open')); it.classList.add('open'); openRecId = id; }
    };
    it.querySelector('.rec-edit').onclick = () => openForm(txMap[it.dataset.id]);
    it.querySelector('.rec-del').onclick = async () => { if (confirm('Видалити операцію?')) { await deleteTx(it.dataset.id); toast('Видалено'); } };
  });
}

function recItem(t) {
  const st = catStyle(t.category || t.account);
  const sign = t.type === 'expense' ? '−' : t.type === 'income' ? '+' : '';
  const col = t.type === 'expense' ? 'var(--exp)' : t.type === 'income' ? 'var(--inc)' : '#2f80ed';
  const sub = t.type === 'transfer' ? `${esc(t.account)} → ${esc(t.category)}` : `${CARD_MINI} ${esc(t.account || '')}`;
  return `<div class="rec-item" data-id="${t.id}">
    <div class="rec-icon" style="--c:${st.color}">${st.icon}</div>
    <div class="rec-info">
      <div class="rec-cat">${esc(t.category || t.account || '—')}</div>
      <div class="rec-acc">${sub}</div>
      ${t.note ? `<div class="rec-note">${esc(t.note)}</div>` : ''}
    </div>
    <span class="rec-amt" style="color:${col}">${sign}${fmt(t.amount)} <span style="font-size:11px;color:var(--text3)">UAH</span></span>
    <div class="rec-actions">
      <button class="rec-act-btn rec-edit">✎</button>
      <button class="rec-act-btn rec-del">✕</button>
    </div>
  </div>`;
}

// ── ACCOUNTS ───────────────────────────────────────────────
function accRow(a) {
  const st = catStyle(a.name);
  const cur = CUR_SUFFIX[a.currency] || a.currency || 'UAH';
  const lb = computeLiveBalance(a.name) ?? a.balance;
  const v = a.currency === 'UAH' ? fmt(lb) : fmtDec(lb);
  return `<div class="acc-row" data-acc="${escAttr(a.name)}">
    <div class="acc-ic" style="--c:${st.color}">${st.icon}</div>
    <div class="acc-name">${esc(a.name)}</div>
    <div class="acc-bal" style="color:${lb < 0 ? 'var(--exp)' : 'var(--text)'}">${v} <span style="font-size:11px;color:var(--text3)">${cur}</span></div>
  </div>`;
}

function renderAccounts() {
  const el = document.getElementById('acc-list');
  if (!accountsList.length) {
    el.innerHTML = `<div class="empty" style="padding:40px 20px"><div class="ic">💳</div>Імпортуй CSV з 1money — й тут з'являться рахунки з балансами.</div>`;
    return;
  }
  const reg = accountsList.filter(a => !isSavings(a.name) && a.group !== 'savings');
  const sav = accountsList.filter(a => isSavings(a.name) || a.group === 'savings');
  const liveSum = arr => arr.reduce((s, a) => {
    const lb = computeLiveBalance(a.name) ?? a.balance;
    return s + (a.currency === 'UAH' ? lb : (a.uah || 0));
  }, 0);
  const section = (title, arr) => arr.length
    ? `<div class="acc-section-title">${title}<span class="acc-section-sum" style="color:${liveSum(arr) < 0 ? 'var(--exp)' : 'var(--inc)'}">${fmt(liveSum(arr))} UAH</span></div>${arr.map(a => accRow(a)).join('')}`
    : '';
  el.innerHTML = section('Рахунки', reg) + section('Заощадження', sav);
  el.querySelectorAll('.acc-row').forEach(row => {
    row.onclick = () => openAccAction(row.dataset.acc);
  });
}

// ── ACCOUNT ACTION SHEET ───────────────────────────────────
function openAccAction(accName) {
  accActionCurrent = accName;
  const a = accountsList.find(x => x.name === accName);
  const st = catStyle(accName);
  const lb = computeLiveBalance(accName) ?? (a?.balance ?? 0);
  const cur = a ? (CUR_SUFFIX[a.currency] || a.currency || 'UAH') : 'UAH';
  const v = a?.currency === 'UAH' ? fmt(lb) : fmtDec(lb);
  document.getElementById('aas-ic').style.background = st.color;
  document.getElementById('aas-ic').innerHTML = st.icon;
  document.getElementById('aas-name').textContent = accName;
  document.getElementById('aas-bal').innerHTML = `${v} <span>${cur}</span>`;
  document.getElementById('aas-bal').style.color = lb < 0 ? 'var(--exp)' : 'var(--text)';
  document.getElementById('acc-action-overlay').classList.add('open');
}
function closeAccAction() { document.getElementById('acc-action-overlay').classList.remove('open'); }

// ── OVERVIEW ───────────────────────────────────────────────
function renderBarChart(txs, dir) {
  if (state.period === 'all') return '';
  const col = dir === 'expense' ? '#eb3b7e' : '#27ae60';
  let vals;
  if (state.period === 'year') {
    vals = Array.from({ length: 12 }, (_, m) =>
      txs.filter(t => t.type === dir && new Date(t.date).getMonth() === m).reduce((s, t) => s + Number(t.amount), 0)
    );
  } else {
    const year = state.cursor.getFullYear(), month = state.cursor.getMonth();
    const days = new Date(year, month + 1, 0).getDate();
    const dm = {};
    txs.filter(t => t.type === dir).forEach(t => { const d = new Date(t.date).getDate(); dm[d] = (dm[d] || 0) + Number(t.amount); });
    vals = Array.from({ length: days }, (_, i) => dm[i + 1] || 0);
  }
  const max = Math.max(...vals, 1);
  const n = vals.length, H = 42, gap = 2;
  const bw = Math.max(2, Math.floor((320 - (n - 1) * gap) / n));
  const bars = vals.map((v, i) => {
    const h = v > 0 ? Math.max(3, Math.round(v / max * H)) : 0;
    return `<rect x="${i * (bw + gap)}" y="${H - h}" width="${bw}" height="${h}" fill="${v > 0 ? col : '#eee'}" rx="1.5"/>`;
  }).join('');
  return `<div class="ov-barchart"><svg viewBox="0 0 ${n * (bw + gap)} ${H}" preserveAspectRatio="none" style="width:100%;height:52px;display:block">${bars}</svg></div>`;
}

function renderOverview() {
  const dir = state.ovDir;
  const txs = periodTxs();
  const exp = txs.filter(t => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0);
  const inc = txs.filter(t => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0);
  const balance = inc - exp;

  const sums = new Map();
  txs.filter(t => t.type === dir).forEach(t => { const p = parentCat(t.category); sums.set(p, (sums.get(p) || 0) + Number(t.amount)); });
  const list = [...sums.entries()].map(([name, v]) => ({ name, v })).sort((a, b) => b.v - a.v);
  const total = dir === 'expense' ? exp : inc;

  const breakdown = list.map(x => {
    const st = catStyle(x.name);
    const pct = total ? Math.round(x.v / total * 100) : 0;
    const expanded = ovExpanded.has(x.name);
    const subs = [...(subsByDir[dir].get(x.name) || [])].filter(Boolean);
    const subRows = expanded && subs.length ? subs.map(sub => {
      const sv = txs.filter(t => t.type === dir && parentCat(t.category) === x.name && subCat(t.category) === sub).reduce((s, t) => s + Number(t.amount), 0);
      const sp = x.v ? Math.round(sv / x.v * 100) : 0;
      return `<div class="ov-sub">
        <div class="ov-sub-dot" style="background:${st.color}"></div>
        <div class="ov-sub-body">
          <div class="ov-sub-top"><span>${esc(sub)}</span><span class="ov-cat-amt">${fmt(sv)} <span>UAH</span></span></div>
          <div class="ov-bar-bg"><div class="ov-bar" style="--c:${st.color};width:${sp}%"></div><span class="ov-pct">${sp}%</span></div>
        </div>
      </div>`;
    }).join('') : '';
    return `<div class="ov-cat${subs.length ? ' clickable' : ''}" data-cat="${escAttr(x.name)}">
      <div class="ov-cat-ic" style="--c:${st.color}">${st.icon}</div>
      <div class="ov-cat-body">
        <div class="ov-cat-top"><span>${esc(x.name)}</span><span class="ov-cat-amt">${fmt(x.v)} <span>UAH</span></span></div>
        <div class="ov-bar-bg"><div class="ov-bar" style="--c:${st.color};width:${pct}%"></div><span class="ov-pct">${pct}%</span></div>
      </div>
      ${subs.length ? `<span class="ov-chevron">${expanded ? '▲' : '▼'}</span>` : ''}
    </div>${subRows}`;
  }).join('') || `<div class="empty" style="font-size:13px">Немає даних</div>`;

  document.getElementById('ov-wrap').innerHTML = `
    ${renderBarChart(txs, dir)}
    <div class="ov-balance-label">Баланс</div>
    <div class="ov-balance" style="color:${balance < 0 ? 'var(--exp)' : 'var(--inc)'}">${fmt(balance)} UAH</div>
    <div class="ov-toggle">
      <button class="ov-tg ${dir === 'expense' ? 'exp' : 'dim'}" data-ov="expense"><div class="l">Витрати</div><div class="v">${fmt(exp)} UAH</div></button>
      <button class="ov-tg ${dir === 'income' ? 'inc' : 'dim'}" data-ov="income"><div class="l">Доходи</div><div class="v">${fmt(inc)} UAH</div></button>
    </div>
    ${breakdown}`;

  document.querySelectorAll('#ov-wrap .ov-tg').forEach(b => b.onclick = () => { state.ovDir = b.dataset.ov; renderOverview(); });
  document.querySelectorAll('#ov-wrap .ov-cat[data-cat]').forEach(el => {
    el.onclick = () => {
      const cat = el.dataset.cat;
      if (ovExpanded.has(cat)) ovExpanded.delete(cat); else ovExpanded.add(cat);
      renderOverview();
    };
  });
}

// ── TABS ───────────────────────────────────────────────────
function syncTabs() {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === state.tab));
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === state.tab + '-screen'));
}

// ── ADD / EDIT (calculator) ────────────────────────────────
let calcExpr = '';
const ARROW_ICON = '<svg viewBox="0 0 24 24" style="stroke:#fff;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round"><path d="M4 9h13l-4-4M20 15H7l4 4"/></svg>';

function openForm(tx = null, presetParent = null, presetDir = null, presetAccount = null) {
  editingTx = tx;
  const dir = tx ? tx.type : (presetDir || (state.catDir === 'income' ? 'income' : 'expense'));
  const defaultAcc = presetAccount
    || accountsList.find(a => !isSavings(a.name) && a.group !== 'savings')?.name
    || accountsAll[0] || '';
  formState = {
    type: dir,
    parent: tx ? (tx.type === 'transfer' ? '' : parentCat(tx.category)) : (presetParent || ''),
    sub: tx ? subCat(tx.category) : '',
    account: tx ? (tx.account || '') : defaultAcc,
    toAccount: tx && tx.type === 'transfer' ? (tx.category || '') : '',
    date: tx ? toLocal(tx.date) : nowLocal(),
  };
  calcExpr = tx ? String(tx.amount) : '';
  document.getElementById('note-input').value = tx ? (tx.note || '') : '';
  document.getElementById('date-input').value = formState.date;
  renderForm();
  document.getElementById('add-view').classList.add('active');
}
function closeForm() { document.getElementById('add-view').classList.remove('active'); editingTx = null; }

function setFormType(t) {
  const old = formState.type;
  formState.type = t;
  if (t === 'transfer') {
    formState.parent = ''; formState.sub = '';
  } else if ((old === 'expense' && t === 'income') || (old === 'income' && t === 'expense')) {
    formState.parent = ''; formState.sub = '';
  }
  renderForm();
}

function renderForm() {
  const t = formState.type;
  document.querySelectorAll('.ct').forEach(b => b.classList.toggle('active', b.dataset.type === t));
  const ll = document.getElementById('left-label'), lv = document.getElementById('left-val');
  const rl = document.getElementById('right-label'), rv = document.getElementById('right-val');
  const L = document.getElementById('side-left'), R = document.getElementById('side-right');
  const ACC = '#2D9CDB', CYAN = '#17B9CE';
  const pcol = formState.parent ? catStyle(formState.parent).color : '#c7c7cc';
  if (t === 'income') {
    ll.textContent = 'З категорії'; lv.textContent = formState.parent || 'Категорія'; L.style.background = pcol;
    rl.textContent = 'На рахунок'; rv.textContent = formState.account || 'Рахунок'; R.style.background = CYAN;
  } else if (t === 'transfer') {
    ll.textContent = 'З рахунку'; lv.textContent = formState.account || 'Рахунок'; L.style.background = ACC;
    rl.textContent = 'На рахунок'; rv.textContent = formState.toAccount || 'Рахунок'; R.style.background = ACC;
  } else {
    ll.textContent = 'З рахунку'; lv.textContent = formState.account || 'Рахунок'; L.style.background = ACC;
    rl.textContent = 'До категорії'; rv.textContent = formState.parent || 'Категорія'; R.style.background = pcol;
  }
  const orb = document.getElementById('calc-orb');
  orb.innerHTML = t === 'transfer' ? ARROW_ICON : (formState.parent ? catStyle(formState.parent).icon : '');
  orb.querySelectorAll('svg').forEach(s => s.style.stroke = t === 'transfer' ? '#2D9CDB' : pcol);
  renderSubchips();
  renderDisplay();
  document.getElementById('calc-date-label').textContent = dateLabel(formState.date);
}

function renderSubchips() {
  const box = document.getElementById('subchips');
  if (formState.type === 'transfer' || !formState.parent) { box.innerHTML = ''; return; }
  const subs = [...(subsByDir[formState.type].get(formState.parent) || [])].filter(Boolean).sort();
  box.innerHTML = subs.map(s => `<button class="chip ${formState.sub === s ? 'on' : ''}" data-sub="${escAttr(s)}">${esc(s)}</button>`).join('')
    + `<button class="chip add" data-sub="__new">＋</button>`;
  box.querySelectorAll('.chip').forEach(c => c.onclick = () => {
    const s = c.dataset.sub;
    if (s === '__new') { const n = prompt('Назва підкатегорії:'); if (n && n.trim()) formState.sub = n.trim(); }
    else formState.sub = formState.sub === s ? '' : s;
    renderForm();
  });
}

function renderDisplay() {
  const col = formState.type === 'expense' ? 'var(--exp)' : formState.type === 'income' ? 'var(--inc)' : '#2f80ed';
  document.getElementById('ca-label').textContent = formState.type === 'expense' ? 'Витрата' : formState.type === 'income' ? 'Дохід' : 'Переказ';
  document.getElementById('ca-label').style.color = col;
  const d = document.getElementById('ca-display');
  d.innerHTML = `${esc(calcExpr || '0')} <span>UAH</span>`;
  d.style.color = col;
}

function keyPress(k) {
  if (k === 'back') calcExpr = calcExpr.slice(0, -1);
  else if (k === 'cal') { const el = document.getElementById('date-input'); el.showPicker ? el.showPicker() : el.click(); return; }
  else if (k === 'cur') return;
  else if (k === 'ok') return saveCalc();
  else if ('÷×−+'.includes(k)) { if (calcExpr && !/[÷×−+]$/.test(calcExpr)) calcExpr += k; }
  else calcExpr += k;
  renderDisplay();
}

function evalExpr(s) {
  s = s.replace(/÷/g, '/').replace(/×/g, '*').replace(/−/g, '-').replace(/,/g, '.');
  const toks = s.match(/(\d+\.?\d*|[+\-*/])/g);
  if (!toks) return NaN;
  const prec = o => (o === '+' || o === '-') ? 1 : 2;
  const out = [], st = [];
  for (const tk of toks) {
    if (/[0-9.]/.test(tk[0])) out.push(parseFloat(tk));
    else { while (st.length && prec(st[st.length - 1]) >= prec(tk)) out.push(st.pop()); st.push(tk); }
  }
  while (st.length) out.push(st.pop());
  const stk = [];
  for (const tk of out) {
    if (typeof tk === 'number') stk.push(tk);
    else { const b = stk.pop(), a = stk.pop(); stk.push(tk === '+' ? a + b : tk === '-' ? a - b : tk === '*' ? a * b : a / b); }
  }
  return stk[0];
}

async function saveCalc() {
  const amount = Math.round((evalExpr(calcExpr) || 0) * 100) / 100;
  if (!amount || amount <= 0) return toast('Введи суму');
  const t = formState.type;
  if (t !== 'transfer' && !formState.parent) return toast('Оберіть категорію');
  if (!formState.account) return toast('Оберіть рахунок');
  if (t === 'transfer' && !formState.toAccount) return toast('Оберіть рахунок призначення');
  const category = t === 'transfer' ? formState.toAccount : (formState.sub ? `${formState.parent} (${formState.sub})` : formState.parent);
  const note = document.getElementById('note-input').value.trim();
  const dv = document.getElementById('date-input').value;
  const tx = { type: t, amount, account: formState.account, category, date: dv ? new Date(dv).toISOString() : new Date().toISOString(), note: note || null };
  try {
    if (editingTx) { await updateTx(editingTx.id, tx); toast('Оновлено ✓'); }
    else { await saveTx(tx); toast('Збережено ✓'); }
    closeForm();
  } catch (e) { toast('Помилка: ' + e.message); }
}

async function pickSideLeft() {
  if (formState.type === 'income') { const v = await openPicker('Категорія', catsParent.income); if (v) { formState.parent = v; formState.sub = ''; renderForm(); } }
  else { const v = await openPicker('Рахунок', accountsAll); if (v) { formState.account = v; renderForm(); } }
}
async function pickSideRight() {
  if (formState.type === 'expense') { const v = await openPicker('Категорія', catsParent.expense); if (v) { formState.parent = v; formState.sub = ''; renderForm(); } }
  else if (formState.type === 'transfer') { const v = await openPicker('На рахунок', accountsAll); if (v) { formState.toAccount = v; renderForm(); } }
  else { const v = await openPicker('Рахунок', accountsAll); if (v) { formState.account = v; renderForm(); } }
}

// ── PICKER ─────────────────────────────────────────────────
function openPicker(title, items) {
  return new Promise(res => {
    pickerResolve = res;
    document.getElementById('sheet-title').textContent = title;
    document.getElementById('sheet-search').value = '';
    drawPicker(items);
    document.getElementById('sheet-overlay').classList.add('open');
    const s = document.getElementById('sheet-search');
    s.oninput = () => drawPicker(items.filter(i => i.toLowerCase().includes(s.value.toLowerCase())), s.value);
    setTimeout(() => s.focus(), 200);
  });
}
function drawPicker(items, nv = '') {
  const list = document.getElementById('sheet-list');
  const rows = items.map(i => { const st = catStyle(i); return `<div class="sheet-item" data-v="${escAttr(i)}"><span class="sheet-item-ic" style="--c:${st.color}">${st.icon}</span><span>${esc(i)}</span></div>`; }).join('');
  const add = nv && !items.includes(nv) ? `<div class="sheet-item" data-v="${escAttr(nv)}"><span class="sheet-item-ic" style="--c:#bbb">${ic('tag')}</span><span>Додати «${esc(nv)}»</span></div>` : '';
  list.innerHTML = rows + add;
  list.querySelectorAll('.sheet-item').forEach(el => el.onclick = () => closePicker(el.dataset.v));
}
function closePicker(v) { document.getElementById('sheet-overlay').classList.remove('open'); if (pickerResolve) { pickerResolve(v); pickerResolve = null; } }

// ── IMPORT ─────────────────────────────────────────────────
const TYPE_MAP = { 'витрата':'expense','expense':'expense','дохід':'income','income':'income','переказ':'transfer','transfer':'transfer','повернення':'return','return':'return' };

function parse1money(lines, h) {
  const col = n => h.indexOf(n);
  const I = { date: col('дата'), type: col('тип'), from: col('з рахунку'), to: col('на рахунок/до категорії'), amt: col('кількість'), cur: col('валюта'), amt2: col('кількість 2'), cur2: col('валюта 2'), tags: col('помітки'), note: col('нотатки') };
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const c = parseLine(lines[i]);
    const type = TYPE_MAP[(c[I.type] || '').trim().toLowerCase()];
    if (!type) continue;
    const m = (c[I.date] || '').trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);
    if (!m) continue;
    const yr = m[3].length === 2 ? '20' + m[3] : m[3];
    const iso = new Date(`${yr}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}T12:00:00`).toISOString();
    const oc = (c[I.cur] || '').trim(), c2 = (c[I.cur2] || '').trim();
    let amount, foreign = '';
    if (oc === 'UAH' || oc === '') amount = parseFloat((c[I.amt] || '0').replace(',', '.'));
    else if (c2 === 'UAH') { amount = parseFloat((c[I.amt2] || '0').replace(',', '.')); foreign = `${c[I.amt]} ${oc}`; }
    else { amount = parseFloat((c[I.amt] || '0').replace(',', '.')); foreign = `${c[I.amt]} ${oc}`; }
    if (!amount) continue;
    const note = [(c[I.note] || '').trim(), (c[I.tags] || '').trim(), foreign].filter(Boolean).join(' · ');
    rows.push({ date: iso, type, account: (c[I.from] || '').trim() || null, category: (c[I.to] || '').trim() || null, amount, note: note || null });
  }
  return rows;
}
function parseSimple(lines, h) {
  const I = { date: h.indexOf('date'), type: h.indexOf('type'), account: h.indexOf('account'), category: h.indexOf('category'), amount: h.indexOf('amount'), note: h.indexOf('note') };
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const c = parseLine(lines[i]);
    const amount = parseFloat((c[I.amount] || '0').replace(',', '.'));
    if (!amount) continue;
    rows.push({ date: new Date(c[I.date] || Date.now()).toISOString(), type: TYPE_MAP[(c[I.type] || '').trim().toLowerCase()] || 'expense', account: c[I.account]?.trim() || null, category: c[I.category]?.trim() || null, amount, note: c[I.note]?.trim() || null });
  }
  return rows;
}
function parseBalances(lines, rates) {
  const out = []; let started = false;
  const RATE = { UAH: 1, USD: rates.USD || 41, EUR: rates.EUR || 47, PLN: rates.PLN || 11 };
  for (const ln of lines) {
    const c = parseLine(ln);
    if (!started) { if ((c[0] || '').toLowerCase().includes('назва') && (c[1] || '').toLowerCase().includes('баланс')) started = true; continue; }
    if (c.length < 3) continue;
    const name = (c[0] || '').trim();
    if (!name) continue;
    const balance = parseFloat((c[1] || '0').replace(',', '.')) || 0;
    const currency = (c[2] || 'UAH').trim() || 'UAH';
    out.push({ name, balance, currency, uah: Math.round(balance * (RATE[currency] || 1)), group: isSavings(name) ? 'savings' : 'regular' });
  }
  return out;
}
function deriveRates(lines, h) {
  const ai = h.indexOf('кількість'), ci = h.indexOf('валюта'), ai2 = h.indexOf('кількість 2'), ci2 = h.indexOf('валюта 2');
  const acc = {};
  for (let i = 1; i < lines.length; i++) {
    const c = parseLine(lines[i]);
    const oc = (c[ci] || '').trim(), c2 = (c[ci2] || '').trim();
    if (!oc || oc === 'UAH' || c2 !== 'UAH') continue;
    const a = parseFloat((c[ai] || '').replace(',', '.')), u = parseFloat((c[ai2] || '').replace(',', '.'));
    if (a > 0 && u > 0) (acc[oc] = acc[oc] || []).push(u / a);
  }
  const rates = {};
  for (const k in acc) { const arr = acc[k].sort((x, y) => x - y); rates[k] = arr[Math.floor(arr.length / 2)]; }
  return rates;
}
async function importCSV(file) {
  const text = await file.text();
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  const h = parseLine(lines[0].replace(/^﻿/, '')).map(x => x.trim().toLowerCase());
  const native = h.includes('з рахунку') || h.includes('на рахунок/до категорії');
  const rows = native ? parse1money(lines, h) : parseSimple(lines, h);
  const rates = native ? deriveRates(lines, h) : {};
  const accounts = native ? parseBalances(lines, rates) : [];

  if (Object.keys(txMap).length && !confirm('Замінити всі наявні дані новим імпортом? (старі записи буде видалено, щоб не було дублів)')) return;

  const box = document.getElementById('import-progress');
  const bar = document.getElementById('progress-bar');
  const st = document.getElementById('import-status');
  const tt = document.getElementById('import-progress-text');
  box.style.display = ''; tt.textContent = 'Очищення старих даних...';
  await remove(ref(db, TX_PATH));
  txMap = {};

  tt.textContent = `Завантаження ${rows.length} операцій...`;
  const BATCH = 500; let done = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const upd = {};
    for (const row of rows.slice(i, i + BATCH)) upd[push(ref(db, TX_PATH)).key] = row;
    await update(ref(db, TX_PATH), upd);
    done += Object.keys(upd).length;
    bar.style.width = Math.round(done / rows.length * 100) + '%';
    st.textContent = `${done} / ${rows.length}`;
  }
  if (accounts.length) await set(ref(db, ACC_PATH), accounts);

  // Save cutoff so computeLiveBalance knows what's already in snapshot
  const maxDate = rows.reduce((m, r) => Math.max(m, new Date(r.date).getTime()), 0);
  if (maxDate) { await set(ref(db, 'finance/meta/importedUpTo'), maxDate); importedUpTo = maxDate; }

  tt.textContent = `✓ Імпортовано ${done} операцій, ${accounts.length} рахунків`;
  toast('Імпорт завершено!');
}
function parseLine(line) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') { q = !q; continue; }
    if (line[i] === ',' && !q) { out.push(cur); cur = ''; continue; }
    cur += line[i];
  }
  out.push(cur); return out;
}

// ── EVENTS ─────────────────────────────────────────────────
function bindEvents() {
  document.querySelectorAll('.tab').forEach(t => t.onclick = () => { state.tab = t.dataset.tab; syncTabs(); renderAll(); });

  document.getElementById('prev-month').onclick = () => shift(-1);
  document.getElementById('next-month').onclick = () => shift(1);

  document.getElementById('fab').onclick = () => openForm();
  document.getElementById('add-close').onclick = closeForm;
  document.querySelectorAll('.ct').forEach(b => b.onclick = () => setFormType(b.dataset.type));
  document.getElementById('keypad').querySelectorAll('button').forEach(b => b.onclick = () => keyPress(b.dataset.k));
  document.getElementById('side-left').onclick = pickSideLeft;
  document.getElementById('side-right').onclick = pickSideRight;
  document.getElementById('date-input').onchange = e => { formState.date = e.target.value; document.getElementById('calc-date-label').textContent = dateLabel(formState.date); };

  document.getElementById('sheet-overlay').onclick = e => { if (e.target.id === 'sheet-overlay') closePicker(null); };

  document.getElementById('btn-period').onclick = openPeriod;
  document.getElementById('period-overlay').onclick = e => { if (e.target.id === 'period-overlay') e.currentTarget.classList.remove('open'); };
  document.querySelectorAll('.period-btn').forEach(b => b.onclick = () => {
    state.period = b.dataset.period;
    document.getElementById('period-overlay').classList.remove('open');
    renderAll();
  });

  document.getElementById('btn-accounts-filter').onclick = openFilter;
  document.getElementById('btn-accounts-filter2').onclick = () => { state.tab = 'accounts'; syncTabs(); renderAll(); };
  document.getElementById('filter-overlay').onclick = e => { if (e.target.id === 'filter-overlay') e.currentTarget.classList.remove('open'); };
  document.getElementById('filter-x').onclick = () => document.getElementById('filter-overlay').classList.remove('open');
  document.getElementById('filter-reset').onclick = () => { filterTemp = new Set(filterNames()); drawFilter(); };
  document.getElementById('filter-done').onclick = () => {
    const all = filterNames();
    selectedAccounts = (filterTemp && filterTemp.size && filterTemp.size < all.length) ? new Set(filterTemp) : null;
    document.getElementById('filter-overlay').classList.remove('open');
    renderAll();
  };

  document.getElementById('btn-profile').onclick = () => document.getElementById('settings-overlay').classList.add('open');
  document.getElementById('settings-overlay').onclick = e => { if (e.target.id === 'settings-overlay') e.currentTarget.classList.remove('open'); };
  document.getElementById('btn-import').onclick = () => document.getElementById('import-file').click();
  document.getElementById('import-file').onchange = e => { const f = e.target.files[0]; if (f) importCSV(f); };

  // Account action sheet
  document.getElementById('acc-action-overlay').onclick = e => { if (e.target.id === 'acc-action-overlay') closeAccAction(); };
  document.getElementById('aab-ops').onclick = () => {
    closeAccAction();
    selectedAccounts = new Set([accActionCurrent]);
    state.tab = 'records'; syncTabs(); renderAll();
  };
  document.getElementById('aab-top').onclick = () => { closeAccAction(); openForm(null, null, 'income', accActionCurrent); };
  document.getElementById('aab-spend').onclick = () => { closeAccAction(); openForm(null, null, 'expense', accActionCurrent); };
  document.getElementById('aab-transfer').onclick = () => { closeAccAction(); openForm(null, null, 'transfer', accActionCurrent); };

  // Category detail sheet
  document.getElementById('cat-action-overlay').onclick = e => { if (e.target.id === 'cat-action-overlay') closeCatSheet(); };
  document.getElementById('cas-close').onclick = closeCatSheet;
}

function shift(d) {
  if (state.period === 'all') return;
  if (state.period === 'year') state.cursor = new Date(state.cursor.getFullYear() + d, 0, 1);
  else state.cursor = new Date(state.cursor.getFullYear(), state.cursor.getMonth() + d, 1);
  renderAll();
}
let filterTemp = null;
function filterNames() { return accountsList.length ? accountsList.map(a => a.name) : [...accountsAll]; }
function openFilter() {
  const all = filterNames();
  if (!all.length) { toast('Спочатку імпортуй дані'); return; }
  filterTemp = new Set(selectedAccounts ? [...selectedAccounts] : all);
  drawFilter();
  document.getElementById('filter-overlay').classList.add('open');
}
function faCard(name, balText) {
  const st = catStyle(name);
  const on = filterTemp.has(name);
  return `<div class="fa-card ${on ? 'on' : 'off'}" data-name="${escAttr(name)}">
    <div class="fa-ic" style="--c:${st.color}">${st.icon}</div>
    <div class="fa-tx"><div class="fa-name">${esc(name)}</div>${balText ? `<div class="fa-bal" style="color:${st.color}">${balText}</div>` : ''}</div>
  </div>`;
}
function drawFilter() {
  const el = document.getElementById('filter-list');
  if (accountsList.length) {
    const reg = accountsList.filter(a => a.group !== 'savings' && !isSavings(a.name));
    const sav = accountsList.filter(a => a.group === 'savings' || isSavings(a.name));
    const cards = a => `<div class="filter-grid">${a.map(x => { const cur = CUR_SUFFIX[x.currency] || x.currency; const v = x.currency === 'UAH' ? fmt(x.balance) : fmtDec(x.balance); return faCard(x.name, `${v} ${cur}`); }).join('')}</div>`;
    el.innerHTML = (reg.length ? `<div class="filter-sub">Рахунки</div>${cards(reg)}` : '')
                 + (sav.length ? `<div class="filter-sub">Накопичувальні рахунки</div>${cards(sav)}` : '');
  } else {
    el.innerHTML = `<div class="filter-grid">${[...accountsAll].map(n => faCard(n, '')).join('')}</div>`;
  }
  el.querySelectorAll('.fa-card').forEach(c => c.onclick = () => {
    const n = c.dataset.name;
    if (filterTemp.has(n)) filterTemp.delete(n); else filterTemp.add(n);
    drawFilter();
  });
}
function openPeriod() {
  const c = state.cursor;
  document.getElementById('pb-month-day').textContent = new Date(c.getFullYear(), c.getMonth() + 1, 0).getDate();
  document.getElementById('pb-month-sub').textContent = `${MONTHS[c.getMonth()]} ${c.getFullYear()}`;
  document.getElementById('pb-year-sub').textContent = `Рік ${c.getFullYear()}`;
  document.querySelectorAll('.period-btn').forEach(b => b.classList.toggle('active', b.dataset.period === state.period));
  document.getElementById('period-overlay').classList.add('open');
}

// ── HELPERS ────────────────────────────────────────────────
function fmt(n) { const v = Math.round(Number(n) || 0); return v.toLocaleString('uk-UA').replace(/,/g, ' '); }
function fmtDec(n) { return (Number(n) || 0).toLocaleString('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/ /g, ' '); }
function relDay(d) {
  const t = new Date(); t.setHours(0,0,0,0);
  const y = new Date(t); y.setDate(t.getDate() - 1);
  const x = new Date(d); x.setHours(0,0,0,0);
  if (x.getTime() === t.getTime()) return 'СЬОГОДНІ';
  if (x.getTime() === y.getTime()) return 'ВЧОРА';
  return WEEKDAYS[d.getDay()].toUpperCase();
}
const MON_SHORT = ['січ.','лют.','бер.','кві.','тра.','чер.','лип.','сер.','вер.','жов.','лис.','гру.'];
function dateLabel(local) {
  const d = local ? new Date(local) : new Date();
  const today = new Date(); today.setHours(0,0,0,0);
  const x = new Date(d); x.setHours(0,0,0,0);
  const base = `${d.getDate()} ${MON_SHORT[d.getMonth()]} ${d.getFullYear()} р.`;
  return x.getTime() === today.getTime() ? `Сьогодні, ${base}` : base;
}
function nowLocal() { const d = new Date(), p = n => String(n).padStart(2,'0'); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; }
function toLocal(iso) { const d = new Date(iso), p = n => String(n).padStart(2,'0'); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; }
function esc(s) { return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function escAttr(s) { return esc(s).replace(/"/g,'&quot;'); }
let tT;
function toast(m) { const e = document.getElementById('toast'); e.textContent = m; e.classList.add('show'); clearTimeout(tT); tT = setTimeout(() => e.classList.remove('show'), 2400); }
