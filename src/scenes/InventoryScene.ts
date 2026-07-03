import Phaser from 'phaser';
import { LOGICAL_W, LOGICAL_H } from '../config';
import { MenuScene } from './MenuScene';
import type { CutoutCharacter } from '../anim/CutoutCharacter';
import {
  CATALOG, SLOT_LABELS, SLOT_ORDER, type EquipSlot, type EquipState, type InvItem,
  loadEquip, saveEquip, itemIconTexture,
} from '../inventory';

// Сторінка «Інвентар» — та сама хатина (успадковує Житло: фон/вогонь/шторм/кнопки),
// але персонаж ВСТАВ з лавки і стоїть в айдлі праворуч від вогнища. Праворуч,
// на темній частині кадру — слоти спорядження (шолом/обладунок/штани/зброя/аксесуар),
// знизу — смуга речей, що в нас є. Клік по речі — вдягнути/зняти; вдягнене видно
// на персонажі білими силуетами (плейсхолдери, поки нема арту речей).

const FONT = 'Georgia, "Times New Roman", serif';
const COL_TEXT = '#e5d8bc';
const COL_GOLD = 0xcbb98a;

// Колонка слотів (логічні координати кадру 1280×576) — на чорному полі праворуч.
const SLOTS_X = 1185;
const SLOTS_Y0 = 128;
const SLOT_SIZE = 68;
const SLOT_GAP = 22;
// Смуга речей знизу.
const STRIP_Y = 536;
const CELL = 56;
const CELL_GAP = 12;

export class InventoryScene extends MenuScene {
  private equip: EquipState = {};
  private ui: Phaser.GameObjects.GameObject[] = [];
  private uiOff = { x: 0, y: 0 };

  constructor() { super('Inventory'); }

  protected pageTitle(): string { return 'ІНВЕНТАР'; }

  // Встав з лавки: айдл, трохи правіше сидячої позиції, ступні на підлозі.
  protected charSetup(): { anim: string; x: number; y: number; scale: number; feetY?: number } {
    const C = this.fx.char;
    return { anim: 'idle', x: C.x + 55, y: C.y, scale: C.scale, feetY: 522 };
  }

  protected onCharReady(char: CutoutCharacter): void {
    this.applyEquip(char);
  }

  protected afterBuild(offX: number, offY: number): void {
    this.equip = loadEquip();
    this.uiOff = { x: offX, y: offY };
    this.drawUI(offX, offY);
  }

  private applyEquip(char: CutoutCharacter | null = this.lobbyChar): void {
    char?.setEquipment({
      pants: !!this.equip.pants,
      armor: !!this.equip.armor,
      helmet: !!this.equip.helmet,
      weapon: !!this.equip.weapon,
    });
  }

  private toggle(item: InvItem): void {
    this.equip[item.slot] = this.equip[item.slot] === item.id ? null : item.id;
    saveEquip(this.equip);
    this.applyEquip();
    this.drawUI(this.uiOff.x, this.uiOff.y);
  }

  private drawUI(offX: number, offY: number): void {
    for (const o of this.ui) o.destroy();
    this.ui = [];
    const add = <T extends Phaser.GameObjects.GameObject>(o: T): T => { this.ui.push(o); return o; };

    // ── Слоти спорядження (колонка праворуч) ──────────────────────────────────
    for (let i = 0; i < SLOT_ORDER.length; i++) {
      const slot = SLOT_ORDER[i];
      const y = SLOTS_Y0 + i * (SLOT_SIZE + SLOT_GAP) + offY;
      const x = SLOTS_X + offX;
      const equippedId = this.equip[slot];
      const item = equippedId ? CATALOG.find((it) => it.id === equippedId) ?? null : null;

      const g = add(this.add.graphics().setScrollFactor(0).setDepth(20));
      g.fillStyle(0x14101a, item ? 0.92 : 0.6);
      g.fillRoundedRect(x - SLOT_SIZE / 2, y - SLOT_SIZE / 2, SLOT_SIZE, SLOT_SIZE, 9);
      g.lineStyle(2, item ? COL_GOLD : 0x3a3346, 1);
      g.strokeRoundedRect(x - SLOT_SIZE / 2, y - SLOT_SIZE / 2, SLOT_SIZE, SLOT_SIZE, 9);

      if (item) {
        add(this.add.image(x, y, itemIconTexture(this, item)).setScrollFactor(0).setDepth(21).setScale(0.8));
      }
      add(this.add.text(x, y + SLOT_SIZE / 2 + 4, SLOT_LABELS[slot], {
        fontFamily: FONT, fontSize: '14px', fontStyle: 'small-caps', color: item ? COL_TEXT : '#8a8171',
      }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(21).setShadow(1, 1, '#000', 4, false, true));

      // Клік по зайнятому слоту — зняти річ.
      if (item) {
        const zone = add(this.add.rectangle(x, y, SLOT_SIZE, SLOT_SIZE, 0, 0)
          .setScrollFactor(0).setDepth(22).setInteractive({ useHandCursor: true }));
        zone.on('pointerup', () => this.toggle(item));
      }
    }

    // ── Смуга речей знизу ─────────────────────────────────────────────────────
    const total = CATALOG.length * CELL + (CATALOG.length - 1) * CELL_GAP;
    const x0 = LOGICAL_W / 2 - total / 2 + offX;
    const stripY = STRIP_Y + offY;
    add(this.add.text(LOGICAL_W / 2 + offX, stripY - CELL / 2 - 6, 'Речі', {
      fontFamily: FONT, fontSize: '15px', fontStyle: 'small-caps', color: '#8a8171',
    }).setOrigin(0.5, 1).setScrollFactor(0).setDepth(20).setShadow(1, 1, '#000', 4, false, true));

    CATALOG.forEach((item, i) => {
      const x = x0 + i * (CELL + CELL_GAP) + CELL / 2;
      const equipped = this.equip[item.slot] === item.id;
      const g = add(this.add.graphics().setScrollFactor(0).setDepth(20));
      g.fillStyle(0x14101a, 0.88);
      g.fillRoundedRect(x - CELL / 2, stripY - CELL / 2, CELL, CELL, 8);
      g.lineStyle(2, equipped ? COL_GOLD : 0x3a3346, 1);
      g.strokeRoundedRect(x - CELL / 2, stripY - CELL / 2, CELL, CELL, 8);
      add(this.add.image(x, stripY, itemIconTexture(this, item))
        .setScrollFactor(0).setDepth(21).setScale(0.66).setAlpha(equipped ? 1 : 0.75));

      const zone = add(this.add.rectangle(x, stripY, CELL, CELL, 0, 0)
        .setScrollFactor(0).setDepth(22).setInteractive({ useHandCursor: true }));
      zone.on('pointerover', () => { hint.setText(item.name + (equipped ? ' · зняти' : ' · вдягнути')); hint.setAlpha(1); });
      zone.on('pointerout', () => hint.setAlpha(0));
      zone.on('pointerup', () => this.toggle(item));
    });
    // Підказка над смугою (назва речі під курсором/пальцем).
    const hint = this.add.text(LOGICAL_W / 2 + offX, stripY + CELL / 2 + 6, '', {
      fontFamily: FONT, fontSize: '14px', fontStyle: 'italic', color: COL_TEXT,
    }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(21).setAlpha(0).setShadow(1, 1, '#000', 4, false, true);
    this.ui.push(hint);
  }
}
