// Атмосфера для «статичних» сцен гри (Меню, Локація): погода (дощ/туман/
// блискавка) + віньєтка/кольоровий баланс через ColorGradePipeline + тінти
// плановості. Порт логіки GameScene/LocationScene у перевикористовний клас.

import Phaser from 'phaser';
import {
  type Atmosphere, type LayerTint, type WeatherState, type LayerKey, type FogLayer,
  parseHex, hexToInt, evalTod, evalWeather,
} from './atmosphere';
import { ColorGradePipeline } from '../scenes/ColorGradePipeline';
import { ensureFogTexture } from './fogTexture';
import { LOGICAL_W, LOGICAL_H } from '../config';

export interface SceneAtmosphereOpts {
  fogDepth?: Partial<Record<LayerKey, number>>;
  rainDepth?: number;
  lightningDepth?: number;
  onLightning?: () => void; // напр. triggerThunder — звук під спалах
}

const DEF_FOG_DEPTH: Record<LayerKey, number> = { sky: 1.5, clouds: 1.5, bg: 1.5, frontbg: 3, map: 3, foreground: 4 };

export class SceneAtmosphere {
  private scene: Phaser.Scene;
  private offX: number; private offY: number;
  private opts: SceneAtmosphereOpts;
  private atm: Atmosphere | null = null;
  private time = 0;
  private rainGfx: Phaser.GameObjects.Graphics | null = null;
  private fogSprites = new Map<string, Phaser.GameObjects.TileSprite>();
  private lightningRect: Phaser.GameObjects.Rectangle | null = null;
  private lightningNext = 6;
  private lightningOn = 0;
  private lightningDur = 0.35;
  private pipe: ColorGradePipeline | null = null;

  constructor(scene: Phaser.Scene, offX: number, offY: number, opts: SceneAtmosphereOpts = {}) {
    this.scene = scene; this.offX = offX; this.offY = offY; this.opts = opts;
  }

  // Тінт шару (плановість, фаза 0) для setTint() на спрайтах; null — без тінту.
  tintFor(layer: LayerKey): number | null {
    const tod = this.atm?.tod;
    if (!tod?.enabled) return null;
    const lt: LayerTint | undefined = evalTod(tod, 0).layers[layer];
    if (!lt || lt.alpha <= 0.005) return null;
    const [cr, cg, cb] = parseHex(lt.color);
    const r = Math.round(255 + (cr - 255) * lt.alpha);
    const g = Math.round(255 + (cg - 255) * lt.alpha);
    const b = Math.round(255 + (cb - 255) * lt.alpha);
    return (r << 16) | (g << 8) | b;
  }

  setAtmosphere(atm: Atmosphere | null): void {
    this.atm = atm;
    this.time = 0;
    // Старі об'єкти могли знищитись рестартом сцени — скидаємо посилання.
    if (!this.rainGfx?.active) this.rainGfx = null;
    if (!this.lightningRect?.active) this.lightningRect = null;
    for (const [k, sp] of this.fogSprites) if (!sp.active) this.fogSprites.delete(k);
    // Віньєтка + баланс кольору (лише WebGL)
    if (this.scene.game.renderer.type === Phaser.WEBGL && (atm?.vignette?.enabled || atm?.colorBalance?.enabled)) {
      this.scene.cameras.main.setPostPipeline(ColorGradePipeline);
      const cgp = this.scene.cameras.main.getPostPipeline(ColorGradePipeline);
      this.pipe = (Array.isArray(cgp) ? cgp[0] : cgp) as ColorGradePipeline ?? null;
    } else if (this.pipe) {
      // атмосфери нема — нейтралізуємо грейд
      this.pipe.vigStr = 0; this.pipe.brightness = 1; this.pipe.contrast = 1;
      this.pipe.saturation = 1; this.pipe.hue = 0;
      this.pipe.shadowStr = 0; this.pipe.midStr = 0; this.pipe.highStr = 0;
      this.pipe = null;
    }
    this.applyGrade();
    if (atm?.weather?.enabled) {
      if (!this.rainGfx) this.rainGfx = this.scene.add.graphics().setScrollFactor(0).setDepth(this.opts.rainDepth ?? 6);
      if (!this.lightningRect) {
        this.lightningRect = this.scene.add.rectangle(
          LOGICAL_W / 2 + this.offX, LOGICAL_H / 2 + this.offY, LOGICAL_W * 3, LOGICAL_H * 3, 0xffffff, 0,
        ).setScrollFactor(0).setDepth(this.opts.lightningDepth ?? 8).setVisible(false);
      }
      this.lightningOn = 0; this.lightningNext = 4 + Math.random() * 8;
      ensureFogTexture(this.scene);
    } else {
      this.rainGfx?.clear();
      this.lightningRect?.setVisible(false);
      for (const sp of this.fogSprites.values()) sp.setVisible(false);
    }
  }

  private applyGrade(): void {
    const p = this.pipe;
    if (!p) return;
    const cb = this.atm?.colorBalance;
    if (cb?.enabled) {
      p.brightness = cb.brightness ?? 1;
      p.contrast = (cb.contrast ?? 1) + (cb.cavity ?? 0) * 0.5;
      p.saturation = cb.saturation ?? 1;
      p.hue = (cb.hue ?? 0) * Math.PI / 180;
      p.shadowCol = ColorGradePipeline.parse(cb.shadowColor ?? '#000033');
      p.midCol = ColorGradePipeline.parse(cb.midColor ?? '#003300');
      p.highCol = ColorGradePipeline.parse(cb.highlightColor ?? '#ffffee');
      p.shadowStr = Math.min(1, cb.shadowStrength ?? 0);
      p.midStr = Math.min(1, cb.midStrength ?? 0);
      p.highStr = Math.min(1, cb.highlightStrength ?? 0);
    } else {
      p.brightness = 1; p.contrast = 1; p.saturation = 1; p.hue = 0;
      p.shadowStr = 0; p.midStr = 0; p.highStr = 0;
    }
    const vig = this.atm?.vignette;
    if (vig?.enabled) {
      p.vigStr = Math.max(0, Math.min(1, vig.strength ?? 0.6));
      p.vigCol = ColorGradePipeline.parse(vig.color ?? '#000000');
      p.vigTop = Math.max(0.02, Math.min(0.98, vig.top ?? 0.5));
      p.vigHasMask = false; // без маски карти — віньєтка на весь кадр
    } else p.vigStr = 0;
  }

  tick(dt: number): void {
    const wx = this.atm?.weather;
    if (!wx?.enabled) return;
    this.time += dt;
    const ws = evalWeather(wx, this.time);
    this.drawRain(ws);
    this.updateFog(ws);
    this.updateLightning(ws, dt);
  }

  private updateFog(ws: WeatherState): void {
    const depths = { ...DEF_FOG_DEPTH, ...(this.opts.fogDepth ?? {}) };
    const active = ws.fog ? ws.fogLayers : {};
    const t = this.time;
    for (const key of Object.keys(depths) as LayerKey[]) {
      const fl = active[key] as FogLayer | undefined;
      let sp = this.fogSprites.get(key);
      if (!fl || fl.alpha <= 0.004) { if (sp) sp.setVisible(false); continue; }
      if (!sp || !sp.active) {
        sp = this.scene.add.tileSprite(LOGICAL_W / 2 + this.offX, LOGICAL_H / 2 + this.offY, LOGICAL_W + 6, LOGICAL_H + 6, 'fog_noise')
          .setOrigin(0.5).setScrollFactor(0).setDepth(depths[key]);
        this.fogSprites.set(key, sp);
      }
      sp.setVisible(true);
      sp.setDepth(depths[key]);
      sp.setTint(hexToInt(fl.color ?? '#c2ccd6'));
      sp.setAlpha(Math.max(0, Math.min(1, fl.alpha)));
      const scale = Math.max(0.3, fl.scale ?? 1);
      sp.setTileScale(scale, scale);
      const rad = (fl.dir ?? 0) * Math.PI / 180;
      const off = (fl.seed ?? 0) * 37.13;
      sp.tilePositionX = off + Math.cos(rad) * (fl.speed ?? 12) * t / scale;
      sp.tilePositionY = off * 0.7 + Math.sin(rad) * (fl.speed ?? 12) * t / scale;
    }
  }

  private rainPalette(hex: string): number[] {
    const h = hex.replace('#', '').padStart(6, '0');
    const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    const cl = (v: number): number => Math.max(0, Math.min(255, Math.round(v)));
    const mk = (mr: number, mg: number, mb: number): number => (cl(r * mr) << 16) | (cl(g * mg) << 8) | cl(b * mb);
    return [mk(0.72, 0.78, 0.92), mk(0.9, 0.95, 1), mk(1, 1, 1), mk(1.12, 1.12, 1.18)];
  }

  private drawRain(ws: WeatherState): void {
    const gfx = this.rainGfx;
    if (!gfx?.active) return;
    gfx.clear();
    if (!ws.rain) return;
    const X0 = this.offX, Y0 = this.offY, W = LOGICAL_W, H = LOGICAL_H;
    const t = this.time;
    const angle = Math.tan((ws.rainDir ?? 15) * Math.PI / 180);
    const spd = ws.rainSpeed ?? 600;
    const baseLen = ws.rainDropLen ?? 16;
    const palette = this.rainPalette(ws.rainColor ?? '#aaddff');
    const hash = (n: number): number => { const s = Math.sin(n * 127.1) * 43758.5453; return s - Math.floor(s); };
    const dropMul = Math.max(0.1, (ws.rainDrops ?? 100) / 100);
    const layers = [
      { sm: 0.7, lm: 0.5, w: 1.0, a: ws.rainFar  ?? 0.35, n: Math.round(70 * dropMul), seed: 11 },
      { sm: 1.0, lm: 1.0, w: 1.6, a: ws.rainMid  ?? 0.7,  n: Math.round(90 * dropMul), seed: 53 },
      { sm: 2.4, lm: 3.2, w: 3.0, a: ws.rainNear ?? 1.0,  n: Math.round(26 * dropMul), seed: 97 },
    ];
    for (const l of layers) {
      if (l.a < 0.01) continue;
      const speed = spd * l.sm;
      for (let i = 0; i < l.n; i++) {
        const rx   = (i + 0.5 + (hash(i + l.seed) - 0.5) * 0.5) / l.n;
        const rlen = 0.6 + hash(i + l.seed + 7) * 0.9;
        const ra   = 0.55 + hash(i + l.seed + 13) * 0.45;
        const rph  = hash(i + l.seed + 23);
        const len   = baseLen * l.lm * rlen;
        const drift = Math.abs(angle) * (H + len);
        const OW    = W + drift + 80;
        const OH    = H + len + 60;
        const baseX = X0 - 40 - (angle > 0 ? drift : 0) + rx * OW;
        const phase = ((rph * OH) + t * speed) % OH;
        const sy    = Y0 - 40 + phase;
        const sx    = baseX + phase * angle;
        gfx.lineStyle(l.w, palette[(i + l.seed) % palette.length], Math.min(1, l.a * ra));
        gfx.beginPath();
        gfx.moveTo(sx, sy);
        gfx.lineTo(sx + len * angle, sy + len);
        gfx.strokePath();
      }
    }
  }

  private updateLightning(ws: WeatherState, dt: number): void {
    const rect = this.lightningRect;
    if (!rect?.active) return;
    if (!ws.lightning) { if (this.lightningOn > 0) { this.lightningOn = 0; rect.setVisible(false); } return; }
    if (this.lightningOn > 0) {
      this.lightningOn -= dt;
      const k = Math.max(0, this.lightningOn / this.lightningDur);
      const a = Math.max(0, Math.sin(k * Math.PI) * 0.85 + (k > 0.5 ? 0.1 : 0));
      if (this.lightningOn <= 0) rect.setVisible(false);
      else rect.setFillStyle(0xffffff, Math.min(0.9, a)).setVisible(true);
    } else {
      this.lightningNext -= dt;
      if (this.lightningNext <= 0) {
        const every = Math.max(0.5, ws.lightningEvery ?? 10);
        const vary = Math.max(0, Math.min(1, ws.lightningVary ?? 0.5));
        this.lightningDur = 0.35 * (1 - vary * 0.6 + Math.random() * vary * 1.2);
        this.lightningOn = this.lightningDur;
        this.lightningNext = every * (1 - vary + Math.random() * vary * 2);
        this.opts.onLightning?.(); // звук грому синхронно зі спалахом
      }
    }
  }
}
