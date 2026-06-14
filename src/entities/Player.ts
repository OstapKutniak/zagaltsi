import Phaser from 'phaser';
import { Actor } from './Actor';
import { PLAYER, JUMP, WORLD_WIDTH } from '../config';
import type { InputCommand } from '../core/input';

interface Band {
  top: number;
  bottom: number;
}

// Герой. Уся поведінка керується командами вводу (cmd) — це "симуляція,
// відокремлена від керування", фундамент під майбутній кооп.
export class Player extends Actor {
  maxX = WORLD_WIDTH - 20; // межа просування (ворота арени піднімають її)

  private attackUntil = 0;
  private nextAttackAt = 0;
  private invulnUntil = 0;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, 'player', PLAYER.maxHp);
  }

  update(cmd: InputCommand, time: number, dt: number, band: Band): void {
    // Під час удару герой "вкопаний" — не ходить.
    if (!this.isAttacking(time)) {
      let vx = 0;
      let vy = 0;
      if (cmd.left) vx = -1;
      else if (cmd.right) vx = 1;
      if (cmd.up) vy = -1;
      else if (cmd.down) vy = 1;
      if (vx !== 0) this.facing = vx > 0 ? 1 : -1;

      const len = Math.hypot(vx, vy) || 1; // нормалізація діагоналі
      this.fx += (vx / len) * PLAYER.speed * dt;
      this.fy += (vy / len) * PLAYER.speed * dt;
      this.fx = Phaser.Math.Clamp(this.fx, 20, this.maxX);
      this.fy = Phaser.Math.Clamp(this.fy, band.top, band.bottom);

      if (cmd.jump) this.jump(JUMP.power);
      if (cmd.attack) this.tryAttack(time);
    }

    this.stepZ(dt);
    const flashing = time < this.invulnUntil && Math.floor(time / 70) % 2 === 0;
    this.setAlpha(flashing ? 0.4 : 1);
    this.sync();
  }

  private tryAttack(time: number): void {
    if (time < this.nextAttackAt) return;
    this.attackUntil = time + PLAYER.attackActive;
    this.nextAttackAt = time + PLAYER.attackCooldown;
  }

  isAttacking(time: number): boolean {
    return time < this.attackUntil;
  }

  takeDamage(time: number, dmg: number, fromX: number): boolean {
    if (time < this.invulnUntil) return false;
    this.hp -= dmg;
    this.invulnUntil = time + PLAYER.invulnDuration;
    this.fx += (this.fx < fromX ? -1 : 1) * 26; // відкидання
    return true;
  }
}
