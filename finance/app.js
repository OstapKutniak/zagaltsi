import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js';
import {
  getDatabase, ref, push, set, update, remove,
  onChildAdded, onChildChanged, onChildRemoved
} from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-database.js';

// ── FIREBASE (reuse existing game project) ─────────────────
const firebaseConfig = {
  apiKey: 'AIzaSyBvg2av881ZTi9op-bzwicL70vh2UENItw',
  authDomain: 'horugva-ff8bd.firebaseapp.com',
  databaseURL: 'https://horugva-ff8bd-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'horugva-ff8bd',
  storageBucket: 'horugva-ff8bd.firebasestorage.app',
  messagingSenderId: '1011491870660',
  appId: '1:1011491870660:web:e02210da9c21bb38a5b691',
};
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const TX_PATH = 'finance/transactions';

// ── CONSTANTS ──────────────────────────────────────────────
const MONTHS_UK = ['Січень','Лютий','Березень','Квітень','Травень','Червень',
                   'Липень','Серпень','Вересень','Жовтень','Листопад','Грудень'];

const CATEGORY_EMOJI = {
  'їжа':'🍽️','продукти':'🛒','кафе':'☕','ресторан':'🍴','піца':'🍕',
  'дозвілля':'🎭','розваги':'🎮','кіно':'🎬','самокат':'🛴','спорт':'⚽',
  'транспорт':'🚗','таксі':'🚕','метро':'🚇','паркінг':'🅿️',
  'придбання':'🛍️','одяг':'👕','техніка':'📱','взуття':'👟',
  'здоров\'я':'💊','ліки':'💉','лікар':'🏥','психотерапія':'🧠','адалімумаб':'💉',
  'комунальні':'🏠','оренда':'🏘️','щомісячне':'📅','підписка':'📺',
  'подарунки':'🎁','квіти':'💐',
  'борг':'💸','переказ':'↔️',
  'зарплата':'💰','дохід':'📈',
  'готівка':'💵','карта':'💳',
  'інше':'📦','другое':'📦',
  'добирання':'🚌','покупки':'🛍️','сім\'я':'👨‍👩‍👧',
};

// ── STATE ──────────────────────────────────────────────────
let txMap = {};                 // id -> transaction (all, in memory)
let currentMonth = new Date();
let editingTx = null;
let formState = { type: 'expense', category: '', account: '', toAccount: '', date: '', note: '' };
let knownCategories = [];
let knownAccounts = [];
let pickerResolve = null;
let openTxId = null;
let renderTimer = null;

// ── INIT ───────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/zagaltsi/finance/sw.js', { scope: '/zagaltsi/finance/' }).catch(() => {});
  }
  loadKnownValues();
  bindEvents();
  showView('list');
  subscribe();
});

// ── FIREBASE SYNC ──────────────────────────────────────────
function subscribe() {
  const r = ref(db, TX_PATH);
  onChildAdded(r,   snap => { txMap[snap.key] = { id: snap.key, ...snap.val() }; scheduleRender(); });
  onChildChanged(r, snap => { txMap[snap.key] = { id: snap.key, ...snap.val() }; scheduleRender(); });
  onChildRemoved(r, snap => { delete txMap[snap.key]; scheduleRender(); });
}

function scheduleRender() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(renderList, 60);
}

async function saveTransaction(tx) {
  const r = push(ref(db, TX_PATH));
  await set(r, tx);
}

async function updateTransaction(id, tx) {
  await update(ref(db, `${TX_PATH}/${id}`), tx);
}

async function deleteTransaction(id) {
  await remove(ref(db, `${TX_PATH}/${id}`));
}

// ── KNOWN VALUES (localStorage) ────────────────────────────
function loadKnownValues() {
  const stored = localStorage.getItem('fin_known');
  if (stored) {
    const d = JSON.parse(stored);
    knownCategories = d.categories || [];
    knownAccounts   = d.accounts   || [];
  }
}
function saveKnownValues() {
  localStorage.setItem('fin_known', JSON.stringify({ categories: knownCategories, accounts: knownAccounts }));
}
function learnFromTx(tx) {
  if (tx.category) knownCategories = [tx.category, ...knownCategories.filter(c => c !== tx.category)].slice(0, 80);
  if (tx.account)  knownAccounts   = [tx.account,  ...knownAccounts.filter(a => a !== tx.account)].slice(0, 40);
  saveKnownValues();
}
// learn categories/accounts from everything synced (so pickers are full)
function rebuildKnownFromData() {
  const cats = new Set(knownCategories), accs = new Set(knownAccounts);
  Object.values(txMap).forEach(t => {
    if (t.category) cats.add(t.category);
    if (t.account)  accs.add(t.account);
  });
  knownCategories = [...cats];
  knownAccounts   = [...accs];
  saveKnownValues();
}

// ── VIEWS ──────────────────────────────────────────────────
function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(name + '-view').classList.add('active');
}

// ── RENDER LIST ────────────────────────────────────────────
function monthTxs() {
  const y = currentMonth.getFullYear(), m = currentMonth.getMonth();
  return Object.values(txMap)
    .filter(t => { const d = new Date(t.date); return d.getFullYear() === y && d.getMonth() === m; })
    .sort((a, b) => new Date(b.date) - new Date(a.date));
}

function renderList() {
  const list = document.getElementById('tx-list');
  const txs = monthTxs();
  updateHeader(txs);
  rebuildKnownFromData();

  if (!txs.length) {
    list.innerHTML = `<div class="empty-state"><div class="icon">📭</div><p>Немає операцій за цей місяць</p></div>`;
    return;
  }

  const groups = {};
  txs.forEach(tx => {
    const d = new Date(tx.date);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    if (!groups[key]) groups[key] = { date: d, txs: [] };
    groups[key].txs.push(tx);
  });

  list.innerHTML = Object.values(groups).map(g => {
    const dayTotal = g.txs.reduce((s, tx) => {
      if (tx.type === 'expense' || tx.type === 'return') return s - Number(tx.amount);
      if (tx.type === 'income')  return s + Number(tx.amount);
      return s;
    }, 0);
    const totalClass = dayTotal < 0 ? 'expense' : dayTotal > 0 ? 'income' : '';
    const totalStr   = (dayTotal > 0 ? '+' : '') + fmtAmt(dayTotal);
    return `<div class="day-group">
      <div class="day-header">
        <span>${fmtDay(g.date)}</span>
        <span class="day-total" style="color:var(--${totalClass || 'text2'})">${totalStr} ₴</span>
      </div>
      ${g.txs.map(txHTML).join('')}
    </div>`;
  }).join('');

  list.querySelectorAll('.tx-item').forEach(el => {
    el.addEventListener('click', e => {
      if (e.target.closest('.tx-delete-btn') || e.target.closest('.tx-edit-btn')) return;
      const id = el.dataset.id;
      if (openTxId === id) { el.classList.remove('show-actions'); openTxId = null; }
      else {
        document.querySelectorAll('.tx-item.show-actions').forEach(x => x.classList.remove('show-actions'));
        el.classList.add('show-actions'); openTxId = id;
      }
    });
    const delBtn = el.querySelector('.tx-delete-btn');
    if (delBtn) delBtn.addEventListener('click', async e => {
      e.stopPropagation();
      if (!confirm('Видалити операцію?')) return;
      try { await deleteTransaction(el.dataset.id); toast('Видалено'); }
      catch (err) { toast('Помилка: ' + err.message); }
    });
    const editBtn = el.querySelector('.tx-edit-btn');
    if (editBtn) editBtn.addEventListener('click', e => {
      e.stopPropagation();
      openAddForm(txMap[el.dataset.id]);
    });
  });
}

function txHTML(tx) {
  const emoji = getCategoryEmoji(tx.category || tx.account || '');
  const typeClass = tx.type === 'return' ? 'income' : (tx.type || 'expense');
  const sign  = tx.type === 'expense' ? '−' : tx.type === 'income' ? '+' : '';
  const sub   = tx.type === 'transfer'
    ? `${tx.account} → ${tx.category}`
    : `${tx.account || ''}${tx.note ? (tx.account ? ' · ' : '') + tx.note : ''}`;
  return `<div class="tx-item" data-id="${tx.id}">
    <div class="tx-icon ${typeClass}">${emoji}</div>
    <div class="tx-info">
      <div class="tx-cat">${escHtml(tx.category || tx.account || '—')}</div>
      ${sub ? `<div class="tx-sub">${escHtml(sub)}</div>` : ''}
    </div>
    <span class="tx-amount ${typeClass}">${sign}${fmtAmt(tx.amount)} ₴</span>
    <div class="tx-actions">
      <button class="tx-edit-btn" title="Редагувати">✎</button>
      <button class="tx-delete-btn" title="Видалити">✕</button>
    </div>
  </div>`;
}

function updateHeader(txs) {
  document.getElementById('month-label').textContent =
    `${MONTHS_UK[currentMonth.getMonth()]} ${currentMonth.getFullYear()}`;
  const exp = txs.filter(t => t.type === 'expense' || t.type === 'return').reduce((s, t) => s + Number(t.amount), 0);
  const inc = txs.filter(t => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0);
  document.getElementById('total-exp').textContent = fmtAmt(exp) + ' ₴';
  document.getElementById('total-inc').textContent = fmtAmt(inc) + ' ₴';
  const bal = inc - exp;
  const balEl = document.getElementById('total-bal');
  balEl.textContent = (bal >= 0 ? '+' : '') + fmtAmt(bal) + ' ₴';
  balEl.style.color = bal >= 0 ? 'var(--income)' : 'var(--expense)';
}

// ── ADD / EDIT FORM ────────────────────────────────────────
function openAddForm(tx = null) {
  editingTx = tx;
  formState = tx ? {
    type: tx.type, category: tx.type === 'transfer' ? '' : (tx.category || ''),
    account: tx.account || '', toAccount: tx.type === 'transfer' ? (tx.category || '') : '',
    date: tx.date ? toLocalInput(tx.date) : nowLocal(), note: tx.note || ''
  } : { type: 'expense', category: '', account: '', toAccount: '', date: nowLocal(), note: '' };

  document.getElementById('add-title').textContent = tx ? 'Редагувати' : 'Нова операція';
  document.getElementById('amount-input').value = tx ? tx.amount : '';
  setFormType(formState.type);
  updateFormFields();
  showView('add');
  if (!tx) setTimeout(() => document.getElementById('amount-input').focus(), 300);
}

function setFormType(type) {
  formState.type = type;
  document.querySelectorAll('.type-btn').forEach(b => b.classList.toggle('active', b.dataset.type === type));
  document.getElementById('field-to-account').style.display = type === 'transfer' ? '' : 'none';
  document.getElementById('field-category').style.display   = type === 'transfer' ? 'none' : '';
}

function updateFormFields() {
  const catVal = document.getElementById('cat-value');
  catVal.textContent = formState.category || 'Обрати';
  catVal.className = 'field-value' + (formState.category ? '' : ' placeholder');
  document.getElementById('cat-icon').textContent = getCategoryEmoji(formState.category);
  const accVal = document.getElementById('acc-value');
  accVal.textContent = formState.account || 'Обрати';
  accVal.className = 'field-value' + (formState.account ? '' : ' placeholder');
  const toVal = document.getElementById('to-acc-value');
  toVal.textContent = formState.toAccount || 'Обрати';
  toVal.className = 'field-value' + (formState.toAccount ? '' : ' placeholder');
  document.getElementById('date-input').value = formState.date || nowLocal();
  document.getElementById('note-input').value = formState.note;
}

async function submitForm() {
  const amount = parseFloat(document.getElementById('amount-input').value.replace(',', '.'));
  if (!amount || amount <= 0) { toast('Введи суму'); return; }
  const dateVal = document.getElementById('date-input').value;
  const note    = document.getElementById('note-input').value.trim();
  if (formState.type !== 'transfer' && !formState.category) { toast('Оберіть категорію'); return; }
  if (!formState.account) { toast('Оберіть рахунок'); return; }
  if (formState.type === 'transfer' && !formState.toAccount) { toast('Оберіть рахунок призначення'); return; }

  const tx = {
    type: formState.type,
    amount,
    account: formState.account,
    category: formState.type === 'transfer' ? formState.toAccount : formState.category,
    date: dateVal ? new Date(dateVal).toISOString() : new Date().toISOString(),
    note: note || null,
  };

  const btn = document.getElementById('add-save');
  btn.disabled = true;
  try {
    if (editingTx) { await updateTransaction(editingTx.id, tx); toast('Оновлено ✓'); }
    else { await saveTransaction(tx); toast('Збережено ✓'); }
    learnFromTx(tx);
    editingTx = null;
    showView('list');
  } catch (e) {
    toast('Помилка: ' + e.message);
  } finally {
    btn.disabled = false;
  }
}

// ── PICKER ────────────────────────────────────────────────
function openPicker(title, items) {
  return new Promise(resolve => {
    pickerResolve = resolve;
    document.getElementById('sheet-title').textContent = title;
    document.getElementById('sheet-search').value = '';
    renderPickerList(items);
    document.getElementById('sheet-overlay').classList.add('open');
    const search = document.getElementById('sheet-search');
    search.oninput = () => renderPickerList(
      items.filter(i => i.toLowerCase().includes(search.value.toLowerCase())), search.value);
    setTimeout(() => search.focus(), 200);
  });
}
function renderPickerList(items, newValue = '') {
  const list = document.getElementById('sheet-list');
  const rows = items.map(item => `
    <div class="sheet-item" data-val="${escHtml(item)}">
      <span class="sheet-item-icon">${getCategoryEmoji(item)}</span><span>${escHtml(item)}</span>
    </div>`).join('');
  const addNew = newValue && !items.includes(newValue)
    ? `<div class="sheet-item" data-val="${escHtml(newValue)}">
        <span class="sheet-item-icon">➕</span><span>Додати «${escHtml(newValue)}»</span></div>` : '';
  list.innerHTML = rows + addNew;
  list.querySelectorAll('.sheet-item').forEach(el =>
    el.addEventListener('click', () => closePicker(el.dataset.val)));
}
function closePicker(value) {
  document.getElementById('sheet-overlay').classList.remove('open');
  if (pickerResolve) { pickerResolve(value); pickerResolve = null; }
}

// ── IMPORT ────────────────────────────────────────────────
async function importCSV(file) {
  const text = await file.text();
  const lines = text.split('\n').filter(l => l.trim());
  const header = lines[0].replace(/^﻿/, '').toLowerCase().split(',');
  const idx = {
    date: header.indexOf('date'), type: header.indexOf('type'),
    account: header.indexOf('account'), category: header.indexOf('category'),
    amount: header.indexOf('amount'), note: header.indexOf('note'),
  };
  const TYPE_MAP = {
    'витрата':'expense','expense':'expense','дохід':'income','income':'income',
    'переказ':'transfer','transfer':'transfer','повернення':'return','return':'return',
    'інше':'other','other':'other',
  };
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    const amount = parseFloat((cols[idx.amount] || '0').replace(',', '.'));
    if (!amount) continue;
    rows.push({
      date: new Date(cols[idx.date] || Date.now()).toISOString(),
      type: TYPE_MAP[cols[idx.type]?.trim().toLowerCase()] || 'expense',
      account: cols[idx.account]?.trim() || null,
      category: cols[idx.category]?.trim() || null,
      amount, note: cols[idx.note]?.trim() || null,
    });
  }

  const prog = document.getElementById('import-progress');
  const bar  = document.getElementById('progress-bar');
  const statusEl = document.getElementById('import-status');
  const titleEl  = document.getElementById('import-progress-text');
  prog.style.display = '';
  titleEl.textContent = `Завантаження ${rows.length} операцій...`;

  const BATCH = 500;
  let done = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const updates = {};
    for (const row of batch) {
      const key = push(ref(db, TX_PATH)).key;
      updates[key] = row;
    }
    await update(ref(db, TX_PATH), updates);
    done += batch.length;
    const pct = Math.round(done / rows.length * 100);
    bar.style.width = pct + '%';
    statusEl.textContent = `${done} / ${rows.length}`;
  }
  titleEl.textContent = `✓ Імпортовано ${done} операцій`;
  document.getElementById('import-result').style.display = '';
  toast('Імпорт завершено!');
}

function parseCSVLine(line) {
  const result = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') { q = !q; continue; }
    if (line[i] === ',' && !q) { result.push(cur); cur = ''; continue; }
    cur += line[i];
  }
  result.push(cur);
  return result;
}

// ── BIND EVENTS ────────────────────────────────────────────
function bindEvents() {
  document.getElementById('prev-month').addEventListener('click', () => {
    currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1); renderList();
  });
  document.getElementById('next-month').addEventListener('click', () => {
    currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1); renderList();
  });

  document.getElementById('add-btn').addEventListener('click', () => openAddForm());
  document.getElementById('add-close').addEventListener('click', () => { editingTx = null; showView('list'); });
  document.getElementById('add-save').addEventListener('click', submitForm);

  document.querySelectorAll('.type-btn').forEach(btn =>
    btn.addEventListener('click', () => { setFormType(btn.dataset.type); updateFormFields(); }));

  document.getElementById('field-category').addEventListener('click', async () => {
    const val = await openPicker('Категорія', [...knownCategories]);
    if (val) { formState.category = val; updateFormFields(); }
  });
  document.getElementById('field-account').addEventListener('click', async () => {
    const val = await openPicker('Рахунок', [...knownAccounts]);
    if (val) { formState.account = val; updateFormFields(); }
  });
  document.getElementById('field-to-account').addEventListener('click', async () => {
    const val = await openPicker('На рахунок', [...knownAccounts]);
    if (val) { formState.toAccount = val; updateFormFields(); }
  });

  document.getElementById('sheet-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('sheet-overlay')) closePicker(null);
  });

  document.getElementById('nav-settings').addEventListener('click', () => showView('settings'));
  document.getElementById('nav-list').addEventListener('click', () => showView('list'));
  document.getElementById('nav-list-from-settings').addEventListener('click', () => showView('list'));

  document.getElementById('btn-import').addEventListener('click', () => {
    document.getElementById('import-progress').style.display = 'none';
    document.getElementById('import-result').style.display = 'none';
    document.getElementById('progress-bar').style.width = '0%';
    showView('import');
  });

  document.getElementById('import-back').addEventListener('click', () => showView('settings'));
  document.getElementById('import-back2').addEventListener('click', () => showView('settings'));
  document.getElementById('import-zone').addEventListener('click', () => document.getElementById('import-file').click());
  document.getElementById('import-file').addEventListener('change', e => {
    const file = e.target.files[0]; if (file) importCSV(file);
  });

  document.getElementById('tx-list').addEventListener('click', e => {
    if (!e.target.closest('.tx-item')) {
      document.querySelectorAll('.tx-item.show-actions').forEach(x => x.classList.remove('show-actions'));
      openTxId = null;
    }
  });

  document.getElementById('amount-input').addEventListener('input', function() {
    this.value = this.value.replace(/[^0-9.,]/g, '');
  });
}

// ── HELPERS ────────────────────────────────────────────────
function fmtAmt(n) { return Math.abs(n).toLocaleString('uk-UA', { maximumFractionDigits: 0 }); }
function fmtDay(d) {
  const today = new Date(); today.setHours(0,0,0,0);
  const yday = new Date(today); yday.setDate(today.getDate() - 1);
  const dd = new Date(d); dd.setHours(0,0,0,0);
  if (dd.getTime() === today.getTime()) return 'Сьогодні';
  if (dd.getTime() === yday.getTime())  return 'Вчора';
  return `${d.getDate()} ${MONTHS_UK[d.getMonth()].toLowerCase()}`;
}
function nowLocal() {
  const d = new Date(); const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function toLocalInput(iso) {
  const d = new Date(iso); const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function getCategoryEmoji(name) {
  if (!name) return '💳';
  const key = name.toLowerCase().trim();
  for (const [k, v] of Object.entries(CATEGORY_EMOJI)) if (key.includes(k)) return v;
  return '🏷️';
}
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
let toastTimer;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2500);
}
