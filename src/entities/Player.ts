import Phaser from 'phaser';
import { Actor } from './Actor';
import { PLAYER, JUMP, WORLD_WIDTH, STATS } from '../config';
import type { InputCommand } from '../core/input';

// Елевація поверхні (px) у точці (gameX, gameY): висота клітинки-платформи під цією
// точкою, або null = підлоги нема (отвір/край). Стіна між рівнями = клітинка, чия
// поверхня ВИЩА за поточну висоту гравця: туди не зайти, поки не підстрибнеш досить.
type SurfaceAt = (x: number, y: number) => number | null;
// Похідний предикат «тут можна стояти на поточній висоті» (підлога є і не зависоко).
type Walkable = (x: number, y: number) => boolean;

// Герой. Уся поведінка керується командами вводу (cmd) — це "симуляція,
// відокремлена від керування", фундамент під майбутній кооп.
export class Player extends Actor {
  maxX = WORLD_WIDTH - 20; // межа просування (ворота арени піднімають її)
  minX = 20; // ліва межа (початок рівня)
  moving = false; // чи рухається цього кроку (для вибору анімації)
  running = false; // біг (Shift)

  // ── Бігунки персонажа ──
  stamina = PLAYER.maxStamina;   // витрачається на біг та удари, регениться у спокої
  backPain = 0;                  // «Біль у спині» (аналог мани), 0..STATS.painMax
  anxiety = 0;                   // «Тривожність», 0..STATS.anxietyMax

  private attackUntil = 0;
  private nextAttackAt = 0;
  private invulnUntil = 0;
  private hurtUntil = 0; // для анімації отримання удару
  private attackAnimUntil = 0; // для анімації удару
  private prevFloorZ = 0; // елевація минулого кроку — для детекту «заліз на колайдер»

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, 'player', PLAYER.maxHp);
  }

  update(cmd: InputCommand, time: number, dt: number, surfaceAt: SurfaceAt): void {
    this.moving = false;
    this.running = false;
    // «Можна стояти тут» = підлога є І її поверхня не вища за поточну висоту гравця.
    // Вища клітинка (стіна/сходинка) непрохідна на землі, але стає прохідною, щойно
    // підстрибнеш вище за неї — тоді заходиш на платформу й приземляєшся на її висоту.
    const TOL = 6;
    const walkable: Walkable = (x, y) => { const s = surfaceAt(x, y); return s !== null && s <= this.hz + TOL; };
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
        // на сусідню лінію глибини (заокруглений перехід між рядами). Бік (вгору/вниз)
        // визначаємо автоматично: той, що дає продовжити рух у бік `dx` (їдемо ВЗДОВЖ
        // 45°-краю, а не в кут) — працює однаково для нахилу і «\», і «/».
        const dir = this.slipDepthDir(walkable, nx, oy, Math.sign(dx));
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

    // Висота поверхні під гравцем: гравітація тягне z до неї. Зайшов на вищу
    // платформу (підстрибнувши) — floorZ росте, стоїш на ній; зійшов з краю —
    // floorZ падає, гравець зривається і падає на нижчу.
    const sf = surfaceAt(this.fx, this.fy);
    if (sf !== null) this.floorZ = sf;
    this.stepZ(dt);
    this.updateStats(dt);
    const flashing = time < this.invulnUntil && Math.floor(time / 70) % 2 === 0;
    this.setAlpha(flashing ? 0.4 : 1);
    this.sync();
  }

  // Оновлення бігунків щокроку: стаміна (біг/відновлення), накопичення «Болю у спині»
  // (заліз на колайдер / біг без стаміни) і пасивної «Тривожності» (повний біль / низьке ХП).
  private updateStats(dt: number): void {
    // Заліз на вертикальний колайдер (елевація зросла) → трішки болю у спині.
    const climb = this.floorZ - this.prevFloorZ;
    if (climb > 0) this.addBackPain(climb * STATS.painPerClimbPx);
    this.prevFloorZ = this.floorZ;

    // Стаміна: біг витрачає; біг при нульовій стамині → біль у спині. Спокій → регенерація.
    if (this.running) {
      if (this.stamina > 0) {
        this.stamina = Math.max(0, this.stamina - PLAYER.staminaRunDrain * dt);
      } else {
        this.addBackPain(STATS.painRunNoStamina * dt);
      }
    } else {
      this.stamina = Math.min(PLAYER.maxStamina, this.stamina + PLAYER.staminaRegen * dt);
    }

    // Тривожність: стабільно потроху при повному болю у спині; потроху при низькому ХП.
    if (this.backPain >= STATS.painMax) this.addAnxiety(STATS.anxietyPainFull * dt);
    if (this.hp < PLAYER.maxHp * STATS.anxietyLowHpFrac) this.addAnxiety(STATS.anxietyLowHp * dt);
  }

  private addBackPain(amount: number): void {
    this.backPain = Math.min(STATS.painMax, this.backPain + amount);
  }
  private addAnxiety(amount: number): void {
    this.anxiety = Math.min(STATS.anxietyMax, this.anxiety + amount);
  }

  // Бік по глибині (1 = вглиб/вниз, -1 = ближче/вгору) для ковзання повз край.
  // Для кожного боку шукає найближчу прохідну точку, де ВОДНОЧАС відкривається
  // подальший рух у бік xDir (тобто їдемо ВЗДОВЖ 45°-краю, а не в його кут).
  // Так напрям визначається з самої геометрії — байдуже «\» чи «/». 0 — нікуди.
  private slipDepthDir(walkable: Walkable, x: number, y: number, xDir: number): number {
    const STEP = 4, SLIP_RANGE = 80, AHEAD = STEP * 2;
    let best = 0, bestS = Infinity, fallback = 0, fallS = Infinity;
    for (const dir of [1, -1]) {
      for (let s = STEP; s <= SLIP_RANGE; s += STEP) {
        if (!walkable(x, y + dir * s)) continue;
        if (s < fallS) { fallS = s; fallback = dir; }
        // край «відступає» в цей бік, якщо звідси можна йти далі по xDir
        if (walkable(x + xDir * AHEAD, y + dir * s) && s < bestS) { bestS = s; best = dir; }
        break;
      }
    }
    return best || fallback;
  }

  private tryAttack(time: number): void {
    if (time < this.nextAttackAt) return;
    this.attackUntil = time + PLAYER.attackActive;
    this.nextAttackAt = time + PLAYER.attackCooldown;
    this.attackAnimUntil = time + 700;
    this.stamina = Math.max(0, this.stamina - PLAYER.staminaAttackCost); // удар їсть стаміну
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
    this.addBackPain(STATS.painOnHit * dmg);   // урон → біль у спині
    this.addAnxiety(STATS.anxietyOnHit * dmg); // урон → тривожність
    return true;
  }
}
