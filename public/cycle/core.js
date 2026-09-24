// Логіка прогнозу циклу — спільна для додатка (public/cycle/app.js) і воркера
// нагадувань (workers/shopping-push, імпортує цей файл напряму). Без залежностей.
//
// Модель (стандартна, як у Flo/Clue/Apple Health):
// - довжина циклу = середнє з останніх ≤6 проміжків між початками місячних
//   (відкидаємо явні викиди <18 або >45 днів — пропущена відмітка тощо);
//   поки відміток <2 — береться settings.cycleLen (дефолт 28);
// - овуляція ≈ за 14 днів (лютеальна фаза) до наступних місячних;
// - фертильне вікно = 5 днів до овуляції + день овуляції + 1 день після
//   (сперматозоїди живуть до 5 днів, яйцеклітина ~1 доба).

export const DEFAULTS = { cycleLen: 28, periodLen: 5, lutealLen: 14 };
const DAY = 86400000;

// 'YYYY-MM-DD' <-> номер дня (UTC-опівніч, щоб не ловити перехід на літній час)
export const toN = key => { const [y, m, d] = key.split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / DAY); };
export const fromN = n => new Date(n * DAY).toISOString().slice(0, 10);
export const addDays = (key, k) => fromN(toN(key) + k);
export const diffDays = (a, b) => toN(a) - toN(b); // a - b

export function settingsOf(data) {
  const s = (data && data.settings) || {};
  return {
    cycleLen: clampInt(s.cycleLen, 18, 45, DEFAULTS.cycleLen),
    periodLen: clampInt(s.periodLen, 2, 10, DEFAULTS.periodLen),
    lutealLen: clampInt(s.lutealLen, 10, 16, DEFAULTS.lutealLen),
  };
}
function clampInt(v, lo, hi, def) {
  v = Math.round(+v);
  return Number.isFinite(v) && v >= lo && v <= hi ? v : def;
}

// відсортовані унікальні дні початку місячних
export function periodStarts(data) {
  const set = new Set(Object.values((data && data.periods) || {}).map(p => p && p.day).filter(Boolean));
  return [...set].sort();
}

export function sexDays(data) {
  return Object.entries((data && data.sex) || {})
    .filter(([, s]) => s && s.day)
    .map(([id, s]) => ({ id, day: s.day }))
    .sort((a, b) => a.day < b.day ? -1 : 1);
}

// середня довжина циклу з історії
export function avgCycle(starts, st) {
  const lens = [];
  for (let i = 1; i < starts.length; i++) {
    const l = diffDays(starts[i], starts[i - 1]);
    if (l >= 18 && l <= 45) lens.push(l);
  }
  const last = lens.slice(-6);
  if (!last.length) return { len: st.cycleLen, known: false, samples: 0 };
  return { len: Math.round(last.reduce((a, b) => a + b, 0) / last.length), known: true, samples: last.length };
}

// Головна функція: стан на дату today ('YYYY-MM-DD').
export function computeState(data, today) {
  const st = settingsOf(data);
  const starts = periodStarts(data);
  const avg = avgCycle(starts, st);
  const L = avg.len;
  const res = { today, st, starts, cycleLen: L, cycleKnown: avg.known, samples: avg.samples, hasData: starts.length > 0 };
  if (!starts.length) return res;

  // останній початок не пізніше сьогодні (майбутні відмітки ігноруємо)
  const past = starts.filter(d => d <= today);
  if (!past.length) { res.hasData = false; return res; }
  const lastStart = past[past.length - 1];
  const nextStart = addDays(lastStart, L);
  const cycleDay = diffDays(today, lastStart) + 1;       // 1 = перший день місячних
  const late = Math.max(0, diffDays(today, nextStart));  // днів затримки
  const ovulation = addDays(nextStart, -st.lutealLen);
  const fertileStart = addDays(ovulation, -5);
  const fertileEnd = addDays(ovulation, 1);

  Object.assign(res, {
    lastStart, nextStart, cycleDay, late, ovulation, fertileStart, fertileEnd,
    inPeriod: cycleDay <= st.periodLen,
    daysToNext: diffDays(nextStart, today),               // може бути ≤0 при затримці
    daysToOvulation: diffDays(ovulation, today),
    fertileNow: today >= fertileStart && today <= fertileEnd,
  });
  // фаза для підпису
  if (res.inPeriod) res.phase = 'period';
  else if (today === ovulation) res.phase = 'ovulation';
  else if (res.fertileNow) res.phase = 'fertile';
  else if (today < fertileStart) res.phase = 'follicular';
  else res.phase = 'luteal';

  // затримка + секс у фертильне вікно цього циклу → варто зробити тест
  res.sexInFertile = sexDays(data).some(s => s.day >= fertileStart && s.day <= fertileEnd);
  res.suggestTest = late >= 3 && res.sexInFertile;
  return res;
}

// Ймовірність зачаття для дня відносно овуляції (грубо, за Wilcox et al. 1995).
export function conceptionChance(day, ovulation) {
  if (!ovulation) return null;
  const d = diffDays(day, ovulation);
  if (d === 0 || d === -1 || d === -2) return 'high';
  if (d >= -5 && d <= 1) return 'mid';
  return 'low';
}

// Розмітка днів для календаря: map day -> {period, periodPred, ovulation, ovulationPred, fertile, fertilePred}
// Минулі цикли — з реальних відміток (овуляція = наступний фактичний старт − лютеальна фаза),
// майбутні — прогноз на horizon циклів уперед.
export function dayMarks(data, today, horizon = 6) {
  const s = computeState(data, today);
  const st = s.st, L = s.cycleLen, marks = {};
  const mark = (day, k) => { (marks[day] || (marks[day] = {}))[k] = true; };
  const markCycle = (start, nextStart, pred) => {
    for (let i = 0; i < st.periodLen; i++) mark(addDays(start, i), pred ? 'periodPred' : 'period');
    if (!nextStart) return;
    const ov = addDays(nextStart, -st.lutealLen);
    for (let i = -5; i <= 1; i++) if (i !== 0) mark(addDays(ov, i), pred ? 'fertilePred' : 'fertile');
    mark(ov, pred ? 'ovulationPred' : 'ovulation');
  };
  const starts = s.starts.filter(d => d <= today);
  starts.forEach((d, i) => {
    const nxt = starts[i + 1];
    if (nxt) markCycle(d, diffDays(nxt, d) <= 45 ? nxt : null, false);
  });
  if (!s.hasData) return { marks, state: s };
  // поточний цикл: фактичні дні місячних + прогнозована овуляція
  for (let i = 0; i < st.periodLen; i++) mark(addDays(s.lastStart, i), 'period');
  const ovCur = s.ovulation;
  for (let i = -5; i <= 1; i++) mark(addDays(ovCur, i), i === 0 ? 'ovulationPred' : 'fertilePred');
  // майбутні цикли; при затримці прогноз зсувається від завтра
  let start = s.late > 0 ? addDays(today, 1) : s.nextStart;
  for (let k = 0; k < horizon; k++) {
    markCycle(start, addDays(start, L), true);
    start = addDays(start, L);
  }
  return { marks, state: s };
}

// Чи куплено запас на поточний цикл (галочка скидається з новим початком місячних)
export function suppliesState(data, lastStart) {
  const sup = (data && data.supplies) || {};
  const one = k => {
    const r = sup[k];
    return r && r.bought && (!lastStart || (r.day && r.day >= lastStart)) ? r : null;
  };
  return { tampons: one('tampons'), pills: one('pills') };
}

// Які нагадування мають піти в цей запуск крону (slot: 'am' | 'pm').
// Використовує воркер; винесено сюди, щоб перевіряти тестами.
export function dueReminders(data, today, slot) {
  const s = computeState(data, today);
  const out = [];
  if (!s.hasData) return out;
  // запас: від доби до очікуваних місячних, раз на 12 год, поки не куплено
  // або поки не відмітили початок (максимум тиждень затримки, щоб не спамити)
  const sup = suppliesState(data, s.lastStart);
  const missing = [!sup.tampons && 'тампони', !sup.pills && 'знеболююче'].filter(Boolean);
  if (!s.inPeriod && s.daysToNext <= 1 && s.late <= 7 && missing.length) {
    const what = missing.join(' і ');
    const when = s.daysToNext === 1 ? 'Завтра очікуються місячні' : s.late > 0 ? `Затримка ${s.late} ${plural(s.late, 'день', 'дні', 'днів')}` : 'Сьогодні очікуються місячні';
    out.push({ kind: 'supplies', title: 'Цикл', body: `${when} — купіть ${what}` });
  }
  // овуляція: за день до піку, один раз (ранковий запуск)
  if (slot === 'am' && s.daysToOvulation === 1)
    out.push({ kind: 'ovulation', title: 'Цикл', body: 'Завтра овуляція — пік фертильності' });
  return out;
}

export function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
