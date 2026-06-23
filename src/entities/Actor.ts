import Phaser from 'phaser';
import { JUMP } from '../config';

// Базовий персонаж бітемапу. Зберігає "підлогову" позицію (fx, fy) у просторі
// з глибиною та АБСОЛЮТНУ висоту z над базовою площиною (рівень 0). Поверхня під
// актором задається floorZ (елевація поточної клітинки-платформи): гравітація
// тягне z до floorZ, тож актор стоїть на платформі тієї висоти, а стрибок підіймає
// z вище. Малюється з тінню на поверхні; глибина рендера = fy (хто нижче — ближче).
export class Actor extends Phaser.GameObjects.Sprite {
  hp: number;
  facing: 1 | -1 = 1;

  protected fx: number; // позиція на підлозі по X
  protected fy: number; // позиція на підлозі по Y (глибина)
  protected hz = 0; // абсолютна висота над площиною рівня 0 (підскок + елевація платформи); 'z' зайнятий Sprite
  protected airVel = 0;
  protected floorZ = 0; // елевація поверхні під актором (висота клітинки, на якій стоїть)

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
    return this.hz <= this.floorZ + 0.5; // стоїть на своїй поверхні (з допуском)
  }
  get airHeight(): number {
    return this.hz; // абсолютна висота (для синхронізації стрибка/платформ у кооп)
  }
  get jumpVel(): number { return this.airVel; }

  // Затиснути позицію в смугу підлоги (після зміни розміру екрана).
  clampDepth(top: number, bottom: number): void {
    this.fy = Phaser.Math.Clamp(this.fy, top, bottom);
    this.sync();
  }

  jump(power: number): void {
    if (this.grounded) this.airVel = power;
  }

  // Гравітація тягне z до floorZ (поверхня під актором). Підлога може бути піднята
  // (платформа) — тоді актор приземляється на її висоту, а не на 0.
  protected stepZ(dt: number): void {
    if (this.hz > this.floorZ || this.airVel !== 0) {
      this.airVel -= JUMP.gravity * dt;
      this.hz += this.airVel * dt;
      if (this.hz <= this.floorZ) {
        this.hz = this.floorZ;
        this.airVel = 0;
      }
    }
    // Поверхня піднялась під актором (спавн на платформі / захід на вищу клітинку в
    // межах допуску) — підіймаємо на неї, бо нижче своєї підлоги бути не можна.
    if (this.hz < this.floorZ) { this.hz = this.floorZ; this.airVel = 0; }
  }

  // Переносить логічну позицію у візуальну (екранну) + тінь + глибину.
  protected sync(): void {
    this.x = this.fx;
    this.y = this.fy - this.hz; // висота (підскок+елевація) піднімає на екрані
    this.setDepth(this.fy);
    this.shadow.setPosition(this.fx, this.fy - this.floorZ).setDepth(this.fy - 1); // тінь на поверхні платформи
    const above = this.hz - this.floorZ; // висота над поверхнею (для розміру тіні)
    this.shadow.setScale(1 - Math.min(above, 160) / 320); // тінь меншає у стрибку
    this.setFlipX(this.facing === -1);
  }

  override destroy(fromScene?: boolean): void {
    this.shadow.destroy();
    super.destroy(fromScene);
  }
}
