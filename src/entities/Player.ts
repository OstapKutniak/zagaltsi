import Phaser from 'phaser';
import { PLAYER } from '../config';
import type { InputCommand } from '../core/input';

// Герой. Уся поведінка керується командами вводу (cmd), а не клавіатурою напряму —
// це і є "симуляція, відокремлена від керування".
export class Player extends Phaser.Physics.Arcade.Sprite {
  hp = PLAYER.maxHp;
  facing: 1 | -1 = 1;

  private attackActiveUntil = 0;
  private nextAttackTime = 0;
  private invulnUntil = 0;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, 'player'); // 'player' — плейсхолдер-текстура з BootScene
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.setCollideWorldBounds(true);
  }

  private get arcadeBody(): Phaser.Physics.Arcade.Body {
    return this.body as Phaser.Physics.Arcade.Body;
  }

  update(cmd: InputCommand, time: number): void {
    const body = this.arcadeBody;

    let vx = 0;
    if (cmd.left) {
      vx = -PLAYER.speed;
      this.facing = -1;
    } else if (cmd.right) {
      vx = PLAYER.speed;
      this.facing = 1;
    }
    this.setVelocityX(vx);

    if (cmd.jump && body.blocked.down) {
      this.setVelocityY(-PLAYER.jumpVelocity);
    }
    // Змінна висота стрибка: відпустив рано — стрибок коротший.
    if (!cmd.jumpHeld && body.velocity.y < 0) {
      this.setVelocityY(body.velocity.y * 0.6);
    }

    if (cmd.attack) this.tryAttack(time);

    this.setFlipX(this.facing === -1);

    // Блимання під час невразливості
    const flashing = time < this.invulnUntil && Math.floor(time / 80) % 2 === 0;
    this.setAlpha(flashing ? 0.35 : 1);
  }

  private tryAttack(time: number): void {
    if (time < this.nextAttackTime) return;
    this.attackActiveUntil = time + PLAYER.attackDuration;
    this.nextAttackTime = time + PLAYER.attackCooldown;
  }

  isAttacking(time: number): boolean {
    return time < this.attackActiveUntil;
  }

  // Прямокутник удару перед героєм (у світових координатах).
  getAttackRect(): Phaser.Geom.Rectangle {
    const w = PLAYER.attackRange;
    const h = PLAYER.attackWidth;
    const x = this.facing === 1 ? this.x + 8 : this.x - 8 - w;
    const y = this.y - h / 2;
    return new Phaser.Geom.Rectangle(x, y, w, h);
  }

  takeDamage(time: number, fromX: number): boolean {
    if (time < this.invulnUntil) return false;
    this.hp -= 1;
    this.invulnUntil = time + PLAYER.invulnDuration;
    const dir = this.x < fromX ? -1 : 1; // відкидання від джерела
    this.setVelocity(dir * 220, -220);
    return true;
  }
}
