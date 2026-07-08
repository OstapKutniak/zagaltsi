// Канвас-рендерер ПОЗИ персонажа (без Phaser) — для вьюпортів студії.
// Дзеркалить трансформ-пайплайн CutoutCharacter.tick(): та сама ієрархія (wof),
// хребет, розрізи кінцівок (cut/cut2/cut3) із згинами, процедурні кліпи
// (sit/idle/walk/run) АБО авторські кліпи doc.clips. Малює один кадр у ctx.
// Координати: (x, y) = КОРІНЬ персонажа (стегна), як контейнер у грі; k —
// додатковий масштаб поверх unitScale (у грі це scale контейнера).

import {
  type CharDoc, type Slot, type Clip, type KeyPose,
  SLOT_DEFS, BASE, PARENT, TARGET_PX, conn,
  animOff, animRoot, animBend, animBend2, animBend3,
} from './CutoutCharacter';

const rad = (d: number): number => (d * Math.PI) / 180;

// Висота персонажа у px гри при k=1 (для рамок виділення/хіт-боксів).
export function charPoseHeight(doc: CharDoc): number {
  return TARGET_PX * (doc.proportions.overall || 1);
}

function unitScale(p: CharDoc['proportions']): number {
  const hBase = BASE.torso * p.torso + BASE.head * p.head + BASE.legs * p.legs;
  return (TARGET_PX / hBase) * p.overall;
}

// Вибірка авторського кліпу (як CutoutCharacter.sampleClip).
function sampleClip(clip: Clip, slots: Record<string, Slot>, t: number, sel: string): KeyPose {
  const su = clip.base?.[sel] ?? slots[sel];
  const base: KeyPose = su
    ? { rot: su.rot, dx: su.dx, dy: su.dy, scale: su.scale, flip: su.flip, bend: su.bend ?? 0, bend2: su.bend2 ?? 0, bend3: su.bend3 ?? 0 }
    : { rot: 0, dx: 0, dy: 0, scale: 1, flip: 1, bend: 0, bend2: 0, bend3: 0 };
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
      return { rot: L(pa.rot, pb.rot), dx: L(pa.dx, pb.dx), dy: L(pa.dy, pb.dy), scale: L(pa.scale, pb.scale), flip: pa.flip, bend: L(pa.bend, pb.bend), bend2: L(pa.bend2 ?? 0, pb.bend2 ?? 0), bend3: L(pa.bend3 ?? 0, pb.bend3 ?? 0) };
    }
  }
  return base;
}

export interface CharPoseOpts {
  x: number; y: number;      // корінь (стегна) у координатах ctx
  k?: number;                // додатковий масштаб (як scale контейнера у грі; 1 = як у грі)
  facing?: number;           // ±1; множиться на doc.facing (як у грі)
  alpha?: number;
}

// Намалювати один кадр пози. images — завантажені картинки частин (ключ = ім'я
// файла з doc.slots[..].image). Повертає false, якщо нема жодної частини.
export function drawCharPose(
  ctx: CanvasRenderingContext2D, doc: CharDoc, images: Record<string, HTMLImageElement>,
  anim: string, t: number, opts: CharPoseOpts,
): boolean {
  const prop = doc.proportions, slots = doc.slots;
  const us = unitScale(prop);
  const animDir = doc.animDir ?? 1;
  const clips = doc.clips ?? {};
  const clip = clips[anim];
  const authored = !!(clip && clip.keys.length);
  const ct = authored ? t % clip!.duration : 0;

  const localOf = (sel: string): { rot: number; dx: number; dy: number; scale: number; bend: number; bend2: number; bend3: number } => {
    const sl = slots[sel];
    if (authored) { const sp = sampleClip(clip!, slots, ct, sel); return { rot: sp.rot, dx: sp.dx, dy: sp.dy, scale: sp.scale, bend: sp.bend, bend2: sp.bend2 ?? 0, bend3: sp.bend3 ?? 0 }; }
    const bp = clip?.base?.[sel];
    const o = animOff(anim, t, sel);
    let dx = (bp?.dx ?? sl?.dx ?? 0) + o.ddx, dy = (bp?.dy ?? sl?.dy ?? 0) + o.ddy;
    if (!PARENT[sel]) { const ar = animRoot(anim, t); dx += ar.ddx; dy += ar.ddy; }
    return { rot: (bp?.rot ?? sl?.rot ?? 0) + o.drot * animDir, dx, dy, scale: bp?.scale ?? sl?.scale ?? 1, bend: sl?.bend ?? 0, bend2: sl?.bend2 ?? 0, bend3: sl?.bend3 ?? 0 };
  };

  // Світові трансформи (локаль контейнера персонажа) — 1:1 wof із tick().
  const cache: Record<string, { x: number; y: number; rot: number; gs: number }> = {};
  let spine: { jx: number; jy: number; bendRad: number } | null = null;
  const SPINE_CHILDREN = new Set(['neck', 'arm_front', 'arm_back']);
  const wof = (sel: string): { x: number; y: number; rot: number; gs: number } => {
    if (cache[sel]) return cache[sel];
    const lp = localOf(sel); const ownG = slots[sel]?.gscale ?? 1;
    const p = PARENT[sel];
    let res: { x: number; y: number; rot: number; gs: number };
    if (!p) {
      res = { x: lp.dx * us, y: lp.dy * us, rot: rad(lp.rot), gs: ownG };
    } else {
      const pw = wof(p);
      const cn = conn(sel, prop);
      const lx = cn.x + lp.dx, ly = cn.y + lp.dy;
      const co = Math.cos(pw.rot), si = Math.sin(pw.rot);
      res = { x: pw.x + (lx * co - ly * si) * pw.gs * us, y: pw.y + (lx * si + ly * co) * pw.gs * us, rot: pw.rot + rad(lp.rot), gs: pw.gs * ownG };
    }
    if (spine && spine.bendRad !== 0 && SPINE_CHILDREN.has(sel)) {
      const dx = res.x - spine.jx, dy = res.y - spine.jy;
      const c = Math.cos(spine.bendRad), s = Math.sin(spine.bendRad);
      res = { x: spine.jx + dx * c - dy * s, y: spine.jy + dx * s + dy * c, rot: res.rot + spine.bendRad, gs: res.gs };
    }
    cache[sel] = res; return res;
  };

  // Суглоб хребта — до рендеру дітей.
  const torsoSl = slots['torso'];
  const torsoImg = torsoSl?.image ? images[torsoSl.image] : undefined;
  if (torsoSl && torsoSl.cut != null && torsoImg?.complete && torsoImg.naturalWidth) {
    const wtT = wof('torso');
    const lpT = localOf('torso');
    const flipT = torsoSl.flip ?? 1;
    const scXT = lpT.scale * us * (torsoSl.sx ?? 1) * wtT.gs;
    const scYT = lpT.scale * us * (torsoSl.sy ?? 1) * wtT.gs;
    const procSpine = authored ? 0 : animBend(anim, t, 'torso') * animDir;
    const bendDeg = ((torsoSl.bend ?? 0) + procSpine) * (torsoSl.bendFlip ? -1 : 1);
    const W = torsoImg.naturalWidth, H = torsoImg.naturalHeight;
    const jfx = (0.5 - torsoSl.pivotX) * W * flipT * scXT, jfy = (torsoSl.cut - torsoSl.pivotY) * H * scYT;
    const coT = Math.cos(wtT.rot), siT = Math.sin(wtT.rot);
    spine = { jx: wtT.x + jfx * coT - jfy * siT, jy: wtT.y + jfx * siT + jfy * coT, bendRad: rad(bendDeg) };
  }

  // Один шматок: трансформ у локалі персонажа + кроп-рект у координатах текстури.
  const piece = (
    img: HTMLImageElement, px: number, py: number, rot: number,
    kx: number, ky: number, originX: number, originY: number,
    crop: { x: number; y: number; w: number; h: number } | null,
  ): void => {
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(rot);
    ctx.scale(kx, ky);
    const W = img.naturalWidth, H = img.naturalHeight;
    const ox = -originX * W, oy = -originY * H;
    if (crop) { ctx.beginPath(); ctx.rect(ox + crop.x - 1, oy + crop.y - 1, crop.w + 2, crop.h + 2); ctx.clip(); }
    ctx.drawImage(img, ox, oy);
    ctx.restore();
  };

  ctx.save();
  ctx.translate(opts.x, opts.y);
  const face = (opts.facing ?? 1) * (doc.facing ?? 1);
  ctx.scale((opts.k ?? 1) * face, opts.k ?? 1);
  if (opts.alpha != null) ctx.globalAlpha *= opts.alpha;

  let drew = false;
  for (const d of SLOT_DEFS) {
    const sl = slots[d.key];
    const img = sl?.image ? images[sl.image] : undefined;
    if (!sl || !img?.complete || !img.naturalWidth) continue;
    drew = true;
    const wt = wof(d.key);
    const lp = localOf(d.key);
    const flip = sl.flip ?? 1;
    const scX = lp.scale * us * (sl.sx ?? 1) * wt.gs;
    const scY = lp.scale * us * (sl.sy ?? 1) * wt.gs;
    const W = img.naturalWidth, H = img.naturalHeight;
    if (d.key === 'torso' && sl.cut != null) {
      // Хребет: таз (під розрізом) на корені; грудина гнеться навколо суглоба.
      const cutPx = sl.cut * H;
      piece(img, wt.x, wt.y, wt.rot, flip * scX, scY, sl.pivotX, sl.pivotY, { x: 0, y: cutPx, w: W, h: H - cutPx });
      const jx = spine ? spine.jx : wt.x, jy = spine ? spine.jy : wt.y, br = spine ? spine.bendRad : 0;
      piece(img, jx, jy, wt.rot + br, flip * scX, scY, sl.pivotX, sl.cut, { x: 0, y: 0, w: W, h: cutPx });
    } else if (sl.cut != null) {
      const cutPx = sl.cut * H;
      piece(img, wt.x, wt.y, wt.rot, flip * scX, scY, sl.pivotX, sl.pivotY, { x: 0, y: 0, w: W, h: cutPx });
      const procBend = authored ? 0 : animBend(anim, t, d.key) * animDir;
      const bendVal = (lp.bend + procBend) * (sl.bendFlip ? -1 : 1);
      const jfx = (0.5 - sl.pivotX) * W * flip * scX, jfy = (sl.cut - sl.pivotY) * H * scY;
      const co = Math.cos(wt.rot), si = Math.sin(wt.rot);
      const jx = wt.x + jfx * co - jfy * si, jy = wt.y + jfx * si + jfy * co;
      // Кропи сегментів — ЯК У ГРІ: кожен нижній до самого низу зображення
      // (перекриваються; наступний малюється зверху). Бувають cut2 < cut — стик-в-стик тут ламався б.
      piece(img, jx, jy, wt.rot + rad(bendVal), flip * scX, scY, 0.5, sl.cut, { x: 0, y: cutPx, w: W, h: H - cutPx });
      if (sl.cut2 != null) {
        const proc2 = authored ? 0 : animBend2(anim, t, d.key) * animDir;
        const bend2Val = ((lp.bend2 ?? 0) + proc2) * (sl.bendFlip2 ? -1 : 1);
        const r1 = wt.rot + rad(bendVal);
        const dist12 = (sl.cut2 - sl.cut) * H * scY;
        const j2x = jx - dist12 * Math.sin(r1), j2y = jy + dist12 * Math.cos(r1);
        const cut2Px = sl.cut2 * H;
        piece(img, j2x, j2y, r1 + rad(bend2Val), flip * scX, scY, 0.5, sl.cut2, { x: 0, y: cut2Px, w: W, h: H - cut2Px });
        if (sl.cut3 != null) {
          const proc3 = authored ? 0 : animBend3(anim, t, d.key) * animDir;
          const bend3Val = ((lp.bend3 ?? 0) + proc3) * (sl.bendFlip3 ? -1 : 1);
          const r2 = r1 + rad(bend2Val);
          const dist23 = (sl.cut3 - sl.cut2) * H * scY;
          const j3x = j2x - dist23 * Math.sin(r2), j3y = j2y + dist23 * Math.cos(r2);
          const cut3Px = sl.cut3 * H;
          piece(img, j3x, j3y, r2 + rad(bend3Val), flip * scX, scY, 0.5, sl.cut3, { x: 0, y: cut3Px, w: W, h: H - cut3Px });
        }
      }
    } else {
      piece(img, wt.x, wt.y, wt.rot, flip * scX, scY, sl.pivotX, sl.pivotY, null);
    }
  }
  ctx.restore();
  return drew;
}

// ── Кеш готових поз (оффскрін-канваси) — для вьюпортів редакторів ─────────────
// Ключ пози: anim. Канвас містить персонажа при k=1; origin — точка кореня.
// bounds — тісний bbox непрозорих пікселів ВІДНОСНО кореня (для рамки/хіт-тесту).
export interface PoseSnapshot {
  canvas: HTMLCanvasElement; originX: number; originY: number;
  bounds: { x0: number; y0: number; x1: number; y1: number };
}

export class CharPoseCache {
  private doc: CharDoc | null = null;
  private images: Record<string, HTMLImageElement> = {};
  private poses = new Map<string, PoseSnapshot>();
  private loading = false;
  onReady: (() => void) | null = null;

  setDoc(doc: CharDoc): void {
    this.doc = doc; this.poses.clear(); this.images = {}; this.loading = true;
    const names = Object.keys(doc.images ?? {});
    let left = names.length;
    if (!left) { this.loading = false; return; }
    for (const name of names) {
      const im = new Image();
      im.onload = im.onerror = (): void => { if (--left <= 0) { this.loading = false; this.onReady?.(); } };
      im.src = doc.images[name];
      this.images[name] = im;
    }
  }

  ready(): boolean { return !!this.doc && !this.loading; }

  // Поза з кешу (рендериться при першому запиті). t фіксований на «виразній» фазі.
  pose(anim: string): PoseSnapshot | null {
    if (!this.doc || this.loading) return null;
    const hit = this.poses.get(anim);
    if (hit) return hit;
    const H = Math.ceil(charPoseHeight(this.doc) * 1.6); // запас на руки/розмах
    const c = document.createElement('canvas');
    c.width = H; c.height = H;
    const ox = H / 2, oy = H * 0.62; // корінь (стегна) нижче центру
    const x = c.getContext('2d')!;
    const t = anim === 'walk' || anim === 'run' ? 0.18 : 0.6; // крок у виразній фазі
    if (!drawCharPose(x, this.doc, this.images, anim, t, { x: ox, y: oy, k: 1, facing: 1 })) return null;
    // Тісний bbox непрозорих пікселів (відносно кореня) — рамка виділення/хіт-тест.
    let x0 = c.width, y0 = c.height, x1 = 0, y1 = 0;
    try {
      const d = x.getImageData(0, 0, c.width, c.height).data;
      for (let py = 0; py < c.height; py += 2) {
        for (let px = 0; px < c.width; px += 2) {
          if (d[(py * c.width + px) * 4 + 3] > 10) {
            if (px < x0) x0 = px; if (px > x1) x1 = px;
            if (py < y0) y0 = py; if (py > y1) y1 = py;
          }
        }
      }
    } catch { x0 = 0; y0 = 0; x1 = c.width; y1 = c.height; }
    if (x1 < x0) { x0 = 0; y0 = 0; x1 = c.width; y1 = c.height; }
    const snap: PoseSnapshot = {
      canvas: c, originX: ox, originY: oy,
      bounds: { x0: x0 - ox, y0: y0 - oy, x1: x1 - ox, y1: y1 - oy },
    };
    this.poses.set(anim, snap);
    return snap;
  }

  // Альфа у точці пози (координати відносно кореня, k=1, без дзеркала).
  private alphaData = new Map<string, Uint8ClampedArray>();
  alphaAt(anim: string, dx: number, dy: number): number {
    const p = this.pose(anim); if (!p) return 0;
    let data = this.alphaData.get(anim);
    if (!data) {
      try { data = p.canvas.getContext('2d')!.getImageData(0, 0, p.canvas.width, p.canvas.height).data.filter((_, i) => i % 4 === 3) as Uint8ClampedArray; } catch { return 255; }
      this.alphaData.set(anim, data);
    }
    const px = Math.round(p.originX + dx), py = Math.round(p.originY + dy);
    if (px < 0 || py < 0 || px >= p.canvas.width || py >= p.canvas.height) return 0;
    return data[py * p.canvas.width + px] ?? 0;
  }
}
