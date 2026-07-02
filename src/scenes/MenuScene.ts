import Phaser from 'phaser';
import { LOGICAL_W, LOGICAL_H, RENDER_SCALE } from '../config';
import { hideLoadScreen, setTouchUI } from './uiButton';
import { startAmbience, stopAmbience, triggerThunder, loadLobbyMix } from '../sound/ambience';
import { CutoutCharacter, type CharDoc } from '../anim/CutoutCharacter';
import { loadCharLibrary } from '../charlib';

// Головне меню = «лоббі» (хатина з багаттям). Згодом анімуємо/зробимо інтерактивним.
// Заголовок ХОРУГВА зверху по центру; кнопки-розділи зліва, серифом у small-caps,
// без обводок, з підсвіткою. «Мандри» = подорожі (згодом глобальна карта; поки просто
// запускає гру); Завдання/Прогрес/Інвентар — поки сцена-заглушка 'Section'.
const ITEMS: { label: string; target: string }[] = [
  { label: 'Мандри',     target: 'World' },
  { label: 'Хоругва',    target: 'Khorugva' },
  { label: 'Завдання',   target: 'Quests' },
  { label: 'Досягнення', target: 'Achievements' },
  { label: 'Інвентар',   target: 'Inventory' },
];

const MENU_FONT = 'Georgia, "Times New Roman", serif';
const COL_IDLE = '#e5d8bc';  // пергамент (як на референсі)
const COL_HOVER = '#ffcf8f'; // теплий відсвіт багаття

// Позиція/масштаб персонажа на лавці біля вогнища (логічні координати кадру 1280×576).
// ЧЕРНЕТКА — точно виставимо в редакторі меню; поки тюнь тут. facing=-1 → обличчям до вогнища.
const LOBBY_CHAR = { x: 800, y: 205, scale: 1.55, facing: -1 };
// Центр багаття на арті хатини (логічні координати) — сюди садимо полум'я і світло.
const FIRE = { x: 640, y: 492 };
// ШИБКИ вікна на арті хатини (логічні координати кадру 1280×576, арт 2000×900 ×0.64):
// 4 стулки, розділені хрестовиною — світло блискавки й дощ сідають ТІЛЬКИ на скло.
const PANES: Array<{ x0: number; y0: number; x1: number; y1: number }> = [
  { x0: 595, y0: 140, x1: 634, y1: 205 }, // верх-ліва
  { x0: 643, y0: 140, x1: 682, y1: 205 }, // верх-права
  { x0: 595, y0: 214, x1: 634, y1: 285 }, // низ-ліва
  { x0: 643, y0: 214, x1: 682, y1: 285 }, // низ-права
];
const WIN_BOUNDS = { x0: 595, y0: 140, x1: 682, y1: 285 }; // габарит скла (для дощу)
// Дощ за вікном — ті самі налаштування, що накручені в атмосфері 1-го бітемап-рівня.
const RAIN = { color: 0xdbf0ea, dir: -25, speed: 1600, dropLen: 24, drops: 76, alpha: 0.5 };
// Блискавка: середній інтервал/рандомізація як у рівні (vary 0.77).
const LIGHTNING = { every: 11, vary: 0.77 };

// Сторінки меню з Редактора Меню (menu.json / IDB zag_menu). Нема — хардкод ITEMS.
interface MenuBtnDoc { id: string; label: string; x: number; y: number; size: number; target: string }
interface MenuPageDoc { id: string; name: string; bg: string; buttons: MenuBtnDoc[] }
interface MenuDocData { pages: MenuPageDoc[]; updatedAt?: number }

async function loadMenuDoc(): Promise<MenuDocData | null> {
  try {
    const { idbGet } = await import('../store');
    const d = await idbGet<MenuDocData>('zag_menu');
    if (d?.pages?.length) return d;
  } catch { /* ignore */ }
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}studio-data/menu.json?t=${Date.now()}`);
    if (r.ok) { const d = await r.json() as MenuDocData; if (d?.pages?.length) return d; }
  } catch { /* ignore */ }
  return null;
}

export class MenuScene extends Phaser.Scene {
  private lobbyChar: CutoutCharacter | null = null;
  private pageId: string | null = null; // яка сторінка MenuDoc відкрита ('page:' переходи)
  private bgImg: Phaser.GameObjects.Image | null = null;
  private fireGlow: Phaser.GameObjects.Image | null = null;
  private fireTime = 0;
  // Шторм за вікном
  private rainGfx: Phaser.GameObjects.Graphics | null = null;
  private windowFlash: Phaser.GameObjects.Image | null = null;   // світло по шибках (блюр)
  private roomFlash: Phaser.GameObjects.Rectangle | null = null; // біле світло в кімнаті
  private boltNext = 4;   // сек до наступної блискавки
  private boltOn = 0;     // залишок поточного спалаху
  private boltDur = 0.4;

  constructor() { super('Menu'); }

  init(data: { pageId?: string }): void { this.pageId = data?.pageId ?? null; }

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
    this.buildStorm(offX, offY);
    // Звук стартує лише після взаємодії (політика браузера) — перший клік/тап.
    this.input.once('pointerdown', () => { void loadLobbyMix().then((m) => startAmbience(m)); });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => stopAmbience());

    // Заголовок — зверху по центру.
    this.add.text(LOGICAL_W / 2 + offX, 58 + offY, 'ЖИТЛО', {
      fontFamily: MENU_FONT, fontStyle: 'small-caps', fontSize: '50px', color: '#efe3c8',
    }).setOrigin(0.5, 0.5).setScrollFactor(0).setShadow(2, 3, '#000000', 7, false, true);

    // Кнопки: зі сторінки Редактора Меню (menu.json), фолбек — хардкод ITEMS.
    void this.buildButtons(offX, offY);

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

  // Кнопки меню: сторінка з Редактора Меню або дефолтний хардкод.
  private async buildButtons(offX: number, offY: number): Promise<void> {
    const doc = await loadMenuDoc();
    if (!this.scene.isActive()) return;
    const pg = doc?.pages.find((p) => p.id === (this.pageId ?? 'main')) ?? doc?.pages[0];
    if (pg?.buttons.length) {
      for (const b of pg.buttons) {
        this.makeMenuItem(b.x + offX, b.y + offY, b.label, () => this.followTarget(b.target), b.size);
      }
      // не-головна сторінка → кнопка назад на головну
      if (doc && pg.id !== (doc.pages[0]?.id ?? 'main') && !pg.buttons.some((b) => b.target.startsWith('page:') && doc.pages[0] && b.target.slice(5) === doc.pages[0].id)) {
        this.makeMenuItem(36 + offX, 40 + offY, '‹ Назад', () => this.scene.start('Menu', { pageId: doc.pages[0].id }), 24);
      }
      return;
    }
    const x = 92 + offX;
    const startY = 210, gap = 74;
    ITEMS.forEach((it, i) => {
      this.makeMenuItem(x, startY + i * gap + offY, it.label, () => {
        if (it.target === 'World') this.scene.start('World', {});
        else if (it.target === 'Inventory') this.scene.start('Section', { title: it.label, from: 'Menu' });
        else this.scene.start(it.target);
      });
    });
  }

  // Гіперпосилання кнопки меню: сцени гри або інша сторінка меню.
  private followTarget(target: string): void {
    if (!target) return;
    if (target === 'world') { this.scene.start('World', {}); return; }
    if (target === 'game') { this.scene.start('Game'); return; }
    if (target === 'khorugva') { this.scene.start('Khorugva'); return; }
    if (target === 'quests') { this.scene.start('Quests'); return; }
    if (target === 'achievements') { this.scene.start('Achievements'); return; }
    if (target.startsWith('section:')) { this.scene.start('Section', { title: target.slice(8), from: 'Menu' }); return; }
    if (target.startsWith('page:')) { this.scene.start('Menu', { pageId: target.slice(5) }); return; }
  }

  // ── Шторм за вікном: дощ (маскою по шибках) + блискавка зі світлом у кімнату ─
  private buildStorm(offX: number, offY: number): void {
    // Дощ малюємо Graphics-ом щокадру, обрізаний маскою по ЧОТИРЬОХ шибках
    // (хрестовина рами лишається темною — краплі тільки на склі).
    this.rainGfx = this.add.graphics().setScrollFactor(0).setDepth(2);
    const maskShape = this.make.graphics({}, false);
    for (const p of PANES) maskShape.fillRect(p.x0 + offX, p.y0 + offY, p.x1 - p.x0, p.y1 - p.y0);
    this.rainGfx.setMask(maskShape.createGeometryMask());

    // Світло блискавки у вікні: канва зі шибками + гаусів блюр у два проходи
    // (вузьке яскраве ядро по склу + широкий м'який ореол на стіну навколо рами).
    if (!this.textures.exists('window_glow')) {
      const PAD = 34;
      const w = (WIN_BOUNDS.x1 - WIN_BOUNDS.x0) + PAD * 2;
      const h = (WIN_BOUNDS.y1 - WIN_BOUNDS.y0) + PAD * 2;
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const x = c.getContext('2d')!;
      const panes = (): void => {
        for (const p of PANES) x.fillRect(p.x0 - WIN_BOUNDS.x0 + PAD, p.y0 - WIN_BOUNDS.y0 + PAD, p.x1 - p.x0, p.y1 - p.y0);
      };
      x.fillStyle = 'rgba(238,242,255,0.5)';
      x.filter = 'blur(13px)'; panes();       // широкий ореол (світло «виливається» на раму/стіну)
      x.fillStyle = 'rgba(244,247,255,0.95)';
      x.filter = 'blur(4px)'; panes();        // яскраве ядро по склу з м'яким краєм
      x.filter = 'none';
      this.textures.addCanvas('window_glow', c);
    }
    this.windowFlash = this.add.image(
      (WIN_BOUNDS.x0 + WIN_BOUNDS.x1) / 2 + offX,
      (WIN_BOUNDS.y0 + WIN_BOUNDS.y1) / 2 + offY,
      'window_glow',
    ).setScrollFactor(0).setDepth(3).setAlpha(0).setBlendMode(Phaser.BlendModes.ADD);

    this.roomFlash = this.add.rectangle(LOGICAL_W / 2 + offX, LOGICAL_H / 2 + offY, LOGICAL_W, LOGICAL_H, 0xeef1ff, 0)
      .setScrollFactor(0).setDepth(40);
    this.boltNext = 3 + Math.random() * 6;
  }

  // Краплі за вікном — та сама математика, що в грі (jittered колонки, нахил, фаза).
  private drawWindowRain(t: number, offX: number, offY: number): void {
    const g = this.rainGfx; if (!g) return;
    g.clear();
    const angle = Math.tan(RAIN.dir * Math.PI / 180);
    const X0 = WIN_BOUNDS.x0 + offX, Y0 = WIN_BOUNDS.y0 + offY;
    const W = WIN_BOUNDS.x1 - WIN_BOUNDS.x0, H = WIN_BOUNDS.y1 - WIN_BOUNDS.y0;
    const hash = (n: number): number => { const s = Math.sin(n * 127.1) * 43758.5453; return s - Math.floor(s); };
    const n = Math.round(16 * RAIN.drops / 100 * 2); // ~30 крапель у маленькому вікні
    const len = RAIN.dropLen * 0.55; // менша «глибина» за вікном
    const speed = RAIN.speed * 0.55;
    for (let i = 0; i < n; i++) {
      const rx = (i + 0.5 + (hash(i + 7) - 0.5) * 0.5) / n;
      const rlen = 0.6 + hash(i + 17) * 0.9;
      const ra = 0.5 + hash(i + 29) * 0.5;
      const drift = Math.abs(angle) * (H + len);
      const OW = W + drift + 20, OH = H + len + 20;
      const baseX = X0 - 10 - (angle > 0 ? drift : 0) + rx * OW;
      const phase = ((hash(i + 41) * OH) + t * speed) % OH;
      const sy = Y0 - 10 + phase;
      const sx = baseX + phase * angle;
      g.lineStyle(1.4, RAIN.color, RAIN.alpha * ra);
      g.beginPath(); g.moveTo(sx, sy); g.lineTo(sx + len * rlen * angle, sy + len * rlen); g.strokePath();
    }
  }

  // Блискавка: подвійний блим (як справжня) — вікно яскраво, кімната білим відсвітом.
  private stepLightning(dt: number): void {
    if (this.boltOn > 0) {
      this.boltOn -= dt;
      const k = Math.max(0, this.boltOn / this.boltDur);
      // подвійний імпульс: пік → провал → менший пік
      const pulse = Math.max(0, Math.sin(k * Math.PI)) * (k > 0.45 ? 1 : 0.55);
      this.windowFlash?.setAlpha(Math.min(1, pulse));
      this.roomFlash?.setFillStyle(0xeef1ff, Math.min(0.35, pulse * 0.30));
      if (this.boltOn <= 0) { this.windowFlash?.setAlpha(0); this.roomFlash?.setFillStyle(0xeef1ff, 0); }
    } else {
      this.boltNext -= dt;
      if (this.boltNext <= 0) {
        const vary = LIGHTNING.vary;
        this.boltDur = 0.38 * (1 - vary * 0.5 + Math.random() * vary);
        this.boltOn = this.boltDur;
        this.boltNext = LIGHTNING.every * (1 - vary + Math.random() * vary * 2);
        triggerThunder(4000 + Math.random() * 2500); // далекий грім: ~4-6.5с після спалаху
      }
    }
  }

  // Тягне персонажа гравця (localStorage zag_game_char → fallback public/character.json)
  // і саджає перед вогнищем у позі 'sit'. Немає арту → просто не показуємо (без падінь).
  private async seatCharacter(offX: number, offY: number): Promise<void> {
    const doc = await MenuScene.loadCharDoc();
    if (!doc) return; // нема персонажа з артом → просто без нього
    // Дефолт лише коли розрізу НЕМА: авторський cut торса з рігу не перетираємо
    // (перетирання ламало позу — персонаж у меню виходив нахилений/зіжмаканий).
    if (doc.slots?.torso && doc.slots.torso.cut == null) doc.slots.torso.cut = 0.5;
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
    // Джерела: локальний zag_game_char, герой із синхронізованої бібліотеки,
    // запасний public/character.json. Виграє НАЙСВІЖІШИЙ (LWW по updatedAt) —
    // стара бібліотечна копія при свіжому character.json давала «розʼїханого»
    // персонажа на телефоні, хоч у студії все було відкалібровано.
    const cand: CharDoc[] = [];
    try { const s = localStorage.getItem('zag_game_char'); if (s) { const d = JSON.parse(s) as CharDoc; if (this.hasImages(d)) cand.push(d); } } catch { /* ignore */ }
    try {
      const lib = await loadCharLibrary();
      const hero = lib.find((x) => x.cat === 'char' && this.hasImages(x.doc)) ?? lib.find((x) => this.hasImages(x.doc));
      if (hero) cand.push(hero.doc);
    } catch { /* ignore */ }
    try { const r = await fetch(`${import.meta.env.BASE_URL}character.json`); if (r.ok) { const d = await r.json() as CharDoc; if (this.hasImages(d)) cand.push(d); } } catch { /* ignore */ }
    if (!cand.length) return null;
    let best = cand[0];
    for (const d of cand) if ((d.updatedAt ?? 0) > (best.updatedAt ?? 0)) best = d;
    return best;
  }

  update(_time: number, deltaMs: number): void {
    this.lobbyChar?.tick(deltaMs / 1000, LOBBY_CHAR.facing);
    // Мерехтіння вогню: сума неспівмірних синусів = живий нерівний ритм.
    this.fireTime += deltaMs / 1000;
    const t = this.fireTime;
    const offX = LOGICAL_W * (RENDER_SCALE - 1) / 2;
    const offY = LOGICAL_H * (RENDER_SCALE - 1) / 2;
    this.drawWindowRain(t, offX, offY);
    this.stepLightning(deltaMs / 1000);
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
  private makeMenuItem(x: number, y: number, label: string, onClick: () => void, size = 34): void {
    const t = this.add.text(x, y, label, {
      fontFamily: MENU_FONT, fontStyle: 'small-caps', fontSize: size + 'px', color: COL_IDLE,
    }).setOrigin(0, 0.5).setScrollFactor(0)
      .setShadow(2, 2, '#000000', 6, false, true)
      .setInteractive({ useHandCursor: true });

    t.on('pointerover', () => { t.setColor(COL_HOVER); t.setX(x + 10); });
    t.on('pointerout',  () => { t.setColor(COL_IDLE);  t.setX(x); });
    t.on('pointerup', onClick);
  }
}
