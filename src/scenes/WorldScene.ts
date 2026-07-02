import Phaser from 'phaser';
import { LOGICAL_W, LOGICAL_H, RENDER_SCALE } from '../config';
import {
  type WorldDoc, type WorldNode, loadWorldsForGame, findGlobalWorld,
  loadTravel, saveTravel,
} from '../world/worldData';

// Сцена мандрів — карта світу з Редактора Карти. Глобальна (Карпати) → клік по
// відкритому регіону → карта регіону (села/лихі місця). По регіону їздить БІЛА
// ТОЧКА героя: клік по вузлу → шлях по ребрах (BFS) → анімований переїзд.
// Прибув у location-вузол → відкривається LocationScene. Переходи-бітемап поки
// скіпаються (levelId є в ребрах — підключимо пізніше).

const MENU_FONT = 'Georgia, "Times New Roman", serif';
const COL_TEXT = '#e5d8bc';
const COL_NODE = '#d8cdb4';
const COL_EDGE = 'rgba(229,216,188,0.5)';

interface Fit { s: number; ox: number; oy: number } // world→screen: sx = ox + wx*s

export class WorldScene extends Phaser.Scene {
  private worlds: WorldDoc[] = [];
  private world: WorldDoc | null = null;
  private isGlobal = true;
  private fit: Fit = { s: 1, ox: 0, oy: 0 };
  private gfx!: Phaser.GameObjects.Graphics;
  private dot: Phaser.GameObjects.Arc | null = null; // біла точка героя
  private curNodeId: string | null = null;
  private travelling = false;
  private labels: Phaser.GameObjects.Text[] = [];
  private offX = 0; private offY = 0;

  constructor() { super('World'); }

  init(data: { worldId?: string }): void {
    this._wantedWorldId = data?.worldId ?? null;
  }
  private _wantedWorldId: string | null = null;

  create(): void {
    const cam = this.cameras.main;
    cam.setZoom(RENDER_SCALE);
    cam.setBackgroundColor('#141118');
    this.offX = LOGICAL_W * (RENDER_SCALE - 1) / 2;
    this.offY = LOGICAL_H * (RENDER_SCALE - 1) / 2;
    this.gfx = this.add.graphics().setScrollFactor(0).setDepth(5);
    this.dot = null; this.labels = []; this.travelling = false;

    void this.loadAndRender();
  }

  private async loadAndRender(): Promise<void> {
    this.worlds = await loadWorldsForGame();
    const global = findGlobalWorld(this.worlds);
    const wanted = this._wantedWorldId ? this.worlds.find((w) => w.id === this._wantedWorldId) : null;
    this.world = wanted ?? global;
    this.isGlobal = !!this.world && this.world.id === global?.id;
    if (!this.world) {
      this.add.text(LOGICAL_W / 2 + this.offX, LOGICAL_H / 2 + this.offY,
        'Карт ще нема — намалюй у Редакторі Карти (studio)', {
          fontFamily: MENU_FONT, fontSize: '22px', color: COL_TEXT,
        }).setOrigin(0.5).setScrollFactor(0);
      this.addBackButton();
      return;
    }
    this.computeFit();
    await this.drawBg();
    this.drawMap();
    this.placeDot();
    this.addBackButton();
    this.addTitle();
  }

  // Вписати карту (bbox вузлів + фон) в екран з полями.
  private computeFit(): void {
    const w = this.world!;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of w.nodes) {
      minX = Math.min(minX, n.x); maxX = Math.max(maxX, n.x);
      minY = Math.min(minY, n.y); maxY = Math.max(maxY, n.y);
    }
    if (minX === Infinity) { minX = -300; maxX = 300; minY = -150; maxY = 150; }
    // трохи повітря навколо вузлів
    const padW = (maxX - minX) * 0.12 + 60, padH = (maxY - minY) * 0.12 + 60;
    minX -= padW; maxX += padW; minY -= padH; maxY += padH;
    const availW = LOGICAL_W - 120, availH = LOGICAL_H - 150;
    const s = Math.min(availW / (maxX - minX), availH / (maxY - minY));
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    this.fit = {
      s,
      ox: LOGICAL_W / 2 - cx * s + this.offX,
      oy: (LOGICAL_H / 2 + 20) - cy * s + this.offY, // +20: лишаємо місце заголовку
    };
  }

  private sx(wx: number): number { return this.fit.ox + wx * this.fit.s; }
  private sy(wy: number): number { return this.fit.oy + wy * this.fit.s; }

  private async drawBg(): Promise<void> {
    const w = this.world!;
    if (!w.bg) return;
    const key = 'worldbg_' + w.id;
    if (!this.textures.exists(key)) {
      await new Promise<void>((res) => {
        this.textures.once('addtexture-' + key, () => res());
        this.textures.addBase64(key, w.bg);
      });
    }
    if (!this.scene.isActive()) return; // пішли зі сцени, поки вантажилось
    // Фон у редакторі лежить верхнім лівим кутом у світовій (0,0), натуральний розмір.
    const img = this.add.image(this.sx(0), this.sy(0), key).setOrigin(0, 0).setScrollFactor(0).setDepth(1);
    img.setScale(this.fit.s);
    img.setAlpha(0.92);
  }

  private drawMap(): void {
    const w = this.world!;
    const g = this.gfx;
    g.clear();
    const byId = new Map(w.nodes.map((n) => [n.id, n]));

    // Ребра
    for (const e of w.edges) {
      const a = byId.get(e.from), b = byId.get(e.to);
      if (!a || !b) continue;
      g.lineStyle(3, 0xe5d8bc, e.levelId ? 0.55 : 0.28);
      // штрих для «ще без рівня» — сегментована лінія
      if (e.levelId) {
        g.lineBetween(this.sx(a.x), this.sy(a.y), this.sx(b.x), this.sy(b.y));
      } else {
        this.dashedLine(g, this.sx(a.x), this.sy(a.y), this.sx(b.x), this.sy(b.y), 9, 7);
      }
    }

    // Вузли
    for (const n of w.nodes) {
      const x = this.sx(n.x), y = this.sy(n.y);
      const locked = n.type === 'region' && !n.regionId;
      if (n.type === 'region') {
        // Регіон — ромб (зачинений — тьмяний з замком)
        g.fillStyle(locked ? 0x4a4438 : 0xcbb98a, 1);
        g.lineStyle(2.5, 0x141118, 1);
        g.beginPath();
        g.moveTo(x, y - 20); g.lineTo(x + 20, y); g.lineTo(x, y + 20); g.lineTo(x - 20, y);
        g.closePath(); g.fillPath(); g.strokePath();
      } else if (n.type === 'stop') {
        g.fillStyle(0x9a8f78, 1);
        g.fillCircle(x, y, 5);
      } else {
        g.fillStyle(0xd8cdb4, 1);
        g.lineStyle(2.5, 0x141118, 1);
        g.fillCircle(x, y, 12);
        g.strokeCircle(x, y, 12);
      }
      // Підпис
      if (n.type !== 'stop') {
        const t = this.add.text(x, y + (n.type === 'region' ? 30 : 22), n.label + (locked ? ' 🔒' : ''), {
          fontFamily: MENU_FONT, fontSize: '17px', color: locked ? '#8a8171' : COL_TEXT,
        }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(6)
          .setShadow(1, 2, '#000000', 5, false, true);
        this.labels.push(t);
      }
      // Хіт-зона кліку
      const zone = this.add.zone(x, y, 56, 56).setOrigin(0.5).setScrollFactor(0)
        .setInteractive({ useHandCursor: !locked });
      zone.on('pointerup', () => this.onNodeClick(n));
    }
  }

  private dashedLine(g: Phaser.GameObjects.Graphics, x1: number, y1: number, x2: number, y2: number, dash: number, gap: number): void {
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    let d = 0;
    while (d < len) {
      const e = Math.min(d + dash, len);
      g.lineBetween(x1 + ux * d, y1 + uy * d, x1 + ux * e, y1 + uy * e);
      d = e + gap;
    }
  }

  // Точка героя: збережена позиція в ЦЬОМУ світі, або перше село (location-вузол).
  private placeDot(): void {
    const w = this.world!;
    const t = loadTravel();
    let node: WorldNode | undefined;
    if (t && t.worldId === w.id) node = w.nodes.find((n) => n.id === t.nodeId);
    if (!node) node = w.nodes.find((n) => n.type === 'location') ?? w.nodes[0];
    if (!node) return;
    this.curNodeId = node.id;
    saveTravel({ worldId: w.id, nodeId: node.id });
    this.dot = this.add.circle(this.sx(node.x), this.sy(node.y), 9, 0xffffff)
      .setScrollFactor(0).setDepth(10).setStrokeStyle(2.5, 0x141118);
    // легка пульсація — щоб героя було видно одразу
    this.tweens.add({ targets: this.dot, scale: 1.25, duration: 700, yoyo: true, repeat: -1, ease: 'sine.inout' });
  }

  private onNodeClick(n: WorldNode): void {
    if (this.travelling) return;
    if (n.type === 'region') {
      if (!n.regionId) { this.toast('Регіон ще зачинено'); return; }
      this.scene.start('World', { worldId: n.regionId });
      return;
    }
    // стоїмо тут → одразу відкриваємо локацію
    if (n.id === this.curNodeId) { this.openNode(n); return; }
    // інакше — їдемо по ребрах (BFS-шлях); переходи-рівні поки скіпаються
    const path = this.findPath(this.curNodeId, n.id);
    if (!path || path.length < 2) { this.toast('Туди нема шляху'); return; }
    this.travelAlong(path, () => this.openNode(n));
  }

  private openNode(n: WorldNode): void {
    if (n.type === 'location') {
      this.scene.start('Location', { nodeId: n.id, label: n.label, locationId: n.locationId, worldId: this.world!.id });
    }
  }

  // BFS по ребрах (двобічно — twoWay поки не обмежує).
  private findPath(from: string | null, to: string): string[] | null {
    const w = this.world!;
    if (!from) return [to];
    const adj = new Map<string, string[]>();
    for (const e of w.edges) {
      (adj.get(e.from) ?? adj.set(e.from, []).get(e.from)!).push(e.to);
      (adj.get(e.to) ?? adj.set(e.to, []).get(e.to)!).push(e.from);
    }
    const prev = new Map<string, string>();
    const seen = new Set([from]);
    const q = [from];
    while (q.length) {
      const cur = q.shift()!;
      if (cur === to) {
        const path = [to];
        let p = to;
        while (p !== from) { p = prev.get(p)!; path.unshift(p); }
        return path;
      }
      for (const nx of adj.get(cur) ?? []) {
        if (seen.has(nx)) continue;
        seen.add(nx); prev.set(nx, cur); q.push(nx);
      }
    }
    return null;
  }

  // Анімований переїзд точки по сегментах шляху; час ~ довжині сегмента.
  private travelAlong(path: string[], done: () => void): void {
    const w = this.world!;
    const byId = new Map(w.nodes.map((n) => [n.id, n]));
    this.travelling = true;
    let i = 1;
    const step = (): void => {
      if (i >= path.length) {
        this.travelling = false;
        this.curNodeId = path[path.length - 1];
        saveTravel({ worldId: w.id, nodeId: this.curNodeId });
        done();
        return;
      }
      const n = byId.get(path[i]); i++;
      if (!n || !this.dot) { step(); return; }
      const tx = this.sx(n.x), ty = this.sy(n.y);
      const dist = Math.hypot(tx - this.dot.x, ty - this.dot.y);
      this.tweens.add({
        targets: this.dot, x: tx, y: ty,
        duration: Math.max(220, Math.min(900, dist * 3)),
        ease: 'sine.inout',
        onComplete: step,
      });
    };
    step();
  }

  private addTitle(): void {
    this.add.text(LOGICAL_W / 2 + this.offX, 40 + this.offY, this.world?.name ?? 'Мандри', {
      fontFamily: MENU_FONT, fontStyle: 'small-caps', fontSize: '34px', color: '#efe3c8',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(20).setShadow(2, 3, '#000000', 7, false, true);
  }

  private addBackButton(): void {
    const label = this.isGlobal ? '‹ Меню' : '‹ Мапа країв';
    const t = this.add.text(36 + this.offX, 34 + this.offY, label, {
      fontFamily: MENU_FONT, fontStyle: 'small-caps', fontSize: '24px', color: COL_TEXT,
    }).setOrigin(0, 0.5).setScrollFactor(0).setDepth(20)
      .setShadow(1, 2, '#000000', 6, false, true)
      .setInteractive({ useHandCursor: true });
    t.on('pointerover', () => t.setColor('#ffcf8f'));
    t.on('pointerout', () => t.setColor(COL_TEXT));
    t.on('pointerup', () => {
      if (this.isGlobal) this.scene.start('Menu');
      else this.scene.start('World', {}); // на глобальну
    });
  }

  private toast(msg: string): void {
    const t = this.add.text(LOGICAL_W / 2 + this.offX, LOGICAL_H - 46 + this.offY, msg, {
      fontFamily: MENU_FONT, fontSize: '20px', color: '#ffcf8f',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(30).setShadow(1, 2, '#000', 5, false, true);
    this.tweens.add({ targets: t, alpha: 0, delay: 900, duration: 500, onComplete: () => t.destroy() });
  }
}
