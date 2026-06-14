import Phaser from 'phaser';

// Малює зібраного в ріг-тулзі персонажа (character.json) як контейнер спрайтів-слотів
// і програє ті самі процедурні анімації (та сама скелетна математика, що в тулзі).
// Примітка: розріз/згин (cut/bend) у грі поки не рендеримо — цілі кінцівки (v1).

const rad = (d: number): number => (d * Math.PI) / 180;
const CHAR_SCALE = 0.3; // одиниці тулзи -> ігрові пікселі (множиться на proportions.overall)

const SLOT_DEFS = [
  { key: 'leg_back', joint: 'hipBack' },
  { key: 'arm_back', joint: 'shBack' },
  { key: 'torso', joint: 'hip' },
  { key: 'head', joint: 'neck' },
  { key: 'leg_front', joint: 'hipFront' },
  { key: 'arm_front', joint: 'shFront' },
] as const;
const BASE = { torso: 105, head: 86, arms: 116, legs: 140 };

interface Slot { image: string | null; pivotX: number; pivotY: number; rot: number; scale: number; dx: number; dy: number; flip: number }
export interface CharDoc { proportions: { overall: number; head: number; torso: number; arms: number; legs: number }; slots: Record<string, Slot>; images: Record<string, string> }

function joints(p: CharDoc['proportions']): Record<string, { x: number; y: number }> {
  const t = BASE.torso * p.torso;
  return { hip: { x: 0, y: 0 }, neck: { x: 0, y: -t }, shBack: { x: -7, y: -t + 12 }, shFront: { x: 7, y: -t + 12 }, hipBack: { x: -9, y: -4 }, hipFront: { x: 9, y: -4 } };
}
function animRoot(name: string, t: number): { ddx: number; ddy: number } {
  if (name === 'walk') return { ddx: 0, ddy: -Math.abs(Math.sin(t * 5.5)) * 3 };
  if (name === 'run') return { ddx: 0, ddy: -Math.abs(Math.sin(t * 9)) * 5 };
  if (name === 'jump') return { ddx: 0, ddy: -Math.sin(((t % 1.6) / 1.6) * Math.PI) * 32 };
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
    const up = Math.sin(((t % 1.6) / 1.6) * Math.PI);
    if (key.startsWith('leg')) return { drot: -up * 38 + (key.includes('front') ? 6 : -6), ddx: 0, ddy: 0 };
    if (key.startsWith('arm')) return { drot: -up * 34, ddx: 0, ddy: 0 };
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

  private constructor(scene: Phaser.Scene, doc: CharDoc) {
    super(scene, 0, 0);
    this.prop = doc.proportions;
    this.slots = doc.slots;
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

  setAnim(name: string): void { this.anim = name; }

  // висота від стегна до п'ят (щоб ставити персонажа на землю)
  feetOffset(): number { return BASE.legs * this.prop.legs * CHAR_SCALE * this.prop.overall; }

  tick(dt: number, facing: number): void {
    this.t += dt;
    const J = joints(this.prop);
    const us = CHAR_SCALE * this.prop.overall;
    const r = animRoot(this.anim, this.t);
    for (const d of SLOT_DEFS) {
      const im = this.parts[d.key];
      if (!im) continue;
      const sl = this.slots[d.key];
      const o = animOff(this.anim, this.t, d.key);
      const j = J[d.joint];
      im.setPosition((j.x + sl.dx + o.ddx + r.ddx) * us, (j.y + sl.dy + o.ddy + r.ddy) * us);
      im.setRotation(rad(sl.rot + o.drot));
      im.setScale(sl.scale * us * sl.flip, sl.scale * us);
    }
    this.scaleX = facing;
    this.scaleY = 1;
  }
}
