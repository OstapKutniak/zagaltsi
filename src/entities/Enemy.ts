import Phaser from 'phaser';
import { Actor } from './Actor';
import { ENEMY } from '../config';
import type { Player } from './Player';
import { CutoutCharacter, type CharDoc } from '../anim/CutoutCharacter';

interface Band {
  top: number;
  bottom: number;
}

// Простий ворог: підходить до гравця по площині, у дистанції б'є по кулдауну.
export class Enemy extends Actor {
  private nextAttackAt = 0;
  private immuneUntil = 0;
  private character: CutoutCharacter | null = null;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, 'enemy', ENEMY.hp);
  }

  async attachChar(doc: CharDoc, keyPrefix: string): Promise<void> {
    const c = await CutoutCharacter.load(this.scene, doc, keyPrefix).catch(() => null);
    if (!c) return;
    this.character = c;
    this.scene.add.existing(c);
    this.setVisible(false);
  }

  // Повертає шкоду, завдану гравцеві цього кроку (0, якщо не вдарив).
  think(player: Player, time: number, dt: number, band: Band): number {
    const dx = player.floorX - this.fx;
    const dy = player.floorY - this.fy;
    this.facing = dx >= 0 ? 1 : -1;

    let anim = 'walk';
    let damage = 0;

    if (time < this.immuneUntil) {
      anim = 'hurt';
      this.stepZ(dt);
      this.sync();
    } else if (Math.abs(dx) <= ENEMY.attackRange && Math.abs(dy) <= ENEMY.attackDepth) {
      anim = 'idle';
      this.stepZ(dt);
      this.sync();
      if (time >= this.nextAttackAt) {
        this.nextAttackAt = time + ENEMY.attackCooldown;
        damage = ENEMY.damage;
      }
    } else {
      const len = Math.hypot(dx, dy) || 1;
      this.fx += (dx / len) * ENEMY.speed * dt;
      this.fy += (dy / len) * ENEMY.speed * dt;
      this.fy = Phaser.Math.Clamp(this.fy, band.top, band.bottom);
      this.stepZ(dt);
      this.sync();
    }

    if (this.character) {
      this.character.setAnim(anim);
      this.character.tick(dt, this.facing);
      this.character.setPosition(this.fx, this.fy - this.character.feetOffset() - this.airZ);
      this.character.setDepth(this.fy + 0.1);
    }

    return damage;
  }

  vulnerable(time: number): boolean {
    return time >= this.immuneUntil;
  }

  // Повертає true, якщо ворог загинув від цього удару.
  hurt(dmg: number, time: number, fromX: number): boolean {
    this.immuneUntil = time + 220; // i-frames: один змах = один удар
    this.hp -= dmg;
    this.fx += (this.fx < fromX ? -1 : 1) * 30; // відкидання
    if (!this.character) {
      this.setTint(0xff8888);
      this.scene.time.delayedCall(110, () => this.clearTint());
    }
    return this.hp <= 0;
  }

  override destroy(fromScene?: boolean): void {
    this.character?.destroy();
    super.destroy(fromScene);
  }
}
