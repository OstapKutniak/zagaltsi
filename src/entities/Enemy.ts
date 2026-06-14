import Phaser from 'phaser';
import { Actor } from './Actor';
import { ENEMY } from '../config';
import type { Player } from './Player';

interface Band {
  top: number;
  bottom: number;
}

// Простий ворог: підходить до гравця по площині, у дистанції б'є по кулдауну.
export class Enemy extends Actor {
  private nextAttackAt = 0;
  private immuneUntil = 0;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, 'enemy', ENEMY.hp);
  }

  // Повертає шкоду, завдану гравцеві цього кроку (0, якщо не вдарив).
  think(player: Player, time: number, dt: number, band: Band): number {
    const dx = player.floorX - this.fx;
    const dy = player.floorY - this.fy;
    this.facing = dx >= 0 ? 1 : -1;

    if (Math.abs(dx) <= ENEMY.attackRange && Math.abs(dy) <= ENEMY.attackDepth) {
      // У зоні удару — б'є по кулдауну, стоїть.
      this.stepZ(dt);
      this.sync();
      if (time >= this.nextAttackAt) {
        this.nextAttackAt = time + ENEMY.attackCooldown;
        return ENEMY.damage;
      }
      return 0;
    }

    // Інакше підходить.
    const len = Math.hypot(dx, dy) || 1;
    this.fx += (dx / len) * ENEMY.speed * dt;
    this.fy += (dy / len) * ENEMY.speed * dt;
    this.fy = Phaser.Math.Clamp(this.fy, band.top, band.bottom);
    this.stepZ(dt);
    this.sync();
    return 0;
  }

  vulnerable(time: number): boolean {
    return time >= this.immuneUntil;
  }

  // Повертає true, якщо ворог загинув від цього удару.
  hurt(dmg: number, time: number, fromX: number): boolean {
    this.immuneUntil = time + 220; // i-frames: один змах = один удар
    this.hp -= dmg;
    this.fx += (this.fx < fromX ? -1 : 1) * 30; // відкидання
    this.setTint(0xff8888);
    this.scene.time.delayedCall(110, () => this.clearTint());
    return this.hp <= 0;
  }
}
