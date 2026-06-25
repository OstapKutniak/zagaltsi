export type WeatherType = 'clear' | 'rain' | 'snow' | 'fog';

// ── Три незалежні секції атмосфери ──────────────────────────────────────────

export interface SkyPhase     { durationSec: number; skyHex: string; groundHex: string }
export interface TodPhase     { durationSec: number; ambientHex: string; ambientAlpha: number }
export interface WeatherPhase { durationSec: number; type: WeatherType; intensity: number; fogAlpha: number }

export interface AtmSky     { enabled: boolean; phases: SkyPhase[] }
export interface AtmTod     { enabled: boolean; phases: TodPhase[] }
export interface AtmWeather { enabled: boolean; phases: WeatherPhase[] }

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

// ── Eval ─────────────────────────────────────────────────────────────────────

export interface SkyState     { skyColor: number; groundColor: number }
export interface TodState     { ambientColor: number; ambientAlpha: number }
export interface WeatherState { type: WeatherType; intensity: number; fogAlpha: number }

export function evalSky(sky: AtmSky, wallSec: number): SkyState {
  const { pA, pB, f } = findPhase(sky.phases, wallSec);
  return {
    skyColor:    lerpHex((pA as SkyPhase).skyHex    ?? '#3a3148', (pB as SkyPhase).skyHex    ?? '#3a3148', f),
    groundColor: lerpHex((pA as SkyPhase).groundHex ?? '#4a3f2e', (pB as SkyPhase).groundHex ?? '#4a3f2e', f),
  };
}

export function evalTod(tod: AtmTod, wallSec: number): TodState {
  const { pA, pB, f } = findPhase(tod.phases, wallSec);
  const a = pA as TodPhase, b = pB as TodPhase;
  return {
    ambientColor: lerpHex(a.ambientHex ?? '#000000', b.ambientHex ?? '#000000', f),
    ambientAlpha: (a.ambientAlpha ?? 0) + ((b.ambientAlpha ?? 0) - (a.ambientAlpha ?? 0)) * f,
  };
}

export function evalWeather(wx: AtmWeather, wallSec: number): WeatherState {
  const { pA, pB, f } = findPhase(wx.phases, wallSec);
  const a = pA as WeatherPhase, b = pB as WeatherPhase;
  return {
    type:      f < 0.5 ? (a.type ?? 'clear') : (b.type ?? 'clear'),
    intensity: (a.intensity ?? 0) + ((b.intensity ?? 0) - (a.intensity ?? 0)) * f,
    fogAlpha:  (a.fogAlpha  ?? 0) + ((b.fogAlpha  ?? 0) - (a.fogAlpha  ?? 0)) * f,
  };
}

// ── Дефолтні фази ────────────────────────────────────────────────────────────

export const DEFAULT_SKY_PHASE:     SkyPhase     = { durationSec: 30, skyHex: '#3a3148', groundHex: '#4a3f2e' };
export const DEFAULT_TOD_PHASE:     TodPhase     = { durationSec: 30, ambientHex: '#000000', ambientAlpha: 0 };
export const DEFAULT_WEATHER_PHASE: WeatherPhase = { durationSec: 30, type: 'clear', intensity: 0, fogAlpha: 0 };
