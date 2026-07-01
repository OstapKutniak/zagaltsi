export type WeatherType = 'clear' | 'rain' | 'snow' | 'fog';

// ── Шари для per-layer тонування ────────────────────────────────────────────

export type LayerKey = 'sky' | 'clouds' | 'bg' | 'frontbg' | 'map' | 'foreground';
export const LAYER_KEYS: LayerKey[] = ['sky', 'clouds', 'bg', 'frontbg', 'map', 'foreground'];
export const LAYER_LABELS: Record<LayerKey, string> = {
  sky: 'Небо', clouds: 'Хмари', bg: 'Задній фон',
  frontbg: 'Передній фон', map: 'Карта', foreground: 'Передній план',
};
export const BLEND_MODES = ['normal', 'multiply', 'screen', 'overlay', 'add', 'darken', 'lighten', 'color-dodge', 'color-burn'] as const;
export type BlendMode = typeof BLEND_MODES[number];
export const BLEND_LABELS: Record<BlendMode, string> = {
  normal: 'Нормальне', multiply: 'Мультиплай', screen: 'Екран',
  overlay: 'Оверлей', add: 'Додавання', darken: 'Затемнення',
  lighten: 'Засвітлення', 'color-dodge': 'Ухилення кольором', 'color-burn': 'Випалювання',
};

export interface LayerTint { color: string; alpha: number; blend: BlendMode; }
export type TodLayers = Partial<Record<LayerKey, LayerTint>>;

// ── Три незалежні секції атмосфери ──────────────────────────────────────────

export interface SkyPhase     { durationSec: number; skyHex: string; groundHex: string }
export interface TodPhase {
  durationSec: number;
  ambientHex?: string;    // legacy
  ambientAlpha?: number;  // legacy
  layers?: TodLayers;     // нові per-layer тонти
}
export interface WeatherPhase {
  durationSec: number;      // legacy (більше не в UI — секції статичні per-level)
  type?: WeatherType;       // legacy exclusive-тип; лишається для міграції у стак-тумблери
  // ── СТАК: незалежні модифікатори погоди (можна вмикати кілька разом) ──
  rain?:  boolean;
  snow?:  boolean;
  fog?:   boolean;
  fogAlpha?: number;        // legacy повноекранний туман — більше НЕ рендериться
  // rain-specific
  rainColor?:   string;   // hex, default '#aaddff'
  rainDir?:     number;   // degrees tilt right, default 15
  rainSpeed?:   number;   // px/sec mid-layer, default 600
  rainDropLen?: number;   // px at mid layer, default 16
  rainDrops?:   number;   // кількість крапель 10-500% від базової, default 100
  rainNear?:    number;   // near layer opacity 0-1, default 1
  rainMid?:     number;   // mid layer opacity 0-1, default 0.7
  rainFar?:     number;   // far layer opacity 0-1, default 0.35
  lightning?:   boolean;
  lightningFreq?:  number; // частота 1 (рідко) .. 10 (часто) — нова; якщо немає, fallback → lightningEvery
  lightningEvery?: number; // legacy: середній інтервал сек
  lightningVary?:  number; // рандомізація 0..1 (default 0.5)
  rainSplash?:  boolean;
  splashSize?:      number;
  splashCount?:     number;
  splashIntensity?: number;
  // ── ТУМАН: процедурний, per-layer (замість купи PNG) ──
  fogLayers?: Partial<Record<LayerKey, FogLayer>>;
}

// Один шар процедурного туману. Малюється тайлованою текстурою (смуги+нойз+блюр),
// прив'язаною до екрана; напрямок/швидкість ганяють патерн. Рандом = варіація патерна.
export interface FogLayer {
  color: string;   // hex, default '#c2ccd6'
  alpha: number;   // 0..1 непрозорість, default 0.4
  speed: number;   // px/sec руху патерна, default 12
  dir:   number;   // degrees напрямок руху (0 = праворуч, 90 = вниз), default 0
  seed:  number;   // рандомізація патерна (зсув/масштаб), default random
  scale?: number;  // масштаб патерна (розмір «клубів»), 0.5..3, default 1
}

export const DEFAULT_FOG_LAYER = (): FogLayer => ({ color: '#c2ccd6', alpha: 0.4, speed: 12, dir: 0, seed: Math.floor(Math.random() * 1000), scale: 1 });

export interface AtmSky     { enabled: boolean; static?: boolean; phases: SkyPhase[] }
export interface AtmTod     { enabled: boolean; static?: boolean; phases: TodPhase[] }
export interface AtmWeather { enabled: boolean; static?: boolean; phases: WeatherPhase[] }

// ── Віньєтка ─────────────────────────────────────────────────────────────────

export interface AtmVignette {
  enabled: boolean;
  strength?: number;   // 0-1, скільки темніє до країв; default 0.6
  blend?: BlendMode;   // режим накладання; default 'multiply'
  color?: string;      // колір краю (hex); default '#000000'
  top?: number;        // 0-1, частка висоти екрана де ПОЧИНАЄТЬСЯ овал (верх); default 0.5
}

// ── Кольоровий баланс ────────────────────────────────────────────────────────

export interface AtmColorBalance {
  enabled: boolean;
  brightness?: number;        // 0-2, default 1 (нейтральне)
  contrast?: number;          // 0-2, default 1
  saturation?: number;        // 0-2, default 1
  hue?: number;               // 0-360, default 0
  shadowColor?: string;       // відтінок тіней (hex)
  shadowStrength?: number;    // 0-1
  midColor?: string;
  midStrength?: number;
  highlightColor?: string;
  highlightStrength?: number;
  cavity?: number;            // 0-1, підсилення порожнин (прото-AO)
}

export interface Atmosphere {
  sky?:          AtmSky;
  tod?:          AtmTod;
  weather?:      AtmWeather;
  vignette?:     AtmVignette;
  colorBalance?: AtmColorBalance;
}

// ── Кольорові утиліти ────────────────────────────────────────────────────────

export function parseHex(hex: string): [number, number, number] {
  const h = hex.replace('#', '').padStart(6, '0');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function lerpHex(a: string, b: string, f: number): number {
  const [ar, ag, ab] = parseHex(a);
  const [br, bg, bb] = parseHex(b);
  return (Math.round(ar + (br - ar) * f) << 16) | (Math.round(ag + (bg - ag) * f) << 8) | Math.round(ab + (bb - ab) * f);
}

// Hex string → Phaser int (0xRRGGBB)
export function hexToInt(hex: string): number {
  const h = hex.replace('#', '').padStart(6, '0');
  return parseInt(h, 16);
}

// ── Пошук фази за часом (duration-based) ────────────────────────────────────

function findPhase<T extends { durationSec: number }>(phases: T[], wallSec: number): { pA: T; pB: T; f: number } {
  if (phases.length === 0) return { pA: {} as T, pB: {} as T, f: 0 };
  if (phases.length === 1) return { pA: phases[0], pB: phases[0], f: 0 };
  const cycle = phases.reduce((s, p) => s + Math.max(0.001, p.durationSec), 0);
  let t = wallSec % cycle;
  for (let i = 0; i < phases.length; i++) {
    const dur = Math.max(0.001, phases[i].durationSec);
    if (t <= dur || i === phases.length - 1) {
      return { pA: phases[i], pB: phases[(i + 1) % phases.length], f: Math.max(0, Math.min(1, t / dur)) };
    }
    t -= dur;
  }
  return { pA: phases[0], pB: phases[0], f: 0 };
}

function staticOrFind<T extends { durationSec: number }>(arr: T[], wallSec: number, isStatic?: boolean): { pA: T; pB: T; f: number } {
  if (!arr.length) return { pA: {} as T, pB: {} as T, f: 0 };
  if (isStatic) return { pA: arr[0], pB: arr[0], f: 0 };
  return findPhase(arr, wallSec);
}

// ── Eval ─────────────────────────────────────────────────────────────────────

export interface SkyState     { skyColor: number; groundColor: number }
export interface TodState     { ambientColor: number; ambientAlpha: number; layers: TodLayers }
export interface WeatherState {
  rain: boolean; snow: boolean; fog: boolean; lightning: boolean;
  rainColor: string; rainDir: number; rainSpeed: number; rainDropLen: number; rainDrops: number;
  rainNear: number; rainMid: number; rainFar: number; rainSplash: boolean;
  lightningEvery: number; lightningVary: number;
  splashSize: number; splashCount: number; splashIntensity: number;
  fogLayers: Partial<Record<LayerKey, FogLayer>>;
}

// Стак-тумблери фази: беремо явні rain/snow/fog, або (legacy) виводимо з exclusive type.
// Викликається і в редакторі (щоб чекбокси показали правильний стан), і в грі.
export function weatherToggles(ph: WeatherPhase): { rain: boolean; snow: boolean; fog: boolean } {
  const hasToggles = ph.rain !== undefined || ph.snow !== undefined || ph.fog !== undefined;
  if (hasToggles) return { rain: !!ph.rain, snow: !!ph.snow, fog: !!ph.fog };
  return { rain: ph.type === 'rain', snow: ph.type === 'snow', fog: ph.type === 'fog' };
}

export function evalSky(sky: AtmSky, wallSec: number): SkyState {
  const { pA, pB, f } = staticOrFind(sky.phases, wallSec, sky.static);
  return {
    skyColor:    lerpHex((pA as SkyPhase).skyHex    ?? '#3a3148', (pB as SkyPhase).skyHex    ?? '#3a3148', f),
    groundColor: lerpHex((pA as SkyPhase).groundHex ?? '#4a3f2e', (pB as SkyPhase).groundHex ?? '#4a3f2e', f),
  };
}

export function evalTod(tod: AtmTod, wallSec: number): TodState {
  const { pA, pB, f } = staticOrFind(tod.phases, wallSec, tod.static);
  const a = pA as TodPhase, b = pB as TodPhase;
  return {
    ambientColor: lerpHex(a.ambientHex ?? '#000000', b.ambientHex ?? '#000000', f),
    ambientAlpha: (a.ambientAlpha ?? 0) + ((b.ambientAlpha ?? 0) - (a.ambientAlpha ?? 0)) * f,
    layers: a.layers ?? {},
  };
}

export function evalWeather(wx: AtmWeather, wallSec: number): WeatherState {
  // Секції статичні per-level → беремо фазу 0 (durationSec/фази-цикл поки не в UI).
  const a = (wx.phases[0] ?? {}) as WeatherPhase;
  const tog = weatherToggles(a);
  // Частота блискавки: нова freq (1-10) або legacy lightningEvery
  const freq = a.lightningFreq;
  const every = freq != null ? (30 / Math.max(1, freq)) : (a.lightningEvery ?? 10);
  return {
    rain: tog.rain, snow: tog.snow, fog: tog.fog,
    lightning:   !!a.lightning,
    rainColor:   a.rainColor   ?? '#aaddff',
    rainDir:     a.rainDir     ?? 15,
    rainSpeed:   a.rainSpeed   ?? 600,
    rainDropLen: a.rainDropLen ?? 16,
    rainDrops:   a.rainDrops   ?? 100,
    rainNear:    a.rainNear    ?? 1,
    rainMid:     a.rainMid     ?? 0.7,
    rainFar:     a.rainFar     ?? 0.35,
    rainSplash:  !!a.rainSplash,
    lightningEvery: every,
    lightningVary:  a.lightningVary  ?? 0.5,
    splashSize:      a.splashSize      ?? 1,
    splashCount:     a.splashCount     ?? 1,
    splashIntensity: a.splashIntensity ?? 1,
    fogLayers:   a.fogLayers ?? {},
  };
}

// ── Дефолтні фази ────────────────────────────────────────────────────────────

export const DEFAULT_SKY_PHASE:     SkyPhase     = { durationSec: 30, skyHex: '#3a3148', groundHex: '#4a3f2e' };
export const DEFAULT_TOD_PHASE:     TodPhase     = { durationSec: 30, ambientHex: '#000000', ambientAlpha: 0, layers: {} };
export const DEFAULT_WEATHER_PHASE: WeatherPhase = { durationSec: 30, rain: false, snow: false, fog: false, rainColor: '#aaddff', rainDir: 15, rainSpeed: 600, rainDropLen: 16, rainDrops: 100, rainNear: 1, rainMid: 0.7, rainFar: 0.35, fogLayers: {} };
