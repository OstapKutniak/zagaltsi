import Phaser from 'phaser';
import { LOGICAL_W } from '../config';
import { setupMenuCamera, addTitle, addBack, MENU_FONT, COL_IDLE } from './menuTheme';
import { listPlayers } from '../players';

// «Досягнення» — заглушка: список усіх гравців, що відкривали гру (реєстр у Firebase),
// навпроти кожного поки нулі. Реєстр наповнюється з моменту релізу реєстрації.
export class AchievementsScene extends Phaser.Scene {
  constructor() { super('Achievements'); }

  create(): void {
    const f = setupMenuCamera(this, '#141017');
    addTitle(this, f, 'ДОСЯГНЕННЯ');
    addBack(this, f);

    const loading = this.add.text(f.cx, 200 + f.offY, 'Гортаємо літопис…', {
      fontFamily: MENU_FONT, fontSize: '22px', color: '#8a8496',
    }).setOrigin(0.5).setScrollFactor(0);

    void listPlayers().then((players) => {
      if (!this.scene.isActive()) return;
      loading.destroy();
      if (!players.length) {
        this.add.text(f.cx, 200 + f.offY, 'Літопис поки порожній', {
          fontFamily: MENU_FONT, fontSize: '22px', color: '#8a8496',
        }).setOrigin(0.5).setScrollFactor(0);
        return;
      }
      const x0 = LOGICAL_W / 2 - 260 + f.offX;
      const x1 = LOGICAL_W / 2 + 260 + f.offX;
      players.slice(0, 8).forEach((p, i) => {
        const y = 150 + i * 46 + f.offY;
        const nick = p.username ? '@' + p.username : p.name;
        this.add.text(x0, y, nick, {
          fontFamily: MENU_FONT, fontStyle: 'small-caps', fontSize: '26px', color: COL_IDLE,
        }).setOrigin(0, 0.5).setScrollFactor(0).setShadow(2, 2, '#000000', 5, false, true);
        this.add.text(x1, y, '0', {
          fontFamily: MENU_FONT, fontSize: '26px', color: '#9a8f78',
        }).setOrigin(1, 0.5).setScrollFactor(0);
        // тонка розділка-пунктир
        const g = this.add.graphics().setScrollFactor(0);
        g.lineStyle(1, 0x3a3040, 1);
        g.beginPath(); g.moveTo(x0, y + 20); g.lineTo(x1, y + 20); g.strokePath();
      });
    });
  }
}
