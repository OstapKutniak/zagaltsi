import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT, WORLD_WIDTH, BAND, PLAYER } from '../config';
import { InputController } from '../core/input';
import { Player } from '../entities/Player';
import { Enemy } from '../entities/Enemy';
import { getUser, saveValue } from '../telegram';

const FIXED_DT = 1 / 60; // фіксований крок симуляції -> детермінізм (multiplayer-ready)
const GATE_X = 1150; // поки арена не зачищена, далі не пройти
const WAVE_TRIGGER_X = 760; // де набігає хвиля

export class GameScene extends Phaser.Scene {
  private player!: Player;
  private controls!: InputController;
  private enemies: Enemy[] = [];
  private hud!: Phaser.GameObjects.Text;
  private banner!: Phaser.GameObjects.Text;
  private goal!: Phaser.GameObjects.Rectangle;
  private gateLine!: Phaser.GameObjects.Rectangle;

  private finished = false;
  private waveSpawned = false;
  private cleared = false;
  private accumulator = 0;
  private simTime = 0; // власний час симуляції (мс), незалежний від кадрів

  constructor() {
    super('Game');
  }

  create(): void {
    this.finished = false;
    this.enemies = [];
    this.waveSpawned = false;
    this.cleared = false;
    this.accumulator = 0;
    this.simTime = 0;

    this.cameras.main.setBounds(0, 0, WORLD_WIDTH, GAME_HEIGHT);
    this.cameras.main.setBackgroundColor('#2a2233');

    // Фон: "небо" зверху + смуга підлоги знизу (присмерковий тон у дусі Don't Starve)
    this.add.rectangle(WORLD_WIDTH / 2, BAND.top / 2, WORLD_WIDTH, BAND.top, 0x3a3148).setDepth(-1000);
    this.add
      .rectangle(WORLD_WIDTH / 2, (BAND.top + GAME_HEIGHT) / 2, WORLD_WIDTH, GAME_HEIGHT - BAND.top, 0x4a3f2e)
      .setDepth(-1000);
    this.add.rectangle(WORLD_WIDTH / 2, BAND.top, WORLD_WIDTH, 3, 0x000000, 0.25).setDepth(-999);

    // Ворота арени (зникають після зачистки)
    this.gateLine = this.add
      .rectangle(GATE_X, (BAND.top + GAME_HEIGHT) / 2, 6, GAME_HEIGHT - BAND.top, 0x000000, 0.25)
      .setDepth(-998);

    // Магазин — ціль рівня
    this.goal = this.add.rectangle(WORLD_WIDTH - 120, BAND.bottom, 70, 120, 0xffd000).setOrigin(0.5, 1);
    this.goal.setDepth(BAND.bottom - 1);
    this.add
      .text(WORLD_WIDTH - 162, BAND.bottom - 150, 'МАГАЗИН', {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: '#ffd000',
      })
      .setDepth(10000);

    // Герой
    this.player = new Player(this, 90, BAND.bottom - 10);
    this.player.maxX = GATE_X - 30;
    this.controls = new InputController(this);
    this.cameras.main.startFollow(this.player, true, 0.08, 0);

    // HUD (прикріплений до екрана)
    this.hud = this.add
      .text(12, 12, '', { fontFamily: 'monospace', fontSize: '18px', color: '#ffffff' })
      .setScrollFactor(0)
      .setDepth(10000);
    const user = getUser();
    const name = user?.first_name ?? user?.username ?? 'Гравець';
    this.add
      .text(12, 38, `${name}: пробийся через село до магазину!`, {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#bdb0c8',
      })
      .setScrollFactor(0)
      .setDepth(10000);
    this.banner = this.add
      .text(GAME_WIDTH / 2, 92, '', {
        fontFamily: 'monospace',
        fontSize: '22px',
        color: '#ffd000',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(10000);
  }

  private spawnWave(): void {
    this.waveSpawned = true;
    const spots: Array<[number, number]> = [
      [950, BAND.top + 30],
      [1060, BAND.bottom - 10],
      [1120, BAND.top + 90],
    ];
    for (const [x, y] of spots) this.enemies.push(new Enemy(this, x, y));
    this.banner.setText('БИЙСЯ! Зачисти ворогів');
  }

  // Phaser викликає update щокадру; ми накопичуємо час і крутимо симуляцію
  // фіксованими кроками — однаково на будь-якому FPS.
  update(_time: number, delta: number): void {
    if (this.finished) return;
    this.accumulator += Math.min(delta / 1000, 0.1);
    while (this.accumulator >= FIXED_DT) {
      this.step(FIXED_DT);
      this.accumulator -= FIXED_DT;
    }
  }

  private step(dt: number): void {
    this.simTime += dt * 1000;
    const time = this.simTime;

    const cmd = this.controls.sample();
    this.player.update(cmd, time, dt);

    // Тригер хвилі
    if (!this.waveSpawned && this.player.floorX > WAVE_TRIGGER_X) this.spawnWave();

    // Удар гравця: зона перед ним з урахуванням глибини
    if (this.player.isAttacking(time) && this.player.grounded) {
      for (const e of [...this.enemies]) {
        if (!e.vulnerable(time)) continue;
        const dx = (e.floorX - this.player.floorX) * this.player.facing;
        const dy = Math.abs(e.floorY - this.player.floorY);
        if (dx > 0 && dx <= PLAYER.attackReach && dy <= PLAYER.attackDepth) {
          const dead = e.hurt(PLAYER.attackDamage, time, this.player.floorX);
          if (dead) {
            e.destroy();
            this.enemies = this.enemies.filter((x) => x !== e);
          }
        }
      }
    }

    // Вороги думають і б'ють
    for (const e of this.enemies) {
      const dmg = e.think(this.player, time, dt);
      if (dmg > 0) this.player.takeDamage(time, dmg, e.floorX);
    }

    // Арена зачищена — відкриваємо шлях
    if (this.waveSpawned && !this.cleared && this.enemies.length === 0) {
      this.cleared = true;
      this.player.maxX = WORLD_WIDTH - 20;
      this.gateLine.setVisible(false);
      this.banner.setText('ШЛЯХ ВІЛЬНИЙ! До магазину →');
      this.time.delayedCall(1600, () => this.banner.setText(''));
    }

    // Досягнення магазину
    if (this.cleared && Math.abs(this.player.floorX - this.goal.x) < 55) {
      this.completeLevel();
    }

    // HUD + смерть
    this.hud.setText('HP ' + '♥'.repeat(Math.max(0, this.player.hp)));
    if (this.player.hp <= 0) this.scene.restart();
  }

  private completeLevel(): void {
    this.finished = true;
    void saveValue('level1', 'done'); // прогрес у Telegram CloudStorage

    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2;
    this.add
      .text(cx, cy - 20, 'ПИВО ДОБУТО! 🍺', { fontFamily: 'monospace', fontSize: '28px', color: '#ffd000' })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(10000);
    this.add
      .text(cx, cy + 20, 'Рівень 1 пройдено', { fontFamily: 'monospace', fontSize: '16px', color: '#ffffff' })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(10000);
  }
}
