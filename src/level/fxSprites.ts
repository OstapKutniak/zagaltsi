// Спільний Phaser-рендер розміщених об'єктів з анімацією/деформацією для сцен
// гри (MenuScene, LocationScene). Та сама математика, що LevelView/GameScene:
// image або deform-mesh + програвання anim/кейфреймів у update(dt).

import Phaser from 'phaser';
import { animOffset, deformImgPt, deformKfAt, type PlacedAnim, type PlacedDeform } from './LevelView';

export interface FxSpriteSpec {
  x: number; y: number;        // екранна позиція центру
  rot: number;                 // градуси
  scaleX: number; scaleY: number; // повний масштаб по осях (scaleX БЕЗ flip)
  flip: number;                // 1 | -1
  depth: number;
  animScale?: number;          // множник для dx/dy анімації руху (світові од → екранні px)
  anim?: PlacedAnim;
  deform?: PlacedDeform;
}

interface AnimEntry { go: Phaser.GameObjects.Components.Transform & { setPosition(x: number, y: number): unknown; setRotation(r: number): unknown }; bx: number; by: number; br: number; anim: PlacedAnim; k: number }
interface KfEntry { mesh: Phaser.GameObjects.Mesh; deform: PlacedDeform; W: number; H: number; N: number; scaleX: number; scaleY: number; flip: number; idx: number[] }
interface BakedEntry { mesh: Phaser.GameObjects.Mesh; anim: PlacedAnim; N: number; idx: number[] }

// Створює спрайти з ефектами і крутить їх у tick(dt). Одна на сцену/побудову.
export class FxSprites {
  private time = 0;
  private anims: AnimEntry[] = [];
  private kfs: KfEntry[] = [];
  private baked: BakedEntry[] = [];

  // Додає об'єкт: звичайний Image або Mesh (якщо є деформація). Текстура key має існувати.
  add(scene: Phaser.Scene, key: string, spec: FxSpriteSpec): Phaser.GameObjects.GameObject {
    let go: Phaser.GameObjects.Image | Phaser.GameObjects.Mesh;
    if (spec.deform) {
      const frame = scene.textures.get(key).get();
      const W = frame.realWidth, H = frame.realHeight;
      const N = spec.deform.subdiv ?? 12;
      const verts: number[] = [], uvs: number[] = [], idx: number[] = [];
      for (let row = 0; row <= N; row++) {
        for (let col = 0; col <= N; col++) {
          const t = col / N, s = row / N;
          const pos = deformImgPt(spec.deform, W, H, t, s);
          // Негуємо y: image-space (y↓) → Phaser Mesh (y↑).
          verts.push(pos.x * spec.scaleX * spec.flip, -pos.y * spec.scaleY);
          uvs.push(t, s);
        }
      }
      for (let row = 0; row < N; row++) {
        for (let col = 0; col < N; col++) {
          const i = row * (N + 1) + col;
          idx.push(i, i + 1, i + N + 1, i + 1, i + N + 2, i + N + 1);
        }
      }
      const mesh = scene.add.mesh(spec.x, spec.y, key);
      mesh.hideCCW = false;
      mesh.setOrtho(mesh.width, mesh.height); // вершини 1:1 до піксельних координат
      mesh.setRotation((spec.rot * Math.PI) / 180);
      mesh.addVertices(verts, uvs, idx, false);
      mesh.setScrollFactor(0).setDepth(spec.depth);
      if (spec.deform.keyframes && spec.deform.keyframes.length >= 2 && !spec.deform.baked) {
        this.kfs.push({ mesh, deform: spec.deform, W, H, N, scaleX: spec.scaleX, scaleY: spec.scaleY, flip: spec.flip, idx });
      }
      if (spec.deform.baked && spec.anim) {
        this.baked.push({ mesh, anim: spec.anim, N, idx });
      }
      go = mesh;
    } else {
      const im = scene.add.image(spec.x, spec.y, key).setOrigin(0.5, 0.5);
      im.setRotation((spec.rot * Math.PI) / 180);
      im.setScale(spec.scaleX * spec.flip, spec.scaleY);
      im.setScrollFactor(0).setDepth(spec.depth);
      go = im;
    }
    if (spec.anim && !spec.deform?.baked) {
      this.anims.push({ go, bx: spec.x, by: spec.y, br: (spec.rot * Math.PI) / 180, anim: spec.anim, k: spec.animScale ?? 1 });
    }
    return go;
  }

  tick(dt: number): void {
    this.time += dt;
    for (const a of this.anims) {
      const off = animOffset(a.anim, this.time);
      if (a.anim.type === 'rotate') a.go.setRotation(a.br + (off.rot * Math.PI) / 180);
      else a.go.setPosition(a.bx + off.dx * a.k, a.by + off.dy * a.k);
    }
    for (const a of this.kfs) {
      if (!a.mesh.active) continue;
      const interp = deformKfAt(a.deform, this.time);
      const verts: number[] = [], uvs: number[] = [];
      for (let row = 0; row <= a.N; row++) for (let col = 0; col <= a.N; col++) {
        const t = col / a.N, s = row / a.N;
        const pos = deformImgPt(interp, a.W, a.H, t, s);
        verts.push(pos.x * a.scaleX * a.flip, -pos.y * a.scaleY);
        uvs.push(t, s);
      }
      a.mesh.clear();
      a.mesh.addVertices(verts, uvs, a.idx, false);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (a.mesh as any).preUpdate();
    }
    for (const a of this.baked) {
      if (!a.mesh.active) continue;
      const off = animOffset(a.anim, this.time);
      const rotRad = -(off.rot * Math.PI) / 180;
      const cosA = Math.cos(rotRad), sinA = Math.sin(rotRad);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mv = (a.mesh as any).vertices as Array<{ tu: number; tv: number }>;
      if (!mv?.length) continue;
      for (let i = 0; i < mv.length; i++) {
        const origIdx = a.idx[i];
        const col = origIdx % (a.N + 1);
        const row = Math.floor(origIdx / (a.N + 1));
        const t = col / a.N, s = row / a.N;
        const ux = t - 0.5, uy = s - 0.5;
        mv[i].tu = 0.5 + ux * cosA - uy * sinA;
        mv[i].tv = 0.5 + ux * sinA + uy * cosA;
      }
    }
  }

  clear(): void { this.anims = []; this.kfs = []; this.baked = []; this.time = 0; }
}
