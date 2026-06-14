import Phaser from 'phaser';
import { JUMP } from '../config';

// Базовий персонаж бітемапу. Зберігає "підлогову" позицію (fx, fy) у просторі
// з глибиною та висоту підскоку (z). Малюється з тінню; глибина рендера = fy,
// тож хто нижче на екрані — той ближче до камери (правильне перекриття).
export class Actor extends Phaser.GameObjects.Sprite {
  hp: number;
  facing: 1 | -1 = 1;

  protected fx: number; // позиція на підлозі по X
  protected fy: number; // позиція на підлозі по Y (глибина)
  protected airZ = 0; // висота над підлогою (стрибок)
  protected airVel = 0;

  private shadow: Phaser.GameObjects.Ellipse;

  constructor(scene: Phaser.Scene, x: number, y: number, texture: string, hp: number) {
    super(scene, x, y, texture);
    this.fx = x;
    this.fy = y;
    this.hp = hp;
    this.setOrigin(0.5, 1); // якорь біля "ніг"
    this.shadow = scene.add.ellipse(x, y, this.width * 0.9, 14, 0x000000, 0.3);
    scene.add.existing(this);
    this.sync();
  }

  get floorX(): number {
    return this.fx;
  }
  get floorY(): number {
    return this.fy;
  }
  get grounded(): boolean {
    return this.airZ <= 0;
  }

  // Затиснути позицію в смугу підлоги (після зміни розміру екрана).
  clampDepth(top: number, bottom: number): void {
    this.fy = Phaser.Math.Clamp(this.fy, top, bottom);
    this.sync();
  }

  jump(power: number): void {
    if (this.grounded) this.airVel = power;
  }

  protected stepZ(dt: number): void {
    if (this.airZ > 0 || this.airVel !== 0) {
      this.airVel -= JUMP.gravity * dt;
      this.airZ += this.airVel * dt;
      if (this.airZ <= 0) {
        this.airZ = 0;
        this.airVel = 0;
      }
    }
  }

  // Переносить логічну позицію у візуальну (екранну) + тінь + глибину.
  protected sync(): void {
    this.x = this.fx;
    this.y = this.fy - this.airZ;
    this.setDepth(this.fy);
    this.shadow.setPosition(this.fx, this.fy).setDepth(this.fy - 1);
    this.shadow.setScale(1 - Math.min(this.airZ, 160) / 320); // тінь меншає у стрибку
    this.setFlipX(this.facing === -1);
  }

  override destroy(fromScene?: boolean): void {
    this.shadow.destroy();
    super.destroy(fromScene);
  }
}
