import Phaser from 'phaser';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  preload(): void {
    this.load.image('hud_heart', 'ui/HP.png');
    this.load.image('hud_sun',   'ui/Pain.png');
    this.load.image('hud_skull', 'ui/Tryvoga.png');
    this.load.image('menu_home', 'menu/home.png'); // фон головного меню (хатина з багаттям)
  }

  create(): void {
    this.makeRect('player', 34, 56, 0x57c25a);
    this.makeRect('enemy',  34, 56, 0xc2504f);
    this.scene.start('Menu');
  }

  private makeRect(key: string, w: number, h: number, color: number): void {
    const g = this.add.graphics();
    g.fillStyle(color, 1);
    g.fillRect(0, 0, w, h);
    g.lineStyle(2, 0x1a1622, 1);
    g.strokeRect(1, 1, w - 2, h - 2);
    g.generateTexture(key, w, h);
    g.destroy();
  }
}
