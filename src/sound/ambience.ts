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

// ── ДОЩ: шум → bandpass ~1.4кГц + повільна модуляція гучності (пориви) ────────
function startRain(out: GainNode): void {
  const a = ac();
  const bp = a.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1400; bp.Q.value = 0.4;
  const hp = a.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 400;
  const g = a.createGain(); g.gain.value = 0.5;
  loopNoise(bp); bp.connect(hp); hp.connect(g); g.connect(out);
  // пориви: LFO на гучність
  const lfo = a.createOscillator(); lfo.frequency.value = 0.07;
  const lfoG = a.createGain(); lfoG.gain.value = 0.15;
  lfo.connect(lfoG); lfoG.connect(g.gain); lfo.start();
}

// ── ВОГНИЩЕ: низький «шелест» + випадкові тріски-клацання ─────────────────────
function startFire(out: GainNode): void {
  const a = ac();
  const lp = a.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 380; lp.Q.value = 0.5;
  const g = a.createGain(); g.gain.value = 0.35;
  loopNoise(lp); lp.connect(g); g.connect(out);
  const crackle = (): void => {
    if (!running) return;
    // тріск: короткий шумовий пшик через bandpass, випадкова висота
    const src = a.createBufferSource(); src.buffer = noise();
    const bp = a.createBiquadFilter(); bp.type = 'bandpass';
    bp.frequency.value = 900 + Math.random() * 2600; bp.Q.value = 9;
    const cg = a.createGain();
    const t = a.currentTime;
    cg.gain.setValueAtTime(0.0001, t);
    cg.gain.exponentialRampToValueAtTime(0.5 + Math.random() * 0.5, t + 0.004);
    cg.gain.exponentialRampToValueAtTime(0.0001, t + 0.03 + Math.random() * 0.05);
    src.connect(bp); bp.connect(cg); cg.connect(out);
    src.start(t); src.stop(t + 0.12);
    timers.push(window.setTimeout(crackle, 60 + Math.random() * 420));
  };
  crackle();
}

// ── ЦВІРКУНИ: синус ~4.3кГц, тремоло ~28Гц, «пачки» цвірінькання ──────────────
function startCrickets(out: GainNode): void {
  const a = ac();
  const chirp = (): void => {
    if (!running) return;
    const osc = a.createOscillator(); osc.type = 'sine';
    osc.frequency.value = 4100 + Math.random() * 500;
    const trem = a.createOscillator(); trem.frequency.value = 24 + Math.random() * 10;
    const tremG = a.createGain(); tremG.gain.value = 0.5;
    const g = a.createGain(); g.gain.value = 0;
    trem.connect(tremG); tremG.connect(g.gain);
    osc.connect(g); g.connect(out);
    const t = a.currentTime, dur = 0.5 + Math.random() * 1.1;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.16, t + 0.05);
    g.gain.setValueAtTime(0.16, t + dur - 0.06);
    g.gain.linearRampToValueAtTime(0, t + dur);
    osc.start(t); trem.start(t); osc.stop(t + dur); trem.stop(t + dur);
    timers.push(window.setTimeout(chirp, 400 + Math.random() * 2200));
  };
  chirp();
}

// ── ГРІМ: низький шум-розкат із повільним загасанням (тригер під спалах) ─────
export function triggerThunder(delayMs = 500): void {
  if (!running || !ctx || !gains.thunder) return;
  const a = ctx;
  const t = a.currentTime + delayMs / 1000;
  const src = a.createBufferSource(); src.buffer = noise(); src.loop = true;
  const lp = a.createBiquadFilter(); lp.type = 'lowpass';
  lp.frequency.setValueAtTime(120, t);
  lp.frequency.exponentialRampToValueAtTime(45, t + 2.6);
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.9, t + 0.10);       // удар
  g.gain.exponentialRampToValueAtTime(0.25, t + 0.8);       // відкат
  g.gain.exponentialRampToValueAtTime(0.5, t + 1.3);        // другий розкат
  g.gain.exponentialRampToValueAtTime(0.0001, t + 3.2);
  src.connect(lp); lp.connect(g); g.connect(gains.thunder);
  src.start(t); src.stop(t + 3.4);
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
export function startAmbience(mix: AmbienceMix): void {
  if (running) { setMix(mix); return; }
  const a = ac();
  void a.resume();
  running = true;
  masterGain = a.createGain(); masterGain.gain.value = mix.master;
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
  masterGain = null;
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
