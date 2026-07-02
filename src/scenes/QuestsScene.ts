import Phaser from 'phaser';
import { LOGICAL_W, LOGICAL_H } from '../config';
import { setupMenuCamera, addTitle, addBack } from './menuTheme';

// «Завдання» — заглушка: дерев'яна дошка оголошень на стіні хатини з порожніми
// пришпиленими нотатками. Малюється процедурно (Canvas-графіка), без ассетів.
// Пізніше нотатки стануть реальними завданнями/контрактами.
export class QuestsScene extends Phaser.Scene {
  constructor() { super('Quests'); }

  create(): void {
    const f = setupMenuCamera(this, '#141017');
    const g = this.add.graphics().setScrollFactor(0);

    // Стіна (тепла глина в тінях, легкий градієнт від центру)
    g.fillStyle(0x241b16, 1); g.fillRect(f.offX, f.offY, LOGICAL_W, LOGICAL_H);
    g.fillStyle(0x2e231b, 1); g.fillRect(f.offX, f.offY + LOGICAL_H * 0.12, LOGICAL_W, LOGICAL_H * 0.55);

    // Дошка: рама + полотно
    const bw = 720, bh = 360;
    const bx = f.cx - bw / 2, by = 130 + f.offY;
    g.fillStyle(0x120d09, 0.6); g.fillRect(bx + 10, by + 12, bw, bh); // тінь
    g.fillStyle(0x4a3524, 1); g.fillRect(bx - 16, by - 16, bw + 32, bh + 32); // рама
    g.fillStyle(0x2b1f16, 1); g.fillRect(bx, by, bw, bh);                     // полотно
    // прожилки дощок
    g.lineStyle(2, 0x241a12, 1);
    for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo(bx, by + (bh / 4) * i); g.lineTo(bx + bw, by + (bh / 4) * i); g.strokePath(); }

    // Порожні нотатки-папірці (пергамент), пришпилені, з легким перекосом
    const notes = [
      { x: 90,  y: 44,  w: 150, h: 120, r: -0.05 },
      { x: 300, y: 70,  w: 130, h: 100, r: 0.04 },
      { x: 500, y: 40,  w: 150, h: 130, r: -0.02 },
      { x: 160, y: 205, w: 140, h: 110, r: 0.06 },
      { x: 420, y: 215, w: 160, h: 105, r: -0.04 },
    ];
    for (const n of notes) {
      const cont = this.add.container(bx + n.x + n.w / 2, by + n.y + n.h / 2).setScrollFactor(0).setRotation(n.r);
      const ng = this.add.graphics();
      ng.fillStyle(0x0c0906, 0.5); ng.fillRect(-n.w / 2 + 4, -n.h / 2 + 5, n.w, n.h); // тінь
      ng.fillStyle(0xd8c9a3, 1); ng.fillRect(-n.w / 2, -n.h / 2, n.w, n.h);            // папірець
      ng.fillStyle(0xc4b28c, 1); ng.fillRect(-n.w / 2, -n.h / 2, n.w, 8);              // затерта смуга
      // порожні «рядки» замість тексту
      ng.lineStyle(2, 0xb3a17c, 1);
      const lines = Math.floor((n.h - 34) / 18);
      for (let i = 0; i < lines; i++) {
        const ly = -n.h / 2 + 24 + i * 18;
        ng.beginPath(); ng.moveTo(-n.w / 2 + 12, ly); ng.lineTo(n.w / 2 - 12 - (i % 2) * 22, ly); ng.strokePath();
      }
      // шпилька
      ng.fillStyle(0x1a1410, 1); ng.fillCircle(0, -n.h / 2 + 6, 4);
      ng.fillStyle(0x6b5138, 1); ng.fillCircle(-1, -n.h / 2 + 5, 2);
      cont.add(ng);
    }

    addTitle(this, f, 'ЗАВДАННЯ');
    addBack(this, f);
  }
}
