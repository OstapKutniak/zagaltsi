import Phaser from 'phaser';
import { LOGICAL_W, LOGICAL_H } from '../config';
import { setupMenuCamera, addTitle, addBack, MENU_FONT, COL_IDLE } from './menuTheme';
import { idbGet } from '../store';
import { stageLevelById } from '../level/launch';
import { myKhorugvaId, getKhorugva, memberList } from '../khorugva';
import { drawKhSlot } from './khPortraits';

// «Мандри» — глобальна карта (WorldDoc з Редактора Карти: IDB zag_worlds →
// опублікований studio-data/worlds.json). Біла цятка стоїть у поточній локації
// (localStorage zag_map_node). Клік по сусідньому вузлу → цятка рушає по ребру,
// на середині зупиняється → прапорець «Ви дещо побачили» + смуга завантаження →
// вмикається бітемап-рівень цього ребра (edge.levelId; нема → тестовий zag_level).
// Ліворуч — 5 квадратів-портретів хоругви (щоб не заважали карті).

interface WNode { id: string; label: string; x: number; y: number; type: string }
interface WEdge { id: string; from: string; to: string; levelId: string }
interface WDoc { id: string; name: string; bg: string; nodes: WNode[]; edges: WEdge[]; updatedAt?: number }

export class MapScene extends Phaser.Scene {
  private world: WDoc | null = null;
  private dot!: Phaser.GameObjects.Arc;
  private traveling = false;
  private toWorld!: (n: WNode) => { x: number; y: number };

  constructor() { super('Map'); }

  create(): void {
    const f = setupMenuCamera(this, '#100c14');
    this.traveling = false;
    addTitle(this, f, 'МАНДРИ');
    addBack(this, f);
    this.drawKhorugva(f);
    void this.loadWorld().then(() => {
      if (!this.scene.isActive()) return;
      this.buildMap(f);
    });
  }

  // Світи: локальні (IDB zag_worlds, LWW у редакторі) → опубліковані worlds.json.
  private async loadWorld(): Promise<void> {
    let worlds: WDoc[] = [];
    const local = await idbGet<WDoc[]>('zag_worlds').catch(() => null);
    if (local?.length) worlds = local;
    else {
      try {
        const r = await fetch(`${import.meta.env.BASE_URL}studio-data/worlds.json`);
        if (r.ok) { const d = await r.json() as { worlds?: WDoc[] }; worlds = d.worlds ?? []; }
      } catch { /* ignore */ }
    }
    this.world = worlds.find((w) => (w.nodes?.length ?? 0) > 0) ?? null;
  }

  private buildMap(f: { offX: number; offY: number; cx: number }): void {
    const w = this.world;
    if (!w) {
      this.add.text(f.cx, 240 + f.offY, 'Карта ще не намальована (Редактор Карти → Опублікувати)', {
        fontFamily: MENU_FONT, fontSize: '22px', color: '#8a8496',
      }).setOrigin(0.5).setScrollFactor(0);
      return;
    }

    // Вписуємо всі вузли в кадр (вузли в координатах редактора навколо 0)
    const xs = w.nodes.map((n) => n.x), ys = w.nodes.map((n) => n.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const spanX = Math.max(60, maxX - minX), spanY = Math.max(60, maxY - minY);
    const pad = 120, leftPad = 200; // зліва місце під портрети хоругви
    const sc = Math.min((LOGICAL_W - pad - leftPad) / spanX, (LOGICAL_H - pad * 2) / spanY);
    const cxm = (minX + maxX) / 2, cym = (minY + maxY) / 2;
    this.toWorld = (n: WNode) => ({
      x: f.cx + leftPad / 2 + (n.x - cxm) * sc,
      y: LOGICAL_H / 2 + f.offY + 20 + (n.y - cym) * sc,
    });

    // Фон карти (якщо намальований у редакторі)
    if (w.bg) {
      const key = 'map_bg_' + w.id;
      const draw = (): void => {
        if (!this.scene.isActive()) return;
        const im = this.add.image(f.cx + leftPad / 2, LOGICAL_H / 2 + f.offY + 20, key).setScrollFactor(0).setDepth(1);
        const s = Math.max((LOGICAL_W - leftPad) / im.width, (LOGICAL_H - 80) / im.height);
        im.setScale(s).setAlpha(0.9);
      };
      if (this.textures.exists(key)) draw();
      else { this.textures.once('addtexture', (k: string) => { if (k === key) draw(); }); this.textures.addBase64(key, w.bg); }
    }

    // Ребра
    const g = this.add.graphics().setScrollFactor(0).setDepth(2);
    g.lineStyle(3, 0x8a7a5c, 0.75);
    for (const e of w.edges) {
      const a = w.nodes.find((n) => n.id === e.from), b = w.nodes.find((n) => n.id === e.to);
      if (!a || !b) continue;
      const pa = this.toWorld(a), pb = this.toWorld(b);
      g.beginPath(); g.moveTo(pa.x, pa.y); g.lineTo(pb.x, pb.y); g.strokePath();
    }

    // Поточна локація
    let curId = localStorage.getItem('zag_map_node') ?? '';
    if (!w.nodes.some((n) => n.id === curId)) curId = w.nodes[0].id;
    localStorage.setItem('zag_map_node', curId);

    // Вузли + лейбли + клік
    for (const n of w.nodes) {
      const p = this.toWorld(n);
      const c = this.add.circle(p.x, p.y, 11, n.id === curId ? 0xffcf8f : 0x5a4f6a)
        .setStrokeStyle(2, 0x2a2233).setScrollFactor(0).setDepth(3)
        .setInteractive({ useHandCursor: true });
      this.add.text(p.x, p.y - 26, n.label, {
        fontFamily: MENU_FONT, fontStyle: 'small-caps', fontSize: '20px', color: COL_IDLE,
      }).setOrigin(0.5).setScrollFactor(0).setDepth(3).setShadow(1, 2, '#000000', 4, false, true);
      c.on('pointerup', () => this.tryTravel(n, f));
    }

    // Біла цятка мандрівника
    const cur = w.nodes.find((n) => n.id === curId)!;
    const cp = this.toWorld(cur);
    this.dot = this.add.circle(cp.x, cp.y, 6, 0xffffff).setScrollFactor(0).setDepth(5);
  }

  // Клік по вузлу: якщо з'єднаний ребром із поточним — вирушаємо.
  private tryTravel(target: WNode, f: { offX: number; offY: number; cx: number }): void {
    const w = this.world;
    if (!w || this.traveling) return;
    const curId = localStorage.getItem('zag_map_node') ?? '';
    if (target.id === curId) return;
    const edge = w.edges.find((e) =>
      (e.from === curId && e.to === target.id) || (e.to === curId && e.from === target.id));
    if (!edge) return;
    this.traveling = true;

    const from = w.nodes.find((n) => n.id === curId)!;
    const pa = this.toWorld(from), pb = this.toWorld(target);
    const midX = (pa.x + pb.x) / 2, midY = (pa.y + pb.y) / 2;

    // Цятка рушає, на середині — подія
    this.tweens.add({
      targets: this.dot, x: midX, y: midY, duration: 1700, ease: 'Sine.easeInOut',
      onComplete: () => {
        if (!this.scene.isActive()) return;
        this.showEvent(midX, midY, edge, target.id);
      },
    });
  }

  // Прапорець «Ви дещо побачили» + смуга завантаження → рівень.
  private showEvent(x: number, y: number, edge: WEdge, targetId: string): void {
    // прапорець: держак + полотнище + напис
    const g = this.add.graphics().setScrollFactor(0).setDepth(6);
    g.lineStyle(3, 0xd8c9a3, 1);
    g.beginPath(); g.moveTo(x, y - 6); g.lineTo(x, y - 58); g.strokePath();
    g.fillStyle(0x2b1f16, 0.95); g.fillRect(x, y - 58, 210, 34);
    g.lineStyle(1, 0x8a7a5c, 1); g.strokeRect(x, y - 58, 210, 34);
    this.add.text(x + 105, y - 41, 'Ви дещо побачили', {
      fontFamily: MENU_FONT, fontStyle: 'small-caps', fontSize: '19px', color: '#ffcf8f',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(7);

    // смуга завантаження під прапорцем
    const barW = 210;
    g.fillStyle(0x1a1420, 1); g.fillRect(x, y - 18, barW, 8);
    const fill = this.add.graphics().setScrollFactor(0).setDepth(7);
    const state = { p: 0 };
    this.tweens.add({
      targets: state, p: 1, duration: 1600, ease: 'Sine.easeIn',
      onUpdate: () => { fill.clear(); fill.fillStyle(0xff9a1f, 1); fill.fillRect(x, y - 18, barW * state.p, 8); },
      onComplete: () => {
        localStorage.setItem('zag_map_node', targetId); // прибули (після рівня — наступна локація)
        void stageLevelById(edge.levelId).finally(() => {
          if (this.scene.isActive()) this.scene.start('Game');
        });
      },
    });
  }

  // 5 портретів хоругви — квадратики ліворуч, вертикально.
  private drawKhorugva(f: { offX: number; offY: number; cx: number }): void {
    const khId = myKhorugvaId();
    const size = 74, gap = 14;
    const x = 34 + f.offX, y0 = 110 + f.offY;
    const drawAll = (members: ReturnType<typeof memberList>): void => {
      if (!this.scene.isActive()) return;
      for (let i = 0; i < 5; i++) drawKhSlot(this, x, y0 + i * (size + gap), size, members[i] ?? null);
    };
    if (!khId) { drawAll([]); return; }
    void getKhorugva(khId).then((kh) => drawAll(memberList(kh))).catch(() => drawAll([]));
  }
}
