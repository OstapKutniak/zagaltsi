import Phaser from 'phaser';

// Генерує плейсхолдер-текстури (поки немає арту) і запускає рівень.
// Згодом сюди підемо за завантаженням атласів/Spine.
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create(): void {
    this.makeRect('player', 34, 56, 0x57c25a); // зелений — герой
    this.makeRect('enemy', 34, 56, 0xc2504f); // червоний — ворог
    this.scene.start('Game');
  }

  private makeRect(key: string, w: number, h: number, color: number): void {
    const g = this.add.graphics();
    g.fillStyle(color, 1);
    g.fillRect(0, 0, w, h);
    g.lineStyle(2, 0x1a1622, 1);
    g.strokeRect(1, 1, w - 2, h - 2); // чорна обводка — натяк на стиль Don't Starve
    g.generateTexture(key, w, h);
    g.destroy();
  }
}
