export type WeatherType = 'clear' | 'rain' | 'snow' | 'fog';

export interface AtmospherePhase {
  t: number;               // 0..1, позиція на циклі
  skyHex: string;          // "#rrggbb"
  groundHex: string;       // "#rrggbb"
  ambientHex: string;      // "#rrggbb" — колір накладки-тонування
  ambientAlpha: number;    // 0..1
  fogAlpha: number;        // 0..1
  weather: WeatherType;
  weatherIntensity: number;// 0..1
}

export interface Atmosphere {
  cycleSec: number;
  phases: AtmospherePhase[];
}

export interface AtmosphereState {
  skyColor: number;
  groundColor: number;
  ambientColor: number;
  ambientAlpha: number;
  fogAlpha: number;
  weather: WeatherType;
  weatherIntensity: number;
}

export function parseHex(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function lerpHex(a: string, b: string, f: number): number {
  const [ar, ag, ab] = parseHex(a);
  const [br, bg, bb] = parseHex(b);
  return (Math.round(ar + (br - ar) * f) << 16) | (Math.round(ag + (bg - ag) * f) << 8) | Math.round(ab + (bb - ab) * f);
}

export function evalAtmosphere(atm: Atmosphere, wallSec: number): AtmosphereState {
  const ph = atm.phases;
  if (!ph.length) return defaultAtmState();
  if (ph.length === 1) {
    const p = ph[0];
    return { skyColor: lerpHex(p.skyHex, p.skyHex, 0), groundColor: lerpHex(p.groundHex, p.groundHex, 0), ambientColor: lerpHex(p.ambientHex, p.ambientHex, 0), ambientAlpha: p.ambientAlpha, fogAlpha: p.fogAlpha, weather: p.weather, weatherIntensity: p.weatherIntensity };
  }
  const t = ((wallSec % atm.cycleSec) / atm.cycleSec + 1) % 1;
  // Знаходимо дві сусідні фази (з wrap-around від останньої до першої)
  let iA = ph.length - 1, iB = 0;
  for (let i = 0; i < ph.length - 1; i++) {
    if (t >= ph[i].t && t < ph[i + 1].t) { iA = i; iB = i + 1; break; }
  }
  const pA = ph[iA], pB = ph[iB];
  const span = pB.t > pA.t ? pB.t - pA.t : 1 - pA.t + pB.t;
  const local = span > 0.0001 ? ((t - pA.t + 1) % 1) / span : 0;
  const f = Math.max(0, Math.min(1, local));
  return {
    skyColor:         lerpHex(pA.skyHex,    pB.skyHex,    f),
    groundColor:      lerpHex(pA.groundHex, pB.groundHex, f),
    ambientColor:     lerpHex(pA.ambientHex, pB.ambientHex, f),
    ambientAlpha:     pA.ambientAlpha    + (pB.ambientAlpha    - pA.ambientAlpha)    * f,
    fogAlpha:         pA.fogAlpha        + (pB.fogAlpha        - pA.fogAlpha)        * f,
    weather:          f < 0.5 ? pA.weather : pB.weather,
    weatherIntensity: pA.weatherIntensity + (pB.weatherIntensity - pA.weatherIntensity) * f,
  };
}

export function defaultAtmState(): AtmosphereState {
  return { skyColor: 0x3a3148, groundColor: 0x4a3f2e, ambientColor: 0x000000, ambientAlpha: 0, fogAlpha: 0, weather: 'clear', weatherIntensity: 0 };
}

export function defaultPhase(t: number): AtmospherePhase {
  return { t, skyHex: '#3a3148', groundHex: '#4a3f2e', ambientHex: '#000000', ambientAlpha: 0, fogAlpha: 0, weather: 'clear', weatherIntensity: 0 };
}
