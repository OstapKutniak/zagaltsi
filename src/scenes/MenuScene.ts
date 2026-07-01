import Phaser from 'phaser';
import { LOGICAL_W, LOGICAL_H, RENDER_SCALE } from '../config';
import { hideLoadScreen } from './uiButton';
import { showLobby } from '../multiplayer/lobbyUI';

// Дефолтне головне меню гри. Фон — хатина з багаттям (menu/home.png). Кнопки-розділи
// зліва, без обводок, серифним шрифтом, підсвічуються при наведенні. «Подорожі» веде
// в наявний ігровий рівень (через лобі); решта — у сцену-заглушку 'Section'.
const ITEMS: { label: string; target: string }[] = [
  { label: 'Житло',      target: 'Home' },
  { label: 'Подорожі',   target: 'Game' },
  { label: 'Досягнення', target: 'Achievements' },
  { label: 'Персонаж',   target: 'Character' },
];

// Серифний стек — «старіший» вигляд у стиль; згодом можна замінити на кастомний шрифт.
const MENU_FONT = 'Georgia, "Times New Roman", serif';
const COL_IDLE = '#cdbfa2';  // приглушений пергамент
const COL_HOVER = '#ffcf8f'; // теплий відсвіт багаття

export class MenuScene extends Phaser.Scene {
  constructor() { super('Menu'); }

  create(): void {
    hideLoadScreen(); // меню — перша видима сцена, знімаємо HTML-оверлей завантаження
    const cam = this.cameras.main;
    cam.setZoom(RENDER_SCALE);
    cam.setBackgroundColor('#0b0a0d');
    const offX = LOGICAL_W * (RENDER_SCALE - 1) / 2;
    const offY = LOGICAL_H * (RENDER_SCALE - 1) / 2;

    // Фон-хатина: масштаб «cover» (заповнює весь кадр, надлишок обрізається).
    const bg = this.add.image(LOGICAL_W / 2 + offX, LOGICAL_H / 2 + offY, 'menu_home')
      .setScrollFactor(0);
    const cover = Math.max(LOGICAL_W / bg.width, LOGICAL_H / bg.height);
    bg.setScale(cover);

    // Лівий скрим для читабельності тексту (темніше зліва → прозоро праворуч).
    const scrim = this.add.graphics().setScrollFactor(0);
    scrim.fillGradientStyle(0x000000, 0x000000, 0x000000, 0x000000, 0.62, 0, 0.62, 0);
    scrim.fillRect(offX, offY, LOGICAL_W * 0.5, LOGICAL_H);

    const x = 84 + offX;
    this.add.text(x, 74 + offY, 'ХОРУГВА', {
      fontFamily: MENU_FONT, fontSize: '46px', color: '#e9dcc0',
    }).setOrigin(0, 0.5).setScrollFactor(0).setShadow(2, 3, '#000000', 6, false, true);

    const startY = 176, gap = 66;
    ITEMS.forEach((it, i) => {
      this.makeMenuItem(x, startY + i * gap + offY, it.label, () => {
        if (it.target === 'Game') {
          showLobby();          // Подорожі: збір Хоругви / соло, далі GameScene за подією 'lobbyStart'
          this.scene.start('Game');
        } else {
          this.scene.start('Section', { title: it.label, from: 'Menu' });
        }
      });
    });
  }

  // Кнопка меню: лише текст (без підкладки/обводки), підсвітка + легкий зсув при наведенні.
  private makeMenuItem(x: number, y: number, label: string, onClick: () => void): void {
    const t = this.add.text(x, y, label, {
      fontFamily: MENU_FONT, fontSize: '30px', color: COL_IDLE,
    }).setOrigin(0, 0.5).setScrollFactor(0)
      .setShadow(2, 2, '#000000', 5, false, true)
      .setInteractive({ useHandCursor: true });

    t.on('pointerover', () => { t.setColor(COL_HOVER); t.setX(x + 10); });
    t.on('pointerout',  () => { t.setColor(COL_IDLE);  t.setX(x); });
    t.on('pointerup', onClick);
  }
}
