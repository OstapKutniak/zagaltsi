import Phaser from 'phaser';

// Генерує плейсхолдер-текстури (поки немає арту) і запускає рівень.
// Згодом сюди підемо за завантаженням атласів/Spine.
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create(): void {
    this.makeRect('player', 30, 46, 0x33d17a); // зелений — герой
    this.makeRect('enemy', 30, 46, 0xe04f5f); // червоний — ворог
    this.scene.start('Game');
  }

  private makeRect(key: string, w: number, h: number, color: number): void {
    const g = this.add.graphics();
    g.fillStyle(color, 1);
    g.fillRect(0, 0, w, h);
    g.generateTexture(key, w, h);
    g.destroy();
  }
}
