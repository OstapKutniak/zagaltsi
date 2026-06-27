export type WeatherType = 'clear' | 'rain' | 'snow' | 'fog';

// ── Три незалежні секції атмосфери ──────────────────────────────────────────

export interface SkyPhase     { durationSec: number; skyHex: string; groundHex: string }
export interface TodPhase     { durationSec: number; ambientHex: string; ambientAlpha: number }
export interface WeatherPhase {
  durationSec: number;
  type: WeatherType;
  fogAlpha: number;
  // rain-specific
  rainColor?:   string;   // hex, default '#aaddff'
  rainDir?:     number;   // degrees tilt right, default 15
  rainSpeed?:   number;   // px/sec mid-layer, default 600
  rainDropLen?: number;   // px at mid layer, default 16
  rainNear?:    number;   // near layer opacity 0-1, default 1
  rainMid?:     number;   // mid layer opacity 0-1, default 0.7
  rainFar?:     number;   // far layer opacity 0-1, default 0.35
  lightning?:   boolean;  // рідкі спалахи блискавки (білий блим по всьому екрану)
  rainSplash?:  boolean;  // пилюка від крапель (тільки в межах колайдерів підлоги)
}

export interface AtmSky     { enabled: boolean; static?: boolean; phases: SkyPhase[] }
export interface AtmTod     { enabled: boolean; static?: boolean; phases: TodPhase[] }
export interface AtmWeather { enabled: boolean; static?: boolean; phases: WeatherPhase[] }

export interface Atmosphere {
  sky?:     AtmSky;
  tod?:     AtmTod;
  weather?: AtmWeather;
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
export interface TodState     { ambientColor: number; ambientAlpha: number }
export interface WeatherState {
  type: WeatherType; fogAlpha: number;
  rainColor: string; rainDir: number; rainSpeed: number; rainDropLen: number;
  rainNear: number; rainMid: number; rainFar: number; lightning: boolean; rainSplash: boolean;
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
  };
}

export function evalWeather(wx: AtmWeather, wallSec: number): WeatherState {
  const { pA, pB, f } = staticOrFind(wx.phases, wallSec, wx.static);
  const a = pA as WeatherPhase, b = pB as WeatherPhase;
  return {
    type:        f < 0.5 ? (a.type ?? 'clear') : (b.type ?? 'clear'),
    fogAlpha:    (a.fogAlpha    ?? 0) + ((b.fogAlpha    ?? 0) - (a.fogAlpha    ?? 0)) * f,
    rainColor:   a.rainColor   ?? '#aaddff',
    rainDir:     a.rainDir     ?? 15,
    rainSpeed:   a.rainSpeed   ?? 600,
    rainDropLen: a.rainDropLen ?? 16,
    rainNear:    a.rainNear    ?? 1,
    rainMid:     a.rainMid     ?? 0.7,
    rainFar:     a.rainFar     ?? 0.35,
    lightning:   !!a.lightning,
    rainSplash:  !!a.rainSplash,
  };
}

// ── Дефолтні фази ────────────────────────────────────────────────────────────

export const DEFAULT_SKY_PHASE:     SkyPhase     = { durationSec: 30, skyHex: '#3a3148', groundHex: '#4a3f2e' };
export const DEFAULT_TOD_PHASE:     TodPhase     = { durationSec: 30, ambientHex: '#000000', ambientAlpha: 0 };
export const DEFAULT_WEATHER_PHASE: WeatherPhase = { durationSec: 30, type: 'clear', fogAlpha: 0, rainColor: '#aaddff', rainDir: 15, rainSpeed: 600, rainDropLen: 16, rainNear: 1, rainMid: 0.7, rainFar: 0.35 };
