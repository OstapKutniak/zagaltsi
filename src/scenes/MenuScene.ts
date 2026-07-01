import Phaser from 'phaser';
import { LOGICAL_W, LOGICAL_H, RENDER_SCALE } from '../config';
import { makeTextButton, hideLoadScreen } from './uiButton';
import { showLobby } from '../multiplayer/lobbyUI';

// Дефолтне головне меню гри (поки без оформлення). Кнопки-розділи:
// Житло / Подорожі / Досягнення / Персонаж. «Подорожі» веде в наявний
// ігровий рівень (бітемап); решта — у сцену-заглушку 'Section' (оформимо пізніше).
const ITEMS: { label: string; target: string }[] = [
  { label: 'Житло',      target: 'Home' },
  { label: 'Подорожі',   target: 'Game' },       // наявна ігрова сцена
  { label: 'Досягнення', target: 'Achievements' },
  { label: 'Персонаж',   target: 'Character' },
];

export class MenuScene extends Phaser.Scene {
  constructor() { super('Menu'); }

  create(): void {
    hideLoadScreen(); // меню — перша видима сцена, знімаємо HTML-оверлей завантаження
    const cam = this.cameras.main;
    // Той самий трюк, що в GameScene: backing×RENDER_SCALE + zoom = поле огляду
    // LOGICAL_W×LOGICAL_H, але різкіше. Статичний UI зсуваємо на uiOff.
    cam.setZoom(RENDER_SCALE);
    cam.setBackgroundColor('#1a1622');
    const offX = LOGICAL_W * (RENDER_SCALE - 1) / 2;
    const offY = LOGICAL_H * (RENDER_SCALE - 1) / 2;
    const cx = LOGICAL_W / 2 + offX;

    this.add.text(cx, 96 + offY, 'ХОРУГВА', {
      fontFamily: 'system-ui, sans-serif',
      fontSize: '52px',
      color: '#e8e0d0',
    }).setOrigin(0.5).setScrollFactor(0);

    const startY = 200, gap = 74;
    ITEMS.forEach((it, i) => {
      makeTextButton(this, cx, startY + i * gap + offY, it.label, () => {
        if (it.target === 'Game') {
          // Подорожі: показуємо лобі (соло / збір Хоругви), далі GameScene
          // чекає на подію 'lobbyStart' і починає гру з обраним кодом.
          showLobby();
          this.scene.start('Game');
        } else {
          this.scene.start('Section', { title: it.label, from: 'Menu' });
        }
      });
    });
  }
}
