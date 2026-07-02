import Phaser from 'phaser';
import { LOGICAL_W, LOGICAL_H, RENDER_SCALE } from '../config';
import { setTouchUI } from './uiButton';
import {
  type WorldDoc, type WorldNode, loadWorldsForGame, findGlobalWorld,
  loadTravel, saveTravel,
} from '../world/worldData';
import { parchmentCanvas, drawInkDecor, locationIcon, regionSeal, compassRose, iconFromLabel, type MapIconKind } from '../world/mapArt';

// Сцена мандрів — «стара мапа»: процедурний пергамент + чорнильні іконки локацій
// (стиль DD1: товсті контури, штриховка). Глобальна (Карпатський край) → регіон.
// Наведення (ПК) або перший тап (телефон) — іконка підсвічується й росте, за нею
// прапорець з описом; клік/другий тап — біла точка героя їде по ребрах (BFS).

const MAP_FONT = 'Georgia, "Times New Roman", serif';
const INK = '#231a12';
const INK_SOFT = '#5a4832';

interface Fit { s: number; ox: number; oy: number }

interface NodeView {
  node: WorldNode;
  img: Phaser.GameObjects.Image;    // іконка
  glow: Phaser.GameObjects.Image;   // золота підсвітка (копія за іконкою)
  baseScale: number;
}

export class WorldScene extends Phaser.Scene {
  private worlds: WorldDoc[] = [];
  private world: WorldDoc | null = null;
  private isGlobal = true;
  private fit: Fit = { s: 1, ox: 0, oy: 0 };
  private gfx!: Phaser.GameObjects.Graphics;
  private dot: Phaser.GameObjects.Arc | null = null;
  private curNodeId: string | null = null;
  private travelling = false;
  private offX = 0; private offY = 0;
  private views: NodeView[] = [];
  private hoveredId: string | null = null;
  private banner: Phaser.GameObjects.Container | null = null;

  constructor() { super('World'); }

  init(data: { worldId?: string }): void {
    this._wantedWorldId = data?.worldId ?? null;
  }
  private _wantedWorldId: string | null = null;

  create(): void {
    setTouchUI(false); // джойстик/кнопки — лише в бітемапі
    const cam = this.cameras.main;
    cam.setZoom(RENDER_SCALE);
    cam.setBackgroundColor('#171310');
    this.offX = LOGICAL_W * (RENDER_SCALE - 1) / 2;
    this.offY = LOGICAL_H * (RENDER_SCALE - 1) / 2;
    this.gfx = this.add.graphics().setScrollFactor(0).setDepth(5);
    this.dot = null; this.travelling = false; this.views = []; this.hoveredId = null; this.banner = null;

    void this.loadAndRender();
    this.drawParty();
  }

  // 5 портретів Хоругви (паті, не presence) — квадратики ліворуч, вертикально,
  // щоб не заважати мапі й смузі завантаження.
  private drawParty(): void {
    void import('../khorugva').then(({ myKhorugvaId, getKhorugva, memberList }) => {
      const draw = (members: import('../khorugva').KhMember[]): void => {
        if (!this.scene.isActive()) return;
        void import('./khPortraits').then(({ drawKhSlot }) => {
          if (!this.scene.isActive()) return;
          const size = 64, gap = 12;
          const x = 26 + this.offX, y0 = 128 + this.offY;
          for (let i = 0; i < 5; i++) drawKhSlot(this, x, y0 + i * (size + gap), size, members[i] ?? null);
        });
      };
      const khId = myKhorugvaId();
      if (!khId) { draw([]); return; }
      getKhorugva(khId).then((kh) => draw(memberList(kh))).catch(() => draw([]));
    });
  }

  private async loadAndRender(): Promise<void> {
    this.worlds = await loadWorldsForGame();
    const global = findGlobalWorld(this.worlds);
    const wanted = this._wantedWorldId ? this.worlds.find((w) => w.id === this._wantedWorldId) : null;
    this.world = wanted ?? global;
    this.isGlobal = !!this.world && this.world.id === global?.id;
    this.drawParchment();
    if (!this.world) {
      this.add.text(LOGICAL_W / 2 + this.offX, LOGICAL_H / 2 + this.offY,
        'Карт ще нема — намалюй у Редакторі Карти (studio)', {
          fontFamily: MAP_FONT, fontSize: '22px', color: INK,
        }).setOrigin(0.5).setScrollFactor(0).setDepth(6);
      this.addBackButton();
      return;
    }
    this.computeFit();
    await this.drawUserBg();
    this.drawMap();
    this.placeDot();
    this.addBackButton();
    this.addTitle();
  }

  // Пергамент на весь кадр + чорнильний декор (річка/ялинки) + компас.
  private drawParchment(): void {
    const key = 'map_parchment';
    if (!this.textures.exists(key)) {
      const c = parchmentCanvas(LOGICAL_W, LOGICAL_H, 7);
      drawInkDecor(c, 11);
      this.textures.addCanvas(key, c);
    }
    this.add.image(LOGICAL_W / 2 + this.offX, LOGICAL_H / 2 + this.offY, key)
      .setScrollFactor(0).setDepth(0);
    const ck = 'map_compass';
    if (!this.textures.exists(ck)) this.textures.addCanvas(ck, compassRose(92));
    this.add.image(LOGICAL_W - 74 + this.offX, LOGICAL_H - 72 + this.offY, ck)
      .setScrollFactor(0).setDepth(4).setAlpha(0.75);
  }

  private computeFit(): void {
    const w = this.world!;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of w.nodes) {
      minX = Math.min(minX, n.x); maxX = Math.max(maxX, n.x);
      minY = Math.min(minY, n.y); maxY = Math.max(maxY, n.y);
    }
    if (minX === Infinity) { minX = -300; maxX = 300; minY = -150; maxY = 150; }
    const padW = (maxX - minX) * 0.12 + 70, padH = (maxY - minY) * 0.12 + 70;
    minX -= padW; maxX += padW; minY -= padH; maxY += padH;
    const availW = LOGICAL_W - 140, availH = LOGICAL_H - 170;
    const s = Math.min(availW / (maxX - minX), availH / (maxY - minY));
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    this.fit = {
      s,
      ox: LOGICAL_W / 2 - cx * s + this.offX,
      oy: (LOGICAL_H / 2 + 24) - cy * s + this.offY,
    };
  }

  private sx(wx: number): number { return this.fit.ox + wx * this.fit.s; }
  private sy(wy: number): number { return this.fit.oy + wy * this.fit.s; }

  // Намальований користувачем фон (Редактор Карти) — поверх пергаменту.
  private async drawUserBg(): Promise<void> {
    const w = this.world!;
    if (!w.bg) return;
    const key = 'worldbg_' + w.id;
    if (!this.textures.exists(key)) {
      await new Promise<void>((res) => {
        this.textures.once('addtexture-' + key, () => res());
        this.textures.addBase64(key, w.bg);
      });
    }
    if (!this.scene.isActive()) return;
    const img = this.add.image(this.sx(0), this.sy(0), key).setOrigin(0, 0).setScrollFactor(0).setDepth(1);
    img.setScale(this.fit.s);
  }

  private iconTexture(kind: MapIconKind): string {
    const key = 'mi_' + kind;
    if (!this.textures.exists(key)) this.textures.addCanvas(key, locationIcon(kind, 108));
    return key;
  }

  private sealTexture(locked: boolean): string {
    const key = 'seal_' + (locked ? 'l' : 'o');
    if (!this.textures.exists(key)) this.textures.addCanvas(key, regionSeal(124, locked));
    return key;
  }

  private drawMap(): void {
    const w = this.world!;
    const g = this.gfx;
    g.clear();
    const byId = new Map(w.nodes.map((n) => [n.id, n]));

    // Шляхи — чорнильний пунктир (з рівнем — щільніший і темніший)
    for (const e of w.edges) {
      const a = byId.get(e.from), b = byId.get(e.to);
      if (!a || !b) continue;
      g.lineStyle(2.4, 0x231a12, e.levelId ? 0.8 : 0.42);
      this.dashedLine(g, this.sx(a.x), this.sy(a.y), this.sx(b.x), this.sy(b.y), e.levelId ? 12 : 7, 8);
    }

    for (const n of w.nodes) {
      const x = this.sx(n.x), y = this.sy(n.y);
      const locked = n.type === 'region' && !n.regionId;

      if (n.type === 'stop') {
        g.fillStyle(0x231a12, 0.9);
        g.fillCircle(x, y, 4.5);
        continue;
      }

      const texKey = n.type === 'region'
        ? this.sealTexture(locked)
        : this.iconTexture((n.icon as MapIconKind) || iconFromLabel(n.label));
      const baseScale = n.type === 'region' ? 0.86 : 0.8;

      // Золота підсвітка — копія текстури за іконкою (видима лише в hover)
      const glow = this.add.image(x, y, texKey).setScrollFactor(0).setDepth(6)
        .setScale(baseScale * 1.12).setTint(0xd99a2b).setAlpha(0);
      const img = this.add.image(x, y, texKey).setScrollFactor(0).setDepth(7).setScale(baseScale);
      if (locked) img.setAlpha(0.55);

      // Підпис чорнилом
      this.add.text(x, y + 44, n.label, {
        fontFamily: MAP_FONT, fontStyle: 'italic', fontSize: '17px', color: locked ? INK_SOFT : INK,
      }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(8);

      img.setInteractive({ useHandCursor: !locked });
      const view: NodeView = { node: n, img, glow, baseScale };
      this.views.push(view);
      img.on('pointerover', () => this.setHover(view));
      img.on('pointerout', () => this.clearHover(view));
      img.on('pointerup', () => {
        // Телефон: перший тап = підсвітка+прапорець, другий — дія.
        if (this.hoveredId !== n.id) { this.setHover(view); return; }
        this.onNodeClick(n);
      });
    }
  }

  // ── hover: збільшення + підсвітка + прапорець-опис ──────────────────────────
  private setHover(v: NodeView): void {
    if (this.hoveredId === v.node.id) return;
    const prev = this.views.find((x) => x.node.id === this.hoveredId);
    if (prev) this.clearHover(prev);
    this.hoveredId = v.node.id;
    this.tweens.add({ targets: v.img, scale: v.baseScale * 1.18, duration: 140, ease: 'sine.out' });
    this.tweens.add({ targets: v.glow, alpha: 0.75, scale: v.baseScale * 1.3, duration: 140 });
    this.showBanner(v);
  }

  private clearHover(v: NodeView): void {
    if (this.hoveredId !== v.node.id) return;
    this.hoveredId = null;
    this.tweens.add({ targets: v.img, scale: v.baseScale, duration: 140, ease: 'sine.in' });
    this.tweens.add({ targets: v.glow, alpha: 0, scale: v.baseScale * 1.12, duration: 140 });
    this.hideBanner();
  }

  // Прапорець над іконкою: планка з хвостиком + назва + короткий опис.
  private showBanner(v: NodeView): void {
    this.hideBanner();
    const n = v.node;
    const x = this.sx(n.x), y = this.sy(n.y) - 52;
    const cont = this.add.container(x, y).setScrollFactor(0).setDepth(30);
    const title = this.add.text(0, 0, n.label, {
      fontFamily: MAP_FONT, fontSize: '16px', fontStyle: 'bold', color: '#efe3c8',
    }).setOrigin(0.5, 0.5);
    const descTxt = n.desc ? this.add.text(0, 0, n.desc, {
      fontFamily: MAP_FONT, fontSize: '13px', fontStyle: 'italic', color: '#cbb98a',
      wordWrap: { width: 230 }, align: 'center',
    }).setOrigin(0.5, 0) : null;
    const wBox = Math.max(title.width, descTxt?.width ?? 0) + 26;
    const hBox = 14 + title.height + (descTxt ? descTxt.height + 4 : 0);
    title.setY(-hBox / 2 + 8 + title.height / 2 - 4);
    if (descTxt) descTxt.setY(title.y + title.height / 2 + 2);
    const g = this.add.graphics();
    g.fillStyle(0x231a12, 0.94);
    g.fillRoundedRect(-wBox / 2, -hBox / 2, wBox, hBox, 6);
    g.lineStyle(2, 0xcbb98a, 0.8);
    g.strokeRoundedRect(-wBox / 2, -hBox / 2, wBox, hBox, 6);
    // хвостик до іконки
    g.fillTriangle(-7, hBox / 2, 7, hBox / 2, 0, hBox / 2 + 10);
    cont.add([g, title]);
    if (descTxt) cont.add(descTxt);
    cont.setY(y - hBox / 2);
    cont.setAlpha(0);
    this.tweens.add({ targets: cont, alpha: 1, y: cont.y - 4, duration: 150, ease: 'sine.out' });
    this.banner = cont;
  }

  private hideBanner(): void {
    if (!this.banner) return;
    const b = this.banner; this.banner = null;
    this.tweens.add({ targets: b, alpha: 0, duration: 120, onComplete: () => b.destroy() });
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

  private placeDot(): void {
    const w = this.world!;
    const t = loadTravel();
    let node: WorldNode | undefined;
    if (t && t.worldId === w.id) node = w.nodes.find((n) => n.id === t.nodeId);
    if (!node) node = w.nodes.find((n) => n.type === 'location') ?? w.nodes[0];
    if (!node) return;
    this.curNodeId = node.id;
    saveTravel({ worldId: w.id, nodeId: node.id });
    this.dot = this.add.circle(this.sx(node.x), this.sy(node.y) + 14, 8.5, 0xffffff)
      .setScrollFactor(0).setDepth(12).setStrokeStyle(3, 0x231a12);
    this.tweens.add({ targets: this.dot, scale: 1.22, duration: 700, yoyo: true, repeat: -1, ease: 'sine.inout' });
  }

  private onNodeClick(n: WorldNode): void {
    if (this.travelling) return;
    if (n.type === 'region') {
      if (!n.regionId) { this.toast('Регіон ще зачинено'); return; }
      this.scene.start('World', { worldId: n.regionId });
      return;
    }
    if (n.id === this.curNodeId) { this.openNode(n); return; }
    const path = this.findPath(this.curNodeId, n.id);
    if (!path || path.length < 2) { this.toast('Туди нема шляху'); return; }
    this.travelAlong(path, () => this.openNode(n));
  }

  private openNode(n: WorldNode): void {
    if (n.type === 'location') {
      this.scene.start('Location', {
        nodeId: n.id, label: n.label, locationId: n.locationId, worldId: this.world!.id,
        icon: (n.icon as MapIconKind) || iconFromLabel(n.label),
      });
    }
  }

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
      const prevId = path[i - 1];
      const n = byId.get(path[i]); i++;
      if (!n || !this.dot) { step(); return; }
      const tx = this.sx(n.x), ty = this.sy(n.y) + 14;
      const dist = Math.hypot(tx - this.dot.x, ty - this.dot.y);
      // Ребро з бітемап-рівнем (levelId у Редакторі Карти) або тестова пара
      // Пересолиха↔Гребля Мельника: на середині шляху — подія «Ви дещо побачили»
      // → смуга завантаження → вмикається рівень (нема levelId → тестовий zag_level).
      const edge = w.edges.find((e) =>
        (e.from === prevId && e.to === n.id) || (e.to === prevId && e.from === n.id));
      const isTestPair = !!edge && [edge.from, edge.to].sort().join('|') === ['n_hreblya', 'n_peresolykha'].join('|');
      if (edge && (edge.levelId || isTestPair)) {
        const midX = (this.dot.x + tx) / 2, midY = (this.dot.y + ty) / 2;
        this.tweens.add({
          targets: this.dot, x: midX, y: midY,
          duration: Math.max(220, Math.min(900, dist * 3)) / 2,
          ease: 'sine.inout',
          onComplete: () => {
            if (!this.scene.isActive()) return;
            // прибуття фіксуємо в ціль хопа — після рівня гравець уже «там»
            saveTravel({ worldId: w.id, nodeId: n.id });
            this.showTravelEvent(midX, midY, edge.levelId);
          },
        });
        return;
      }
      this.tweens.add({
        targets: this.dot, x: tx, y: ty,
        duration: Math.max(220, Math.min(900, dist * 3)),
        ease: 'sine.inout',
        onComplete: step,
      });
    };
    step();
  }

  // Прапорець «Ви дещо побачили» + смуга завантаження → бітемап-рівень.
  private showTravelEvent(x: number, y: number, levelId: string): void {
    const g = this.add.graphics().setScrollFactor(0).setDepth(25);
    g.lineStyle(3, 0x231a12, 1);
    g.beginPath(); g.moveTo(x, y - 4); g.lineTo(x, y - 54); g.strokePath();
    g.fillStyle(0xefe3c8, 0.96); g.fillRect(x, y - 54, 212, 32);
    g.lineStyle(1.5, 0x5a4832, 1); g.strokeRect(x, y - 54, 212, 32);
    this.add.text(x + 106, y - 38, 'Ви дещо побачили', {
      fontFamily: MAP_FONT, fontStyle: 'small-caps', fontSize: '19px', color: INK,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(26);
    // смуга завантаження
    const barW = 212;
    g.fillStyle(0x2b1f16, 0.9); g.fillRect(x, y - 16, barW, 7);
    const fill = this.add.graphics().setScrollFactor(0).setDepth(26);
    const st = { p: 0 };
    this.tweens.add({
      targets: st, p: 1, duration: 1600, ease: 'Sine.easeIn',
      onUpdate: () => { fill.clear(); fill.fillStyle(0xb0721f, 1); fill.fillRect(x, y - 16, barW * st.p, 7); },
      onComplete: () => {
        void import('../level/launch').then(({ stageLevelById }) =>
          stageLevelById(levelId).finally(() => { if (this.scene.isActive()) this.scene.start('Game'); }));
      },
    });
  }

  private addTitle(): void {
    // Картуш-заголовок чорнилом на пергаменті
    const t = this.add.text(LOGICAL_W / 2 + this.offX, 42 + this.offY, this.world?.name ?? 'Мандри', {
      fontFamily: MAP_FONT, fontStyle: 'small-caps', fontSize: '36px', color: INK,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(20);
    // підкреслення-розчерк
    const g = this.add.graphics().setScrollFactor(0).setDepth(20);
    g.lineStyle(2, 0x231a12, 0.7);
    const y = 42 + this.offY + t.height / 2 + 3;
    g.lineBetween(t.x - t.width / 2 - 14, y, t.x + t.width / 2 + 14, y);
  }

  private addBackButton(): void {
    const label = this.isGlobal ? '‹ Меню' : '‹ Мапа країв';
    const t = this.add.text(36 + this.offX, 34 + this.offY, label, {
      fontFamily: MAP_FONT, fontStyle: 'small-caps', fontSize: '24px', color: INK,
    }).setOrigin(0, 0.5).setScrollFactor(0).setDepth(20)
      .setInteractive({ useHandCursor: true });
    t.on('pointerover', () => t.setColor('#7a5b16'));
    t.on('pointerout', () => t.setColor(INK));
    t.on('pointerup', () => {
      if (this.isGlobal) this.scene.start('Menu');
      else this.scene.start('World', {});
    });
  }

  private toast(msg: string): void {
    const t = this.add.text(LOGICAL_W / 2 + this.offX, LOGICAL_H - 42 + this.offY, msg, {
      fontFamily: MAP_FONT, fontSize: '19px', fontStyle: 'italic', color: INK,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(30);
    this.tweens.add({ targets: t, alpha: 0, delay: 900, duration: 500, onComplete: () => t.destroy() });
  }
}
