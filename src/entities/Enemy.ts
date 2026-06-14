import Phaser from 'phaser';
import { ENEMY } from '../config';
import type { Player } from './Player';

// Простий ворог: іде в бік гравця по горизонталі, гине з одного удару.
export class Enemy extends Phaser.Physics.Arcade.Sprite {
  hp = ENEMY.hp;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, 'enemy');
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.setCollideWorldBounds(true);
  }

  update(player: Player): void {
    const dir = player.x < this.x ? -1 : 1;
    this.setVelocityX(ENEMY.speed * dir);
    this.setFlipX(dir === 1);
  }

  hit(): void {
    this.hp -= 1;
    if (this.hp <= 0) this.destroy();
  }
}
