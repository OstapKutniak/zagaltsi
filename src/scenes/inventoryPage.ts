import Phaser from 'phaser';
import { LOGICAL_W } from '../config';
import type { CutoutCharacter } from '../anim/CutoutCharacter';
import {
  CATALOG, SLOT_LABELS, SLOT_ORDER, type EquipState, type InvItem,
  loadEquip, saveEquip, itemIconTexture,
} from '../inventory';

// Модуль «сторінки Інвентар»: слоти спорядження праворуч + смуга речей знизу.
// Живе поверх спільної сцени-хатини (MenuScene) — будується/зноситься при
// реальночасному переході між сторінками меню. Вдягання застосовується до
// персонажа через getChar() (білі силуети-плейсхолдери).

const FONT = 'Georgia, "Times New Roman", serif';
const COL_TEXT = '#e5d8bc';
const COL_GOLD = 0xcbb98a;
const SLOTS_X = 1185, SLOTS_Y0 = 128, SLOT_SIZE = 68, SLOT_GAP = 22;
const STRIP_Y = 536, CELL = 56, CELL_GAP = 12;

export class InventoryPage {
  private ui: Phaser.GameObjects.GameObject[] = [];
  private equip: EquipState = {};

  constructor(
    private scene: Phaser.Scene,
    private offX: number,
    private offY: number,
    private getChar: () => CutoutCharacter | null,
  ) {}

  build(): void {
    this.equip = loadEquip();
    this.applyEquip();
    this.draw();
  }

  teardown(): void {
    for (const o of this.ui) o.destroy();
    this.ui = [];
    this.getChar()?.setEquipment({}); // роздягнути — на інших сторінках без спорядження
  }

  private applyEquip(): void {
    this.getChar()?.setEquipment({
      pants: !!this.equip.pants, armor: !!this.equip.armor,
      helmet: !!this.equip.helmet, weapon: !!this.equip.weapon,
    });
  }

  private toggle(item: InvItem): void {
    this.equip[item.slot] = this.equip[item.slot] === item.id ? null : item.id;
    saveEquip(this.equip);
    this.applyEquip();
    this.draw();
  }

  private draw(): void {
    for (const o of this.ui) o.destroy();
    this.ui = [];
    const s = this.scene, offX = this.offX, offY = this.offY;
    const add = <T extends Phaser.GameObjects.GameObject>(o: T): T => { this.ui.push(o); return o; };

    // ── Слоти спорядження (колонка праворуч) ──────────────────────────────────
    for (let i = 0; i < SLOT_ORDER.length; i++) {
      const slot = SLOT_ORDER[i];
      const y = SLOTS_Y0 + i * (SLOT_SIZE + SLOT_GAP) + offY;
      const x = SLOTS_X + offX;
      const equippedId = this.equip[slot];
      const item = equippedId ? CATALOG.find((it) => it.id === equippedId) ?? null : null;

      const g = add(s.add.graphics().setScrollFactor(0).setDepth(20));
      g.fillStyle(0x14101a, item ? 0.92 : 0.6);
      g.fillRoundedRect(x - SLOT_SIZE / 2, y - SLOT_SIZE / 2, SLOT_SIZE, SLOT_SIZE, 9);
      g.lineStyle(2, item ? COL_GOLD : 0x3a3346, 1);
      g.strokeRoundedRect(x - SLOT_SIZE / 2, y - SLOT_SIZE / 2, SLOT_SIZE, SLOT_SIZE, 9);

      if (item) {
        add(s.add.image(x, y, itemIconTexture(s, item)).setScrollFactor(0).setDepth(21).setScale(0.8));
      }
      add(s.add.text(x, y + SLOT_SIZE / 2 + 4, SLOT_LABELS[slot], {
        fontFamily: FONT, fontSize: '14px', fontStyle: 'small-caps', color: item ? COL_TEXT : '#8a8171',
      }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(21).setShadow(1, 1, '#000', 4, false, true));

      if (item) {
        const zone = add(s.add.rectangle(x, y, SLOT_SIZE, SLOT_SIZE, 0, 0)
          .setScrollFactor(0).setDepth(22).setInteractive({ useHandCursor: true }));
        zone.on('pointerup', () => this.toggle(item));
      }
    }

    // ── Смуга речей знизу ─────────────────────────────────────────────────────
    const total = CATALOG.length * CELL + (CATALOG.length - 1) * CELL_GAP;
    const x0 = LOGICAL_W / 2 - total / 2 + offX;
    const stripY = STRIP_Y + offY;
    add(s.add.text(LOGICAL_W / 2 + offX, stripY - CELL / 2 - 6, 'Речі', {
      fontFamily: FONT, fontSize: '15px', fontStyle: 'small-caps', color: '#8a8171',
    }).setOrigin(0.5, 1).setScrollFactor(0).setDepth(20).setShadow(1, 1, '#000', 4, false, true));

    const hint = add(s.add.text(LOGICAL_W / 2 + offX, stripY + CELL / 2 + 6, '', {
      fontFamily: FONT, fontSize: '14px', fontStyle: 'italic', color: COL_TEXT,
    }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(21).setAlpha(0).setShadow(1, 1, '#000', 4, false, true));

    CATALOG.forEach((item, i) => {
      const x = x0 + i * (CELL + CELL_GAP) + CELL / 2;
      const equipped = this.equip[item.slot] === item.id;
      const g = add(s.add.graphics().setScrollFactor(0).setDepth(20));
      g.fillStyle(0x14101a, 0.88);
      g.fillRoundedRect(x - CELL / 2, stripY - CELL / 2, CELL, CELL, 8);
      g.lineStyle(2, equipped ? COL_GOLD : 0x3a3346, 1);
      g.strokeRoundedRect(x - CELL / 2, stripY - CELL / 2, CELL, CELL, 8);
      add(s.add.image(x, stripY, itemIconTexture(s, item))
        .setScrollFactor(0).setDepth(21).setScale(0.66).setAlpha(equipped ? 1 : 0.75));

      const zone = add(s.add.rectangle(x, stripY, CELL, CELL, 0, 0)
        .setScrollFactor(0).setDepth(22).setInteractive({ useHandCursor: true }));
      zone.on('pointerover', () => { hint.setText(item.name + (equipped ? ' · зняти' : ' · вдягнути')); hint.setAlpha(1); });
      zone.on('pointerout', () => hint.setAlpha(0));
      zone.on('pointerup', () => this.toggle(item));
    });
  }
}
