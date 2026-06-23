import Phaser from 'phaser';
import { Actor } from './Actor';
import { ENEMY } from '../config';
import type { Player } from './Player';
import { CutoutCharacter, type CharDoc } from '../anim/CutoutCharacter';
import type { NodeGraph, GraphNode } from '../node-editor';

interface Band {
  top: number;
  bottom: number;
}

// Простий ворог: підходить до гравця по площині, у дистанції б'є по кулдауну.
export class Enemy extends Actor {
  private nextAttackAt = 0;
  private immuneUntil = 0;
  private character: CutoutCharacter | null = null;

  // Нодова поведінка (необовʼязкова). cellSize = розмір клітинки колайдера в px
  // («1 крок = 1 клітинка»). maxHp — для умови «здоровʼя нижче %».
  private behavior: NodeGraph | null = null;
  private cellSize = 48;
  private readonly maxHp = ENEMY.hp;
  private dialogTriggered = false; // діалог «Почати діалог» спрацьовує один раз на ворога

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, 'enemy', ENEMY.hp);
  }

  setBehavior(g: NodeGraph | null, cellSize: number): void {
    this.behavior = g && g.nodes && g.nodes.length ? g : null;
    if (cellSize > 0) this.cellSize = cellSize;
  }

  async attachChar(doc: CharDoc, keyPrefix: string): Promise<void> {
    const c = await CutoutCharacter.load(this.scene, doc, keyPrefix).catch(() => null);
    if (!c) return;
    this.character = c;
    this.scene.add.existing(c);
    this.setVisible(false);
  }

  // Обирана цього кадру дія: DFS усіма гілками від кореня. Умови маршрутизують
  // (Так/Ні), дії/діалог — термінали. З-поміж усіх досягнутих обираємо НАЙГЛИБШУ
  // (щоб гілки «близько→атака» та «далеко→діалог» від одного кореня працювали обидві).
  private pickAction(player: Player): GraphNode | null {
    const g = this.behavior!;
    const byId = (id: string): GraphNode | undefined => g.nodes.find((n) => n.id === id);
    const edgesFrom = (id: string, port: number) => g.edges.filter((e) => e.fromId === id && e.fromPort === port);

    let best: GraphNode | null = null;
    let bestDepth = -1;
    const visit = (node: GraphNode | undefined, depth: number, seen: Set<string>): void => {
      if (!node || seen.has(node.id)) return;
      const s2 = new Set(seen); s2.add(node.id);
      if (node.cat === 'dialog' || node.cat === 'behavior') {
        if (depth > bestDepth) { best = node; bestDepth = depth; }
        if (node.cat === 'dialog') return; // діалог — термінал (виходи = відповіді)
        for (const e of edgesFrom(node.id, 0)) visit(byId(e.toId), depth + 1, s2);
      } else if (node.cat === 'reroute' || node.type === 'then_next') {
        for (const e of edgesFrom(node.id, 0)) visit(byId(e.toId), depth + 1, s2);
      } else if (node.cat === 'condition') {
        const port = this.evalCond(node, player);
        for (const e of edgesFrom(node.id, port)) visit(byId(e.toId), depth + 1, s2);
      }
    };

    const root = g.nodes.find((n) => n.cat === 'root');
    const seen = new Set<string>();
    if (root) { for (const e of edgesFrom(root.id, 0)) visit(byId(e.toId), 0, seen); }
    else for (const n of g.nodes.filter((n) => n.cat !== 'root' && !g.edges.some((e) => e.toId === n.id))) visit(n, 0, seen);
    return best;
  }

  // Повертає індекс вихідного порту, яким іти далі.
  private evalCond(node: GraphNode, player: Player): number {
    const dx = player.floorX - this.fx, dy = player.floorY - this.fy;
    switch (node.type) {
      case 'player_distance': {
        const steps = Math.hypot(dx, dy) / this.cellSize;
        const target = Number(node.config.steps ?? 3);
        let pass: boolean;
        switch (String(node.config.cmp ?? 'lte')) {
          case 'gte': pass = steps >= target; break;
          case 'lt':  pass = steps < target; break;
          case 'gt':  pass = steps > target; break;
          case 'eq':  pass = Math.round(steps) === Math.round(target); break;
          default:    pass = steps <= target; break; // lte
        }
        return pass ? 0 : 1; // 0=Так, 1=Ні
      }
      case 'health_below': {
        const pct = (this.hp / this.maxHp) * 100;
        return pct < Number(node.config.percent ?? 30) ? 0 : 1;
      }
      case 'and_cond': {
        const g = this.behavior!;
        const inEdge = (port: number) => g.edges.find((e) => e.toId === node.id && e.toPort === port);
        const inNode = (port: number) => { const e = inEdge(port); return e ? g.nodes.find((n) => n.id === e!.fromId) : undefined; };
        const e0 = inEdge(0), e1 = inEdge(1);
        const n0 = inNode(0), n1 = inNode(1);
        // pass = джерело вивело б той самий порт, яким воно під'єднане до AND
        const pass0 = n0 && e0 ? this.evalCond(n0, player) === e0.fromPort : true;
        const pass1 = n1 && e1 ? this.evalCond(n1, player) === e1.fromPort : true;
        return (pass0 && pass1) ? 0 : 1; // 0=Так, 1=Ні
      }
      case 'dialog_done': return this.dialogTriggered ? 0 : 1; // 0=Так якщо вже поговорили
      case 'sees_player': return 0; // поки що завжди бачить
      case 'time_of_day':  return 0; // поки що завжди «День»
      default: return 0;
    }
  }

  // Приблизні світові координати голови (для позиціонування діалогової кульки).
  headWorldPos(): { wx: number; wy: number } {
    const fo = this.character?.feetOffset() ?? 200;
    return { wx: this.fx, wy: this.fy - fo * 2.4 };
  }

  private moveToward(dx: number, dy: number, speed: number, dt: number, band: Band): void {
    const len = Math.hypot(dx, dy) || 1;
    this.fx += (dx / len) * speed * dt;
    this.fy += (dy / len) * speed * dt;
    this.fy = Phaser.Math.Clamp(this.fy, band.top, band.bottom);
  }

  // Повертає шкоду, завдану гравцеві цього кроку (0, якщо не вдарив).
  think(player: Player, time: number, dt: number, band: Band): number {
    const dx = player.floorX - this.fx;
    const dy = player.floorY - this.fy;
    this.facing = dx >= 0 ? 1 : -1;

    let anim = 'walk';
    let damage = 0;

    const attack = (): void => { if (time >= this.nextAttackAt) { this.nextAttackAt = time + ENEMY.attackCooldown; damage = ENEMY.damage; } };

    if (time < this.immuneUntil) {
      anim = 'hurt';
    } else if (this.behavior) {
      // Режим нодової поведінки: дія = найглибша досягнута поведінка.
      const act = this.pickAction(player);
      if (act?.cat === 'dialog') {
        anim = 'idle';
        if (!this.dialogTriggered) {
          this.dialogTriggered = true;
          const { wx, wy } = this.headWorldPos();
          this.scene.events.emit('enemyDialog', { graph: this.behavior, nodeId: act.id, wx, wy });
        }
      } else switch (act?.type) {
        case 'run_to_player':  anim = 'run';  this.moveToward(dx, dy, ENEMY.speed, dt, band); break;
        case 'walk_to_player': anim = 'walk'; this.moveToward(dx, dy, ENEMY.speed * 0.5, dt, band); break;
        case 'wait':           anim = 'idle'; break;
        case 'melee_attack':
        case 'range_attack':   anim = 'attack'; attack(); break;
        default:               anim = 'idle'; break; // нічого не обрано — стоїть
      }
    } else if (Math.abs(dx) <= ENEMY.attackRange && Math.abs(dy) <= ENEMY.attackDepth) {
      anim = 'idle'; attack();
    } else {
      anim = 'walk'; this.moveToward(dx, dy, ENEMY.speed, dt, band);
    }

    this.stepZ(dt);
    this.sync();

    if (this.character) {
      this.character.setAnim(anim);
      this.character.tick(dt, this.facing);
      this.character.setPosition(this.fx, this.fy - this.character.feetOffset() - this.hz);
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
