import Phaser from 'phaser';
import { GAME_HEIGHT } from '../config';
import { InputController } from '../core/input';
import { Player } from '../entities/Player';
import { Enemy } from '../entities/Enemy';
import { getUser, saveValue } from '../telegram';

const WORLD_WIDTH = 2400;

// Один короткий рівень-випробування: пройти село зліва направо до магазину,
// перестрибуючи платформи й розбираючись із ворогами.
export class GameScene extends Phaser.Scene {
  private player!: Player;
  private controls!: InputController;
  private enemies: Enemy[] = [];
  private platforms: Phaser.GameObjects.Rectangle[] = [];
  private attackGfx!: Phaser.GameObjects.Graphics;
  private hud!: Phaser.GameObjects.Text;
  private goal!: Phaser.GameObjects.Rectangle;
  private finished = false;

  constructor() {
    super('Game');
  }

  create(): void {
    this.finished = false;
    this.enemies = [];
    this.platforms = [];

    this.physics.world.setBounds(0, 0, WORLD_WIDTH, GAME_HEIGHT);
    this.cameras.main.setBounds(0, 0, WORLD_WIDTH, GAME_HEIGHT);
    this.cameras.main.setBackgroundColor('#1d2b53');

    // Земля + платформи
    this.makePlatform(WORLD_WIDTH / 2, GAME_HEIGHT - 16, WORLD_WIDTH, 32);
    this.makePlatform(420, 400, 160, 24);
    this.makePlatform(680, 320, 160, 24);
    this.makePlatform(980, 360, 180, 24);
    this.makePlatform(1320, 300, 160, 24);
    this.makePlatform(1650, 380, 200, 24);

    // Герой
    this.player = new Player(this, 80, GAME_HEIGHT - 80);
    this.physics.add.collider(this.player, this.platforms);

    // Вороги
    this.spawnEnemy(700, GAME_HEIGHT - 80);
    this.spawnEnemy(1100, GAME_HEIGHT - 80);
    this.spawnEnemy(1500, GAME_HEIGHT - 80);

    // Магазин — ціль рівня
    this.goal = this.add.rectangle(WORLD_WIDTH - 80, GAME_HEIGHT - 80, 56, 96, 0xffd000);
    this.add.text(WORLD_WIDTH - 116, GAME_HEIGHT - 156, 'МАГАЗИН', {
      fontFamily: 'monospace',
      fontSize: '16px',
      color: '#ffd000',
    });

    this.controls = new InputController(this);
    this.cameras.main.startFollow(this.player, true, 0.12, 0.12);
    this.attackGfx = this.add.graphics();

    // HUD (прикріплений до екрана)
    this.hud = this.add
      .text(12, 12, '', { fontFamily: 'monospace', fontSize: '18px', color: '#ffffff' })
      .setScrollFactor(0);
    const user = getUser();
    const name = user?.first_name ?? user?.username ?? 'Гравець';
    this.add
      .text(12, 38, `${name}, дійди до магазину по пиво!`, {
        fontFamily: 'monospace',
        fontSize: '13px',
        color: '#a0b0d0',
      })
      .setScrollFactor(0);
  }

  private makePlatform(cx: number, cy: number, w: number, h: number): void {
    const r = this.add.rectangle(cx, cy, w, h, 0x2e4b2e);
    this.physics.add.existing(r, true); // true = статичне тіло
    this.platforms.push(r);
  }

  private spawnEnemy(x: number, y: number): void {
    const e = new Enemy(this, x, y);
    this.physics.add.collider(e, this.platforms);
    this.enemies.push(e);
  }

  update(time: number): void {
    if (this.finished) return;

    const cmd = this.controls.sample();
    this.player.update(cmd, time);
    for (const e of this.enemies) e.update(this.player);

    // Розв'язання удару героя
    this.attackGfx.clear();
    if (this.player.isAttacking(time)) {
      const rect = this.player.getAttackRect();
      this.attackGfx.fillStyle(0xffe066, 0.5).fillRectShape(rect);
      for (const e of [...this.enemies]) {
        if (Phaser.Geom.Rectangle.Overlaps(rect, e.getBounds())) {
          e.hit();
          if (!e.active) this.enemies = this.enemies.filter((x) => x !== e);
        }
      }
    }

    // Контактна шкода від ворогів
    const pb = this.player.getBounds();
    for (const e of this.enemies) {
      if (e.active && Phaser.Geom.Rectangle.Overlaps(pb, e.getBounds())) {
        this.player.takeDamage(time, e.x);
      }
    }

    // Досягнення магазину
    if (Phaser.Geom.Rectangle.Overlaps(pb, this.goal.getBounds())) {
      this.completeLevel();
    }

    // HUD + смерть/падіння
    this.hud.setText('HP ' + '♥'.repeat(Math.max(0, this.player.hp)));
    if (this.player.hp <= 0 || this.player.y > GAME_HEIGHT + 200) {
      this.scene.restart();
    }
  }

  private completeLevel(): void {
    this.finished = true;
    this.player.setVelocity(0, 0);
    void saveValue('level1', 'done'); // зберігаємо прогрес у Telegram CloudStorage

    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2;
    this.add
      .text(cx, cy - 20, 'ПИВО ДОБУТО! 🍺', {
        fontFamily: 'monospace',
        fontSize: '28px',
        color: '#ffd000',
      })
      .setOrigin(0.5)
      .setScrollFactor(0);
    this.add
      .text(cx, cy + 20, 'Рівень 1 пройдено', {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: '#ffffff',
      })
      .setOrigin(0.5)
      .setScrollFactor(0);
  }
}
