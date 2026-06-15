import Phaser from 'phaser';
import { WORLD_WIDTH, BAND_DEPTH, FLOOR_MARGIN, PLAYER } from '../config';
import { InputController } from '../core/input';
import { Player } from '../entities/Player';
import { Enemy } from '../entities/Enemy';
import { CutoutCharacter, type CharDoc } from '../anim/CutoutCharacter';
import { buildLevelView, type LevelDoc } from '../level/LevelView';
import { getUser, saveValue } from '../telegram';

const FIXED_DT = 1 / 60; // фіксований крок симуляції -> детермінізм (multiplayer-ready)
const GATE_X = 1150; // поки арена не зачищена, далі не пройти
const WAVE_TRIGGER_X = 760; // де набігає хвиля

export class GameScene extends Phaser.Scene {
  private player!: Player;
  private controls!: InputController;
  private enemies: Enemy[] = [];
  private character: CutoutCharacter | null = null;

  // Динамічний макет: заповнюємо весь в'юпорт, смуга підлоги — від низу екрана.
  private worldH = 540;
  private bandTop = 320;
  private bandBottom = 510;

  private skyRect!: Phaser.GameObjects.Rectangle;
  private groundRect!: Phaser.GameObjects.Rectangle;
  private horizon!: Phaser.GameObjects.Rectangle;
  private gateLine!: Phaser.GameObjects.Rectangle;
  private goal!: Phaser.GameObjects.Rectangle;
  private goalLabel!: Phaser.GameObjects.Text;

  private hud!: Phaser.GameObjects.Text;
  private banner!: Phaser.GameObjects.Text;

  private finished = false;
  private waveSpawned = false;
  private cleared = false;
  private levelMode = false;
  private levelStart = 0;
  private levelEnd = WORLD_WIDTH;
  private accumulator = 0;
  private simTime = 0; // власний час симуляції (мс), незалежний від кадрів

  constructor() {
    super('Game');
  }

  private get band(): { top: number; bottom: number } {
    return { top: this.bandTop, bottom: this.bandBottom };
  }

  create(): void {
    this.finished = false;
    this.enemies = [];
    this.waveSpawned = false;
    this.cleared = false;
    this.accumulator = 0;
    this.simTime = 0;

    this.cameras.main.setBackgroundColor('#2a2233');
    this.computeLayout();

    // Фон: "небо" зверху + смуга підлоги знизу (присмерковий тон у дусі Don't Starve)
    this.skyRect = this.add.rectangle(0, 0, 10, 10, 0x3a3148).setDepth(-1000);
    this.groundRect = this.add.rectangle(0, 0, 10, 10, 0x4a3f2e).setDepth(-1000);
    this.horizon = this.add.rectangle(0, 0, 10, 3, 0x000000, 0.25).setDepth(-999);
    this.gateLine = this.add.rectangle(0, 0, 6, 10, 0x000000, 0.25).setDepth(-998);

    // Магазин — ціль рівня
    this.goal = this.add.rectangle(WORLD_WIDTH - 120, 0, 70, 120, 0xffd000).setOrigin(0.5, 1);
    this.goalLabel = this.add.text(0, 0, 'МАГАЗИН', {
      fontFamily: 'monospace',
      fontSize: '16px',
      color: '#ffd000',
    });
    this.repositionWorld();

    // Герой
    this.player = new Player(this, 90, this.bandBottom - 10);
    this.player.maxX = GATE_X - 30;
    this.controls = new InputController(this);
    this.cameras.main.startFollow(this.player, true, 0.08, 0);

    // Якщо є зібраний персонаж із ріг-тулзи (public/character.json) — малюємо його
    // замість прямокутника. Немає файлу -> лишається прямокутник-плейсхолдер.
    this.character = null;
    // 1) спершу беремо персонажа, відправленого з тулзи (Export у гру, той самий домен);
    // 2) інакше — закомічений public/character.json.
    let localDoc: CharDoc | null = null;
    try { const s = localStorage.getItem('zag_game_char'); if (s) localDoc = JSON.parse(s) as CharDoc; } catch { /* ignore */ }
    const docP: Promise<CharDoc | null> = localDoc
      ? Promise.resolve(localDoc)
      : fetch(`${import.meta.env.BASE_URL}character.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    docP
      .then((doc) => (doc && doc.slots && doc.images ? CutoutCharacter.load(this, doc) : null))
      .then((c) => { if (c) { this.character = c; this.add.existing(c); this.player.setVisible(false); } })
      .catch(() => { /* нема — лишається прямокутник */ });

    // Рівень із редактора (localStorage zag_level або public/level.json)
    this.levelMode = false;
    let lvlDoc: LevelDoc | null = null;
    try { const s = localStorage.getItem('zag_level'); if (s) lvlDoc = JSON.parse(s) as LevelDoc; } catch { /* ignore */ }
    const lvP: Promise<LevelDoc | null> = lvlDoc
      ? Promise.resolve(lvlDoc)
      : fetch(`${import.meta.env.BASE_URL}level.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    lvP.then((doc) => { if (doc && doc.placed) this.applyLevel(doc); }).catch(() => {});

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
      .text(0, 0, '', { fontFamily: 'monospace', fontSize: '20px', color: '#ffd000' })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(10000);

    // Реакція на зміну розміру вікна Telegram / браузера
    this.scale.on('resize', this.onResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.scale.off('resize', this.onResize, this));
  }

  // Рахує смугу підлоги під поточний розмір екрана (без зуму: 1 світ = 1 піксель,
  // тож HUD і спрайти лишаються чіткими та на місцях, а чорних полів немає).
  private computeLayout(): void {
    this.worldH = this.scale.height;
    this.bandBottom = this.worldH - FLOOR_MARGIN;
    this.bandTop = Math.max(this.worldH * 0.28, this.bandBottom - BAND_DEPTH);
    if (this.levelMode) this.cameras.main.setBounds(this.levelStart, 0, Math.max(1, this.levelEnd - this.levelStart), this.worldH);
    else this.cameras.main.setBounds(0, 0, WORLD_WIDTH, this.worldH);
  }

  // Застосувати рівень із редактора: візуал + спавн + межі камери/гравця.
  private applyLevel(doc: LevelDoc): void {
    this.levelMode = true;
    this.skyRect.setVisible(false); this.groundRect.setVisible(false); this.horizon.setVisible(false);
    this.gateLine.setVisible(false); this.goal.setVisible(false); this.goalLabel.setVisible(false);
    for (const e of this.enemies) e.destroy();
    this.enemies = [];
    this.levelStart = doc.start ?? 0;
    this.levelEnd = Math.max(this.levelStart + 200, doc.end ?? WORLD_WIDTH);
    this.player.minX = this.levelStart + 20;
    this.player.maxX = this.levelEnd - 20;
    this.player.spawnAt(doc.spawn?.x ?? this.levelStart + 60);
    this.cameras.main.setBounds(this.levelStart, 0, this.levelEnd - this.levelStart, this.worldH);
    void buildLevelView(this, doc, this.bandBottom);
    this.banner.setText('');
  }

  private repositionWorld(): void {
    const h = this.worldH;
    this.skyRect.setPosition(WORLD_WIDTH / 2, this.bandTop / 2).setSize(WORLD_WIDTH, this.bandTop);
    this.groundRect.setPosition(WORLD_WIDTH / 2, (this.bandTop + h) / 2).setSize(WORLD_WIDTH, h - this.bandTop);
    this.horizon.setPosition(WORLD_WIDTH / 2, this.bandTop).setSize(WORLD_WIDTH, 3);
    this.gateLine.setPosition(GATE_X, (this.bandTop + h) / 2).setSize(6, h - this.bandTop);
    this.goal.setPosition(WORLD_WIDTH - 120, this.bandBottom).setDepth(this.bandBottom - 1);
    this.goalLabel.setPosition(WORLD_WIDTH - 162, this.bandBottom - 150);
  }

  private onResize(): void {
    this.computeLayout();
    this.repositionWorld();
    if (this.banner) this.banner.setPosition(this.scale.width / 2, 84);
    // Повертаємо персонажів у нову смугу
    this.player?.clampDepth(this.bandTop, this.bandBottom);
    for (const e of this.enemies) e.clampDepth(this.bandTop, this.bandBottom);
  }

  private spawnWave(): void {
    this.waveSpawned = true;
    const mid = (this.bandTop + this.bandBottom) / 2;
    const spots: Array<[number, number]> = [
      [950, this.bandTop + 24],
      [1060, this.bandBottom - 10],
      [1120, mid],
    ];
    for (const [x, y] of spots) this.enemies.push(new Enemy(this, x, y));
    this.banner.setPosition(this.scale.width / 2, 84).setText('БИЙСЯ! Зачисти ворогів');
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
    const band = this.band;

    const cmd = this.controls.sample();
    this.player.update(cmd, time, dt, band);

    // Синхронізуємо зібраного персонажа з гравцем (позиція, анімація, напрям)
    if (this.character) {
      const p = this.player;
      const anim = !p.grounded ? 'jump' : p.isHurt(time) ? 'hurt' : p.isInAttack(time) ? 'attack' : p.moving ? (p.running ? 'run' : 'walk') : 'idle';
      this.character.setAnim(anim);
      this.character.tick(dt, this.player.facing);
      this.character.setPosition(this.player.x, this.player.y - this.character.feetOffset());
      this.character.setDepth(this.player.depth + 0.1);
    }

    // Тригер хвилі (демо-арена; у режимі рівня вимкнено)
    if (!this.levelMode && !this.waveSpawned && this.player.floorX > WAVE_TRIGGER_X) this.spawnWave();

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
      const dmg = e.think(this.player, time, dt, band);
      if (dmg > 0) this.player.takeDamage(time, dmg, e.floorX);
    }

    // Арена зачищена — відкриваємо шлях
    if (!this.levelMode && this.waveSpawned && !this.cleared && this.enemies.length === 0) {
      this.cleared = true;
      this.player.maxX = WORLD_WIDTH - 20;
      this.gateLine.setVisible(false);
      this.banner.setPosition(this.scale.width / 2, 84).setText('ШЛЯХ ВІЛЬНИЙ! До магазину →');
      this.time.delayedCall(1600, () => this.banner.setText(''));
    }

    // Досягнення магазину (демо; у режимі рівня вимкнено)
    if (!this.levelMode && this.cleared && Math.abs(this.player.floorX - this.goal.x) < 55) {
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
