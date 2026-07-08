// Процедурний ембієнт (WebAudio, без аудіофайлів): дощ, вогнище, цвіркуни,
// грім, ворона, вітер, сова, жаби, скрип хати, далекий дзвін, далекий пес.
// Кожен генератор — вузли WebAudio; мікс керується рівнями 0..1.
// Використовує лобі (шторм за вікном) і Редактор Звуку (прев'ю/мікс).
//
// ВАЖЛИВО: браузер дозволяє звук лише після взаємодії — стартуємо на pointerdown.

export interface AmbienceMix {
  master: number;
  rain: number;
  fire: number;
  crickets: number;
  thunder: number; // гучність гуркоту (тригериться зовні, під спалах)
  crow: number;    // гучність + частота крякань
  wind: number;    // вітер: гул + пориви + виття у щілинах
  owl: number;     // сова: «угу-гу» зрідка
  frogs: number;   // жаби: кумкання (болота Тихоплаву)
  creak: number;   // скрип дерев'яної хати зрідка
  bell: number;    // далекий дзвін (тривожно, дуже зрідка)
  dog: number;     // далекий пес: приглушений гавкіт серіями
}

// Нові звуки за замовчуванням ВИМКНЕНІ (0) — щоб наявний саунд лобі не змінився,
// поки їх не підкрутити в Редакторі Звуку.
export const DEFAULT_MIX: AmbienceMix = {
  master: 0.8, rain: 0.55, fire: 0.5, crickets: 0.25, thunder: 0.8, crow: 0.35,
  wind: 0, owl: 0, frogs: 0, creak: 0, bell: 0, dog: 0,
};

// Ключі каналів міксу (без master) — щоб не тримати список у трьох місцях.
export const MIX_KEYS = ['rain', 'fire', 'crickets', 'thunder', 'crow', 'wind', 'owl', 'frogs', 'creak', 'bell', 'dog'] as const;

let ctx: AudioContext | null = null;
let masterGain: GainNode | null = null;
const gains: Partial<Record<keyof AmbienceMix, GainNode>> = {};
let running = false;
let timers: number[] = [];

function ac(): AudioContext {
  if (!ctx) ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
  return ctx;
}

// Буфер білого шуму (2с, реюз усіма генераторами).
let noiseBuf: AudioBuffer | null = null;
function noise(): AudioBuffer {
  if (noiseBuf) return noiseBuf;
  const a = ac();
  noiseBuf = a.createBuffer(1, a.sampleRate * 2, a.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return noiseBuf;
}

function loopNoise(dest: AudioNode): AudioBufferSourceNode {
  const src = ac().createBufferSource();
  src.buffer = noise(); src.loop = true;
  src.connect(dest); src.start();
  return src;
}

// ── ДОЩ (за вікном/склом): приглушений — скло ріже верх, стуки глухі ─────────
// Характер дощу дають транзієнти-краплі, а не рівний шум (рівний шум = «шшш»).
function startRain(out: GainNode): void {
  const a = ac();
  // «скло»: усе дощове йде через спільний lowpass — тьмяно, як з-за шибки
  const glass = a.createBiquadFilter(); glass.type = 'lowpass'; glass.frequency.value = 2300; glass.Q.value = 0.3;
  glass.connect(out);
  // тонка підкладка-мряка (ледь чутна)
  const hp = a.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 900;
  const g = a.createGain(); g.gain.value = 0.09;
  loopNoise(hp); hp.connect(g); g.connect(glass);
  const lfo = a.createOscillator(); lfo.frequency.value = 0.07; // пориви
  const lfoG = a.createGain(); lfoG.gain.value = 0.035;
  lfo.connect(lfoG); lfoG.connect(g.gain); lfo.start();
  // краплі: м'які глухуваті стуки, нижчі й тихіші (не «дзвін»)
  const drop = (): void => {
    if (!running) return;
    const t = a.currentTime;
    const src = a.createBufferSource(); src.buffer = noise();
    const bp = a.createBiquadFilter(); bp.type = 'bandpass';
    bp.frequency.value = 800 + Math.random() * 1700; bp.Q.value = 7;
    const dg = a.createGain();
    const peak = 0.14 + Math.random() * 0.24;
    dg.gain.setValueAtTime(0.0001, t);
    dg.gain.exponentialRampToValueAtTime(peak, t + 0.005);
    dg.gain.exponentialRampToValueAtTime(0.0001, t + 0.03 + Math.random() * 0.05);
    src.connect(bp); bp.connect(dg); dg.connect(glass);
    src.start(t); src.stop(t + 0.1);
    timers.push(window.setTimeout(drop, 20 + Math.random() * 70));
  };
  drop();
}

// ── ВОГНИЩЕ: ледь чутне «дихання» жару + ГОЛОВНЕ — сухі тріски-«попкорн» ──────
function startFire(out: GainNode): void {
  const a = ac();
  // низький жар — тихий, з повільним диханням
  const lp = a.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 160; lp.Q.value = 0.4;
  const g = a.createGain(); g.gain.value = 0.09;
  loopNoise(lp); lp.connect(g); g.connect(out);
  const breathe = a.createOscillator(); breathe.frequency.value = 0.23;
  const bg = a.createGain(); bg.gain.value = 0.04;
  breathe.connect(bg); bg.connect(g.gain); breathe.start();
  // один тріск (клік із коротким дзвоном); кластеризуються як попкорн
  const snap = (delay: number, loud: number): void => {
    const t = a.currentTime + delay;
    const src = a.createBufferSource(); src.buffer = noise();
    const bp = a.createBiquadFilter(); bp.type = 'bandpass';
    bp.frequency.value = 1400 + Math.random() * 3800; bp.Q.value = 16;
    const cg = a.createGain();
    cg.gain.setValueAtTime(0.0001, t);
    cg.gain.exponentialRampToValueAtTime(loud, t + 0.002);
    cg.gain.exponentialRampToValueAtTime(0.0001, t + 0.015 + Math.random() * 0.03);
    src.connect(bp); bp.connect(cg); cg.connect(out);
    src.start(t); src.stop(t + 0.06);
  };
  const crackle = (): void => {
    if (!running) return;
    snap(0, 0.6 + Math.random() * 0.6);
    // кластер: 40% шанс ще 1-2 тріски одразу слідом (попкорн)
    if (Math.random() < 0.4) snap(0.03 + Math.random() * 0.05, 0.4 + Math.random() * 0.4);
    if (Math.random() < 0.15) snap(0.08 + Math.random() * 0.06, 0.3 + Math.random() * 0.3);
    // зрідка — глухий «пух» осілого поліна
    if (Math.random() < 0.08) {
      const t = a.currentTime + 0.02;
      const src = a.createBufferSource(); src.buffer = noise();
      const blp = a.createBiquadFilter(); blp.type = 'lowpass'; blp.frequency.value = 300;
      const pg = a.createGain();
      pg.gain.setValueAtTime(0.0001, t);
      pg.gain.exponentialRampToValueAtTime(0.5, t + 0.02);
      pg.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
      src.connect(blp); blp.connect(pg); pg.connect(out);
      src.start(t); src.stop(t + 0.3);
    }
    timers.push(window.setTimeout(crackle, 90 + Math.random() * 500));
  };
  crackle();
}

// ── ЦВІРКУНИ: 2 «особини», регулярні серії коротких пульсів (дуже впізнавано) ─
function startCrickets(out: GainNode): void {
  const a = ac();
  const individual = (baseFreq: number, startDelay: number): void => {
    const cycle = (): void => {
      if (!running) return;
      const pulses = 3 + Math.floor(Math.random() * 3); // серія цвірінь
      const t0 = a.currentTime;
      for (let i = 0; i < pulses; i++) {
        const t = t0 + i * 0.075;
        const osc = a.createOscillator(); osc.type = 'sine';
        osc.frequency.value = baseFreq + Math.random() * 120;
        const g = a.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.30, t + 0.008);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
        osc.connect(g); g.connect(out);
        osc.start(t); osc.stop(t + 0.06);
      }
      timers.push(window.setTimeout(cycle, pulses * 75 + 350 + Math.random() * 1100));
    };
    timers.push(window.setTimeout(cycle, startDelay));
  };
  individual(4300, 100);
  individual(4750, 800); // друга — вища і в протифазі
}

// ── ГРІМ: низький шум-розкат із повільним загасанням (тригер під спалах) ─────
// Грім ДАЛЕКИЙ: приходить із запізненням після спалаху (звук повільніший за
// світло) і КОТИТЬСЯ — довгий рокіт ~8с із випадковими хвилями, без різкого
// «кряку» (на відстані тріск розряду не чутно, лише низ).
export function triggerThunder(delayMs = 5000): void {
  if (!running || !ctx || !gains.thunder) return;
  const a = ctx;
  const t = a.currentTime + delayMs / 1000;
  const DUR = 7 + Math.random() * 2.5;
  const src = a.createBufferSource(); src.buffer = noise(); src.loop = true;
  const lp = a.createBiquadFilter(); lp.type = 'lowpass';
  lp.frequency.setValueAtTime(110, t);
  lp.frequency.exponentialRampToValueAtTime(32, t + DUR);
  const g = a.createGain();
  // повільне наростання → серія хвиль рокоту, що поступово вщухають
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(0.55 + Math.random() * 0.2, t + 0.5 + Math.random() * 0.3);
  let tt = 0.9;
  while (tt < DUR - 1.2) {
    const fade = 1 - tt / DUR; // загальне згасання
    g.gain.linearRampToValueAtTime((0.15 + Math.random() * 0.25) * fade, t + tt);
    tt += 0.5 + Math.random() * 0.5;
    g.gain.linearRampToValueAtTime((0.4 + Math.random() * 0.35) * fade, t + tt);
    tt += 0.6 + Math.random() * 0.7;
  }
  g.gain.linearRampToValueAtTime(0.0001, t + DUR);
  src.connect(lp); lp.connect(g); g.connect(gains.thunder);
  src.start(t); src.stop(t + DUR + 0.2);
}

// ── ВОРОНА: справжнє хрипке «КАРР» ────────────────────────────────────────────
// Було: гладка пила з гліссандо вниз через bandpass — виходив писк («суслік»).
// Кар — це ШОРСТКИЙ звук: деренчання горла (амплітудна модуляція ~100Гц),
// перегруз (драний тембр), форманти дзьоба ~1.2/2.3кГц і шум-видих.
let _crowCurve: Float32Array<ArrayBuffer> | null = null;
function crowCurve(): Float32Array<ArrayBuffer> {
  if (_crowCurve) return _crowCurve;
  const n = 1024; const c = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(3.5 * x); }
  _crowCurve = c; return c;
}
function caw(a: AudioContext, t: number, out: AudioNode): void {
  const dur = 0.15 + Math.random() * 0.09;
  // хрипкий тон: пила з невеликим спадом висоти (не свист!)
  const osc = a.createOscillator(); osc.type = 'sawtooth';
  const f0 = 400 + Math.random() * 90;
  osc.frequency.setValueAtTime(f0, t);
  osc.frequency.linearRampToValueAtTime(f0 * 0.7, t + dur);
  const shaper = a.createWaveShaper(); shaper.curve = crowCurve();
  // деренчання горла: АМ ~90–140Гц — ключ до «карр» замість писку
  const am = a.createGain(); am.gain.value = 0.55;
  const amOsc = a.createOscillator(); amOsc.type = 'square';
  amOsc.frequency.value = 90 + Math.random() * 50;
  const amDepth = a.createGain(); amDepth.gain.value = 0.42;
  amOsc.connect(amDepth); amDepth.connect(am.gain);
  // форманти (паралельно): «дзьоб» + верхній скрегіт
  const fm1 = a.createBiquadFilter(); fm1.type = 'bandpass'; fm1.frequency.value = 1250; fm1.Q.value = 1.5;
  const fm2 = a.createBiquadFilter(); fm2.type = 'bandpass'; fm2.frequency.value = 2300; fm2.Q.value = 2.5;
  const fm2g = a.createGain(); fm2g.gain.value = 0.55;
  // шум-видих тим самим конвертом (хрип)
  const nsrc = a.createBufferSource(); nsrc.buffer = noise();
  const nbp = a.createBiquadFilter(); nbp.type = 'bandpass'; nbp.frequency.value = 1700; nbp.Q.value = 0.8;
  const ng = a.createGain(); ng.gain.value = 0.28;
  // конверт: різкий викрик, тримається, короткий хвіст
  const env = a.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(0.9, t + 0.013);
  env.gain.setValueAtTime(0.9, t + dur * 0.65);
  env.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.06);
  osc.connect(shaper); shaper.connect(am);
  am.connect(fm1); am.connect(fm2); fm2.connect(fm2g);
  fm1.connect(env); fm2g.connect(env);
  nsrc.connect(nbp); nbp.connect(ng); ng.connect(env);
  env.connect(out);
  osc.start(t); osc.stop(t + dur + 0.1);
  amOsc.start(t); amOsc.stop(t + dur + 0.1);
  nsrc.start(t); nsrc.stop(t + dur + 0.1);
}
export function triggerCrow(): void {
  if (!running || !ctx || !gains.crow) return;
  const a = ctx;
  const n = 2 + Math.floor(Math.random() * 2); // 2–3 «карр» серією
  let t = a.currentTime + 0.02;
  for (let i = 0; i < n; i++) { caw(a, t, gains.crow); t += 0.3 + Math.random() * 0.22; }
}

function startCrowLoop(): void {
  const cycle = (): void => {
    if (!running) return;
    triggerCrow();
    timers.push(window.setTimeout(cycle, 9000 + Math.random() * 22000));
  };
  timers.push(window.setTimeout(cycle, 3500 + Math.random() * 6000));
}

// ── ВІТЕР: низький гул із поривами + тонке виття у щілинах ────────────────────
function startWind(out: GainNode): void {
  const a = ac();
  // тіло вітру: низький шум із повільними поривами
  const lp = a.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420; lp.Q.value = 0.4;
  const g = a.createGain(); g.gain.value = 0.22;
  loopNoise(lp); lp.connect(g); g.connect(out);
  const gust = a.createOscillator(); gust.frequency.value = 0.06;
  const gustG = a.createGain(); gustG.gain.value = 0.12;
  gust.connect(gustG); gustG.connect(g.gain); gust.start();
  const gust2 = a.createOscillator(); gust2.frequency.value = 0.17;
  const gust2G = a.createGain(); gust2G.gain.value = 0.05;
  gust2.connect(gust2G); gust2G.connect(g.gain); gust2.start();
  // виття у щілинах: вузький резонанс, що повільно плаває 500–1100Гц
  const howl = a.createBiquadFilter(); howl.type = 'bandpass'; howl.frequency.value = 750; howl.Q.value = 14;
  const hg = a.createGain(); hg.gain.value = 0.05;
  loopNoise(howl); howl.connect(hg); hg.connect(out);
  const sweep = a.createOscillator(); sweep.frequency.value = 0.043;
  const sweepG = a.createGain(); sweepG.gain.value = 300;
  sweep.connect(sweepG); sweepG.connect(howl.frequency); sweep.start();
  const hLfo = a.createOscillator(); hLfo.frequency.value = 0.09;
  const hLfoG = a.createGain(); hLfoG.gain.value = 0.03;
  hLfo.connect(hLfoG); hLfoG.connect(hg.gain); hLfo.start();
}

// ── СОВА: м'яке «у-гу…  угуу» — тепла синусоїда з вібрато й м'яким виходом ────
export function triggerOwl(): void {
  if (!running || !ctx || !gains.owl) return;
  const a = ctx;
  const f0 = 330 + Math.random() * 40;
  const hoot = (t: number, dur: number, drop: number): void => {
    const osc = a.createOscillator(); osc.type = 'triangle';
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.linearRampToValueAtTime(f0 * drop, t + dur);
    const vib = a.createOscillator(); vib.frequency.value = 5.2;
    const vibG = a.createGain(); vibG.gain.value = 6;
    vib.connect(vibG); vibG.connect(osc.frequency);
    const lp = a.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
    const g = a.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.06);
    g.gain.setValueAtTime(0.5, t + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.12);
    osc.connect(lp); lp.connect(g); g.connect(gains.owl!);
    osc.start(t); osc.stop(t + dur + 0.15);
    vib.start(t); vib.stop(t + dur + 0.15);
  };
  const t0 = a.currentTime + 0.02;
  hoot(t0, 0.14, 0.96);           // коротке «у»
  hoot(t0 + 0.32, 0.45, 0.88);    // довге «гуу» зі спадом
}
function startOwlLoop(): void {
  const cycle = (): void => {
    if (!running) return;
    triggerOwl();
    timers.push(window.setTimeout(cycle, 14000 + Math.random() * 30000));
  };
  timers.push(window.setTimeout(cycle, 6000 + Math.random() * 10000));
}

// ── ЖАБИ: кумкання — короткі «ква» з деренчанням, 2 особини в протифазі ───────
function startFrogs(out: GainNode): void {
  const a = ac();
  const kva = (t: number, f0: number): void => {
    const osc = a.createOscillator(); osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.linearRampToValueAtTime(f0 * 0.65, t + 0.16);
    // деренчання: АМ ~28Гц — характерне жаб'яче
    const am = a.createGain(); am.gain.value = 0.6;
    const amOsc = a.createOscillator(); amOsc.type = 'square'; amOsc.frequency.value = 26 + Math.random() * 8;
    const amD = a.createGain(); amD.gain.value = 0.4;
    amOsc.connect(amD); amD.connect(am.gain);
    const bp = a.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 300; bp.Q.value = 0.9;
    const g = a.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.85, t + 0.02);
    g.gain.linearRampToValueAtTime(0.5, t + 0.15); // тіло «ква» тримається
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
    osc.connect(am); am.connect(bp); bp.connect(g); g.connect(out);
    osc.start(t); osc.stop(t + 0.24);
    amOsc.start(t); amOsc.stop(t + 0.24);
  };
  const individual = (f0: number, startDelay: number): void => {
    const cycle = (): void => {
      if (!running) return;
      const n = 1 + Math.floor(Math.random() * 3);
      const t0 = a.currentTime;
      for (let i = 0; i < n; i++) kva(t0 + i * (0.34 + Math.random() * 0.1), f0 + Math.random() * 30);
      timers.push(window.setTimeout(cycle, n * 380 + 900 + Math.random() * 2600));
    };
    timers.push(window.setTimeout(cycle, startDelay));
  };
  individual(210, 300);
  individual(165, 1500); // друга — нижча, у протифазі
}

// ── СКРИП ХАТИ: рипіння дерева зрідка (резонансна «пила», що повзе вгору) ─────
export function triggerCreak(): void {
  if (!running || !ctx || !gains.creak) return;
  const a = ctx;
  const t = a.currentTime + 0.02;
  const dur = 0.35 + Math.random() * 0.5;
  const osc = a.createOscillator(); osc.type = 'sawtooth';
  const f0 = 70 + Math.random() * 50;
  osc.frequency.setValueAtTime(f0, t);
  // рипіння «сходинками» — стик-слип дерева
  let ft = 0.06;
  while (ft < dur) {
    osc.frequency.linearRampToValueAtTime(f0 * (1 + ft / dur * (0.6 + Math.random() * 0.5)), t + ft);
    ft += 0.05 + Math.random() * 0.07;
  }
  const bp = a.createBiquadFilter(); bp.type = 'bandpass';
  bp.frequency.setValueAtTime(380 + Math.random() * 200, t);
  bp.frequency.linearRampToValueAtTime(700 + Math.random() * 350, t + dur);
  bp.Q.value = 9;
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.55, t + dur * 0.35);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.1);
  osc.connect(bp); bp.connect(g); g.connect(gains.creak!);
  osc.start(t); osc.stop(t + dur + 0.15);
}
function startCreakLoop(): void {
  const cycle = (): void => {
    if (!running) return;
    triggerCreak();
    // зрідка подвійний скрип (хтось пройшов?)
    if (Math.random() < 0.3) timers.push(window.setTimeout(triggerCreak, 500 + Math.random() * 700));
    timers.push(window.setTimeout(cycle, 12000 + Math.random() * 26000));
  };
  timers.push(window.setTimeout(cycle, 5000 + Math.random() * 9000));
}

// ── ДАЛЕКИЙ ДЗВІН: негармонійні парціали, довгий хвіст (тривожний фолк-горор) ─
export function triggerBell(): void {
  if (!running || !ctx || !gains.bell) return;
  const a = ctx;
  const strikes = 1 + Math.floor(Math.random() * 3);
  const f0 = 145 + Math.random() * 25;
  for (let s = 0; s < strikes; s++) {
    const t = a.currentTime + 0.05 + s * (2.4 + Math.random() * 0.4);
    // класичні дзвонові співвідношення (хам/прайм/терція/квінта/номінал)
    for (const [ratio, amp, dec] of [[0.5, 0.5, 5.5], [1, 1, 4.5], [1.19, 0.55, 3.2], [1.5, 0.4, 2.6], [2.02, 0.5, 1.8]] as const) {
      const osc = a.createOscillator(); osc.type = 'sine';
      osc.frequency.value = f0 * ratio * (1 + (Math.random() - 0.5) * 0.004);
      const g = a.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.32 * amp, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dec);
      osc.connect(g); g.connect(gains.bell!);
      osc.start(t); osc.stop(t + dec + 0.1);
    }
    // удар: короткий глухий клац
    const nsrc = a.createBufferSource(); nsrc.buffer = noise();
    const nlp = a.createBiquadFilter(); nlp.type = 'lowpass'; nlp.frequency.value = 800;
    const ng = a.createGain();
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.exponentialRampToValueAtTime(0.2, t + 0.005);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
    nsrc.connect(nlp); nlp.connect(ng); ng.connect(gains.bell!);
    nsrc.start(t); nsrc.stop(t + 0.1);
  }
}
function startBellLoop(): void {
  const cycle = (): void => {
    if (!running) return;
    triggerBell();
    timers.push(window.setTimeout(cycle, 50000 + Math.random() * 90000)); // дуже зрідка
  };
  timers.push(window.setTimeout(cycle, 20000 + Math.random() * 40000));
}

// ── ДАЛЕКИЙ ПЕС: приглушений гавкіт серіями (за селом) ────────────────────────
export function triggerDog(): void {
  if (!running || !ctx || !gains.dog) return;
  const a = ctx;
  const n = 2 + Math.floor(Math.random() * 4);
  let t = a.currentTime + 0.02;
  for (let i = 0; i < n; i++) {
    const osc = a.createOscillator(); osc.type = 'sawtooth';
    const f0 = 300 + Math.random() * 80;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(f0 * 0.7, t + 0.07);
    const shaper = a.createWaveShaper(); shaper.curve = crowCurve();
    const fm = a.createBiquadFilter(); fm.type = 'bandpass'; fm.frequency.value = 850; fm.Q.value = 1.2;
    // далеко: зрізаний верх
    const dist = a.createBiquadFilter(); dist.type = 'lowpass'; dist.frequency.value = 1100;
    const g = a.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.6, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    osc.connect(shaper); shaper.connect(fm); fm.connect(dist); dist.connect(g); g.connect(gains.dog!);
    osc.start(t); osc.stop(t + 0.12);
    t += 0.16 + Math.random() * 0.2;
  }
}
function startDogLoop(): void {
  const cycle = (): void => {
    if (!running) return;
    triggerDog();
    timers.push(window.setTimeout(cycle, 18000 + Math.random() * 35000));
  };
  timers.push(window.setTimeout(cycle, 8000 + Math.random() * 14000));
}

// ── Публічне API ──────────────────────────────────────────────────────────────
let analyser: AnalyserNode | null = null;
// Аналізатор живого міксу (осцилограма в Редакторі Звуку). null, поки не грає.
export function getAnalyser(): AnalyserNode | null { return analyser; }

export function startAmbience(mix: AmbienceMix): void {
  if (running) { setMix(mix); return; }
  const a = ac();
  void a.resume();
  running = true;
  masterGain = a.createGain(); masterGain.gain.value = mix.master;
  analyser = a.createAnalyser(); analyser.fftSize = 2048;
  masterGain.connect(analyser);
  masterGain.connect(a.destination);
  for (const k of MIX_KEYS) {
    const g = a.createGain(); g.gain.value = mix[k]; g.connect(masterGain);
    gains[k] = g;
  }
  startRain(gains.rain!);
  startFire(gains.fire!);
  startCrickets(gains.crickets!);
  startWind(gains.wind!);
  startFrogs(gains.frogs!);
  startCrowLoop();
  startOwlLoop();
  startCreakLoop();
  startBellLoop();
  startDogLoop();
}

export function setMix(mix: Partial<AmbienceMix>): void {
  if (!ctx) return;
  if (mix.master != null && masterGain) masterGain.gain.value = mix.master;
  for (const k of MIX_KEYS) {
    if (mix[k] != null && gains[k]) gains[k]!.gain.value = mix[k]!;
  }
}

export function stopAmbience(): void {
  running = false;
  for (const t of timers) clearTimeout(t);
  timers = [];
  if (ctx) { void ctx.close(); ctx = null; }
  masterGain = null; analyser = null;
  for (const k of Object.keys(gains)) delete gains[k as keyof AmbienceMix];
  noiseBuf = null;
}

export function isAmbienceRunning(): boolean { return running; }

// Запускає ембієнт лоббі на першому тапі сцени, якщо він ще не грає (політика
// браузера: звук лише після взаємодії). Використовують і лоббі, і карта —
// щоб звук лоббі тривав на глобальних картах без переривання.
export function ensureAmbience(scene: { input: { once: (e: string, cb: () => void) => void } }): void {
  if (running) return;
  scene.input.once('pointerdown', () => { void loadLobbyMix().then((m) => startAmbience(m)); });
}

// Мікс лобі: локальний IDB (правки з Редактора Звуку) → published sound.json → дефолт.
export async function loadLobbyMix(): Promise<AmbienceMix> {
  try {
    const { idbGet } = await import('../store');
    const m = await idbGet<AmbienceMix>('zag_sound_mix');
    if (m && typeof m.master === 'number') return { ...DEFAULT_MIX, ...m };
  } catch { /* ignore */ }
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}studio-data/sound.json?t=${Date.now()}`);
    if (r.ok) { const j = await r.json() as { lobby?: AmbienceMix }; if (j.lobby) return { ...DEFAULT_MIX, ...j.lobby }; }
  } catch { /* ignore */ }
  return { ...DEFAULT_MIX };
}
