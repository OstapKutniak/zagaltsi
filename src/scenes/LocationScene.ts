import Phaser from 'phaser';
import { LOGICAL_W, LOGICAL_H, RENDER_SCALE } from '../config';
import { setTouchUI } from './uiButton';
import {
  type LocationDoc, loadLocationsForGame, locationForNode, type WorldNode,
} from '../world/worldData';
import { enterLocation, leaveLocation, watchLocationPresence, type PresenceEntry } from '../multiplayer/presence';
import { getPlayerId } from '../multiplayer/lobby';
import { loadCharLibrary, type LibItem } from '../charlib';

// Сцена локації (хаб): арт із Редактора Локацій (фон + розставлені будівлі), а поки
// його нема — білі куби-заглушки. Внизу — 5 слотів Хоругви (як герої в HoMM):
// хто з гравців зараз у ЦІЙ локації (Firebase presence), той у слоті.

const MENU_FONT = 'Georgia, "Times New Roman", serif';
const COL_TEXT = '#e5d8bc';

export class LocationScene extends Phaser.Scene {
  private nodeId = '';
  private label = '';
  private locationId: string | undefined;
  private worldId = '';
  private offX = 0; private offY = 0;
  private unwatch: (() => void) | null = null;
  private slotObjs: Phaser.GameObjects.GameObject[] = [];
  private lib: LibItem[] = [];

  constructor() { super('Location'); }

  init(data: { nodeId?: string; label?: string; locationId?: string; worldId?: string }): void {
    this.nodeId = data?.nodeId ?? '';
    this.label = data?.label ?? 'Локація';
    this.locationId = data?.locationId;
    this.worldId = data?.worldId ?? '';
  }

  create(): void {
    setTouchUI(false); // джойстик/кнопки — лише в бітемапі
    const cam = this.cameras.main;
    cam.setZoom(RENDER_SCALE);
    cam.setBackgroundColor('#17131c');
    this.offX = LOGICAL_W * (RENDER_SCALE - 1) / 2;
    this.offY = LOGICAL_H * (RENDER_SCALE - 1) / 2;
    this.slotObjs = [];

    // Заголовок і назад
    this.add.text(LOGICAL_W / 2 + this.offX, 40 + this.offY, this.label, {
      fontFamily: MENU_FONT, fontStyle: 'small-caps', fontSize: '34px', color: '#efe3c8',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(20).setShadow(2, 3, '#000000', 7, false, true);
    const back = this.add.text(36 + this.offX, 34 + this.offY, '‹ До карти', {
      fontFamily: MENU_FONT, fontStyle: 'small-caps', fontSize: '24px', color: COL_TEXT,
    }).setOrigin(0, 0.5).setScrollFactor(0).setDepth(20)
      .setShadow(1, 2, '#000000', 6, false, true)
      .setInteractive({ useHandCursor: true });
    back.on('pointerover', () => back.setColor('#ffcf8f'));
    back.on('pointerout', () => back.setColor(COL_TEXT));
    back.on('pointerup', () => this.scene.start('World', { worldId: this.worldId }));

    void this.renderLocation();
    this.setupPresence();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.unwatch?.(); this.unwatch = null;
      leaveLocation();
    });
  }

  // ── Арт локації (або куби) ─────────────────────────────────────────────────
  private async renderLocation(): Promise<void> {
    const locs = await loadLocationsForGame();
    const fakeNode: WorldNode = { id: this.nodeId, label: this.label, x: 0, y: 0, type: 'location', locationId: this.locationId };
    const doc = locationForNode(fakeNode, locs);
    if (!this.scene.isActive()) return;
    if (doc && (doc.bg || doc.placed.length)) await this.renderDoc(doc);
    else this.renderPlaceholder();
  }

  // Рендер LocationDoc: та сама система координат, що в Редакторі Локацій
  // (центр полотна = світова (0,0); фон — верхнім лівим кутом у (0,0)).
  private async renderDoc(doc: LocationDoc): Promise<void> {
    // Вписуємо: bbox фону (якщо є) або розставлених ассетів.
    let minX = -400, minY = -220, maxX = 400, maxY = 220;
    const bgKey = 'locbg_' + doc.id;
    let bgW = 0, bgH = 0;
    if (doc.bg) {
      if (!this.textures.exists(bgKey)) {
        await new Promise<void>((res) => {
          this.textures.once('addtexture-' + bgKey, () => res());
          this.textures.addBase64(bgKey, doc.bg);
        });
      }
      if (!this.scene.isActive()) return;
      const src = this.textures.get(bgKey).getSourceImage() as HTMLImageElement;
      bgW = src.width; bgH = src.height;
      minX = 0; minY = 0; maxX = bgW; maxY = bgH;
    } else if (doc.placed.length) {
      minX = Infinity; minY = Infinity; maxX = -Infinity; maxY = -Infinity;
      for (const p of doc.placed) {
        minX = Math.min(minX, p.x - 150); maxX = Math.max(maxX, p.x + 150);
        minY = Math.min(minY, p.y - 150); maxY = Math.max(maxY, p.y + 150);
      }
    }
    const availW = LOGICAL_W - 80, availH = LOGICAL_H - 210; // низ — під слоти Хоругви
    const s = Math.min(availW / (maxX - minX), availH / (maxY - minY));
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    const ox = LOGICAL_W / 2 - cx * s + this.offX;
    const oy = (LOGICAL_H / 2 - 30) - cy * s + this.offY;

    if (doc.bg) {
      this.add.image(ox, oy, bgKey).setOrigin(0, 0).setScale(s).setScrollFactor(0).setDepth(1);
    }
    // Розставлені будівлі/ассети
    for (const p of doc.placed) {
      const key = 'locp_' + doc.id + '_' + p.id;
      if (!this.textures.exists(key)) {
        await new Promise<void>((res) => {
          this.textures.once('addtexture-' + key, () => res());
          this.textures.addBase64(key, p.url);
        });
      }
      if (!this.scene.isActive()) return;
      this.add.image(ox + p.x * s, oy + p.y * s, key)
        .setScale(p.scale * s * (p.flip < 0 ? -1 : 1), p.scale * s)
        .setAngle(p.rot)
        .setScrollFactor(0).setDepth(2);
    }
  }

  // Заглушка: «земля» + пара білих кубів-будівель, поки локацію не зібрано в редакторі.
  private renderPlaceholder(): void {
    const g = this.add.graphics().setScrollFactor(0).setDepth(1);
    const groundY = LOGICAL_H - 210 + this.offY;
    g.fillStyle(0x241e2c, 1);
    g.fillRect(this.offX, groundY, LOGICAL_W, 90);
    g.lineStyle(2, 0x3a3346, 1);
    g.lineBetween(this.offX, groundY, this.offX + LOGICAL_W, groundY);
    // два куби різного розміру
    const cube = (x: number, w: number, h: number): void => {
      g.fillStyle(0xf2efe8, 1);
      g.fillRect(x + this.offX, groundY - h, w, h);
      g.lineStyle(2, 0x141118, 1);
      g.strokeRect(x + this.offX, groundY - h, w, h);
    };
    cube(LOGICAL_W / 2 - 190, 150, 130);
    cube(LOGICAL_W / 2 + 60, 110, 95);
    this.add.text(LOGICAL_W / 2 + this.offX, groundY - 165, 'Локацію ще не зібрано — Редактор Локацій у studio', {
      fontFamily: MENU_FONT, fontSize: '16px', color: '#8a8171',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(2);
  }

  // ── Слоти Хоругви (5) ──────────────────────────────────────────────────────
  private setupPresence(): void {
    if (this.nodeId) enterLocation(this.nodeId);
    this.drawSlots([]); // одразу порожні рамки, себе домалює presence-снапшот
    if (this.nodeId) {
      this.unwatch = watchLocationPresence(this.nodeId, (list) => {
        if (this.scene.isActive()) this.drawSlots(list);
      });
    }
    void loadCharLibrary().then((l) => { this.lib = l; });
  }

  private drawSlots(list: PresenceEntry[]): void {
    for (const o of this.slotObjs) o.destroy();
    this.slotObjs = [];
    const myId = getPlayerId();
    // я — завжди в першому слоті; решта за часом заходу
    const others = list.filter((p) => p.id !== myId).slice(0, 4);
    const me = list.find((p) => p.id === myId) ?? { id: myId, name: 'Я', charId: '', t: 0 };
    const entries: (PresenceEntry | null)[] = [me, ...others];
    while (entries.length < 5) entries.push(null);

    const SLOT = 86, GAP = 14;
    const total = 5 * SLOT + 4 * GAP;
    const x0 = (LOGICAL_W - total) / 2 + this.offX;
    const y = LOGICAL_H - 96 + this.offY;

    const cap = this.add.text(LOGICAL_W / 2 + this.offX, y - 14, 'Хоругва', {
      fontFamily: MENU_FONT, fontStyle: 'small-caps', fontSize: '18px', color: '#8a8171',
    }).setOrigin(0.5, 1).setScrollFactor(0).setDepth(20);
    this.slotObjs.push(cap);

    entries.forEach((p, i) => {
      const x = x0 + i * (SLOT + GAP);
      const g = this.add.graphics().setScrollFactor(0).setDepth(20);
      g.fillStyle(0x1d1826, p ? 0.95 : 0.6);
      g.fillRoundedRect(x, y, SLOT, SLOT, 8);
      g.lineStyle(2, p ? 0xcbb98a : 0x3a3346, 1);
      g.strokeRoundedRect(x, y, SLOT, SLOT, 8);
      this.slotObjs.push(g);
      if (!p) return;

      // Портрет: thumb персонажа з бібліотеки, або ініціал.
      const item = p.charId ? this.lib.find((l) => l.id === p.charId) : undefined;
      if (item?.thumb) {
        const key = 'pth_' + item.id;
        const place = (): void => {
          if (!this.scene.isActive()) return;
          const im = this.add.image(x + SLOT / 2, y + SLOT / 2, key).setScrollFactor(0).setDepth(21);
          const sc = Math.min((SLOT - 8) / im.width, (SLOT - 8) / im.height);
          im.setScale(sc);
          this.slotObjs.push(im);
        };
        if (this.textures.exists(key)) place();
        else { this.textures.once('addtexture-' + key, place); this.textures.addBase64(key, item.thumb); }
      } else {
        const init = this.add.text(x + SLOT / 2, y + SLOT / 2 - 6, (p.name || '?').slice(0, 1).toUpperCase(), {
          fontFamily: MENU_FONT, fontSize: '34px', color: COL_TEXT,
        }).setOrigin(0.5).setScrollFactor(0).setDepth(21);
        this.slotObjs.push(init);
      }
      const nm = this.add.text(x + SLOT / 2, y + SLOT - 4, p.id === myId ? 'ти' : p.name, {
        fontFamily: MENU_FONT, fontSize: '13px', color: p.id === myId ? '#ffcf8f' : COL_TEXT,
      }).setOrigin(0.5, 1).setScrollFactor(0).setDepth(22).setShadow(1, 1, '#000', 4, false, true);
      this.slotObjs.push(nm);
    });
  }
}
