import Phaser from 'phaser';

// Генерує плейсхолдер-текстури (поки немає арту) і запускає рівень.
// Згодом сюди підемо за завантаженням атласів/Spine.
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create(): void {
    this.makeRect('player', 34, 56, 0x57c25a);
    this.makeRect('enemy', 34, 56, 0xc2504f);
    this.makeHudHeart();
    this.makeHudSun();
    this.makeHudSkull();
    this.scene.start('Game');
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

  private makeHudHeart(): void {
    const g = this.add.graphics();
    g.fillStyle(0xffffff, 1);
    g.fillCircle(14, 14, 12);   // ліва частка
    g.fillCircle(30, 14, 12);   // права частка
    g.fillTriangle(4, 20, 40, 20, 22, 43); // низ
    g.generateTexture('hud_heart', 44, 44);
    g.destroy();
  }

  private makeHudSun(): void {
    const g = this.add.graphics();
    g.fillStyle(0xffffff, 1);
    const cx = 22, cy = 22;
    g.fillCircle(cx, cy, 10);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const tr = 21, br = 12, bh = 0.28;
      g.fillTriangle(
        cx + Math.cos(a) * tr,       cy + Math.sin(a) * tr,
        cx + Math.cos(a - bh) * br,  cy + Math.sin(a - bh) * br,
        cx + Math.cos(a + bh) * br,  cy + Math.sin(a + bh) * br,
      );
    }
    g.generateTexture('hud_sun', 44, 44);
    g.destroy();
  }

  private makeHudSkull(): void {
    const g = this.add.graphics();
    g.fillStyle(0xffffff, 1);
    g.fillEllipse(22, 17, 36, 28);  // черепна коробка
    g.fillRect(13, 27, 18, 9);       // щелепа
    for (let i = 0; i < 3; i++) g.fillRect(13 + i * 6, 35, 5, 6); // зуби
    g.fillStyle(0x000000, 1);
    g.fillCircle(15, 16, 5);         // ліве очниця
    g.fillCircle(29, 16, 5);         // права очниця
    g.fillRect(19, 23, 6, 5);        // ніс
    g.generateTexture('hud_skull', 44, 44);
    g.destroy();
  }
}
