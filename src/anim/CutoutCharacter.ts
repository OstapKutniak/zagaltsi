import Phaser from 'phaser';

// Малює зібраного в ріг-тулзі персонажа (character.json) як контейнер спрайтів-слотів
// і програє ті самі процедурні анімації (та сама скелетна математика, що в тулзі).
// Примітка: розріз/згин (cut/bend) у грі поки не рендеримо — цілі кінцівки (v1).

const rad = (d: number): number => (d * Math.PI) / 180;
const TARGET_PX = 410; // цільова висота персонажа (при overall=1) у пікселях гри

// шари ззаду наперед; передня нога ПІД торсом
const SLOT_DEFS = [
  { key: 'leg_back', joint: 'hipBack' },
  { key: 'arm_back', joint: 'shBack' },
  { key: 'leg_front', joint: 'hipFront' },
  { key: 'torso', joint: 'hip' },
  { key: 'head', joint: 'neck' },
  { key: 'arm_front', joint: 'shFront' },
] as const;
const BASE = { torso: 105, head: 86, arms: 116, legs: 140 };

interface Slot { image: string | null; pivotX: number; pivotY: number; rot: number; scale: number; dx: number; dy: number; flip: number }
export interface CharDoc { proportions: { overall: number; head: number; torso: number; arms: number; legs: number }; slots: Record<string, Slot>; images: Record<string, string>; facing?: number }

function joints(p: CharDoc['proportions']): Record<string, { x: number; y: number }> {
  const t = BASE.torso * p.torso;
  return { hip: { x: 0, y: 0 }, neck: { x: 0, y: -t }, shBack: { x: -7, y: -t + 12 }, shFront: { x: 7, y: -t + 12 }, hipBack: { x: -9, y: -4 }, hipFront: { x: 9, y: -4 } };
}
function animRoot(name: string, t: number): { ddx: number; ddy: number } {
  if (name === 'walk') return { ddx: 0, ddy: -Math.abs(Math.sin(t * 5.5)) * 3 };
  if (name === 'run') return { ddx: 0, ddy: -Math.abs(Math.sin(t * 9)) * 5 };
  if (name === 'jump') { const ph = (t % 1.6) / 1.6; const ddy = ph < 0.16 ? (ph / 0.16) * 10 : 10 - Math.sin(((ph - 0.16) / 0.84) * Math.PI) * 48; return { ddx: 0, ddy }; }
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
    const ph = (t % 1.6) / 1.6; const air = ph < 0.16 ? 0 : Math.sin(((ph - 0.16) / 0.84) * Math.PI);
    if (key.startsWith('leg')) return { drot: -air * 26 + (key.includes('front') ? 6 : -6), ddx: 0, ddy: 0 };
    if (key.startsWith('arm')) return { drot: -air * 28, ddx: 0, ddy: 0 };
    return z;
  }
  if (name === 'attack') {
    const ap = (t % 0.7) / 0.7;
    let af: number;
    if (ap < 0.45) af = (ap / 0.45) * 40; else if (ap < 0.6) af = 40 - ((ap - 0.45) / 0.15) * 95; else af = -55 + ((ap - 0.6) / 0.4) * 55;
    if (key === 'arm_front') return { drot: af, ddx: 0, ddy: 0 };
    if (key === 'arm_back') return { drot: -af * 0.3, ddx: 0, ddy: 0 };
    if (key === 'torso') return { drot: ap < 0.45 ? (ap / 0.45) * 6 : -6 + ((ap - 0.45) / 0.55) * 6, ddx: 0, ddy: 0 };
    return z;
  }
  if (name === 'hurt') {
    const r = Math.sin(Math.min(1, (t % 0.6) / 0.6) * Math.PI);
    if (key === 'torso') return { drot: r * 12, ddx: 0, ddy: 0 };
    if (key === 'head') return { drot: r * 8, ddx: 0, ddy: 0 };
    if (key.startsWith('arm')) return { drot: -r * 20, ddx: 0, ddy: 0 };
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
    const J = joints(this.prop);
    const us = this.unitScale();
    const r = animRoot(this.anim, this.t);
    const hurt = this.anim === 'hurt';
    for (const d of SLOT_DEFS) {
      const im = this.parts[d.key];
      if (!im) continue;
      const sl = this.slots[d.key];
      const o = animOff(this.anim, this.t, d.key);
      const j = J[d.joint];
      im.setPosition((j.x + sl.dx + o.ddx + r.ddx) * us, (j.y + sl.dy + o.ddy + r.ddy) * us);
      im.setRotation(rad(sl.rot + o.drot));
      im.setScale(sl.scale * us * sl.flip, sl.scale * us);
      if (hurt) im.setTint(0xff5555); else im.clearTint();
    }
    this.scaleX = facing * this.docFacing; // напрямок руху * базовий напрямок арту
    this.scaleY = 1;
  }
}
