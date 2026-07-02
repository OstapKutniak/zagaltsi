import Phaser from 'phaser';
import { LOGICAL_W, LOGICAL_H, RENDER_SCALE } from '../config';
import { hideLoadScreen, setTouchUI } from './uiButton';
import { CutoutCharacter, type CharDoc } from '../anim/CutoutCharacter';
import { loadCharLibrary } from '../charlib';

// Головне меню = «лоббі» (хатина з багаттям). Згодом анімуємо/зробимо інтерактивним.
// Заголовок ХОРУГВА зверху по центру; кнопки-розділи зліва, серифом у small-caps,
// без обводок, з підсвіткою. «Мандри» = подорожі (згодом глобальна карта; поки просто
// запускає гру); Завдання/Прогрес/Інвентар — поки сцена-заглушка 'Section'.
const ITEMS: { label: string; target: string }[] = [
  { label: 'Мандри',   target: 'World' },
  { label: 'Завдання', target: 'Quests' },
  { label: 'Прогрес',  target: 'Progress' },
  { label: 'Інвентар', target: 'Inventory' },
];

const MENU_FONT = 'Georgia, "Times New Roman", serif';
const COL_IDLE = '#e5d8bc';  // пергамент (як на референсі)
const COL_HOVER = '#ffcf8f'; // теплий відсвіт багаття

// Позиція/масштаб персонажа на лавці біля вогнища (логічні координати кадру 1280×576).
// ЧЕРНЕТКА — точно виставимо в редакторі меню; поки тюнь тут. facing=-1 → обличчям до вогнища.
const LOBBY_CHAR = { x: 800, y: 205, scale: 1.55, facing: -1 };
// Центр багаття на арті хатини (логічні координати) — сюди садимо полум'я і світло.
const FIRE = { x: 640, y: 492 };

export class MenuScene extends Phaser.Scene {
  private lobbyChar: CutoutCharacter | null = null;
  private bgImg: Phaser.GameObjects.Image | null = null;
  private fireGlow: Phaser.GameObjects.Image | null = null;
  private fireTime = 0;

  constructor() { super('Menu'); }

  create(): void {
    hideLoadScreen(); // меню — перша видима сцена, знімаємо HTML-оверлей завантаження
    setTouchUI(false); // джойстик/кнопки — лише в бітемапі
    const cam = this.cameras.main;
    cam.setZoom(RENDER_SCALE);
    cam.setBackgroundColor('#0b0a0d');
    const offX = LOGICAL_W * (RENDER_SCALE - 1) / 2;
    const offY = LOGICAL_H * (RENDER_SCALE - 1) / 2;

    // Фон-хатина: масштаб «cover» (арт 20:9 = кадр, тож фактично точно вписується).
    const bg = this.add.image(LOGICAL_W / 2 + offX, LOGICAL_H / 2 + offY, 'menu_home')
      .setScrollFactor(0);
    bg.setScale(Math.max(LOGICAL_W / bg.width, LOGICAL_H / bg.height));
    this.bgImg = bg;

    this.buildFire(offX, offY);

    // Заголовок — зверху по центру.
    this.add.text(LOGICAL_W / 2 + offX, 58 + offY, 'ХОРУГВА', {
      fontFamily: MENU_FONT, fontStyle: 'small-caps', fontSize: '50px', color: '#efe3c8',
    }).setOrigin(0.5, 0.5).setScrollFactor(0).setShadow(2, 3, '#000000', 7, false, true);

    // Кнопки — ліворуч, стовпчиком.
    const x = 92 + offX;
    const startY = 210, gap = 74;
    ITEMS.forEach((it, i) => {
      this.makeMenuItem(x, startY + i * gap + offY, it.label, () => {
        // «Мандри» → глобальна карта (WorldScene). Бітемап (GameScene) тепер
        // запускається з переходів карти (поки скіпаються — приїзд одразу).
        if (it.target === 'World') this.scene.start('World', {});
        else this.scene.start('Section', { title: it.label, from: 'Menu' });
      });
    });

    void this.seatCharacter(offX, offY);
  }

  // ── Живе багаття: частинки полум'я/іскри + світло, що дихає ────────────────
  private buildFire(offX: number, offY: number): void {
    // Текстура м'якої плями (радіальний градієнт) — і для полум'я, і для світла.
    if (!this.textures.exists('fire_soft')) {
      const c = document.createElement('canvas'); c.width = 64; c.height = 64;
      const x = c.getContext('2d')!;
      const g = x.createRadialGradient(32, 32, 2, 32, 32, 30);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g; x.fillRect(0, 0, 64, 64);
      this.textures.addCanvas('fire_soft', c);
    }
    const fx = FIRE.x + offX, fy = FIRE.y + offY;

    // Язики полум'я: злітають, стискаються, жовте → руде → гаснуть.
    this.add.particles(fx, fy - 6, 'fire_soft', {
      x: { min: -16, max: 16 },
      speedY: { min: -95, max: -55 },
      speedX: { min: -8, max: 8 },
      scale: { start: 0.85, end: 0.12 },
      alpha: { start: 0.75, end: 0 },
      tint: [0xffe9a8, 0xffc25e, 0xff8a2a, 0xe0561c],
      lifespan: { min: 520, max: 900 },
      frequency: 45,
      blendMode: Phaser.BlendModes.ADD,
    }).setDepth(6);
    // Іскри: рідкі, дрібні, летять вище і зносяться вбік.
    this.add.particles(fx, fy - 14, 'fire_soft', {
      x: { min: -10, max: 10 },
      speedY: { min: -170, max: -110 },
      speedX: { min: -26, max: 30 },
      scale: { start: 0.16, end: 0 },
      alpha: { start: 1, end: 0 },
      tint: [0xffd27a, 0xff9a3d],
      lifespan: { min: 700, max: 1400 },
      frequency: 220,
      blendMode: Phaser.BlendModes.ADD,
    }).setDepth(6);
    // Світлова пляма над вогнищем — «дихає» у update() і фарбує сцену переливами.
    this.fireGlow = this.add.image(fx, fy - 30, 'fire_soft')
      .setScrollFactor(0).setDepth(5).setScale(11, 7.5)
      .setTint(0xff9a3d).setAlpha(0.16).setBlendMode(Phaser.BlendModes.ADD);
  }

  // Тягне персонажа гравця (localStorage zag_game_char → fallback public/character.json)
  // і саджає перед вогнищем у позі 'sit'. Немає арту → просто не показуємо (без падінь).
  private async seatCharacter(offX: number, offY: number): Promise<void> {
    const doc = await MenuScene.loadCharDoc();
    if (!doc) return; // нема персонажа з артом → просто без нього
    // Тимчасовий дефолт: розріз хребта на талії, щоб sit гарно згинався вже зараз.
    // Прибрати, коли Остап виставить власний розріз торса в рігу й перевидасть персонажа.
    if (doc.slots?.torso) doc.slots.torso.cut = 0.5;
    const char = await CutoutCharacter.load(this, doc, 'lobby_').catch(() => null);
    if (!char) return;
    char.setAnim('sit');
    // Обгортка задає позицію/масштаб: tick() щокадру перезаписує scaleX/Y самого персонажа.
    const holder = this.add.container(LOBBY_CHAR.x + offX, LOBBY_CHAR.y + offY, [char]);
    holder.setScrollFactor(0).setScale(LOBBY_CHAR.scale).setDepth(5);
    this.lobbyChar = char;
  }

  private static hasImages(doc: CharDoc | null | undefined): boolean {
    return !!(doc?.slots && doc.images && Object.keys(doc.images).length > 0);
  }

  private static async loadCharDoc(): Promise<CharDoc | null> {
    // 1) персонаж гравця на цьому пристрої
    try { const s = localStorage.getItem('zag_game_char'); if (s) { const d = JSON.parse(s) as CharDoc; if (this.hasImages(d)) return d; } } catch { /* ignore */ }
    // 2) синхронізована бібліотека (char-library.json з деплою) — герой із артом.
    //    Працює крос-пристроєво, тож персонаж видно і з телефона без локального zag_game_char.
    try {
      const lib = await loadCharLibrary();
      const hero = lib.find((x) => x.cat === 'char' && this.hasImages(x.doc)) ?? lib.find((x) => this.hasImages(x.doc));
      if (hero) return hero.doc;
    } catch { /* ignore */ }
    // 3) запасний вшитий у репо (наразі без картинок → не покажеться)
    try { const r = await fetch(`${import.meta.env.BASE_URL}character.json`); if (r.ok) { const d = await r.json() as CharDoc; if (this.hasImages(d)) return d; } } catch { /* ignore */ }
    return null;
  }

  update(_time: number, deltaMs: number): void {
    this.lobbyChar?.tick(deltaMs / 1000, LOBBY_CHAR.facing);
    // Мерехтіння вогню: сума неспівмірних синусів = живий нерівний ритм.
    this.fireTime += deltaMs / 1000;
    const t = this.fireTime;
    const f = 0.5 + 0.5 * (Math.sin(t * 7.3) * 0.5 + Math.sin(t * 12.7 + 1.3) * 0.3 + Math.sin(t * 3.1 + 2.1) * 0.2);
    if (this.fireGlow) {
      this.fireGlow.setAlpha(0.11 + 0.10 * f);
      this.fireGlow.setScale(10.6 + f * 1.2, 7.2 + f * 0.9);
    }
    // Переливи на сцені: фон і персонаж ледь теплішають/холоднішають у такт.
    const warm = (base: number, amp: number): number => Math.round(base + amp * f);
    const tint = (warm(236, 19) << 16) | (warm(222, 20) << 8) | warm(205, 22);
    this.bgImg?.setTint(tint);
    if (this.lobbyChar) this.lobbyChar.ambientTint = tint;
  }

  // Кнопка меню: лише текст (без підкладки/обводки), small-caps, підсвітка + зсув при наведенні.
  private makeMenuItem(x: number, y: number, label: string, onClick: () => void): void {
    const t = this.add.text(x, y, label, {
      fontFamily: MENU_FONT, fontStyle: 'small-caps', fontSize: '34px', color: COL_IDLE,
    }).setOrigin(0, 0.5).setScrollFactor(0)
      .setShadow(2, 2, '#000000', 6, false, true)
      .setInteractive({ useHandCursor: true });

    t.on('pointerover', () => { t.setColor(COL_HOVER); t.setX(x + 10); });
    t.on('pointerout',  () => { t.setColor(COL_IDLE);  t.setX(x); });
    t.on('pointerup', onClick);
  }
}
