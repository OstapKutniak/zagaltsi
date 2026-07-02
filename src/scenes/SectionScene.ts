import Phaser from 'phaser';
import { LOGICAL_W, LOGICAL_H, RENDER_SCALE } from '../config';
import { makeTextButton, setTouchUI } from './uiButton';

// Універсальна сцена-заглушка для розділів меню (Житло / Досягнення / Персонаж).
// Показує назву розділу + кнопку «Назад». Оформлення й вміст додамо пізніше —
// зараз це просто робочий кістяк навігації.
export class SectionScene extends Phaser.Scene {
  private title = '';
  private from = 'Menu';

  constructor() { super('Section'); }

  init(data: { title?: string; from?: string }): void {
    this.title = data?.title ?? 'Розділ';
    this.from = data?.from ?? 'Menu';
  }

  create(): void {
    setTouchUI(false); // джойстик/кнопки — лише в бітемапі
    const cam = this.cameras.main;
    cam.setZoom(RENDER_SCALE);
    cam.setBackgroundColor('#1a1622');
    const offX = LOGICAL_W * (RENDER_SCALE - 1) / 2;
    const offY = LOGICAL_H * (RENDER_SCALE - 1) / 2;
    const cx = LOGICAL_W / 2 + offX;

    this.add.text(cx, LOGICAL_H / 2 - 40 + offY, this.title, {
      fontFamily: 'system-ui, sans-serif',
      fontSize: '44px',
      color: '#e8e0d0',
    }).setOrigin(0.5).setScrollFactor(0);

    this.add.text(cx, LOGICAL_H / 2 + 8 + offY, 'Порожня сторінка — оформимо пізніше', {
      fontFamily: 'system-ui, sans-serif',
      fontSize: '20px',
      color: '#8a8496',
    }).setOrigin(0.5).setScrollFactor(0);

    makeTextButton(this, cx, LOGICAL_H / 2 + 90 + offY, 'Назад', () => {
      this.scene.start(this.from);
    }, { w: 220 });
  }
}
