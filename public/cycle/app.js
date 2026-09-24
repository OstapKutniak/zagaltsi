import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js';
import {
  getDatabase, ref, get, push, set, remove, onValue,
} from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-database.js';
import {
  computeState, dayMarks, suppliesState, sexDays, conceptionChance,
  addDays, diffDays, toN, plural,
} from './core.js?v=3';

// ── FIREBASE (та сама база, що в SList і 1мані) ─────────────
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
const APP_VERSION = 3; // бампати разом із V у sw.js і ?v= у index.html (та в import core.js)
const SPACE = 'cycle';
// шляхи: cycle/periods, cycle/sex, cycle/supplies, cycle/settings, cycle/push, cycle/meta/version
const WORKER_URL = 'https://shopping-push.priko1isf.workers.dev'; // той самий поштар пушів, що в SList
const VAPID_PUBLIC = 'BDL_rAqfpmJS7p0v1jcUCDHiNTmOAFQI4TT7zll7UfrFUOiEXmMwr8jMb106WwzLJFg21tGxm6cWQ-zTECn4Fsg';
const PUSH_PATH = `${SPACE}/push`;

const C = { period: '#eb3b7e', fertile: '#8fdcc9', ovu: '#16a596', sex: '#6a5ae0', track: '#f1f1f4' };

const ICONS = {
  drop: '<path d="M12 3c3.5 4.5 6 7.8 6 11a6 6 0 01-12 0c0-3.2 2.5-6.5 6-11z"/>',
  heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 017-2.6A4 4 0 0119 10c0 5.6-7 10-7 10z"/>',
  tampon: '<rect x="8.5" y="3" width="7" height="12" rx="3.5"/><path d="M12 15v6"/><path d="M8.5 7h7"/>',
  pill: '<rect x="3" y="8.5" width="18" height="7" rx="3.5" transform="rotate(-35 12 12)"/><path d="M9.7 8.8l4.6 6.4"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
};
const ic = k => `<svg viewBox="0 0 24 24">${ICONS[k] || ''}</svg>`;

const MONTHS = ['Січень','Лютий','Березень','Квітень','Травень','Червень','Липень','Серпень','Вересень','Жовтень','Листопад','Грудень'];
const MONTHS_GEN = ['січня','лютого','березня','квітня','травня','червня','липня','серпня','вересня','жовтня','листопада','грудня'];
const MONTHS_SHORT = ['січ','лют','бер','квіт','трав','черв','лип','серп','вер','жовт','лист','груд'];
const WD = ['неділя','понеділок','вівторок','середа','четвер','пʼятниця','субота'];
const WD_SHORT = ['нд','пн','вт','ср','чт','пт','сб'];

const $ = id => document.getElementById(id);
const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const parts = key => key.split('-').map(Number);
const weekday = key => new Date(toN(key) * 86400000).getUTCDay();
const fmtDay = key => { const [, m, d] = parts(key); return `${d} ${MONTHS_GEN[m - 1]}`; };
const fmtShort = key => { const [, m, d] = parts(key); return `${d} ${MONTHS_SHORT[m - 1]}`; };
const fmtDayWd = key => `${fmtDay(key)}, ${WD_SHORT[weekday(key)]}`;
const esc = s => String(s ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

let data = { periods: {}, sex: {}, supplies: {}, settings: {} };
let state = { tab: 'ring', addDay: null, dayOpen: null, calScrolled: false };
let renderTimer = null;
const today = () => dayKey();

// ── INIT ───────────────────────────────────────────────────
let swReg = null;
document.addEventListener('DOMContentLoaded', () => {
  if ('serviceWorker' in navigator)
    navigator.serviceWorker.register('/zagaltsi/cycle/sw.js', { scope: '/zagaltsi/cycle/' })
      .then(r => { swReg = r; refreshPushSub(); }).catch(() => {});
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    if (swReg) swReg.update().catch(() => {});
    renderAll();
  });
  initSwipeLayout();
  initSheetDrag();
  bindEvents();
  subscribe();
  renderAll();
  // зміна дня опівночі
  let lastDay = today();
  setInterval(() => { if (today() !== lastDay) { lastDay = today(); renderAll(); } }, 60000);
});

// ── SYNC ───────────────────────────────────────────────────
function subscribe() {
  onValue(ref(db, `${SPACE}/meta/version`), s => {
    const v = s.val() || 0;
    if (v > APP_VERSION) {
      const last = +sessionStorage.getItem('verReload') || 0;
      if (Date.now() - last > 60000) {
        sessionStorage.setItem('verReload', String(Date.now()));
        swReg?.update().catch(() => {});
        setTimeout(() => location.reload(), 400);
      }
    } else if (v < APP_VERSION) {
      set(ref(db, `${SPACE}/meta/version`), APP_VERSION).catch(() => {});
    }
  });
  ['periods', 'sex', 'supplies', 'settings'].forEach(k =>
    onValue(ref(db, `${SPACE}/${k}`), s => { data[k] = s.val() || {}; scheduleRender(); }));
  onValue(ref(db, '.info/connected'), s => {
    const ok = !!s.val();
    const dot = $('sync-dot'), sub = $('sync-sub');
    if (dot) dot.style.background = ok ? 'var(--done)' : 'var(--danger)';
    if (sub) sub.textContent = ok ? 'Онлайн · база доступна' : 'Немає з’єднання з базою!';
  });
}
function scheduleRender() { clearTimeout(renderTimer); renderTimer = setTimeout(renderAll, 60); }

function renderAll() {
  const s = computeState(data, today());
  renderHeader(s);
  renderRing(s);
  renderSupplies(s);
  renderForecast(s);
  renderAlert(s);
  renderCalendar();
  renderSettings(s);
  if (state.dayOpen && $('day-overlay').classList.contains('open')) renderDaySheet(state.dayOpen);
  if ($('add-overlay').classList.contains('open')) renderAddSheet();
}

// ── ШАПКА ──────────────────────────────────────────────────
function renderHeader(s) {
  if (!s.hasData) { $('total-label').textContent = 'Цикл'; $('total-amount').innerHTML = '<span>немає відміток</span>'; return; }
  if (s.inPeriod) {
    $('total-label').textContent = 'Місячні';
    $('total-amount').innerHTML = `${s.cycleDay} <span>день</span>`;
  } else if (s.late > 0) {
    $('total-label').textContent = 'Очікувались';
    $('total-amount').innerHTML = `${fmtShort(s.nextStart)}`;
  } else {
    $('total-label').textContent = 'Наступні місячні';
    $('total-amount').innerHTML = `${fmtShort(s.nextStart)} <span>${WD_SHORT[weekday(s.nextStart)]}</span>`;
  }
}

// ── КРУЖОК ─────────────────────────────────────────────────
const CX = 150, CY = 150, R = 128, SW = 20;
function polar(frac, r = R) {
  const a = frac * Math.PI * 2 - Math.PI / 2;
  return [CX + r * Math.cos(a), CY + r * Math.sin(a)];
}
function arc(f0, f1, color, width = SW) {
  if (f1 - f0 >= 0.999) return `<circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="${color}" stroke-width="${width}"/>`;
  const [x0, y0] = polar(f0), [x1, y1] = polar(f1);
  const large = f1 - f0 > 0.5 ? 1 : 0;
  return `<path d="M${x0.toFixed(2)} ${y0.toFixed(2)} A${R} ${R} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round"/>`;
}

function renderRing(s) {
  const svg = $('ring-svg');
  let html = `<circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="${C.track}" stroke-width="${SW}"/>`;
  if (!s.hasData) {
    svg.innerHTML = html;
    $('ring-top').textContent = 'Відміть';
    $('ring-num').innerHTML = '<span class="ring-num-sm">перші місячні</span>';
    $('ring-sub').textContent = '';
    $('phase').textContent = 'Прогноз з’явиться після першої відмітки';
    return;
  }
  const L = s.cycleLen, st = s.st;
  // розмітка циклу: доля кола на день; маленький зазор між сегментами
  const g = 0.006;
  const dayFrac = d => (d - 1) / L; // початок дня d (1-based)
  html += arc(dayFrac(1) + g, dayFrac(st.periodLen + 1) - g, C.period);
  const ovDay = diffDays(s.ovulation, s.lastStart) + 1;
  html += arc(dayFrac(ovDay - 5) + g, dayFrac(ovDay + 2) - g, C.fertile);
  html += arc(dayFrac(ovDay) + g * 0.5, dayFrac(ovDay + 1) - g * 0.5, C.ovu);
  // секс у поточному циклі — сердечка по зовнішньому краю
  sexDays(data).filter(x => x.day >= s.lastStart && x.day <= today()).forEach(x => {
    const d = diffDays(x.day, s.lastStart) + 1;
    if (d > L) return;
    const [hx, hy] = polar(dayFrac(d) + 0.5 / L, R + SW / 2 + 9);
    html += `<text x="${hx.toFixed(1)}" y="${(hy + 4).toFixed(1)}" text-anchor="middle" class="ring-heart" fill="${C.sex}">♥</text>`;
  });
  // маркер «сьогодні»
  const tf = Math.min(s.cycleDay, L) - 0.5;
  const [mx, my] = polar(tf / L);
  html += `<circle cx="${mx.toFixed(2)}" cy="${my.toFixed(2)}" r="15" fill="#fff" stroke="${s.late > 0 ? C.period : 'var(--text)'}" stroke-width="3.5"/>`;
  svg.innerHTML = html;

  if (s.inPeriod) {
    $('ring-top').textContent = 'Місячні';
    $('ring-num').textContent = s.cycleDay;
    $('ring-sub').textContent = 'день';
  } else if (s.late > 0) {
    $('ring-top').textContent = 'Затримка';
    $('ring-num').textContent = s.late;
    $('ring-sub').textContent = plural(s.late, 'день', 'дні', 'днів');
  } else if (s.daysToNext === 0) {
    $('ring-top').textContent = 'Місячні';
    $('ring-num').innerHTML = '<span class="ring-num-sm">сьогодні</span>';
    $('ring-sub').textContent = 'за прогнозом';
  } else {
    $('ring-top').textContent = 'До місячних';
    $('ring-num').textContent = s.daysToNext;
    $('ring-sub').textContent = plural(s.daysToNext, 'день', 'дні', 'днів');
  }
  $('phase').textContent = s.late > 0 ? '' : `Шанс зачаття ${chanceWord(conceptionChance(today(), s.ovulation))}`;
}
const chanceWord = c => ({ high: 'високий', mid: 'середній', low: 'низький' }[c] || '—');

// ── ЗАПАС (тампони / знеболююче) ───────────────────────────
const SUPPLIES = [
  { key: 'tampons', name: 'Тампони', icon: 'tampon', color: '#eb3b7e' },
  { key: 'pills', name: 'Знеболююче', icon: 'pill', color: '#6a5ae0' },
];
function renderSupplies(s) {
  const sup = suppliesState(data, s.lastStart);
  const soon = s.hasData && !s.inPeriod && s.daysToNext <= 3;
  $('supplies').innerHTML = SUPPLIES.map(it => {
    const r = sup[it.key];
    const sub = r ? `Купив(ла) ${esc(r.by || 'хтось')} · ${fmtShort(r.day)}` : soon ? 'Треба купити до місячних' : 'Ще не куплено на цей цикл';
    return `<div class="litem ${r ? 'done' : ''} ${!r && soon ? 'urgent' : ''}" data-sup="${it.key}">
      <span class="litem-ic" style="--c:${it.color}">${ic(it.icon)}</span>
      <div class="litem-tx"><div class="litem-name">${it.name}</div><div class="litem-sub">${sub}</div></div>
      <button class="litem-check" type="button" aria-label="куплено">${ic('check')}</button>
    </div>`;
  }).join('');
  $('supplies').querySelectorAll('[data-sup]').forEach(el =>
    el.addEventListener('click', () => toggleSupply(el.dataset.sup)));
}
function toggleSupply(key) {
  const s = computeState(data, today());
  const cur = suppliesState(data, s.lastStart)[key];
  const it = SUPPLIES.find(x => x.key === key);
  if (cur) {
    set(ref(db, `${SPACE}/supplies/${key}`), { bought: false, ts: Date.now() });
  } else {
    if (!myName()) { askName(() => toggleSupply(key)); return; }
    set(ref(db, `${SPACE}/supplies/${key}`), { bought: true, by: myName(), day: today(), ts: Date.now() });
    notify('bought', [`${it.name} (${myName()})`]);
  }
}

// ── ПРОГНОЗ ────────────────────────────────────────────────
function renderForecast(s) {
  if (!s.hasData) { $('forecast').innerHTML = '<div class="fc-empty">Відміть початок останніх місячних — натисни на кружок</div>'; return; }
  const rows = [
    ['drop', C.period, 'Наступні місячні', s.late > 0 ? `очікувались ${fmtShort(s.nextStart)}` : fmtDayWd(s.nextStart)],
    ['heart', C.ovu, s.ovulation < today() ? 'Овуляція була' : 'Овуляція', fmtDayWd(s.ovulation)],
    ['cal', C.fertile, 'Фертильне вікно', `${fmtShort(s.fertileStart)} — ${fmtShort(s.fertileEnd)}`],
    ['cal', '#9E9E9E', 'Середній цикл', `${s.cycleLen} ${plural(s.cycleLen, 'день', 'дні', 'днів')}` + (s.cycleKnown ? ` · з ${s.samples} ${plural(s.samples, 'циклу', 'циклів', 'циклів')}` : ' · з налаштувань')],
  ];
  $('forecast').innerHTML = rows.map(([icon, c, name, val]) =>
    `<div class="fc-row"><span class="fc-ic" style="--c:${c}">${ic(icon)}</span><span class="fc-name">${name}</span><span class="fc-val">${val}</span></div>`).join('');
}

function renderAlert(s) {
  const el = $('alert');
  let msg = '';
  if (s.suggestTest) msg = `<b>Затримка ${s.late} ${plural(s.late, 'день', 'дні', 'днів')}</b>, а у фертильні дні був секс — варто зробити тест на вагітність.`;
  else if (s.late >= 7) msg = `<b>Затримка ${s.late} ${plural(s.late, 'день', 'дні', 'днів')}.</b> Якщо місячні вже почалися — відміть їх, натиснувши на кружок.`;
  el.innerHTML = msg;
  el.style.display = msg ? '' : 'none';
}

// ── ДОДАВАННЯ З КРУЖКА ─────────────────────────────────────
function openAddSheet() {
  state.addDay = today();
  renderAddSheet();
  $('add-overlay').classList.add('open');
}
function renderAddSheet() {
  const t = today();
  const days = [[t, 'Сьогодні'], [addDays(t, -1), 'Вчора'], [addDays(t, -2), 'Позавчора']];
  $('add-days').innerHTML = days.map(([d, n]) =>
    `<button class="chip ${d === state.addDay ? 'on' : ''}" data-d="${d}">${n}</button>`).join('') +
    `<button class="chip" data-other="1">Інший день</button>`;
  $('add-days').querySelectorAll('.chip').forEach(b => b.addEventListener('click', () => {
    if (b.dataset.other) { $('add-overlay').classList.remove('open'); setTab('cal'); toast('Натисни потрібний день у календарі'); return; }
    state.addDay = b.dataset.d; renderAddSheet();
  }));
  const d = state.addDay;
  const hasStart = Object.values(data.periods || {}).some(p => p.day === d);
  $('add-list').innerHTML = `
    <div class="sheet-item" data-act="period"><span class="sheet-item-ic" style="--c:${C.period}">${ic('drop')}</span>
      <span class="si-name">Початок місячних<div class="si-sub">${hasStart ? 'вже відмічено на ' + fmtDay(d) : fmtDay(d)}</div></span></div>
    <div class="sheet-item" data-act="sex"><span class="sheet-item-ic" style="--c:${C.sex}">${ic('heart')}</span>
      <span class="si-name">Секс<div class="si-sub">${fmtDay(d)} · шанс зачаття ${chanceWord(chanceFor(d))}</div></span></div>`;
  $('add-list').querySelectorAll('[data-act]').forEach(el => el.addEventListener('click', () => {
    const act = el.dataset.act;
    if (act === 'period') addPeriod(d);
    else addSex(d);
    $('add-overlay').classList.remove('open');
  }));
}

// шанс зачаття для дня — відносно найближчої (фактичної чи прогнозної) овуляції
function chanceFor(day) {
  const { marks } = dayMarks(data, today(), 3);
  const ovs = Object.entries(marks).filter(([, m]) => m.ovulation || m.ovulationPred).map(([d]) => d);
  if (!ovs.length) return null;
  const near = ovs.reduce((a, b) => Math.abs(diffDays(day, b)) < Math.abs(diffDays(day, a)) ? b : a);
  return conceptionChance(day, near);
}

function addPeriod(day) {
  if (day > today()) { toast('Це майбутній день'); return; }
  if (Object.values(data.periods || {}).some(p => p.day === day)) { toast('Цей день уже відмічено'); return; }
  set(push(ref(db, `${SPACE}/periods`)), { day, by: myName() || '', ts: Date.now() });
  toast(`Місячні з ${fmtDay(day)} відмічено`);
  notify('period', [fmtDay(day)]);
}
function addSex(day) {
  if (day > today()) { toast('Це майбутній день'); return; }
  set(push(ref(db, `${SPACE}/sex`)), { day, ts: Date.now() });
  toast(`Секс ${fmtDay(day)} відмічено`);
}

// ── КАЛЕНДАР ───────────────────────────────────────────────
function renderCalendar() {
  const t = today();
  const { marks } = dayMarks(data, t, 7);
  const sexMap = {};
  sexDays(data).forEach(x => { (sexMap[x.day] || (sexMap[x.day] = [])).push(x); });
  const starts = new Set(Object.values(data.periods || {}).map(p => p.day));
  // діапазон: від найранішої відмітки (але не більше 12 міс назад) до +6 міс
  const [ty, tm] = parts(t);
  const first = Object.values(data.periods || {}).map(p => p.day).sort()[0];
  let [sy, sm] = first ? parts(first) : [ty, tm];
  const back = (ty - sy) * 12 + (tm - sm);
  if (back > 12 || back < 2) { const k = ty * 12 + tm - 1 - (back > 12 ? 12 : 2); sy = Math.floor(k / 12); sm = k % 12 + 1; }
  const months = [];
  for (let k = sy * 12 + sm - 1; k <= ty * 12 + tm - 1 + 6; k++) months.push([Math.floor(k / 12), k % 12 + 1]);

  $('cal-wrap').innerHTML = months.map(([y, m]) => {
    const firstKey = `${y}-${String(m).padStart(2, '0')}-01`;
    const lead = (weekday(firstKey) + 6) % 7; // понеділок першим
    const nDays = new Date(Date.UTC(y, m, 0)).getUTCDate();
    let cells = '<span class="cal-e"></span>'.repeat(lead);
    for (let d = 1; d <= nDays; d++) {
      const key = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const mk = marks[key] || {};
      const cls = ['cal-d'];
      if (mk.period) cls.push('period');
      else if (mk.periodPred) cls.push('period-pred');
      else if (mk.ovulation) cls.push('ovu');
      else if (mk.ovulationPred) cls.push('ovu-pred');
      else if (mk.fertile) cls.push('fertile');
      else if (mk.fertilePred) cls.push('fertile-pred');
      if (key === t) cls.push('today');
      if (key > t) cls.push('future');
      if (starts.has(key)) cls.push('start');
      const sx = sexMap[key];
      const heart = sx ? `<i class="cal-heart">♥</i>` : '';
      cells += `<button class="${cls.join(' ')}" data-day="${key}"><span class="cal-n">${d}</span>${heart}</button>`;
    }
    const cur = y === ty && m === tm;
    return `<div class="cal-month ${cur ? 'cur' : ''}"><div class="cal-title">${MONTHS[m - 1]} ${y}</div>
      <div class="cal-wd">${['пн','вт','ср','чт','пт','сб','нд'].map(w => `<span>${w}</span>`).join('')}</div>
      <div class="cal-grid">${cells}</div></div>`;
  }).join('');
  $('cal-wrap').querySelectorAll('[data-day]').forEach(b =>
    b.addEventListener('click', () => openDaySheet(b.dataset.day)));
  if (state.tab === 'cal' && !state.calScrolled) scrollCalToNow();
}
function scrollCalToNow() {
  const cur = $('cal-wrap').querySelector('.cal-month.cur');
  if (!cur) return;
  state.calScrolled = true;
  $('cal-screen').scrollTop = cur.offsetTop - 60;
}

function openDaySheet(day) {
  state.dayOpen = day;
  renderDaySheet(day);
  $('day-overlay').classList.add('open');
}
function renderDaySheet(day) {
  const t = today();
  const wd = WD[weekday(day)];
  $('day-title').textContent = `${wd[0].toUpperCase() + wd.slice(1)}, ${fmtDay(day)}`;
  const { marks } = dayMarks(data, t, 7);
  const mk = marks[day] || {};
  const tags = [];
  if (mk.period) tags.push(['Місячні', C.period]);
  if (mk.periodPred) tags.push(['Місячні · прогноз', C.period]);
  if (mk.ovulation) tags.push(['Овуляція', C.ovu]);
  if (mk.ovulationPred) tags.push(['Овуляція · прогноз', C.ovu]);
  if (mk.fertile || mk.fertilePred) tags.push(['Фертильний день', C.ovu]);
  const ch = chanceFor(day);
  if (ch) tags.push([`Шанс зачаття: ${chanceWord(ch)}`, ch === 'high' ? C.period : ch === 'mid' ? '#e89b2d' : '#9E9E9E']);
  $('day-info').innerHTML = tags.map(([n, c]) => `<span class="tag" style="--c:${c}">${n}</span>`).join('');

  const future = day > t;
  const startEntry = Object.entries(data.periods || {}).find(([, p]) => p.day === day);
  const sexes = Object.entries(data.sex || {}).filter(([, x]) => x.day === day);
  let html = '';
  if (startEntry) html += row('del-period', startEntry[0], C.period, 'drop', 'Початок місячних', 'Натисни кошик, щоб прибрати', true);
  sexes.forEach(([id]) => { html += row('del-sex', id, C.sex, 'heart', 'Секс', '', true); });
  if (future) html += '<div class="fc-empty">Майбутній день — відмітки можна ставити лише на сьогодні і раніше</div>';
  else {
    if (!startEntry) html += row('add-period', '', C.period, 'plus', 'Початок місячних', '');
    html += row('add-sex', '', C.sex, 'plus', 'Секс', '');
  }
  $('day-list').innerHTML = html;
  $('day-list').querySelectorAll('[data-act]').forEach(el => el.addEventListener('click', () => {
    const { act, id } = el.dataset;
    if (act === 'del-period') { remove(ref(db, `${SPACE}/periods/${id}`)); toast('Відмітку прибрано'); }
    else if (act === 'del-sex') { remove(ref(db, `${SPACE}/sex/${id}`)); toast('Відмітку прибрано'); }
    else if (act === 'add-period') addPeriod(day);
    else if (act === 'add-sex') addSex(day);
  }));
}
function row(act, id, color, icon, name, sub, del) {
  return `<div class="sheet-item" data-act="${act}" data-id="${id}">
    <span class="sheet-item-ic" style="--c:${color}">${ic(icon)}</span>
    <span class="si-name">${name}${sub ? `<div class="si-sub">${sub}</div>` : ''}</span>
    ${del ? `<span class="si-del">${ic('trash')}</span>` : ''}</div>`;
}

// ── НАЛАШТУВАННЯ ───────────────────────────────────────────
function renderSettings(s) {
  $('name-sub').textContent = myName() || 'Не вказано — натисни';
  document.querySelectorAll('.stepper').forEach(el => {
    el.querySelector('span').textContent = s.st[el.dataset.key];
  });
  $('cyclelen-sub').textContent = s.cycleKnown
    ? `Зараз рахується з відміток: ${s.cycleLen} ${plural(s.cycleLen, 'день', 'дні', 'днів')}`
    : 'Поки мало відміток — береться звідси';
}
const myName = () => localStorage.getItem('cycle-name') || '';
let afterName = null;
function askName(then) {
  afterName = then || null;
  $('name-input').value = myName();
  $('name-overlay').classList.add('open');
  setTimeout(() => $('name-input').focus(), 300);
}
function saveName() {
  const n = $('name-input').value.trim().slice(0, 24);
  if (!n) { toast('Введи ім’я'); return; }
  localStorage.setItem('cycle-name', n);
  $('name-overlay').classList.remove('open');
  refreshPushSub();
  renderAll();
  const f = afterName; afterName = null;
  if (f) f();
}

// ── PUSH ───────────────────────────────────────────────────
function deviceId() {
  let id = localStorage.getItem('cycle-device');
  if (!id) { id = 'd' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36); localStorage.setItem('cycle-device', id); }
  return id;
}
const b64uToU8 = s => {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(b, c => c.charCodeAt(0));
};
async function saveSub(s) {
  await set(ref(db, `${PUSH_PATH}/${deviceId()}`), {
    sub: JSON.stringify(s.toJSON()), name: myName(), ua: navigator.userAgent.slice(0, 90), ts: Date.now(),
  });
}
async function enableNotifications() {
  if (!('Notification' in window) || !('PushManager' in window)) {
    toast('Сповіщення працюють лише з іконки на екрані «Домів»'); return;
  }
  try {
    const reg = swReg || await navigator.serviceWorker.ready;
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { toast('Дозвіл на сповіщення не надано'); renderNotifyRow(); return; }
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToU8(VAPID_PUBLIC) });
    await saveSub(sub);
    toast('Сповіщення увімкнено');
  } catch (e) {
    toast('Не вдалося увімкнути сповіщення');
    console.warn('push subscribe failed', e);
  }
  renderNotifyRow();
}
async function renderNotifyRow() {
  const sub = $('notify-sub');
  if (!('Notification' in window) || !('PushManager' in window)) { sub.textContent = 'Доступно лише в додатку з екрана «Домів»'; return; }
  if (Notification.permission === 'granted') {
    const s = await (swReg || await navigator.serviceWorker.ready).pushManager.getSubscription().catch(() => null);
    let devices = '';
    try {
      const snap = await get(ref(db, PUSH_PATH));
      const n = snap.exists() ? Object.keys(snap.val()).length : 0;
      devices = ` · у базі ${n} ${plural(n, 'пристрій', 'пристрої', 'пристроїв')}`;
    } catch {}
    sub.textContent = (s ? 'Увімкнено на цьому пристрої' : 'Натисни, щоб увімкнути') + devices;
  } else if (Notification.permission === 'denied') sub.textContent = 'Заборонено в налаштуваннях iOS';
  else sub.textContent = 'Натисни, щоб увімкнути';
}
// iOS може «загубити» підписку між запусками — перезаписуємо свіжу на кожному старті
async function refreshPushSub() {
  if (!('Notification' in window) || !('PushManager' in window)) return;
  if (Notification.permission !== 'granted') return;
  try {
    const reg = swReg || await navigator.serviceWorker.ready;
    let s = await reg.pushManager.getSubscription();
    try {
      const cur = s?.options?.applicationServerKey && new Uint8Array(s.options.applicationServerKey);
      const want = b64uToU8(VAPID_PUBLIC);
      if (cur && (cur.length !== want.length || cur.some((b, i) => b !== want[i]))) { await s.unsubscribe().catch(() => {}); s = null; }
    } catch {}
    if (!s) s = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToU8(VAPID_PUBLIC) });
    await saveSub(s);
  } catch (e) { console.warn('push refresh failed', e); }
}
async function testPush() {
  const sub = $('testpush-sub');
  sub.textContent = 'Надсилаю…';
  try {
    const res = await fetch(WORKER_URL, {
      method: 'POST',
      body: JSON.stringify({ event: 'test', names: ['Перевірка зв’язку — все працює'], from: deviceId(), space: SPACE }),
    });
    const j = await res.json();
    if (j.errors?.length) sub.textContent = ('Помилка: ' + j.errors[0]).slice(0, 140);
    else if (j.error) sub.textContent = 'Воркер ще не оновлено: ' + j.error;
    else if (!j.sent) sub.textContent = `Надіслано 0 — інший телефон не підписаний${j.dead ? ` (мертвих підписок прибрано: ${j.dead})` : ''}`;
    else sub.textContent = `Надіслано на ${j.sent} ${plural(j.sent, 'пристрій', 'пристрої', 'пристроїв')} — глянь інший телефон`;
  } catch (e) { sub.textContent = 'Воркер недоступний: ' + e.message; }
}
// подія для іншого телефона (не собі)
function notify(event, names) {
  const payload = JSON.stringify({ event, names, from: deviceId(), space: SPACE });
  if (navigator.sendBeacon) navigator.sendBeacon(WORKER_URL, payload);
  else fetch(WORKER_URL, { method: 'POST', body: payload }).catch(() => {});
}

// ── ПОДІЇ ──────────────────────────────────────────────────
function bindEvents() {
  $('ring').addEventListener('click', openAddSheet);
  $('btn-settings').addEventListener('click', () => { renderNotifyRow(); $('settings-overlay').classList.add('open'); });
  $('btn-info').addEventListener('click', () => $('info-overlay').classList.add('open'));
  $('btn-notify').addEventListener('click', enableNotifications);
  $('btn-test-push').addEventListener('click', testPush);
  $('btn-name').addEventListener('click', () => askName());
  $('name-done').addEventListener('click', saveName);
  $('name-input').addEventListener('keydown', e => { if (e.key === 'Enter') saveName(); });
  document.querySelectorAll('.stepper').forEach(el => el.querySelectorAll('button').forEach(b =>
    b.addEventListener('click', () => {
      const s = computeState(data, today());
      const k = el.dataset.key;
      const v = Math.min(+el.dataset.max, Math.max(+el.dataset.min, s.st[k] + +b.dataset.d));
      set(ref(db, `${SPACE}/settings/${k}`), v);
    })));
  document.querySelectorAll('.tabbar [data-tab]').forEach(tab =>
    tab.addEventListener('click', () => setTab(tab.dataset.tab)));
  document.querySelectorAll('.sheet-overlay').forEach(ov =>
    ov.addEventListener('click', e => { if (e.target === ov) ov.classList.remove('open'); }));
}

const SWIPE_TABS = ['ring', 'cal'];
function setTab(t) {
  state.tab = t;
  document.querySelectorAll('.tabbar [data-tab]').forEach(x => x.classList.toggle('active', x.dataset.tab === t));
  syncTabs();
  if (t === 'cal' && !state.calScrolled) requestAnimationFrame(scrollCalToNow);
}
function syncTabs() {
  const cur = SWIPE_TABS.indexOf(state.tab);
  SWIPE_TABS.forEach((t, i) => {
    const s = $(t + '-screen');
    s.style.transition = '';
    s.style.transform = `translateX(${(i - cur) * 100}%)`;
    s.classList.toggle('active', t === state.tab);
  });
}
function initSwipeLayout() {
  syncTabs();
  const wrap = $('screen-wrap');
  let swX = 0, swY = 0, swActive = false, swLocked = false;
  wrap.addEventListener('touchstart', e => {
    swX = e.touches[0].clientX; swY = e.touches[0].clientY;
    swActive = true; swLocked = false;
  }, { passive: true });
  wrap.addEventListener('touchmove', e => {
    if (!swActive) return;
    const dx = e.touches[0].clientX - swX, dy = e.touches[0].clientY - swY;
    if (!swLocked) {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
      if (Math.abs(dy) >= Math.abs(dx)) { swActive = false; return; }
      swLocked = true;
    }
    e.preventDefault();
    const cur = SWIPE_TABS.indexOf(state.tab), W = wrap.offsetWidth;
    SWIPE_TABS.forEach((t, i) => {
      const s = $(t + '-screen');
      s.style.transition = 'none';
      s.style.transform = `translateX(${(i - cur) * W + dx}px)`;
    });
  }, { passive: false });
  wrap.addEventListener('touchend', e => {
    if (!swActive || !swLocked) { swActive = false; return; }
    swActive = false;
    const dx = e.changedTouches[0].clientX - swX;
    const threshold = wrap.offsetWidth * 0.28;
    const cur = SWIPE_TABS.indexOf(state.tab);
    let next = cur;
    if (dx < -threshold && cur < SWIPE_TABS.length - 1) next = cur + 1;
    else if (dx > threshold && cur > 0) next = cur - 1;
    if (next !== cur) setTab(SWIPE_TABS[next]);
    else syncTabs();
  }, { passive: true });
}
// шторки: закриття свайпом за полоску
function initSheetDrag() {
  document.querySelectorAll('.sheet-overlay').forEach(ov => {
    const sheet = ov.querySelector('.sheet');
    const handle = sheet?.querySelector('.sheet-handle');
    if (!handle) return;
    let y0 = 0, dragging = false;
    handle.addEventListener('touchstart', e => { y0 = e.touches[0].clientY; dragging = true; sheet.style.transition = 'none'; }, { passive: true });
    handle.addEventListener('touchmove', e => {
      if (!dragging) return;
      sheet.style.transform = `translateY(${Math.max(0, e.touches[0].clientY - y0)}px)`;
    }, { passive: true });
    handle.addEventListener('touchend', e => {
      if (!dragging) return;
      dragging = false;
      const dy = e.changedTouches[0].clientY - y0;
      sheet.style.transition = '';
      sheet.style.transform = '';
      if (dy > 70) ov.classList.remove('open');
    }, { passive: true });
  });
}

let toastTimer = null;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}
