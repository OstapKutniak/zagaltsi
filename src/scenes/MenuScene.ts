import Phaser from 'phaser';
import { LOGICAL_W, LOGICAL_H } from '../config';
import { hideLoadScreen } from './uiButton';
import { CutoutCharacter, type CharDoc } from '../anim/CutoutCharacter';
import { loadCharLibrary } from '../charlib';
import { setupMenuCamera, addTitle, addMenuItem } from './menuTheme';

// «Житло» — головна сторінка (хатина з багаттям, персонаж сидить біля вогню).
// Кнопки-розділи зліва: Мандри (глобальна карта) / Хоругва (збір загону) /
// Завдання / Досягнення / Інвентар (заглушка).
const ITEMS: { label: string; target: string }[] = [
  { label: 'Мандри',     target: 'Map' },
  { label: 'Хоругва',    target: 'Khorugva' },
  { label: 'Завдання',   target: 'Quests' },
  { label: 'Досягнення', target: 'Achievements' },
  { label: 'Інвентар',   target: 'Inventory' },
];

// Позиція/масштаб персонажа на лавці біля вогнища (логічні координати кадру 1280×576).
// ЧЕРНЕТКА — точно виставимо в редакторі меню; поки тюнь тут. facing=-1 → обличчям до вогнища.
const LOBBY_CHAR = { x: 800, y: 205, scale: 1.55, facing: -1 };

export class MenuScene extends Phaser.Scene {
  private lobbyChar: CutoutCharacter | null = null;

  constructor() { super('Menu'); }

  create(): void {
    hideLoadScreen(); // меню — перша видима сцена, знімаємо HTML-оверлей завантаження
    this.lobbyChar = null; // сцена могла перезапускатись — старий інстанс знищено
    const f = setupMenuCamera(this);

    // Фон-хатина: масштаб «cover» (арт 20:9 = кадр, тож фактично точно вписується).
    const bg = this.add.image(LOGICAL_W / 2 + f.offX, LOGICAL_H / 2 + f.offY, 'menu_home')
      .setScrollFactor(0);
    bg.setScale(Math.max(LOGICAL_W / bg.width, LOGICAL_H / bg.height));

    addTitle(this, f, 'ЖИТЛО');

    // Кнопки — ліворуч, стовпчиком.
    const x = 92 + f.offX;
    const startY = 186, gap = 66;
    ITEMS.forEach((it, i) => {
      addMenuItem(this, x, startY + i * gap + f.offY, it.label, () => {
        if (it.target === 'Inventory') this.scene.start('Section', { title: it.label, from: 'Menu' });
        else this.scene.start(it.target);
      });
    });

    void this.seatCharacter(f.offX, f.offY);
  }

  // Тягне персонажа гравця (localStorage zag_game_char → бібліотека → public/character.json)
  // і саджає перед вогнищем у позі 'sit'. Немає арту → просто не показуємо (без падінь).
  private async seatCharacter(offX: number, offY: number): Promise<void> {
    const doc = await MenuScene.loadCharDoc();
    if (!doc) return; // нема персонажа з артом → просто без нього
    // Тимчасовий дефолт: розріз хребта на талії, щоб sit гарно згинався вже зараз.
    // Прибрати, коли Остап виставить власний розріз торса в рігу й перевидасть персонажа.
    if (doc.slots?.torso) doc.slots.torso.cut = 0.5;
    const char = await CutoutCharacter.load(this, doc, 'lobby_').catch(() => null);
    if (!char || !this.scene.isActive()) return;
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
}
