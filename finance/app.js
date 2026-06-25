import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

// ── CONSTANTS ──────────────────────────────────────────────
const SB_URL_KEY = 'fin_sb_url';
const SB_KEY_KEY = 'fin_sb_key';
const MONTHS_UK = ['Січень','Лютий','Березень','Квітень','Травень','Червень',
                   'Липень','Серпень','Вересень','Жовтень','Листопад','Грудень'];
const DAYS_UK   = ['Нд','Пн','Вт','Ср','Чт','Пт','Сб'];

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
  'інше':'📦','другое':'📦','інше':'📦',
  'добирання':'🚌','покупки':'🛍️','сім\'я':'👨‍👩‍👧',
};

// ── STATE ──────────────────────────────────────────────────
let sb = null;
let transactions = [];
let currentMonth = new Date();
let editingTx = null;
let formState = { type: 'expense', category: '', account: '', toAccount: '', date: '', note: '' };
let knownCategories = [];
let knownAccounts = [];
let pickerResolve = null;
let openTxId = null;

// ── INIT ───────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/zagaltsi/finance/sw.js', { scope: '/zagaltsi/finance/' }).catch(() => {});
  }

  const url = localStorage.getItem(SB_URL_KEY);
  const key = localStorage.getItem(SB_KEY_KEY);

  if (url && key) {
    await connect(url, key);
  } else {
    showView('setup');
  }

  bindEvents();
});

async function connect(url, key) {
  try {
    sb = createClient(url, key);
    await loadTransactions();
    loadKnownValues();
    subscribeRealtime();
    showView('list');
  } catch (e) {
    toast('Помилка підключення: ' + e.message);
    showView('setup');
  }
}

// ── SUPABASE ───────────────────────────────────────────────
async function loadTransactions() {
  const start = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
  const end   = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0, 23, 59, 59);

  const { data, error } = await sb
    .from('transactions')
    .select('*')
    .gte('date', start.toISOString())
    .lte('date', end.toISOString())
    .order('date', { ascending: false });

  if (error) { toast('Помилка завантаження'); return; }
  transactions = data || [];
  renderList();
}

async function saveTransaction(tx) {
  const { error } = await sb.from('transactions').insert(tx);
  if (error) throw error;
}

async function deleteTransaction(id) {
  const { error } = await sb.from('transactions').delete().eq('id', id);
  if (error) throw error;
}

function subscribeRealtime() {
  sb.channel('fin-rt')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions' }, () => {
      loadTransactions();
    })
    .subscribe();
}

function loadKnownValues() {
  const stored = localStorage.getItem('fin_known');
  if (stored) {
    const d = JSON.parse(stored);
    knownCategories = d.categories || [];
    knownAccounts   = d.accounts   || [];
  }
}

function saveKnownValues() {
  localStorage.setItem('fin_known', JSON.stringify({
    categories: knownCategories,
    accounts:   knownAccounts,
  }));
}

function learnFromTx(tx) {
  if (tx.category && !knownCategories.includes(tx.category))
    knownCategories.unshift(tx.category);
  if (tx.account && !knownAccounts.includes(tx.account))
    knownAccounts.unshift(tx.account);
  if (tx.category) knownCategories = [tx.category, ...knownCategories.filter(c => c !== tx.category)].slice(0, 50);
  if (tx.account)  knownAccounts   = [tx.account,  ...knownAccounts.filter(a => a !== tx.account)].slice(0, 30);
  saveKnownValues();
}

// ── VIEWS ──────────────────────────────────────────────────
function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(name + '-view').classList.add('active');
}

// ── RENDER LIST ────────────────────────────────────────────
function renderList() {
  const list = document.getElementById('tx-list');
  updateHeader();

  if (!transactions.length) {
    list.innerHTML = `<div class="empty-state"><div class="icon">📭</div><p>Немає операцій за цей місяць</p></div>`;
    return;
  }

  const groups = {};
  transactions.forEach(tx => {
    const d = new Date(tx.date);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    if (!groups[key]) groups[key] = { date: d, txs: [] };
    groups[key].txs.push(tx);
  });

  list.innerHTML = Object.values(groups).map(g => {
    const dayTotal = g.txs.reduce((s, tx) => {
      if (tx.type === 'expense') return s - tx.amount;
      if (tx.type === 'income')  return s + tx.amount;
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
      if (e.target.classList.contains('tx-delete-btn') || e.target.closest('.tx-delete-btn')) return;
      const id = el.dataset.id;
      if (openTxId === id) {
        el.classList.remove('show-delete');
        openTxId = null;
      } else {
        document.querySelectorAll('.tx-item.show-delete').forEach(x => x.classList.remove('show-delete'));
        el.classList.add('show-delete');
        openTxId = id;
      }
    });
    const delBtn = el.querySelector('.tx-delete-btn');
    if (delBtn) delBtn.addEventListener('click', async e => {
      e.stopPropagation();
      if (!confirm('Видалити операцію?')) return;
      try {
        await deleteTransaction(el.dataset.id);
        toast('Видалено');
      } catch (err) {
        toast('Помилка: ' + err.message);
      }
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
      <div class="tx-cat">${tx.category || tx.account || '—'}</div>
      ${sub ? `<div class="tx-sub">${sub}</div>` : ''}
    </div>
    <span class="tx-amount ${typeClass}">${sign}${fmtAmt(tx.amount)} ₴</span>
    <button class="tx-delete-btn" title="Видалити">✕</button>
  </div>`;
}

function updateHeader() {
  document.getElementById('month-label').textContent =
    `${MONTHS_UK[currentMonth.getMonth()]} ${currentMonth.getFullYear()}`;

  const exp = transactions.filter(t => t.type === 'expense' || t.type === 'return')
    .reduce((s, t) => s + Number(t.amount), 0);
  const inc = transactions.filter(t => t.type === 'income')
    .reduce((s, t) => s + Number(t.amount), 0);

  document.getElementById('total-exp').textContent = fmtAmt(exp) + ' ₴';
  document.getElementById('total-inc').textContent = fmtAmt(inc) + ' ₴';
  const bal = inc - exp;
  const balEl = document.getElementById('total-bal');
  balEl.textContent = (bal >= 0 ? '+' : '') + fmtAmt(bal) + ' ₴';
  balEl.style.color = bal >= 0 ? 'var(--income)' : 'var(--expense)';
}

// ── ADD FORM ───────────────────────────────────────────────
function openAddForm(tx = null) {
  editingTx = tx;
  formState = tx ? {
    type: tx.type, category: tx.category || '', account: tx.account || '',
    toAccount: '', date: tx.date ? tx.date.slice(0, 16) : nowLocal(),
    note: tx.note || ''
  } : {
    type: 'expense', category: '', account: '', toAccount: '',
    date: nowLocal(), note: ''
  };

  document.getElementById('add-title').textContent = tx ? 'Редагувати' : 'Нова операція';
  document.getElementById('amount-input').value = tx ? tx.amount : '';

  setFormType(formState.type);
  updateFormFields();
  showView('add');

  setTimeout(() => document.getElementById('amount-input').focus(), 300);
}

function setFormType(type) {
  formState.type = type;
  document.querySelectorAll('.type-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.type === type);
  });
  document.getElementById('field-to-account').style.display =
    type === 'transfer' ? '' : 'none';
  document.getElementById('field-category').style.display =
    type === 'transfer' ? 'none' : '';
}

function updateFormFields() {
  const catVal = document.getElementById('cat-value');
  catVal.textContent = formState.category || 'Обрати';
  catVal.className   = 'field-value' + (formState.category ? '' : ' placeholder');
  document.getElementById('cat-icon').textContent = getCategoryEmoji(formState.category);

  const accVal = document.getElementById('acc-value');
  accVal.textContent = formState.account || 'Обрати';
  accVal.className   = 'field-value' + (formState.account ? '' : ' placeholder');

  const toVal = document.getElementById('to-acc-value');
  toVal.textContent = formState.toAccount || 'Обрати';
  toVal.className   = 'field-value' + (formState.toAccount ? '' : ' placeholder');

  document.getElementById('date-input').value = formState.date || nowLocal();
  document.getElementById('note-input').value = formState.note;
}

async function submitForm() {
  const amtRaw = document.getElementById('amount-input').value.replace(',', '.');
  const amount = parseFloat(amtRaw);
  if (!amount || amount <= 0) { toast('Введи суму'); return; }

  const dateVal = document.getElementById('date-input').value;
  const note    = document.getElementById('note-input').value.trim();

  if (formState.type !== 'transfer' && !formState.category) {
    toast('Оберіть категорію'); return;
  }
  if (!formState.account) { toast('Оберіть рахунок'); return; }

  const tx = {
    type:     formState.type,
    amount,
    account:  formState.account,
    category: formState.type === 'transfer' ? formState.toAccount : formState.category,
    date:     dateVal ? new Date(dateVal).toISOString() : new Date().toISOString(),
    note:     note || null,
  };

  try {
    const btn = document.getElementById('add-save');
    btn.disabled = true;
    await saveTransaction(tx);
    learnFromTx(tx);
    showView('list');
    toast('Збережено ✓');
  } catch (e) {
    toast('Помилка: ' + e.message);
  } finally {
    document.getElementById('add-save').disabled = false;
  }
}

// ── PICKER ────────────────────────────────────────────────
function openPicker(title, items, allowNew = true) {
  return new Promise(resolve => {
    pickerResolve = resolve;
    document.getElementById('sheet-title').textContent = title;
    document.getElementById('sheet-search').value = '';
    renderPickerList(items, allowNew);
    document.getElementById('sheet-overlay').classList.add('open');

    const search = document.getElementById('sheet-search');
    search.oninput = () => renderPickerList(
      items.filter(i => i.toLowerCase().includes(search.value.toLowerCase())),
      allowNew,
      search.value
    );
    setTimeout(() => search.focus(), 200);
  });
}

function renderPickerList(items, allowNew, newValue = '') {
  const list = document.getElementById('sheet-list');
  const rows = items.map(item => `
    <div class="sheet-item" data-val="${escHtml(item)}">
      <span class="sheet-item-icon">${getCategoryEmoji(item)}</span>
      <span>${escHtml(item)}</span>
    </div>`).join('');

  const addNew = allowNew && newValue && !items.includes(newValue)
    ? `<div class="sheet-item" data-val="${escHtml(newValue)}" data-new="1">
        <span class="sheet-item-icon">➕</span>
        <span>Додати «${escHtml(newValue)}»</span>
       </div>` : '';

  list.innerHTML = rows + addNew;
  list.querySelectorAll('.sheet-item').forEach(el => {
    el.addEventListener('click', () => {
      closePicker(el.dataset.val);
    });
  });
}

function closePicker(value) {
  document.getElementById('sheet-overlay').classList.remove('open');
  if (pickerResolve) { pickerResolve(value); pickerResolve = null; }
}

// ── IMPORT ────────────────────────────────────────────────
async function importCSV(file) {
  const text = await file.text();
  const lines = text.split('\n').filter(l => l.trim());
  const header = lines[0].toLowerCase().split(',');

  const idx = {
    date:     header.indexOf('date'),
    type:     header.indexOf('type'),
    account:  header.indexOf('account'),
    category: header.indexOf('category'),
    amount:   header.indexOf('amount'),
    note:     header.indexOf('note'),
  };

  const TYPE_MAP = {
    'витрата':'expense','expense':'expense',
    'дохід':'income','income':'income',
    'переказ':'transfer','transfer':'transfer',
    'повернення':'return','return':'return',
    'інше':'other','other':'other',
  };

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    const amount = parseFloat((cols[idx.amount] || '0').replace(',', '.'));
    if (!amount) continue;
    rows.push({
      date:     new Date(cols[idx.date] || Date.now()).toISOString(),
      type:     TYPE_MAP[cols[idx.type]?.trim().toLowerCase()] || 'expense',
      account:  cols[idx.account]?.trim() || null,
      category: cols[idx.category]?.trim() || null,
      amount,
      note:     cols[idx.note]?.trim() || null,
    });
  }

  const prog = document.getElementById('import-progress');
  const progressBar = document.getElementById('progress-bar');
  const statusEl  = document.getElementById('import-status');
  const titleEl   = document.getElementById('import-progress-text');
  prog.style.display = '';
  titleEl.textContent = `Завантаження ${rows.length} операцій...`;

  const BATCH = 200;
  let done = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const { error } = await sb.from('transactions').upsert(batch, { onConflict: 'id' });
    if (error) { toast('Помилка: ' + error.message); return; }
    done += batch.length;
    const pct = Math.round(done / rows.length * 100);
    progressBar.style.width = pct + '%';
    statusEl.textContent = `${done} / ${rows.length}`;
    await new Promise(r => setTimeout(r, 10));
  }

  titleEl.textContent = `✓ Імпортовано ${done} операцій`;
  document.getElementById('import-result').style.display = '';
  toast('Імпорт завершено!');
  loadTransactions();
}

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') { inQuotes = !inQuotes; continue; }
    if (line[i] === ',' && !inQuotes) { result.push(current); current = ''; continue; }
    current += line[i];
  }
  result.push(current);
  return result;
}

// ── BIND EVENTS ────────────────────────────────────────────
function bindEvents() {
  // Setup
  document.getElementById('setup-save').addEventListener('click', async () => {
    const url = document.getElementById('setup-url').value.trim();
    const key = document.getElementById('setup-key').value.trim();
    if (!url || !key) { toast('Заповни обидва поля'); return; }
    localStorage.setItem(SB_URL_KEY, url);
    localStorage.setItem(SB_KEY_KEY, key);
    document.getElementById('setup-save').disabled = true;
    await connect(url, key);
    document.getElementById('setup-save').disabled = false;
    document.getElementById('sb-url-label').textContent = new URL(url).hostname;
  });

  // Month nav
  document.getElementById('prev-month').addEventListener('click', () => {
    currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1);
    loadTransactions();
  });
  document.getElementById('next-month').addEventListener('click', () => {
    currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1);
    loadTransactions();
  });

  // Add
  document.getElementById('add-btn').addEventListener('click', () => openAddForm());
  document.getElementById('add-close').addEventListener('click', () => showView('list'));
  document.getElementById('add-save').addEventListener('click', submitForm);

  // Type toggle
  document.querySelectorAll('.type-btn').forEach(btn => {
    btn.addEventListener('click', () => { setFormType(btn.dataset.type); updateFormFields(); });
  });

  // Category picker
  document.getElementById('field-category').addEventListener('click', async () => {
    const val = await openPicker('Категорія', [...knownCategories]);
    if (val) { formState.category = val; updateFormFields(); }
  });

  // Account picker
  document.getElementById('field-account').addEventListener('click', async () => {
    const val = await openPicker('Рахунок', [...knownAccounts]);
    if (val) { formState.account = val; updateFormFields(); }
  });

  // To account picker
  document.getElementById('field-to-account').addEventListener('click', async () => {
    const val = await openPicker('На рахунок', [...knownAccounts]);
    if (val) { formState.toAccount = val; updateFormFields(); }
  });

  // Close picker on overlay
  document.getElementById('sheet-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('sheet-overlay')) closePicker(null);
  });

  // Nav
  document.getElementById('nav-settings').addEventListener('click', () => {
    const url = localStorage.getItem(SB_URL_KEY);
    if (url) document.getElementById('sb-url-label').textContent = new URL(url).hostname;
    showView('settings');
  });
  document.getElementById('nav-list').addEventListener('click', () => showView('list'));
  document.getElementById('nav-list-from-settings').addEventListener('click', () => showView('list'));

  // Settings
  document.getElementById('btn-import').addEventListener('click', () => showView('import'));
  document.getElementById('btn-reset-sb').addEventListener('click', () => {
    if (confirm('Змінити підключення Supabase?')) {
      localStorage.removeItem(SB_URL_KEY);
      localStorage.removeItem(SB_KEY_KEY);
      showView('setup');
    }
  });

  // Import
  document.getElementById('import-back').addEventListener('click', () => showView('settings'));
  document.getElementById('import-back2').addEventListener('click', () => showView('settings'));
  document.getElementById('import-zone').addEventListener('click', () =>
    document.getElementById('import-file').click()
  );
  document.getElementById('import-file').addEventListener('change', e => {
    const file = e.target.files[0];
    if (file) importCSV(file);
  });

  // Close delete on tap outside
  document.getElementById('tx-list').addEventListener('click', e => {
    if (!e.target.closest('.tx-item')) {
      document.querySelectorAll('.tx-item.show-delete').forEach(x => x.classList.remove('show-delete'));
      openTxId = null;
    }
  });

  // Amount: allow only numbers and comma/dot
  document.getElementById('amount-input').addEventListener('input', function() {
    this.value = this.value.replace(/[^0-9.,]/g, '');
  });
}

// ── HELPERS ────────────────────────────────────────────────
function fmtAmt(n) {
  return Math.abs(n).toLocaleString('uk-UA', { maximumFractionDigits: 0 });
}

function fmtDay(d) {
  const today    = new Date(); today.setHours(0,0,0,0);
  const yday     = new Date(today); yday.setDate(today.getDate() - 1);
  const dayDate  = new Date(d); dayDate.setHours(0,0,0,0);

  if (dayDate.getTime() === today.getTime()) return 'Сьогодні';
  if (dayDate.getTime() === yday.getTime())  return 'Вчора';
  return `${d.getDate()} ${MONTHS_UK[d.getMonth()].toLowerCase()}`;
}

function nowLocal() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function getCategoryEmoji(name) {
  if (!name) return '💳';
  const key = name.toLowerCase().trim();
  for (const [k, v] of Object.entries(CATEGORY_EMOJI)) {
    if (key.includes(k)) return v;
  }
  return '🏷️';
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

let toastTimer;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2500);
}
