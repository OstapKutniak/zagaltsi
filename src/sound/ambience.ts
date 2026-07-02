// Процедурний ембієнт (WebAudio, без аудіофайлів): дощ, вогнище, цвіркуни,
// грім, ворона. Кожен генератор — вузли WebAudio; мікс керується рівнями 0..1.
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
}

export const DEFAULT_MIX: AmbienceMix = { master: 0.8, rain: 0.55, fire: 0.5, crickets: 0.25, thunder: 0.8, crow: 0.35 };

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

// ── ВОРОНА: «кар» = пилкоподібний тон 620→380Гц із хрипом, серія 1-3 ──────────
export function triggerCrow(): void {
  if (!running || !ctx || !gains.crow) return;
  const a = ctx;
  const n = 1 + Math.floor(Math.random() * 3);
  for (let i = 0; i < n; i++) {
    const t = a.currentTime + i * (0.42 + Math.random() * 0.15);
    const osc = a.createOscillator(); osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(600 + Math.random() * 60, t);
    osc.frequency.exponentialRampToValueAtTime(380, t + 0.16);
    const bp = a.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 1.4;
    // хрип: шум множиться на той самий конверт
    const g = a.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    osc.connect(bp); bp.connect(g); g.connect(gains.crow!);
    osc.start(t); osc.stop(t + 0.25);
  }
}

function startCrowLoop(): void {
  const caw = (): void => {
    if (!running) return;
    triggerCrow();
    timers.push(window.setTimeout(caw, 9000 + Math.random() * 22000));
  };
  timers.push(window.setTimeout(caw, 3500 + Math.random() * 6000));
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
  for (const k of ['rain', 'fire', 'crickets', 'thunder', 'crow'] as const) {
    const g = a.createGain(); g.gain.value = mix[k]; g.connect(masterGain);
    gains[k] = g;
  }
  startRain(gains.rain!);
  startFire(gains.fire!);
  startCrickets(gains.crickets!);
  startCrowLoop();
}

export function setMix(mix: Partial<AmbienceMix>): void {
  if (!ctx) return;
  if (mix.master != null && masterGain) masterGain.gain.value = mix.master;
  for (const k of ['rain', 'fire', 'crickets', 'thunder', 'crow'] as const) {
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
