import Phaser from 'phaser';
import { LOGICAL_W, LOGICAL_H, RENDER_SCALE } from '../config';
import { hideLoadScreen, setTouchUI } from './uiButton';
import { triggerThunder, ensureAmbience } from '../sound/ambience';
import { CutoutCharacter, TRANS_DUR, type CharDoc } from '../anim/CutoutCharacter';
import { buildInvPanel, applyEquipTo } from './invPanel';
import { buildQuestsPanel, buildAchievementsPanel, buildKhorugvaPanel } from './pagePanels';
import { loadEquip } from '../inventory';
import { loadCharLibrary } from '../charlib';
import { publishMyChar, publishMyEquip, loadMemberCharDoc, loadMemberEquip } from '../multiplayer/sharedChars';
import { cachedMembers, refreshMembers, type KhMember } from '../khorugva';

// Розділи, що морфляться в лоббі БЕЗ зміни сцени (персонаж лишається, змінюється
// лише напис + панель праворуч). Мандри — окрема сцена (реальний перехід на карту).
type PageKey = 'home' | 'inventory' | 'quests' | 'achievements' | 'khorugva';
const PAGE_TITLE: Record<PageKey, string> = {
  home: 'ЖИТЛО', inventory: 'ІНВЕНТАР', quests: 'ЗАВДАННЯ', achievements: 'ДОСЯГНЕННЯ', khorugva: 'ХОРУГВА',
};

// Головне меню = «лоббі» (хатина з багаттям). Згодом анімуємо/зробимо інтерактивним.
// Заголовок ХОРУГВА зверху по центру; кнопки-розділи зліва, серифом у small-caps,
// без обводок, з підсвіткою. «Мандри» = подорожі (згодом глобальна карта; поки просто
// запускає гру); Завдання/Прогрес/Інвентар — поки сцена-заглушка 'Section'.
const ITEMS: { label: string; target: string }[] = [
  { label: 'Житло',      target: 'home' },
  { label: 'Мандри',     target: 'world' },
  { label: 'Хоругва',    target: 'khorugva' },
  { label: 'Завдання',   target: 'quests' },
  { label: 'Досягнення', target: 'achievements' },
  { label: 'Інвентар',   target: 'inventory' },
];

const MENU_FONT = 'Georgia, "Times New Roman", serif';
const COL_IDLE = '#e5d8bc';  // пергамент (як на референсі)
const COL_HOVER = '#ffcf8f'; // теплий відсвіт багаття

// Ефекти сцени лобі — редагуються в Редакторі Меню (menu.json → pg.fx);
// нижче — дефолти (та сама хатина), якщо сторінка їх не перекрила.
interface MenuFxData {
  char: { on: boolean; x: number; y: number; scale: number };
  fire: { on: boolean; x: number; y: number; scale: number; glow: number };
  rain: { on: boolean; x0: number; y0: number; x1: number; y1: number; panes: boolean; dir: number; alpha: number; speed: number };
  bolt: { on: boolean; every: number; vary: number; bright: number };
}
const DEF_FX: MenuFxData = {
  char: { on: true, x: 800, y: 205, scale: 1.55 },
  fire: { on: true, x: 640, y: 492, scale: 1, glow: 0.16 },
  rain: { on: true, x0: 595, y0: 140, x1: 682, y1: 285, panes: true, dir: -25, alpha: 0.5, speed: 1600 },
  bolt: { on: true, every: 11, vary: 0.77, bright: 1 },
};
function normFx(p?: Partial<MenuFxData> | null): MenuFxData {
  const d = JSON.parse(JSON.stringify(DEF_FX)) as MenuFxData;
  if (!p) return d;
  return { char: { ...d.char, ...p.char }, fire: { ...d.fire, ...p.fire }, rain: { ...d.rain, ...p.rain }, bolt: { ...d.bolt, ...p.bolt } };
}
const RAIN_COLOR = 0xdbf0ea;
const CHAR_FACING = -1; // обличчям до вогнища

// Сторінки меню з Редактора Меню (menu.json / IDB zag_menu). Нема — хардкод ITEMS.
interface MenuBtnDoc { id: string; label: string; x: number; y: number; size: number; target: string }
interface MenuPageDoc { id: string; name: string; bg: string; buttons: MenuBtnDoc[]; fx?: Partial<MenuFxData> }
interface MenuDocData { pages: MenuPageDoc[]; updatedAt?: number }

async function loadMenuDoc(): Promise<MenuDocData | null> {
  // LWW: локальна копія (студія на цьому пристрої) проти опублікованої — виграє свіжіша.
  let local: MenuDocData | null = null, pub: MenuDocData | null = null;
  try {
    const { idbGet } = await import('../store');
    const d = await idbGet<MenuDocData>('zag_menu');
    if (d?.pages?.length) local = d;
  } catch { /* ignore */ }
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}studio-data/menu.json?t=${Date.now()}`);
    if (r.ok) { const d = await r.json() as MenuDocData; if (d?.pages?.length) pub = d; }
  } catch { /* ignore */ }
  if (local && pub) return (pub.updatedAt ?? 0) > (local.updatedAt ?? 0) ? pub : local;
  return local ?? pub;
}

export class MenuScene extends Phaser.Scene {
  protected lobbyChar: CutoutCharacter | null = null;
  protected charHolder: Phaser.GameObjects.Container | null = null;
  private titleObj: Phaser.GameObjects.Text | null = null;
  // Ріалтайм-морф розділів БЕЗ зміни сцени (персонаж лишається на місці, напис
  // плавно перетворюється, фон/кнопки/шторм ті самі). Стоїть лише в Інвентарі —
  // решта розділів «персонаж просто сидить».
  private curPage: PageKey = 'home';
  private sectionPanel: { destroy(): void } | null = null;
  private morphing = false;
  // Збір побратимів біля вогнища (сторінка Хоругва): персонажі всіх учасників паті
  // зі своїм спорядженням, розставлені по колу. Свій lobbyChar на цей час ховаємо.
  private gather: Array<{ id: string; char: CutoutCharacter; holder: Phaser.GameObjects.Container; facing: number; equipSig: string }> = [];
  private gatherGen = 0;
  private regather: (() => void) | null = null; // переперевірка складу (вхід/вихід учасника)
  private regatherAcc = 0;
  private equipAcc = 0; // акумулятор для оновлення спорядження побратимів
  private pageId: string | null = null; // яка сторінка MenuDoc відкрита ('page:' переходи)
  private startPage: PageKey | null = null; // deep-link: одразу зморфити в цей розділ
  private buildGen = 0; // покоління буду сцени: async buildScene від СТАРОГО create має відпасти
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
  protected fx: MenuFxData = normFx(null); // ефекти сцени (перекриваються pg.fx з menu.json)

  // key параметризовано: сторінка «Інвентар» (InventoryScene) успадковує хатину.
  constructor(key = 'Menu') { super(key); }

  init(data: { pageId?: string; startPage?: PageKey }): void {
    this.pageId = data?.pageId ?? null;
    this.startPage = data?.startPage ?? null;
  }

  // ── Хуки для сторінок-нащадків (Інвентар тощо) ──────────────────────────────
  protected pageTitle(): string { return 'ЖИТЛО'; }
  // Поза/позиція персонажа; feetY — поставити ступні на цю логічну висоту.
  protected charSetup(): { anim: string; x: number; y: number; scale: number; feetY?: number } {
    const C = this.fx.char;
    return { anim: 'sit', x: C.x, y: C.y, scale: C.scale };
  }
  // За замовчуванням одягаємо на лобі-персонажа вдягнене в Інвентарі спорядження —
  // щоб меч/броня були видні й у Житлі, і в Хоругві (коли сам, без збору 2+).
  protected onCharReady(char: CutoutCharacter): void { applyEquipTo(char, loadEquip()); }
  protected afterBuild(_offX: number, _offY: number): void { /* додатковий UI нащадків */ }

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

    // Звук стартує лише після взаємодії (політика браузера) — перший клік/тап.
    // НЕ зупиняємо на виході: ембієнт лоббі тягнеться далі на глобальну карту
    // (World/Location); замовкає лише в бою (GameScene.stopAmbience).
    ensureAmbience(this);

    // Заголовок — зверху по центру.
    this.curPage = 'home'; this.sectionPanel = null; this.morphing = false;
    // Phaser ПЕРЕВИКОРИСТОВУЄ інстанс сцени: після рестарту (scene.start('Menu'))
    // поля лишаються від минулого життя, а GameObjects уже знищені. Скидаємо посилання
    // на персонажа/збір — інакше seatCharacter бачив «живий» lobbyChar і не саджав
    // нового (персонаж зникав / не перевдягався у свіже спорядження).
    this.lobbyChar = null; this.charHolder = null; this.seatingChar = false; this.gather = [];
    this.titleObj = this.add.text(LOGICAL_W / 2 + offX, 58 + offY, this.pageTitle(), {
      fontFamily: MENU_FONT, fontStyle: 'small-caps', fontSize: '50px', color: '#efe3c8',
    }).setOrigin(0.5, 0.5).setScrollFactor(0).setShadow(2, 3, '#000000', 7, false, true);

    // Все, що залежить від menu.json (fx + кнопки + персонаж) — після завантаження doc.
    void this.buildScene(offX, offY, ++this.buildGen);

    // Лідер-кеш (zag_kh_leader) тримаємо свіжим ще в лоббі — щоб broadcastNav спрацював
    // при виході на карту навіть якщо гравець не заходив на сторінку Хоругва.
    void refreshMembers().catch(() => {});

    // Панель розділу тримає підписку (watchKhorugva) — знімаємо на виході зі сцени.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => { this.sectionPanel?.destroy(); this.sectionPanel = null; this.clearGathering(); });
  }

  private async buildScene(offX: number, offY: number, gen: number): Promise<void> {
    const doc = await loadMenuDoc().catch(() => null);
    // Сцену перезапустили, поки вантажився doc → цей build застарів: не дублюємо
    // кнопки/вогонь/шторм у новий кадр (guard isActive НЕ ловить це — сцену
    // переактивували під тим самим обʼєктом).
    if (gen !== this.buildGen || !this.scene.isActive()) return;
    const pg = doc?.pages.find((p) => p.id === (this.pageId ?? 'main')) ?? doc?.pages[0] ?? null;
    this.fx = normFx(pg?.fx ?? null);
    // Кожен ефект — окремо в try: збій на конкретному пристрої не має з'їдати КНОПКИ.
    try { if (this.fx.fire.on) this.buildFire(offX, offY); } catch { /* без вогню */ }
    try { this.buildStorm(offX, offY); } catch { /* без шторму */ }
    try { this.buildButtons(doc, pg, offX, offY); } catch { this.buildButtons(null, null, offX, offY); }
    try { if (this.fx.char.on) void this.seatCharacter(offX, offY); } catch { /* без персонажа */ }
    try { this.afterBuild(offX, offY); } catch { /* без додаткового UI */ }
    // Deep-link: одразу морфимо в потрібний розділ (напр. join хоругви з бота).
    if (this.startPage && this.sys.settings.key === 'Menu') { const sp = this.startPage; this.startPage = null; this.morphTo(sp); }
  }

  // Шибки вікна: прямокутник дощу з редактора; panes — ділимо хрестовиною 2×2.
  private panesOf(r: MenuFxData['rain']): Array<{ x0: number; y0: number; x1: number; y1: number }> {
    if (!r.panes) return [{ x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1 }];
    const g = 4.5, mx = (r.x0 + r.x1) / 2, my = (r.y0 + r.y1) / 2;
    return [
      { x0: r.x0, y0: r.y0, x1: mx - g, y1: my - g },
      { x0: mx + g, y0: r.y0, x1: r.x1, y1: my - g },
      { x0: r.x0, y0: my + g, x1: mx - g, y1: r.y1 },
      { x0: mx + g, y0: my + g, x1: r.x1, y1: r.y1 },
    ];
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
    const F = this.fx.fire;
    const s = F.scale;
    const fx = F.x + offX, fy = F.y + offY;

    // Язики полум'я: злітають, стискаються, жовте → руде → гаснуть.
    this.add.particles(fx, fy - 6 * s, 'fire_soft', {
      x: { min: -16 * s, max: 16 * s },
      speedY: { min: -95 * s, max: -55 * s },
      speedX: { min: -8, max: 8 },
      scale: { start: 0.85 * s, end: 0.12 * s },
      alpha: { start: 0.75, end: 0 },
      tint: [0xffe9a8, 0xffc25e, 0xff8a2a, 0xe0561c],
      lifespan: { min: 520, max: 900 },
      frequency: 45,
      blendMode: Phaser.BlendModes.ADD,
    }).setDepth(6);
    // Іскри: рідкі, дрібні, летять вище і зносяться вбік.
    this.add.particles(fx, fy - 14 * s, 'fire_soft', {
      x: { min: -10 * s, max: 10 * s },
      speedY: { min: -170 * s, max: -110 * s },
      speedX: { min: -26, max: 30 },
      scale: { start: 0.16 * s, end: 0 },
      alpha: { start: 1, end: 0 },
      tint: [0xffd27a, 0xff9a3d],
      lifespan: { min: 700, max: 1400 },
      frequency: 220,
      blendMode: Phaser.BlendModes.ADD,
    }).setDepth(6);
    // Світлова пляма над вогнищем — «дихає» у update() і фарбує сцену переливами.
    this.fireGlow = this.add.image(fx, fy - 30 * s, 'fire_soft')
      .setScrollFactor(0).setDepth(5).setScale(11 * s, 7.5 * s)
      .setTint(0xff9a3d).setAlpha(F.glow).setBlendMode(Phaser.BlendModes.ADD);
  }

  // Кнопки меню: сторінка з Редактора Меню або дефолтний хардкод.
  private buildButtons(doc: MenuDocData | null, pg: MenuPageDoc | null, offX: number, offY: number): void {
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
    const startY = 176, gap = 68; // 6 пунктів (з «Житло») вміщаємо вище/щільніше
    ITEMS.forEach((it, i) => {
      this.makeMenuItem(x, startY + i * gap + offY, it.label, () => this.followTarget(it.target));
    });
  }

  // Ріалтайм-перехід між розділами: сцена НЕ перезапускається. Заголовок плавно
  // перетікає, панель розділу з'являється/зникає, фон/вогонь/шторм/кнопки — ті
  // самі. Персонаж встає лише для Інвентаря (stand_up); в інші розділи — сидить.
  private morphTo(page: PageKey): void {
    if (this.curPage === page || this.morphing) return;
    this.morphing = true;
    const offX = LOGICAL_W * (RENDER_SCALE - 1) / 2;
    const offY = LOGICAL_H * (RENDER_SCALE - 1) / 2;
    const durMs = TRANS_DUR * 1000;

    // Заголовок: розтанути → замінити → проявитись.
    if (this.titleObj) {
      const t = this.titleObj;
      this.tweens.add({ targets: t, alpha: 0, duration: 240, ease: 'Sine.easeIn',
        onComplete: () => { t.setText(PAGE_TITLE[page]); this.tweens.add({ targets: t, alpha: 1, duration: 300, ease: 'Sine.easeOut' }); } });
    }

    // Персонаж: стоїть лише в Інвентарі. Граємо перехід, лише коли МІНЯЄТЬСЯ стан.
    const char = this.lobbyChar, holder = this.charHolder;
    const C = this.fx.char;
    const wantStand = page === 'inventory';
    const isStand = this.curPage === 'inventory';
    const charChanged = !!(char && holder && wantStand !== isStand);
    if (char && holder && charChanged) {
      if (wantStand) {
        char.setAnim('idle'); char.tick(0, CHAR_FACING);
        const standY = 522 + offY - char.feetOffset() * C.scale;
        char.setAnim('stand_up');
        this.tweens.add({ targets: holder, x: C.x + 55 + offX, y: standY, duration: durMs, ease: 'Sine.easeInOut' });
      } else {
        char.setAnim('sit_down');
        this.tweens.add({ targets: holder, x: C.x + offX, y: C.y + offY, duration: durMs, ease: 'Sine.easeInOut' });
      }
    }

    // Панель розділу.
    this.sectionPanel?.destroy(); this.sectionPanel = null;
    if (page === 'inventory') {
      this.sectionPanel = buildInvPanel(this, offX, offY, () => this.lobbyChar);
      applyEquipTo(char, loadEquip());
    } else if (page === 'quests') {
      this.sectionPanel = buildQuestsPanel(this, offX, offY);
    } else if (page === 'achievements') {
      this.sectionPanel = buildAchievementsPanel(this, offX, offY);
    } else if (page === 'khorugva') {
      this.sectionPanel = buildKhorugvaPanel(this, offX, offY);
    }

    // Збір біля вогнища: на сторінці Хоругва ховаємо одинокого lobbyChar і
    // показуємо ВСІХ побратимів; на інших сторінках — навпаки.
    if (page === 'khorugva') this.buildGathering(offX, offY);
    else this.clearGathering();

    this.curPage = page;
    // Таймер-подія (time.delayedCall) у цій сцені не спрацьовує надійно — тому
    // завершення морфу веземо на твіні (він точно тікає): скидаємо блок і
    // фіксуємо фінальну позу персонажа (stand_up/sit_down у спокої = idle/sit).
    this.tweens.add({
      targets: { p: 0 }, p: 1, duration: durMs,
      onComplete: () => {
        this.morphing = false;
        if (charChanged && this.lobbyChar === char) char?.setAnim(wantStand ? 'idle' : 'sit');
      },
    });
  }

  // Гіперпосилання кнопки меню: морф-розділ у лоббі, окрема сцена або сторінка меню.
  private followTarget(target: string): void {
    if (!target) return;
    const t = target === 'section:Інвентар' ? 'inventory' : target;
    if (t === 'world') {
      // Лідер веде хоругву на карту; ведений теж може відкрити карту, але далі
      // напрям обирає головний (WorldScene це вже гейтить).
      void import('../khorugva').then(({ iAmLeaderCached }) => {
        if (iAmLeaderCached()) void import('../multiplayer/partyNav').then(({ broadcastNav }) => broadcastNav('World', {}));
      });
      this.scene.start('World', {});
      return;
    }
    if (t === 'game') { this.scene.start('Game'); return; }
    if (t.startsWith('page:')) { this.scene.start('Menu', { pageId: t.slice(5) }); return; }
    if (t.startsWith('section:')) { this.scene.start('Section', { title: t.slice(8), from: 'Menu' }); return; }
    // Морф-розділи (Житло/Інвентар/Завдання/Досягнення/Хоругва).
    const PAGE: Record<string, PageKey> = { home: 'home', zhytlo: 'home', inventory: 'inventory', quests: 'quests', achievements: 'achievements', khorugva: 'khorugva' };
    const page = PAGE[t];
    if (!page) return;
    if (this.sys.settings.key === 'Menu') { this.morphTo(page); return; }
    // Не лоббі (deep-link сцена) → відкриваємо лоббі з потрібним розділом.
    this.scene.start('Menu', { startPage: page });
  }

  // ── Шторм за вікном: дощ (маскою по шибках) + блискавка зі світлом у кімнату ─
  private buildStorm(offX: number, offY: number): void {
    const R = this.fx.rain;
    const panes = this.panesOf(R);
    if (R.on) {
      // Дощ малюємо Graphics-ом щокадру, обрізаний маскою по шибках
      // (хрестовина рами лишається темною — краплі тільки на склі).
      this.rainGfx = this.add.graphics().setScrollFactor(0).setDepth(2);
      const maskShape = this.make.graphics({}, false);
      for (const p of panes) maskShape.fillRect(p.x0 + offX, p.y0 + offY, p.x1 - p.x0, p.y1 - p.y0);
      this.rainGfx.setMask(maskShape.createGeometryMask());
    }

    if (!this.fx.bolt.on) return;
    // Світло блискавки у вікні: канва зі шибками + гаусів блюр у два проходи
    // (вузьке яскраве ядро по склу + широкий м'який ореол на стіну навколо рами).
    // Ключ текстури з габаритами — вікно тепер редаговане, кеш на розмір.
    const gk = `window_glow_${Math.round(R.x0)}_${Math.round(R.y0)}_${Math.round(R.x1)}_${Math.round(R.y1)}_${R.panes ? 1 : 0}`;
    if (!this.textures.exists(gk)) {
      const PAD = 34;
      const w = (R.x1 - R.x0) + PAD * 2;
      const h = (R.y1 - R.y0) + PAD * 2;
      const c = document.createElement('canvas'); c.width = Math.max(2, w); c.height = Math.max(2, h);
      const x = c.getContext('2d')!;
      const drawPanes = (): void => {
        for (const p of panes) x.fillRect(p.x0 - R.x0 + PAD, p.y0 - R.y0 + PAD, p.x1 - p.x0, p.y1 - p.y0);
      };
      x.fillStyle = 'rgba(238,242,255,0.5)';
      x.filter = 'blur(13px)'; drawPanes();   // широкий ореол (світло «виливається» на раму/стіну)
      x.fillStyle = 'rgba(244,247,255,0.95)';
      x.filter = 'blur(4px)'; drawPanes();    // яскраве ядро по склу з м'яким краєм
      x.filter = 'none';
      this.textures.addCanvas(gk, c);
    }
    this.windowFlash = this.add.image(
      (R.x0 + R.x1) / 2 + offX,
      (R.y0 + R.y1) / 2 + offY,
      gk,
    ).setScrollFactor(0).setDepth(3).setAlpha(0).setBlendMode(Phaser.BlendModes.ADD);

    this.roomFlash = this.add.rectangle(LOGICAL_W / 2 + offX, LOGICAL_H / 2 + offY, LOGICAL_W, LOGICAL_H, 0xeef1ff, 0)
      .setScrollFactor(0).setDepth(40);
    this.boltNext = 3 + Math.random() * 6;
  }

  // Краплі за вікном — та сама математика, що в грі (jittered колонки, нахил, фаза).
  private drawWindowRain(t: number, offX: number, offY: number): void {
    const g = this.rainGfx; if (!g) return;
    g.clear();
    const R = this.fx.rain;
    const angle = Math.tan(R.dir * Math.PI / 180);
    const X0 = R.x0 + offX, Y0 = R.y0 + offY;
    const W = R.x1 - R.x0, H = R.y1 - R.y0;
    const hash = (n2: number): number => { const s = Math.sin(n2 * 127.1) * 43758.5453; return s - Math.floor(s); };
    const n = Math.max(6, Math.round(W / 3.6)); // щільність пропорційна ширині вікна
    const len = 24 * 0.55; // менша «глибина» за вікном
    const speed = R.speed * 0.55;
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
      g.lineStyle(1.4, RAIN_COLOR, R.alpha * ra);
      g.beginPath(); g.moveTo(sx, sy); g.lineTo(sx + len * rlen * angle, sy + len * rlen); g.strokePath();
    }
  }

  // Блискавка: подвійний блим (як справжня) — вікно яскраво, кімната білим відсвітом.
  private stepLightning(dt: number): void {
    const B = this.fx.bolt;
    if (!B.on || !this.windowFlash) return;
    if (this.boltOn > 0) {
      this.boltOn -= dt;
      const k = Math.max(0, this.boltOn / this.boltDur);
      // подвійний імпульс: пік → провал → менший пік
      const pulse = Math.max(0, Math.sin(k * Math.PI)) * (k > 0.45 ? 1 : 0.55) * B.bright;
      this.windowFlash?.setAlpha(Math.min(1, pulse));
      this.roomFlash?.setFillStyle(0xeef1ff, Math.min(0.5, pulse * 0.30));
      if (this.boltOn <= 0) { this.windowFlash?.setAlpha(0); this.roomFlash?.setFillStyle(0xeef1ff, 0); }
    } else {
      this.boltNext -= dt;
      if (this.boltNext <= 0) {
        const vary = B.vary;
        this.boltDur = 0.38 * (1 - vary * 0.5 + Math.random() * vary);
        this.boltOn = this.boltDur;
        this.boltNext = B.every * (1 - vary + Math.random() * vary * 2);
        triggerThunder(4000 + Math.random() * 2500); // далекий грім: ~4-6.5с після спалаху
      }
    }
  }

  // Тягне персонажа гравця (localStorage zag_game_char → fallback public/character.json)
  // і саджає перед вогнищем у позі 'sit'. Немає арту → просто не показуємо (без падінь).
  private seatingChar = false;
  private async seatCharacter(offX: number, offY: number): Promise<void> {
    // Захист від дубля: якщо персонаж уже саджається або вже стоїть — не створюємо
    // другого (два асинхронні виклики або повторний вхід давали двох персонажів).
    if (this.seatingChar || this.lobbyChar) return;
    this.seatingChar = true;
    const doc = await MenuScene.loadCharDoc();
    if (!doc || !this.scene.isActive()) { this.seatingChar = false; return; }
    // Дефолт лише коли розрізу НЕМА: авторський cut торса з рігу не перетираємо
    // (перетирання ламало позу — персонаж у меню виходив нахилений/зіжмаканий).
    if (doc.slots?.torso && doc.slots.torso.cut == null) doc.slots.torso.cut = 0.5;
    const char = await CutoutCharacter.load(this, doc, 'lobby_').catch(() => null);
    this.seatingChar = false;
    if (!char || !this.scene.isActive() || this.lobbyChar) { char?.destroy(); return; }
    const st = this.charSetup();
    char.setAnim(st.anim);
    // Обгортка задає позицію/масштаб: tick() щокадру перезаписує scaleX/Y самого персонажа.
    const holder = this.add.container(st.x + offX, st.y + offY, [char]);
    holder.setScrollFactor(0).setScale(st.scale).setDepth(5);
    // Поставити ступні на вказану висоту (для стоячих поз в Інвентарі).
    if (st.feetY != null) { char.tick(0, CHAR_FACING); holder.y = st.feetY + offY - char.feetOffset() * st.scale; }
    this.lobbyChar = char;
    this.charHolder = holder;
    this.onCharReady(char);
  }

  // ── Збір побратимів біля вогнища (сторінка Хоругва) ─────────────────────────
  // 5 місць по колу: правий стоїть (як інвентар), сидить на лавці (як житло),
  // двоє ліворуч у айдлі (дзеркально), пʼятий за вогнищем. Плановості ще нема —
  // пʼятий поки «на вогні» (Остап потім переробить локацію).
  private gatherSlots(): Array<{ x: number; feetY?: number; y?: number; anim: string; facing: number; depth: number }> {
    const C = this.fx.char;
    return [
      { x: C.x + 55, feetY: 522, anim: 'idle', facing: -1, depth: 5 }, // правий стоїть
      { x: C.x, y: C.y, anim: 'sit', facing: -1, depth: 5 },           // на лавці сидить
      { x: 2 * this.fx.fire.x - (C.x + 55), feetY: 522, anim: 'idle', facing: 1, depth: 5 }, // дзеркало правого
      { x: 2 * this.fx.fire.x - C.x, feetY: 500, anim: 'idle', facing: 1, depth: 5 },        // дзеркало лавки
      { x: this.fx.fire.x, feetY: 468, anim: 'idle', facing: -1, depth: 4 },                 // за вогнищем
    ];
  }

  private clearGathering(): void {
    this.gatherGen++;
    this.regather = null;
    for (const g of this.gather) g.holder.destroy(true);
    this.gather = [];
    this.charHolder?.setVisible(true); // повертаємо одинокого lobbyChar
  }

  private buildGathering(offX: number, offY: number): void {
    this.clearGathering();
    const gen = ++this.gatherGen;
    void publishMyChar().catch(() => {}); // хай побратими бачать МЕНЕ (док+спорядження)
    const slots = this.gatherSlots();
    const place = (members: KhMember[]): void => {
      if (gen !== this.gatherGen || !this.scene.isActive()) return;
      // Збір потрібен лише для паті 2+. Сам (0-1) — звичайний одинокий lobbyChar.
      if (members.length < 2) {
        for (const g of this.gather) g.holder.destroy(true);
        this.gather = []; this.charHolder?.setVisible(true);
        return;
      }
      this.charHolder?.setVisible(false); // у зборі свій lobbyChar ховаємо — він у колі
      // Перебудова лише коли склад змінився (щоб не мерехтіло при кожному оновленні).
      if (this.gather.length === Math.min(members.length, 5)) return;
      for (const g of this.gather) g.holder.destroy(true);
      this.gather = [];
      members.slice(0, 5).forEach((m, i) => {
        const slot = slots[i];
        // Спершу МАЛЮЄМО персонажа (не чекаючи спорядження — його доліпимо пізніше,
        // щоб повільний Firebase не тримав увесь збір порожнім).
        void loadMemberCharDoc(m.id, m.charId ?? '').then((doc) => {
          if (gen !== this.gatherGen || !this.scene.isActive() || !doc) return;
          if (doc.slots?.torso && doc.slots.torso.cut == null) doc.slots.torso.cut = 0.5;
          void CutoutCharacter.load(this, doc, 'gath_' + m.id + '_').then((char) => {
            if (gen !== this.gatherGen || !this.scene.isActive()) { char.destroy(); return; }
            char.setAnim(slot.anim);
            const holder = this.add.container(slot.x + offX, (slot.y ?? 0) + offY, [char]);
            holder.setScrollFactor(0).setScale(this.fx.char.scale).setDepth(slot.depth);
            if (slot.feetY != null) { char.tick(0, slot.facing); holder.y = slot.feetY + offY - char.feetOffset() * this.fx.char.scale; }
            const entry = { id: m.id, char, holder, facing: slot.facing, equipSig: '' };
            this.gather.push(entry);
            // Спорядження — окремо, коли приїде (не блокує появу персонажа).
            void loadMemberEquip(m.id).then((equip) => {
              if (gen !== this.gatherGen) return;
              entry.equipSig = JSON.stringify(equip);
              char.setEquipment(equip);
            });
          });
        });
      });
    };
    // Переперевірка складу (update викликає throttled): вхід/вихід учасника →
    // збір перебудується, а після «Покинути» (0-1) — повернеться одинокий персонаж.
    this.regather = () => place(cachedMembers());
    place(cachedMembers());              // миттєво з кешу
    void refreshMembers().then(place);   // оновлення з мережі
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
    this.lobbyChar?.tick(deltaMs / 1000, CHAR_FACING);
    for (const g of this.gather) g.char.tick(deltaMs / 1000, g.facing); // збір біля вогнища
    // Раз на ~0.8с переперевіряємо склад збору (хтось приєднався/вийшов).
    if (this.regather) { this.regatherAcc += deltaMs; if (this.regatherAcc > 800) { this.regatherAcc = 0; this.regather(); } }
    // Раз на ~3с оновлюємо спорядження побратимів (я публікую своє, тягну їхнє) —
    // щоб меч/броня, вдягнені під час збору, зʼявились у всіх без перебудови.
    if (this.gather.length) {
      this.equipAcc += deltaMs;
      if (this.equipAcc > 3000) {
        this.equipAcc = 0;
        void publishMyEquip();
        for (const g of this.gather) {
          void loadMemberEquip(g.id).then((equip) => {
            const sig = JSON.stringify(equip);
            if (sig !== g.equipSig) { g.equipSig = sig; g.char.setEquipment(equip); }
          });
        }
      }
    }
    // Мерехтіння вогню: сума неспівмірних синусів = живий нерівний ритм.
    this.fireTime += deltaMs / 1000;
    const t = this.fireTime;
    const offX = LOGICAL_W * (RENDER_SCALE - 1) / 2;
    const offY = LOGICAL_H * (RENDER_SCALE - 1) / 2;
    this.drawWindowRain(t, offX, offY);
    this.stepLightning(deltaMs / 1000);
    const f = 0.5 + 0.5 * (Math.sin(t * 7.3) * 0.5 + Math.sin(t * 12.7 + 1.3) * 0.3 + Math.sin(t * 3.1 + 2.1) * 0.2);
    if (this.fireGlow) {
      const F = this.fx.fire;
      // при glow=0.16 діапазон 0.11..0.21 — як було до редагованих ефектів
      this.fireGlow.setAlpha(F.glow * (0.7 + 0.62 * f));
      this.fireGlow.setScale((10.6 + f * 1.2) * F.scale, (7.2 + f * 0.9) * F.scale);
    }
    // Переливи на сцені: фон і персонаж ледь теплішають/холоднішають у такт.
    const warm = (base: number, amp: number): number => Math.round(base + amp * f);
    const tint = (warm(236, 19) << 16) | (warm(222, 20) << 8) | warm(205, 22);
    this.bgImg?.setTint(tint);
    if (this.lobbyChar) this.lobbyChar.ambientTint = tint;
  }

  // Кнопка меню: лише текст (без підкладки/обводки), small-caps, підсвітка + зсув при наведенні.
  protected makeMenuItem(x: number, y: number, label: string, onClick: () => void, size = 34): void {
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
