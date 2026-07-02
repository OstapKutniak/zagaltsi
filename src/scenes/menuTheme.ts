import Phaser from 'phaser';
import { LOGICAL_W, LOGICAL_H, RENDER_SCALE } from '../config';

// Спільна тема сторінок меню: серифний шрифт small-caps, пергамент/бурштин.
// (Кастомний шрифт-файл підключимо пізніше — Остап дасть; тоді міняється тут ОДИН раз.)
export const MENU_FONT = 'Georgia, "Times New Roman", serif';
export const COL_IDLE = '#e5d8bc';
export const COL_HOVER = '#ffcf8f';
export const COL_TITLE = '#efe3c8';

export interface Frame { offX: number; offY: number; cx: number }

// Готує камеру сцени меню (зум суперсемплінгу + фон) і повертає зсуви кадру.
export function setupMenuCamera(scene: Phaser.Scene, bgColor = '#0b0a0d'): Frame {
  const cam = scene.cameras.main;
  cam.setZoom(RENDER_SCALE);
  cam.setBackgroundColor(bgColor);
  const offX = LOGICAL_W * (RENDER_SCALE - 1) / 2;
  const offY = LOGICAL_H * (RENDER_SCALE - 1) / 2;
  return { offX, offY, cx: LOGICAL_W / 2 + offX };
}

// Заголовок сторінки зверху по центру (як на головній).
export function addTitle(scene: Phaser.Scene, f: Frame, text: string): Phaser.GameObjects.Text {
  return scene.add.text(f.cx, 58 + f.offY, text, {
    fontFamily: MENU_FONT, fontStyle: 'small-caps', fontSize: '50px', color: COL_TITLE,
  }).setOrigin(0.5, 0.5).setScrollFactor(0).setShadow(2, 3, '#000000', 7, false, true);
}

// Текстова кнопка меню: без підкладки/обводки, підсвітка + зсув при наведенні.
export function addMenuItem(scene: Phaser.Scene, x: number, y: number, label: string, onClick: () => void, fontSize = 34): Phaser.GameObjects.Text {
  const t = scene.add.text(x, y, label, {
    fontFamily: MENU_FONT, fontStyle: 'small-caps', fontSize: fontSize + 'px', color: COL_IDLE,
  }).setOrigin(0, 0.5).setScrollFactor(0)
    .setShadow(2, 2, '#000000', 6, false, true)
    .setInteractive({ useHandCursor: true });
  t.on('pointerover', () => { t.setColor(COL_HOVER); t.setX(x + 10); });
  t.on('pointerout',  () => { t.setColor(COL_IDLE);  t.setX(x); });
  t.on('pointerup', onClick);
  return t;
}

// Кнопка «Назад» у лівому нижньому куті.
export function addBack(scene: Phaser.Scene, f: Frame, to = 'Menu'): void {
  addMenuItem(scene, 48 + f.offX, LOGICAL_H - 44 + f.offY, 'Назад', () => scene.scene.start(to), 26);
}
