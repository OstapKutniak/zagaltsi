import Phaser from 'phaser';
import { LOGICAL_W, LOGICAL_H, RENDER_SCALE } from '../config';
import { hideLoadScreen } from './uiButton';
import { CutoutCharacter, type CharDoc } from '../anim/CutoutCharacter';
import { loadCharLibrary } from '../charlib';

// Головне меню = «лоббі» (хатина з багаттям). Згодом анімуємо/зробимо інтерактивним.
// Заголовок ХОРУГВА зверху по центру; кнопки-розділи зліва, серифом у small-caps,
// без обводок, з підсвіткою. «Мандри» = подорожі (згодом глобальна карта; поки просто
// запускає гру); Завдання/Прогрес/Інвентар — поки сцена-заглушка 'Section'.
const ITEMS: { label: string; target: string }[] = [
  { label: 'Мандри',   target: 'Game' },
  { label: 'Завдання', target: 'Quests' },
  { label: 'Прогрес',  target: 'Progress' },
  { label: 'Інвентар', target: 'Inventory' },
];

const MENU_FONT = 'Georgia, "Times New Roman", serif';
const COL_IDLE = '#e5d8bc';  // пергамент (як на референсі)
const COL_HOVER = '#ffcf8f'; // теплий відсвіт багаття

// Позиція/масштаб персонажа на лавці біля вогнища (логічні координати кадру 1280×576).
// ЧЕРНЕТКА — точно виставимо в редакторі меню; поки тюнь тут. facing=-1 → обличчям до вогнища.
const LOBBY_CHAR = { x: 1030, y: 372, scale: 0.62, facing: -1 };

export class MenuScene extends Phaser.Scene {
  private lobbyChar: CutoutCharacter | null = null;

  constructor() { super('Menu'); }

  create(): void {
    hideLoadScreen(); // меню — перша видима сцена, знімаємо HTML-оверлей завантаження
    const cam = this.cameras.main;
    cam.setZoom(RENDER_SCALE);
    cam.setBackgroundColor('#0b0a0d');
    const offX = LOGICAL_W * (RENDER_SCALE - 1) / 2;
    const offY = LOGICAL_H * (RENDER_SCALE - 1) / 2;

    // Фон-хатина: масштаб «cover» (арт 20:9 = кадр, тож фактично точно вписується).
    const bg = this.add.image(LOGICAL_W / 2 + offX, LOGICAL_H / 2 + offY, 'menu_home')
      .setScrollFactor(0);
    bg.setScale(Math.max(LOGICAL_W / bg.width, LOGICAL_H / bg.height));

    // Заголовок — зверху по центру.
    this.add.text(LOGICAL_W / 2 + offX, 58 + offY, 'ХОРУГВА', {
      fontFamily: MENU_FONT, fontStyle: 'small-caps', fontSize: '50px', color: '#efe3c8',
    }).setOrigin(0.5, 0.5).setScrollFactor(0).setShadow(2, 3, '#000000', 7, false, true);

    // Кнопки — ліворуч, стовпчиком.
    const x = 92 + offX;
    const startY = 210, gap = 74;
    ITEMS.forEach((it, i) => {
      this.makeMenuItem(x, startY + i * gap + offY, it.label, () => {
        // «Мандри» поки просто запускає гру (глобальна карта — пізніше). Лобі-збір
        // Хоругви прибрано зі старту: GameScene бачить прихований лобі → грає соло.
        if (it.target === 'Game') this.scene.start('Game');
        else this.scene.start('Section', { title: it.label, from: 'Menu' });
      });
    });

    void this.seatCharacter(offX, offY);
  }

  // Тягне персонажа гравця (localStorage zag_game_char → fallback public/character.json)
  // і саджає перед вогнищем у позі 'sit'. Немає арту → просто не показуємо (без падінь).
  private async seatCharacter(offX: number, offY: number): Promise<void> {
    const doc = await MenuScene.loadCharDoc();
    if (!doc) return; // нема персонажа з артом → просто без нього
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
