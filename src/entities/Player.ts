import Phaser from 'phaser';
import { Actor } from './Actor';
import { PLAYER, JUMP, WORLD_WIDTH } from '../config';
import type { InputCommand } from '../core/input';

// Чи прохідна точка (gameX, gameY) — поклітинкова перевірка підлоги (з GameScene).
type Walkable = (x: number, y: number) => boolean;

// Герой. Уся поведінка керується командами вводу (cmd) — це "симуляція,
// відокремлена від керування", фундамент під майбутній кооп.
export class Player extends Actor {
  maxX = WORLD_WIDTH - 20; // межа просування (ворота арени піднімають її)
  minX = 20; // ліва межа (початок рівня)
  moving = false; // чи рухається цього кроку (для вибору анімації)
  running = false; // біг (Shift)

  private attackUntil = 0;
  private nextAttackAt = 0;
  private invulnUntil = 0;
  private hurtUntil = 0; // для анімації отримання удару
  private attackAnimUntil = 0; // для анімації удару

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, 'player', PLAYER.maxHp);
  }

  update(cmd: InputCommand, time: number, dt: number, walkable: Walkable): void {
    this.moving = false;
    this.running = false;
    // Під час удару герой "вкопаний" — не ходить.
    if (!this.isAttacking(time)) {
      let vx = 0;
      let vy = 0;
      if (cmd.left) vx = -1;
      else if (cmd.right) vx = 1;
      if (cmd.up) vy = -1;
      else if (cmd.down) vy = 1;
      if (vx !== 0) this.facing = vx > 0 ? 1 : -1;
      this.moving = vx !== 0 || vy !== 0;
      this.running = this.moving && cmd.run;

      const len = Math.hypot(vx, vy) || 1; // нормалізація діагоналі
      const spd = PLAYER.speed * (cmd.run ? 1.7 : 1);
      const dx = (vx / len) * spd * dt;
      const dy = (vy / len) * spd * dt;
      const ox = this.fx, oy = this.fy;
      const curOk = walkable(ox, oy); // стоїмо на підлозі?
      // Рух по осях ОКРЕМО — ковзання вздовж краю/отвору, симетрично в обидва боки.
      let nx = Phaser.Math.Clamp(ox + dx, this.minX, this.maxX);
      let ny = oy;
      if (curOk && dx !== 0 && !walkable(nx, oy)) {
        // Вперлись у отвір/край по X — замість різкої зупинки плавно з'їжджаємо
        // на найближчу сусідню лінію глибини (заокруглений перехід між рядами).
        // Ребра клітинок нахилені 45° в один бік, тож ramp для руху ВПРАВО і ВЛІВО
        // йде в ПРОТИЛЕЖНІ вертикальні боки — інакше один напрям впирався б у кут.
        const prefer = dx > 0 ? -1 : 1;
        const dir = this.slipDepthDir(walkable, nx, oy, prefer);
        const ng = oy + dir * spd * dt;
        if (dir !== 0 && (walkable(ox, ng) || walkable(nx, ng))) {
          ny = ng;
          if (!walkable(nx, ny)) nx = ox; // поки не доїхали до відкритої лінії — не йдемо вперед
        } else {
          nx = ox;
        }
      }
      let ty = ny + dy;
      if (curOk && dy !== 0 && !walkable(nx, ty)) ty = ny; // вперлись по глибині
      ny = ty;
      this.fx = nx;
      this.fy = ny;

      if (cmd.jump) this.jump(JUMP.power);
      if (cmd.attack) this.tryAttack(time);
    }

    this.stepZ(dt);
    const flashing = time < this.invulnUntil && Math.floor(time / 70) % 2 === 0;
    this.setAlpha(flashing ? 0.4 : 1);
    this.sync();
  }

  // Шукає напрямок по глибині (1 = вглиб/вниз, -1 = ближче/вгору) до найближчої
  // прохідної точки в колонці X, у межах SLIP_RANGE. Спершу повністю пробує
  // `prefer` (ramp у бік, що відповідає напрямку руху по 45°-ребру), і лише якщо
  // там глухо — протилежний. 0 — нема куди з'їхати.
  private slipDepthDir(walkable: Walkable, x: number, y: number, prefer: number): number {
    const STEP = 4, SLIP_RANGE = 72;
    for (let s = STEP; s <= SLIP_RANGE; s += STEP) if (walkable(x, y + prefer * s)) return prefer;
    for (let s = STEP; s <= SLIP_RANGE; s += STEP) if (walkable(x, y - prefer * s)) return -prefer;
    return 0;
  }

  private tryAttack(time: number): void {
    if (time < this.nextAttackAt) return;
    this.attackUntil = time + PLAYER.attackActive;
    this.nextAttackAt = time + PLAYER.attackCooldown;
    this.attackAnimUntil = time + 700;
  }

  spawnAt(x: number, y?: number): void { this.fx = x; if (y != null) this.fy = y; }

  isAttacking(time: number): boolean {
    return time < this.attackUntil;
  }
  isInAttack(time: number): boolean {
    return time < this.attackAnimUntil;
  }
  isHurt(time: number): boolean {
    return time < this.hurtUntil;
  }

  takeDamage(time: number, dmg: number, fromX: number): boolean {
    if (time < this.invulnUntil) return false;
    this.hp -= dmg;
    this.invulnUntil = time + PLAYER.invulnDuration;
    this.hurtUntil = time + 600;
    this.fx += (this.fx < fromX ? -1 : 1) * 26; // відкидання
    return true;
  }
}
