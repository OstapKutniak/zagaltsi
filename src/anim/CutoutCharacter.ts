import Phaser from 'phaser';
import { JUMP } from '../config';

// Малює зібраного в ріг-тулзі персонажа (character.json) як контейнер спрайтів-слотів
// і програє ті самі процедурні анімації (та сама скелетна математика, що в тулзі).
// Розріз/згин (cut/bend) рендериться: розрізана кінцівка = 2 кропнуті спрайти,
// нижній гнеться навколо суглоба (як у тулзі). Також sx/sy та gscale (масштаб по ієрархії).

const rad = (d: number): number => (d * Math.PI) / 180;
const TARGET_PX = 410; // цільова висота персонажа (при overall=1) у пікселях гри

// шари ззаду наперед; передня нога ПІД торсом
const SLOT_DEFS = [
  { key: 'arm_back' }, { key: 'leg_back' }, { key: 'leg_front' },
  { key: 'torso' }, { key: 'neck' }, { key: 'head' },
  { key: 'eye_back' }, { key: 'eye_front' }, { key: 'brow_back' }, { key: 'brow_front' }, { key: 'mouth' },
  { key: 'arm_front' },
] as const;
const BASE = { torso: 105, head: 86, arms: 116, legs: 140, neck: 26 };

interface Slot { image: string | null; pivotX: number; pivotY: number; rot: number; scale: number; dx: number; dy: number; flip: number; bend?: number; cut?: number | null; bendFlip?: boolean; sx?: number; sy?: number; gscale?: number }
interface KeyPose { rot: number; dx: number; dy: number; scale: number; flip: number; bend: number }
interface Keyframe { t: number; interp: 'linear' | 'smooth'; pose: Record<string, KeyPose> }
interface Clip { duration: number; keys: Keyframe[]; hotkey?: string }
export interface CharDoc { proportions: { overall: number; head: number; torso: number; arms: number; legs: number }; slots: Record<string, Slot>; images: Record<string, string>; facing?: number; animDir?: number; clips?: Record<string, Clip> }

// Ієрархія (як у тулзі): торс — корінь; шия/руки/ноги — діти торса; голова — дитя шиї.
const PARENT: Record<string, string | null> = {
  torso: null, neck: 'torso', head: 'neck', arm_back: 'torso', arm_front: 'torso', leg_back: 'torso', leg_front: 'torso',
  eye_back: 'head', eye_front: 'head', brow_back: 'head', brow_front: 'head', mouth: 'head',
};
function conn(sel: string, p: CharDoc['proportions']): { x: number; y: number } {
  const t = BASE.torso * p.torso;
  const h = BASE.head * p.head;
  switch (sel) {
    case 'neck': return { x: 0, y: -t };
    case 'head': return { x: 0, y: 0 };
    case 'arm_back': return { x: -7, y: -t + 12 };
    case 'arm_front': return { x: 7, y: -t + 12 };
    case 'leg_back': return { x: -9, y: -4 };
    case 'leg_front': return { x: 9, y: -4 };
    case 'eye_back': return { x: -h * 0.13, y: -h * 0.55 };
    case 'eye_front': return { x: h * 0.13, y: -h * 0.55 };
    case 'brow_back': return { x: -h * 0.13, y: -h * 0.66 };
    case 'brow_front': return { x: h * 0.13, y: -h * 0.66 };
    case 'mouth': return { x: 0, y: -h * 0.34 };
    default: return { x: 0, y: 0 };
  }
}
type AnimCtx = { speed?: number; jumpVel?: number; landingT?: number };

function animRoot(name: string, t: number, ctx: AnimCtx = {}): { ddx: number; ddy: number } {
  const wk = ctx.speed != null ? ctx.speed * (5.5 / 230) : (name === 'run' ? 9 : 5.5);
  if (name === 'walk') return { ddx: 0, ddy: -Math.abs(Math.sin(t * wk)) * 3 };
  if (name === 'run')  return { ddx: 0, ddy: -Math.abs(Math.sin(t * wk)) * 5 };
  if (name === 'jump') {
    // Приземлення: гойдаємо тіло вниз-вгору
    if (ctx.landingT != null && ctx.landingT > 0) {
      return { ddx: 0, ddy: Math.sin(ctx.landingT * Math.PI) * 16 };
    }
    if (ctx.jumpVel !== undefined) {
      const velN = Math.max(-1, Math.min(1, ctx.jumpVel / JUMP.power));
      // Летить вгору — тіло розтягується (від'ємний ddy), падає — злегка присідає
      const ddy = velN > 0 ? -velN * 28 : -velN * 7;
      return { ddx: 0, ddy };
    }
    // Fallback: таймерна анімація (якщо фізика не передана)
    const ph = (t % 1.6) / 1.6; let ddy: number;
    if (ph < 0.16) ddy = (ph / 0.16) * 10;
    else if (ph < 0.35) ddy = 10 - ((ph - 0.16) / 0.19) * 48;
    else if (ph < 0.6) ddy = -38;
    else if (ph < 0.85) ddy = -38 + ((ph - 0.6) / 0.25) * 48;
    else ddy = 10 - ((ph - 0.85) / 0.15) * 10;
    return { ddx: 0, ddy };
  }
  if (name === 'attack') {
    const ap = (t % 0.7) / 0.7;
    // замах (0-0.30): тіло назад; удар (0.30-0.42): ривок вперед; відкат (0.42-0.70)
    let ddx: number;
    if (ap < 0.30)      ddx = -(ap / 0.30) * 7;
    else if (ap < 0.42) ddx = -7 + ((ap - 0.30) / 0.12) * 18;
    else                ddx = 11 - ((ap - 0.42) / 0.58) * 11;
    const ddy = ap < 0.42 ? (ap / 0.42) * 4 : 4 * (1 - (ap - 0.42) / 0.58);
    return { ddx, ddy };
  }
  if (name === 'hurt') { const r = Math.sin(Math.min(1, (t % 0.6) / 0.6) * Math.PI); return { ddx: -r * 12, ddy: -r * 3 }; }
  if (name === 'idle') return { ddx: 0, ddy: Math.sin(t * 1.8) * 1.2 };
  return { ddx: 0, ddy: 0 };
}
function animOff(name: string, t: number, key: string, ctx: AnimCtx = {}): { drot: number; ddx: number; ddy: number } {
  const z = { drot: 0, ddx: 0, ddy: 0 };
  if (name === 'idle') {
    if (key === 'head') return { drot: Math.sin(t * 1.8) * 2, ddx: 0, ddy: 0 };
    if (key.startsWith('arm')) return { drot: Math.sin(t * 1.8) * 3, ddx: 0, ddy: 0 };
    return z;
  }
  if (name === 'walk' || name === 'run') {
    const spd = ctx.speed != null ? ctx.speed * (5.5 / 230) : (name === 'run' ? 9 : 5.5);
    const amp = name === 'run' ? 48 : 24, aArm = name === 'run' ? 46 : 20;
    const ph = t * spd, back = Math.sin(ph), front = Math.sin(ph + Math.PI);
    const lean = name === 'run' ? 12 : 0;
    if (key === 'leg_front') return { drot: front * amp, ddx: 0, ddy: 0 };
    if (key === 'leg_back')  return { drot: back * amp, ddx: 0, ddy: 0 };
    if (key === 'arm_front') return { drot: back * aArm, ddx: 0, ddy: 0 };
    if (key === 'arm_back')  return { drot: front * aArm, ddx: 0, ddy: 0 };
    if (key === 'torso') return { drot: lean + Math.sin(ph) * 2, ddx: 0, ddy: 0 };
    if (key === 'head' && name === 'run') return { drot: -lean * 0.6, ddx: 0, ddy: 0 };
    return z;
  }
  if (name === 'jump') {
    // Приземлення: ноги гнуться, руки трохи вперед для балансу
    if (ctx.landingT != null && ctx.landingT > 0) {
      const sq = Math.sin(ctx.landingT * Math.PI);
      if (key.startsWith('leg')) return { drot: sq * 22 * (key.includes('front') ? 1 : -1), ddx: 0, ddy: 0 };
      if (key.startsWith('arm')) return { drot: sq * 12, ddx: 0, ddy: 0 };
      if (key === 'torso') return { drot: sq * 5, ddx: 0, ddy: 0 };
      return z;
    }
    if (ctx.jumpVel !== undefined) {
      const velN = Math.max(-1, Math.min(1, ctx.jumpVel / JUMP.power));
      // Ноги підтягуються вгору при зльоті, розкриваються при падінні
      const legUp = velN > 0 ? velN : 0;
      const legDown = velN < 0 ? -velN : 0;
      if (key.startsWith('leg')) return { drot: -legUp * 30 + legDown * 14 + (key.includes('front') ? 5 : -5), ddx: 0, ddy: 0 };
      if (key.startsWith('arm')) return { drot: -velN * 28, ddx: 0, ddy: 0 };
      if (key === 'torso') return { drot: -velN * 4, ddx: 0, ddy: 0 };
      return z;
    }
    // Fallback: таймерна
    const ph = (t % 1.6) / 1.6;
    const air = ph >= 0.16 && ph < 0.85 ? Math.sin(((ph - 0.16) / 0.69) * Math.PI) : 0;
    if (key.startsWith('leg')) return { drot: -air * 26 + (key.includes('front') ? 6 : -6), ddx: 0, ddy: 0 };
    if (key.startsWith('arm')) return { drot: -air * 28, ddx: 0, ddy: 0 };
    return z;
  }
  if (name === 'attack') {
    const ap = (t % 0.7) / 0.7;
    // Замах (0-0.30): рука йде назад; удар (0.30-0.42): різкий ривок вперед; відкат (0.42-0.70)
    if (key === 'arm_front') {
      let af: number;
      if (ap < 0.30)      af = -(ap / 0.30) * 58;                    // 0 → -58 (замах)
      else if (ap < 0.42) af = -58 + ((ap - 0.30) / 0.12) * 108;     // -58 → +50 (різкий удар)
      else                af = 50 - ((ap - 0.42) / 0.58) * 50;        // +50 → 0 (відкат)
      return { drot: af, ddx: 0, ddy: 0 };
    }
    if (key === 'arm_back') {
      let ab: number;
      if (ap < 0.30)      ab = (ap / 0.30) * 22;                     // 0 → +22 (контр-замах)
      else if (ap < 0.42) ab = 22 - ((ap - 0.30) / 0.12) * 38;      // +22 → -16
      else                ab = -16 + ((ap - 0.42) / 0.58) * 16;
      return { drot: ab, ddx: 0, ddy: 0 };
    }
    if (key === 'torso') {
      let at: number;
      if (ap < 0.30)      at = -(ap / 0.30) * 8;
      else if (ap < 0.42) at = -8 + ((ap - 0.30) / 0.12) * 20;      // -8 → +12
      else                at = 12 - ((ap - 0.42) / 0.58) * 12;
      return { drot: at, ddx: 0, ddy: 0 };
    }
    if (key === 'head') {
      const at = ap < 0.30 ? -(ap / 0.30) * 3 : ap < 0.42 ? -3 + ((ap - 0.30) / 0.12) * 5 : 2 - ((ap - 0.42) / 0.58) * 2;
      return { drot: at, ddx: 0, ddy: 0 };
    }
    return z;
  }
  if (name === 'hurt') {
    const r = Math.sin(Math.min(1, (t % 0.6) / 0.6) * Math.PI);
    if (key === 'torso') return { drot: r * 6, ddx: 0, ddy: 0 };
    if (key === 'head')  return { drot: r * 7, ddx: 0, ddy: 0 };
    if (key.startsWith('arm')) return { drot: -r * 8, ddx: 0, ddy: 0 };
    return z;
  }
  return z;
}

// Згин у суглобі (лікоть/коліно) — як у тулзі (для розрізаних кінцівок).
function animBend(name: string, t: number, key: string, ctx: AnimCtx = {}): number {
  if (name === 'walk' || name === 'run') {
    const spd = ctx.speed != null ? ctx.speed * (5.5 / 230) : (name === 'run' ? 9 : 5.5);
    const ph = t * spd;
    const legAmp = name === 'run' ? 46 : 28, armAmp = name === 'run' ? 50 : 34;
    if (key === 'leg_front') return -Math.max(0, Math.sin(ph + Math.PI)) * legAmp;
    if (key === 'leg_back')  return -Math.max(0, Math.sin(ph)) * legAmp;
    if (key === 'arm_front') return -(0.4 + 0.6 * Math.abs(Math.sin(ph))) * armAmp;
    if (key === 'arm_back')  return -(0.4 + 0.6 * Math.abs(Math.sin(ph + Math.PI))) * armAmp;
    return 0;
  }
  if (name === 'jump') {
    if (ctx.landingT != null && ctx.landingT > 0) {
      const sq = Math.sin(ctx.landingT * Math.PI);
      if (key.startsWith('leg')) return -(sq * 38 + 8);
      if (key.startsWith('arm')) return -(sq * 18);
      return 0;
    }
    if (ctx.jumpVel !== undefined) {
      const velN = Math.max(-1, Math.min(1, ctx.jumpVel / JUMP.power));
      const tuck = Math.abs(velN);
      if (key.startsWith('leg')) return -(8 + tuck * 52);   // ноги підтягуються в повітрі
      if (key.startsWith('arm')) return -(tuck * 28);
      return 0;
    }
    // Fallback: таймерна
    const ph = (t % 1.6) / 1.6;
    const crouch = ph < 0.16 ? ph / 0.16 : ph > 0.85 ? 1 - (ph - 0.85) / 0.15 : 0;
    const air = ph >= 0.16 && ph < 0.85 ? Math.sin(((ph - 0.16) / 0.69) * Math.PI) : 0;
    if (key.startsWith('leg')) return -(crouch * 28 + air * 50);
    if (key.startsWith('arm')) return -air * 30;
    return 0;
  }
  if (name === 'attack') {
    const ap = (t % 0.7) / 0.7;
    if (key === 'arm_front') {
      // Замах: лікоть сильно зігнутий (кулак біля вуха); удар: рука розгинається; відкат
      if (ap < 0.30)      return -(ap / 0.30) * 75;           // 0 → -75 (кулак назад)
      else if (ap < 0.42) return -75 + ((ap - 0.30) / 0.12) * 72; // -75 → -3 (розгинається)
      else                return -3 - ((ap - 0.42) / 0.58) * 22;   // -3 → -25 (відкат)
    }
    if (key.startsWith('leg')) return -(ap < 0.42 ? (ap / 0.42) * 14 : 14 * (1 - (ap - 0.42) / 0.58));
    return 0;
  }
  if (name === 'hurt') { const r = Math.sin(Math.min(1, (t % 0.6) / 0.6) * Math.PI); if (key.startsWith('arm')) return -r * 25; return 0; }
  if (name === 'idle') { if (key.startsWith('arm')) return -(0.3 + 0.3 * Math.sin(t * 1.8)) * 10; return 0; }
  return 0;
}

function loadTextures(scene: Phaser.Scene, images: Record<string, string>, prefix: string): Promise<unknown> {
  return Promise.all(Object.entries(images).map(([name, data]) => new Promise<void>((res) => {
    const key = prefix + name;
    if (scene.textures.exists(key)) { res(); return; }
    const img = new Image();
    img.onload = () => { if (!scene.textures.exists(key)) scene.textures.addImage(key, img); res(); };
    img.onerror = () => res();
    img.src = data;
  })));
}

export class CutoutCharacter extends Phaser.GameObjects.Container {
  private prop: CharDoc['proportions'];
  private slots: Record<string, Slot>;
  private parts: Record<string, Phaser.GameObjects.Image> = {};
  private lower: Record<string, Phaser.GameObjects.Image> = {}; // нижня частина розрізаної кінцівки (за суглобом)
  private anim = 'idle';
  private t = 0;
  private docFacing = 1; // базовий напрямок арту (1 праворуч, -1 ліворуч)
  private animDir = 1; // напрям кроку кісток (з тулзи «Хода в бік»); не чіпає арт
  private clips: Record<string, Clip> = {};

  private constructor(scene: Phaser.Scene, doc: CharDoc) {
    super(scene, 0, 0);
    this.prop = doc.proportions;
    this.slots = doc.slots;
    this.docFacing = doc.facing ?? 1;
    this.animDir = doc.animDir ?? 1;
    this.clips = doc.clips ?? {};
  }

  // вибірка авторського кліпу в момент t для слота (локальний трансформ)
  private sampleClip(clip: Clip, t: number, sel: string): KeyPose {
    const su = this.slots[sel];
    const base: KeyPose = su ? { rot: su.rot, dx: su.dx, dy: su.dy, scale: su.scale, flip: su.flip, bend: su.bend ?? 0 } : { rot: 0, dx: 0, dy: 0, scale: 1, flip: 1, bend: 0 };
    const ks = clip.keys;
    if (!ks.length) return base;
    if (t <= ks[0].t) return ks[0].pose[sel] ?? base;
    const last = ks[ks.length - 1];
    if (t >= last.t) return last.pose[sel] ?? base;
    for (let i = 0; i < ks.length - 1; i++) {
      const a = ks[i], b = ks[i + 1];
      if (t >= a.t && t <= b.t) {
        let f = (t - a.t) / ((b.t - a.t) || 1);
        if (a.interp === 'smooth') f = f * f * (3 - 2 * f);
        const pa = a.pose[sel] ?? base, pb = b.pose[sel] ?? base;
        const L = (x: number, y: number): number => x + (y - x) * f;
        return { rot: L(pa.rot, pb.rot), dx: L(pa.dx, pb.dx), dy: L(pa.dy, pb.dy), scale: L(pa.scale, pb.scale), flip: pa.flip, bend: L(pa.bend, pb.bend) };
      }
    }
    return base;
  }

  // масштаб одиниці->піксель так, щоб висота персонажа = TARGET_PX (overall — множник)
  private unitScale(): number {
    const p = this.prop;
    const hBase = BASE.torso * p.torso + BASE.head * p.head + BASE.legs * p.legs;
    return (TARGET_PX / hBase) * p.overall;
  }

  // keyPrefix дозволяє кільком різним персонажам жити поруч (кооп) без колізій
  // текстур, навіть якщо в них однакові назви файлів.
  static async load(scene: Phaser.Scene, doc: CharDoc, keyPrefix = 'char_'): Promise<CutoutCharacter> {
    await loadTextures(scene, doc.images, keyPrefix);
    const c = new CutoutCharacter(scene, doc);
    for (const d of SLOT_DEFS) {
      const sl = c.slots[d.key];
      if (!sl || !sl.image) continue;
      const key = keyPrefix + sl.image;
      if (!scene.textures.exists(key)) continue;
      const im = scene.add.image(0, 0, key).setOrigin(sl.pivotX, sl.pivotY);
      c.add(im);
      c.parts[d.key] = im;
      if (sl.cut != null) { // розрізана кінцівка — окрема нижня частина (гнеться в суглобі)
        const lo = scene.add.image(0, 0, key).setOrigin(0.5, sl.cut);
        c.add(lo);
        c.lower[d.key] = lo;
      }
    }
    return c;
  }

  setAnim(name: string): void { if (name !== this.anim) { this.anim = name; this.t = 0; } }

  // відстань від кореня (стегна) до найнижчої точки ніг — щоб ступні стали на землю
  feetOffset(): number {
    let feet = 0;
    for (const key of ['leg_front', 'leg_back']) {
      const im = this.parts[key];
      if (im) { const b = im.y + im.displayHeight * (1 - im.originY); if (b > feet) feet = b; }
    }
    if (feet <= 0) feet = BASE.legs * this.prop.legs * this.unitScale();
    return feet;
  }

  tick(dt: number, facing: number, ctx?: AnimCtx): void {
    this.t += dt;
    const us = this.unitScale();
    const hurt = this.anim === 'hurt';
    const clip = this.clips[this.anim];
    const authored = !!(clip && clip.keys.length); // є авторська анімація -> грати її
    const ct = authored ? this.t % clip!.duration : 0;
    // локальний трансформ слота (авторський семпл АБО процедурний) + згин
    const localOf = (sel: string): { rot: number; dx: number; dy: number; scale: number; bend: number } => {
      const sl = this.slots[sel];
      if (authored) { const sp = this.sampleClip(clip!, ct, sel); return { rot: sp.rot, dx: sp.dx, dy: sp.dy, scale: sp.scale, bend: sp.bend }; }
      const o = animOff(this.anim, this.t, sel, ctx);
      let dx = (sl?.dx ?? 0) + o.ddx, dy = (sl?.dy ?? 0) + o.ddy;
      if (!PARENT[sel]) { const ar = animRoot(this.anim, this.t, ctx); dx += ar.ddx; dy += ar.ddy; }
      return { rot: (sl?.rot ?? 0) + o.drot * this.animDir, dx, dy, scale: sl?.scale ?? 1, bend: sl?.bend ?? 0 };
    };
    // світовий трансформ слота в локалі контейнера (ієрархія); gs — накопичений масштаб (gscale батька -> дітям)
    const cache: Record<string, { x: number; y: number; rot: number; gs: number }> = {};
    const wof = (sel: string): { x: number; y: number; rot: number; gs: number } => {
      if (cache[sel]) return cache[sel];
      const lp = localOf(sel); const ownG = this.slots[sel]?.gscale ?? 1;
      const p = PARENT[sel];
      let res: { x: number; y: number; rot: number; gs: number };
      if (!p) {
        res = { x: lp.dx * us, y: lp.dy * us, rot: rad(lp.rot), gs: ownG };
      } else {
        const pw = wof(p);
        const cn = conn(sel, this.prop);
        const lx = cn.x + lp.dx, ly = cn.y + lp.dy;
        const co = Math.cos(pw.rot), si = Math.sin(pw.rot);
        res = { x: pw.x + (lx * co - ly * si) * pw.gs * us, y: pw.y + (lx * si + ly * co) * pw.gs * us, rot: pw.rot + rad(lp.rot), gs: pw.gs * ownG };
      }
      cache[sel] = res; return res;
    };
    for (const d of SLOT_DEFS) {
      const im = this.parts[d.key];
      if (!im) continue;
      const sl = this.slots[d.key];
      const wt = wof(d.key);
      const lp = localOf(d.key);
      const flip = sl.flip ?? 1;
      const scX = lp.scale * us * (sl.sx ?? 1) * wt.gs;
      const scY = lp.scale * us * (sl.sy ?? 1) * wt.gs;
      const lo = this.lower[d.key];
      if (sl.cut != null && lo) {
        const W = im.width, H = im.height, cutPx = sl.cut * H;
        // верхня частина — від півота до лінії розрізу
        im.setOrigin(sl.pivotX, sl.pivotY); im.setPosition(wt.x, wt.y); im.setRotation(wt.rot); im.setScale(flip * scX, scY);
        im.setCrop(0, 0, W, cutPx);
        // згин (манульний + процедурний), знак як у тулзі
        const procBend = authored ? 0 : animBend(this.anim, this.t, d.key, ctx) * this.animDir;
        // знак: НЕ множимо на flip (Phaser обертає поверх дзеркала-масштабу, на відміну
        // від тулзи, що крутить усередині дзеркального ctx) — інакше дзеркальні кінцівки гнуться навпаки
        const bendVal = (lp.bend + procBend) * (sl.bendFlip ? -1 : 1);
        // світова точка суглоба (зсув від півота до (0.5, cut), масштаб, поворот)
        const jfx = (0.5 - sl.pivotX) * W * flip * scX, jfy = (sl.cut - sl.pivotY) * H * scY;
        const co = Math.cos(wt.rot), si = Math.sin(wt.rot);
        const jx = wt.x + jfx * co - jfy * si, jy = wt.y + jfx * si + jfy * co;
        lo.setOrigin(0.5, sl.cut); lo.setPosition(jx, jy); lo.setRotation(wt.rot + rad(bendVal)); lo.setScale(flip * scX, scY);
        lo.setCrop(0, cutPx, W, H - cutPx);
        if (hurt) { im.setTint(0xff5555); lo.setTint(0xff5555); } else { im.clearTint(); lo.clearTint(); }
      } else {
        im.setOrigin(sl.pivotX, sl.pivotY); im.setPosition(wt.x, wt.y); im.setRotation(wt.rot); im.setScale(flip * scX, scY);
        if (hurt) im.setTint(0xff5555); else im.clearTint();
      }
    }
    this.scaleX = facing * this.docFacing; // напрямок руху * базовий напрямок арту
    this.scaleY = 1;
  }
}
