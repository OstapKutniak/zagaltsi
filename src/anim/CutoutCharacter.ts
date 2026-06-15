import Phaser from 'phaser';

// Малює зібраного в ріг-тулзі персонажа (character.json) як контейнер спрайтів-слотів
// і програє ті самі процедурні анімації (та сама скелетна математика, що в тулзі).
// Примітка: розріз/згин (cut/bend) у грі поки не рендеримо — цілі кінцівки (v1).

const rad = (d: number): number => (d * Math.PI) / 180;
const TARGET_PX = 410; // цільова висота персонажа (при overall=1) у пікселях гри

// шари ззаду наперед; передня нога ПІД торсом
const SLOT_DEFS = [
  { key: 'arm_back' }, { key: 'leg_back' }, { key: 'leg_front' },
  { key: 'torso' }, { key: 'neck' }, { key: 'head' }, { key: 'arm_front' },
] as const;
const BASE = { torso: 105, head: 86, arms: 116, legs: 140, neck: 26 };

interface Slot { image: string | null; pivotX: number; pivotY: number; rot: number; scale: number; dx: number; dy: number; flip: number }
export interface CharDoc { proportions: { overall: number; head: number; torso: number; arms: number; legs: number }; slots: Record<string, Slot>; images: Record<string, string>; facing?: number }

// Ієрархія (як у тулзі): торс — корінь; шия/руки/ноги — діти торса; голова — дитя шиї.
const PARENT: Record<string, string | null> = {
  torso: null, neck: 'torso', head: 'neck', arm_back: 'torso', arm_front: 'torso', leg_back: 'torso', leg_front: 'torso',
};
function conn(sel: string, p: CharDoc['proportions']): { x: number; y: number } {
  const t = BASE.torso * p.torso;
  switch (sel) {
    case 'neck': return { x: 0, y: -t };
    case 'head': return { x: 0, y: 0 };
    case 'arm_back': return { x: -7, y: -t + 12 };
    case 'arm_front': return { x: 7, y: -t + 12 };
    case 'leg_back': return { x: -9, y: -4 };
    case 'leg_front': return { x: 9, y: -4 };
    default: return { x: 0, y: 0 };
  }
}
function animRoot(name: string, t: number): { ddx: number; ddy: number } {
  if (name === 'walk') return { ddx: 0, ddy: -Math.abs(Math.sin(t * 5.5)) * 3 };
  if (name === 'run') return { ddx: 0, ddy: -Math.abs(Math.sin(t * 9)) * 5 };
  if (name === 'jump') {
    const ph = (t % 1.6) / 1.6; let ddy: number;
    if (ph < 0.16) ddy = (ph / 0.16) * 10;            // присідання
    else if (ph < 0.35) ddy = 10 - ((ph - 0.16) / 0.19) * 48; // ривок угору
    else if (ph < 0.6) ddy = -38;                     // зависання
    else if (ph < 0.85) ddy = -38 + ((ph - 0.6) / 0.25) * 48; // падіння
    else ddy = 10 - ((ph - 0.85) / 0.15) * 10;        // присів і встав
    return { ddx: 0, ddy };
  }
  if (name === 'attack') { const ap = (t % 0.7) / 0.7; return { ddx: 0, ddy: ap < 0.45 ? (ap / 0.45) * 6 : 6 * (1 - (ap - 0.45) / 0.55) }; }
  if (name === 'hurt') { const r = Math.sin(Math.min(1, (t % 0.6) / 0.6) * Math.PI); return { ddx: -r * 12, ddy: -r * 3 }; }
  if (name === 'idle') return { ddx: 0, ddy: Math.sin(t * 1.8) * 1.2 };
  return { ddx: 0, ddy: 0 };
}
function animOff(name: string, t: number, key: string): { drot: number; ddx: number; ddy: number } {
  const z = { drot: 0, ddx: 0, ddy: 0 };
  if (name === 'idle') {
    if (key === 'head') return { drot: Math.sin(t * 1.8) * 2, ddx: 0, ddy: 0 };
    if (key.startsWith('arm')) return { drot: Math.sin(t * 1.8) * 3, ddx: 0, ddy: 0 };
    return z;
  }
  if (name === 'walk' || name === 'run') {
    const spd = name === 'run' ? 9 : 5.5, amp = name === 'run' ? 34 : 24, aArm = name === 'run' ? 32 : 20;
    const ph = t * spd, back = Math.sin(ph), front = Math.sin(ph + Math.PI);
    if (key === 'leg_front') return { drot: front * amp, ddx: 0, ddy: 0 };
    if (key === 'leg_back') return { drot: back * amp, ddx: 0, ddy: 0 };
    if (key === 'arm_front') return { drot: back * aArm, ddx: 0, ddy: 0 };
    if (key === 'arm_back') return { drot: front * aArm, ddx: 0, ddy: 0 };
    if (key === 'torso') return { drot: Math.sin(ph) * 2, ddx: 0, ddy: 0 };
    return z;
  }
  if (name === 'jump') {
    const ph = (t % 1.6) / 1.6;
    const air = ph >= 0.16 && ph < 0.85 ? Math.sin(((ph - 0.16) / 0.69) * Math.PI) : 0;
    if (key.startsWith('leg')) return { drot: -air * 26 + (key.includes('front') ? 6 : -6), ddx: 0, ddy: 0 };
    if (key.startsWith('arm')) return { drot: -air * 28, ddx: 0, ddy: 0 };
    return z;
  }
  if (name === 'attack') {
    const ap = (t % 0.7) / 0.7;
    let af: number;
    if (ap < 0.45) af = (ap / 0.45) * 30; else if (ap < 0.6) af = 30 - ((ap - 0.45) / 0.15) * 70; else af = -40 + ((ap - 0.6) / 0.4) * 40;
    if (key === 'arm_front') return { drot: af, ddx: 0, ddy: 0 };
    if (key === 'torso') return { drot: ap < 0.45 ? (ap / 0.45) * 4 : -4 + ((ap - 0.45) / 0.55) * 4, ddx: 0, ddy: 0 };
    return z;
  }
  if (name === 'hurt') {
    const r = Math.sin(Math.min(1, (t % 0.6) / 0.6) * Math.PI);
    if (key === 'torso') return { drot: r * 6, ddx: 0, ddy: 0 };
    if (key === 'head') return { drot: r * 7, ddx: 0, ddy: 0 };
    if (key.startsWith('arm')) return { drot: -r * 8, ddx: 0, ddy: 0 };
    return z;
  }
  return z;
}

function loadTextures(scene: Phaser.Scene, images: Record<string, string>): Promise<unknown> {
  return Promise.all(Object.entries(images).map(([name, data]) => new Promise<void>((res) => {
    const key = 'char_' + name;
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
  private anim = 'idle';
  private t = 0;
  private docFacing = 1; // базовий напрямок арту (1 праворуч, -1 ліворуч)

  private constructor(scene: Phaser.Scene, doc: CharDoc) {
    super(scene, 0, 0);
    this.prop = doc.proportions;
    this.slots = doc.slots;
    this.docFacing = doc.facing ?? 1;
  }

  // масштаб одиниці->піксель так, щоб висота персонажа = TARGET_PX (overall — множник)
  private unitScale(): number {
    const p = this.prop;
    const hBase = BASE.torso * p.torso + BASE.head * p.head + BASE.legs * p.legs;
    return (TARGET_PX / hBase) * p.overall;
  }

  static async load(scene: Phaser.Scene, doc: CharDoc): Promise<CutoutCharacter> {
    await loadTextures(scene, doc.images);
    const c = new CutoutCharacter(scene, doc);
    for (const d of SLOT_DEFS) {
      const sl = c.slots[d.key];
      if (!sl || !sl.image) continue;
      const key = 'char_' + sl.image;
      if (!scene.textures.exists(key)) continue;
      const im = scene.add.image(0, 0, key).setOrigin(sl.pivotX, sl.pivotY);
      c.add(im);
      c.parts[d.key] = im;
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

  tick(dt: number, facing: number): void {
    this.t += dt;
    const us = this.unitScale();
    const hurt = this.anim === 'hurt';
    // світовий трансформ слота в локалі контейнера (ієрархія)
    const cache: Record<string, { x: number; y: number; rot: number }> = {};
    const wof = (sel: string): { x: number; y: number; rot: number } => {
      if (cache[sel]) return cache[sel];
      const sl = this.slots[sel];
      const o = animOff(this.anim, this.t, sel);
      const lrot = (sl?.rot ?? 0) + o.drot;
      let ldx = (sl?.dx ?? 0) + o.ddx;
      let ldy = (sl?.dy ?? 0) + o.ddy;
      const p = PARENT[sel];
      let res: { x: number; y: number; rot: number };
      if (!p) {
        const ar = animRoot(this.anim, this.t); // корінь рухає все тіло
        ldx += ar.ddx; ldy += ar.ddy;
        res = { x: ldx * us, y: ldy * us, rot: rad(lrot) };
      } else {
        const pw = wof(p);
        const cn = conn(sel, this.prop);
        const lx = cn.x + ldx, ly = cn.y + ldy;
        const co = Math.cos(pw.rot), si = Math.sin(pw.rot);
        res = { x: pw.x + (lx * co - ly * si) * us, y: pw.y + (lx * si + ly * co) * us, rot: pw.rot + rad(lrot) };
      }
      cache[sel] = res; return res;
    };
    for (const d of SLOT_DEFS) {
      const im = this.parts[d.key];
      if (!im) continue;
      const sl = this.slots[d.key];
      const wt = wof(d.key);
      im.setPosition(wt.x, wt.y);
      im.setRotation(wt.rot);
      im.setScale(sl.scale * us * sl.flip, sl.scale * us);
      if (hurt) im.setTint(0xff5555); else im.clearTint();
    }
    this.scaleX = facing * this.docFacing; // напрямок руху * базовий напрямок арту
    this.scaleY = 1;
  }
}
