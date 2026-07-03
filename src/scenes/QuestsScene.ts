import Phaser from 'phaser';
import { LOGICAL_W, LOGICAL_H } from '../config';
import { setupMenuCamera, addTitle, addBack, MENU_FONT } from './menuTheme';
import { loadQuests, type Quest } from '../story/quests';
import { takenQuests } from '../story/questState';

// «Завдання» — дерев'яна дошка на стіні з пришпиленими нотатками-квестами
// (з Редактора Історії → панель «Квести»). Головні квести — з ★. Тап по нотатці
// розгортає повний текст. Нема квестів — порожні папірці-заглушки.
const NOTE_POS = [
  { x: 90,  y: 44,  w: 150, h: 120, r: -0.05 },
  { x: 300, y: 70,  w: 130, h: 100, r: 0.04 },
  { x: 500, y: 40,  w: 150, h: 130, r: -0.02 },
  { x: 160, y: 205, w: 140, h: 110, r: 0.06 },
  { x: 420, y: 215, w: 160, h: 105, r: -0.04 },
];

export class QuestsScene extends Phaser.Scene {
  private overlay: Phaser.GameObjects.Container | null = null;

  constructor() { super('Quests'); }

  create(): void {
    const f = setupMenuCamera(this, '#141017');
    this.overlay = null;
    const g = this.add.graphics().setScrollFactor(0);

    // Стіна
    g.fillStyle(0x241b16, 1); g.fillRect(f.offX, f.offY, LOGICAL_W, LOGICAL_H);
    g.fillStyle(0x2e231b, 1); g.fillRect(f.offX, f.offY + LOGICAL_H * 0.12, LOGICAL_W, LOGICAL_H * 0.55);

    // Дошка
    const bw = 720, bh = 360;
    const bx = f.cx - bw / 2, by = 130 + f.offY;
    g.fillStyle(0x120d09, 0.6); g.fillRect(bx + 10, by + 12, bw, bh);
    g.fillStyle(0x4a3524, 1); g.fillRect(bx - 16, by - 16, bw + 32, bh + 32);
    g.fillStyle(0x2b1f16, 1); g.fillRect(bx, by, bw, bh);
    g.lineStyle(2, 0x241a12, 1);
    for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo(bx, by + (bh / 4) * i); g.lineTo(bx + bw, by + (bh / 4) * i); g.strokePath(); }

    addTitle(this, f, 'ЗАВДАННЯ');
    addBack(this, f);

    void loadQuests().then((store) => {
      if (!this.scene.isActive()) return;
      // На дошці — лише ВЗЯТІ квести (енкаунтери/НПС видають), головні першими.
      // Квест без giver вважаємо «одразу відомим» (авторський, видимий без видачі).
      const taken = takenQuests();
      const quests = store.quests
        .filter((q) => !q.giver || taken[q.id])
        .sort((a, b) => (a.cat === 'main' ? -1 : 1) - (b.cat === 'main' ? -1 : 1));
      NOTE_POS.forEach((n, i) => this.drawNote(bx, by, n, quests[i] ?? null));
    });
  }

  private drawNote(bx: number, by: number, n: typeof NOTE_POS[number], q: Quest | null): void {
    const cont = this.add.container(bx + n.x + n.w / 2, by + n.y + n.h / 2).setScrollFactor(0).setRotation(n.r);
    const ng = this.add.graphics();
    ng.fillStyle(0x0c0906, 0.5); ng.fillRect(-n.w / 2 + 4, -n.h / 2 + 5, n.w, n.h);
    ng.fillStyle(q ? 0xe4d6b0 : 0xd8c9a3, 1); ng.fillRect(-n.w / 2, -n.h / 2, n.w, n.h);
    ng.fillStyle(0xc4b28c, 1); ng.fillRect(-n.w / 2, -n.h / 2, n.w, 8);
    cont.add(ng);

    if (q) {
      const title = this.add.text(0, -n.h / 2 + 16, (q.cat === 'main' ? '★ ' : '') + q.title, {
        fontFamily: MENU_FONT, fontStyle: 'small-caps', fontSize: '15px', color: '#2b2115',
        wordWrap: { width: n.w - 20 }, align: 'center',
      }).setOrigin(0.5, 0);
      cont.add(title);
      // коротка витримка з тексту
      if (q.text) {
        const teaser = this.add.text(0, 8, q.text.length > 60 ? q.text.slice(0, 60) + '…' : q.text, {
          fontFamily: MENU_FONT, fontSize: '11px', color: '#4a3b28',
          wordWrap: { width: n.w - 20 }, align: 'center',
        }).setOrigin(0.5, 0);
        cont.add(teaser);
      }
      // Хіт-зона контейнера: явний прямокутник навколо центру (setSize сам по собі
      // дає зміщену зону в контейнерів)
      cont.setInteractive(new Phaser.Geom.Rectangle(-n.w / 2, -n.h / 2, n.w, n.h), Phaser.Geom.Rectangle.Contains);
      cont.on('pointerup', () => this.openQuest(q));
    } else {
      // порожні «рядки»
      ng.lineStyle(2, 0xb3a17c, 1);
      const lines = Math.floor((n.h - 34) / 18);
      for (let i = 0; i < lines; i++) {
        const ly = -n.h / 2 + 24 + i * 18;
        ng.beginPath(); ng.moveTo(-n.w / 2 + 12, ly); ng.lineTo(n.w / 2 - 12 - (i % 2) * 22, ly); ng.strokePath();
      }
    }
    // шпилька
    const pin = this.add.graphics();
    pin.fillStyle(0x1a1410, 1); pin.fillCircle(0, -n.h / 2 + 6, 4);
    pin.fillStyle(0x6b5138, 1); pin.fillCircle(-1, -n.h / 2 + 5, 2);
    cont.add(pin);
  }

  // Розгорнутий квест — велика нотатка поверх дошки.
  private openQuest(q: Quest): void {
    this.overlay?.destroy(true);
    const cx = this.cameras.main.width / 2, cy = this.cameras.main.height / 2;
    const w = 520, h = 340;
    const c = this.add.container(cx, cy).setScrollFactor(0).setDepth(100);
    const g = this.add.graphics();
    g.fillStyle(0x000000, 0.55); g.fillRect(-this.cameras.main.width / 2, -this.cameras.main.height / 2, this.cameras.main.width, this.cameras.main.height);
    g.fillStyle(0x0c0906, 0.6); g.fillRect(-w / 2 + 8, -h / 2 + 9, w, h);
    g.fillStyle(0xe4d6b0, 1); g.fillRect(-w / 2, -h / 2, w, h);
    g.fillStyle(0xc4b28c, 1); g.fillRect(-w / 2, -h / 2, w, 10);
    c.add(g);
    c.add(this.add.text(0, -h / 2 + 30, (q.cat === 'main' ? '★ ' : '') + q.title, {
      fontFamily: MENU_FONT, fontStyle: 'small-caps', fontSize: '26px', color: '#2b2115',
      wordWrap: { width: w - 60 }, align: 'center',
    }).setOrigin(0.5, 0));
    c.add(this.add.text(0, -h / 2 + 76, q.text || '(без опису)', {
      fontFamily: MENU_FONT, fontSize: '17px', color: '#3a2e1e', lineSpacing: 5,
      wordWrap: { width: w - 60 },
    }).setOrigin(0.5, 0));
    const closeZone = this.add.zone(0, 0, this.cameras.main.width, this.cameras.main.height).setInteractive();
    closeZone.on('pointerup', () => { c.destroy(true); this.overlay = null; });
    c.add(closeZone);
    this.overlay = c;
  }
}
