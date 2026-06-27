import Phaser from 'phaser';
import { WORLD_WIDTH, BAND_DEPTH, FLOOR_MARGIN, PLAYER, STATS, RENDER_SCALE } from '../config';
import { InputController } from '../core/input';
import { Player } from '../entities/Player';
import { Enemy } from '../entities/Enemy';
import { CutoutCharacter, type CharDoc } from '../anim/CutoutCharacter';
import { buildLevelView, animOffset, deformKfAt, deformImgPt, type LevelDoc, type PlacedAnim, type PlacedDeform } from '../level/LevelView';
import { footprintWorldCells } from '../level/footprint';
import { saveValue } from '../telegram';
import { idbGet } from '../store';
import { loadPublishedBehaviors } from '../behaviors';
import { openDialog, isDialogActive } from '../dialogUI';
import {
  pushPlayerState, watchGameState, getLobbyPlayers, getChosenChar,
  getPlayerId, getPlayerName, type PlayerState,
} from '../multiplayer/lobby';
import { loadCharLibrary, docById, type LibItem } from '../charlib';
import type { NodeGraph } from '../node-editor';
import { type Atmosphere, type WeatherType, evalSky, evalTod, evalWeather } from '../level/atmosphere';

interface Remote {
  container: CutoutCharacter | null;
  loading: boolean;
  charId: string;
  rx: number; ry: number; rz: number;  // згладжена позиція (+ висота підскоку)
  tx: number; ty: number; tz: number;  // ціль із мережі
  anim: string; facing: number;
}

const FIXED_DT = 1 / 60; // фіксований крок симуляції -> детермінізм (multiplayer-ready)
const GATE_X = 1150; // поки арена не зачищена, далі не пройти
const WAVE_TRIGGER_X = 760; // де набігає хвиля

export class GameScene extends Phaser.Scene {
  private player!: Player;
  private controls!: InputController;
  private enemies: Enemy[] = [];
  private character: CutoutCharacter | null = null;

  // Динамічний макет: заповнюємо весь в'юпорт, смуга підлоги — від низу екрана.
  private worldH = 540;
  private bandTop = 320;
  private bandBottom = 510;

  private skyRect!: Phaser.GameObjects.Rectangle;
  private groundRect!: Phaser.GameObjects.Rectangle;
  private horizon!: Phaser.GameObjects.Rectangle;
  private gateLine!: Phaser.GameObjects.Rectangle;
  private goal!: Phaser.GameObjects.Rectangle;
  private goalLabel!: Phaser.GameObjects.Text;

  // Атмосфера
  private atmosphere: Atmosphere | null = null;
  private atmTime = 0;
  private weatherTime = 0;
  private ambientRect!: Phaser.GameObjects.Rectangle;
  private fogRect!: Phaser.GameObjects.Rectangle;
  private weatherFar!: Phaser.GameObjects.Graphics;   // дальній шар — розмитий, блідий, повільний
  private weatherMid!: Phaser.GameObjects.Graphics;   // середній — чіткий
  private weatherNear!: Phaser.GameObjects.Graphics;  // ближній — розмитий, швидкі довгі смуги

  private banner!: Phaser.GameObjects.Text;

  // HUD — три бари з іконками
  private hudBars: Phaser.GameObjects.Graphics | null = null;
  private hudFills: Phaser.GameObjects.Graphics | null = null;
  private hudIcons: Phaser.GameObjects.Image[] = [];
  private hudLayout: Array<{ iconKey: string; iconCx: number; barX: number; barW: number }> = [];
  private hudSig = ''; // підпис стану барів — перемальовуємо заливку лише при зміні
  private bwActive = false; // чи увімкнено ч/б екран (тривожність = 100)

  private finished = false;
  private waveSpawned = false;
  private cleared = false;
  private levelMode = false;
  private levelStart = 0;
  private levelEnd = WORLD_WIDTH;
  private levelBand: { top: number; bottom: number } | null = null; // прохідна смуга з намальованих колайдерів
  private colliderCells: string[] = [];
  private colliderGrid = 48;
  private floorSet = new Set<string>(); // "cx,cy" намальованих підлогових (h) клітинок — для поклітинкової прохідності
  private cellLevel = new Map<string, number>(); // "cx,cy" → рівень висоти клітинки (0 = земля); елевація px = рівень·gs
  private blockedCells = new Set<string>(); // "cx,cy" вирізані футпринтами ассетів — непрохідні (персонаж обходить, малюється за)
  private greenCells = new Set<string>(); // "cx,cy" ручні зелені override-клітинки — примусово прохідні (перекривають виріз футпринта)
  // Паралакс-шари: анкеримо їх до ФАКТИЧНОЇ scrollX камери на старті (а не до lv.start), бо камера
  // стоїть там, куди її ставить спавн+зум+клемп. Зчитуємо scrollX, коли камера стабілізувалась.
  private parallaxLayers: { im: Phaser.GameObjects.Image; baseX: number; sf: number }[] = [];
  private parallaxAnchored = false;
  private lastCamScrollX = NaN;
  // Анімовані ассети рівня (обертання/переміщення). Базу (позиція/кут) фіксуємо лениво —
  // для паралакс-шарів після анкера, інакше зразу.
  private levelAnims: { im: Phaser.GameObjects.Image; anim: PlacedAnim; isPlx: boolean; based: boolean; bx: number; by: number; br: number }[] = [];
  private lvlAnimTime = 0;
  private lvlKfAnims: { mesh: Phaser.GameObjects.Mesh; deform: PlacedDeform; W: number; H: number; N: number; scale: number; flip: number; idx: number[] }[] = [];
  private lvlBakedAnims: { mesh: Phaser.GameObjects.Mesh; deform: PlacedDeform; W: number; H: number; N: number; scale: number; flip: number; anim: PlacedAnim; idx: number[] }[] = [];
  private lvlKfTime = 0;
  private playerSpawned = false;
  private accumulator = 0;
  private simTime = 0; // власний час симуляції (мс), незалежний від кадрів
  private hotkeyAnimEnd = 0; // поки simTime < цього — не скидаємо анімацію від хоткея
  private wasGrounded = true;
  private landAnimUntil = 0;

  // ── мультиплеєр / вибір персонажа / точки спавна ──
  private spawns: { x: number; y: number }[] = [];
  private lib: LibItem[] = [];
  private libReady: Promise<void> | null = null;
  private levelReady!: Promise<void>;
  private resolveLevelReady!: () => void;
  private lobbyCode = '';
  private isMulti = false;
  private myId = '';
  private myCharId = '';
  private curAnim = 'idle';
  private lastNetPush = 0;
  private netStates: Record<string, PlayerState> = {};
  private remotes: Record<string, Remote> = {};
  private unwatchState: (() => void) | null = null;
  private started = false;

  constructor() {
    super('Game');
  }

  // Логічні розміри кадру (backing у RENDER_SCALE× більший — ділимо, щоб лишити 1280×576).
  private get logicalW(): number { return this.scale.width / RENDER_SCALE; }
  private get logicalH(): number { return this.scale.height / RENDER_SCALE; }
  // Зсув для UI (scrollFactor(0)) елементів. Камера має setZoom(RENDER_SCALE), а Phaser масштабує
  // й нерухомі (sf=0) об'єкти НАВКОЛО центру камери → елемент у логічних координатах виїжджає за
  // екран. Додаємо logicalW·(RS−1)/2 до позиції UI, щоб після зум-навколо-центру він лягав туди ж,
  // де в логічному кадрі 1280×576. При RS=1 зсув=0 (без змін).
  private get uiOffX(): number { return this.logicalW * (RENDER_SCALE - 1) / 2; }
  private get uiOffY(): number { return this.logicalH * (RENDER_SCALE - 1) / 2; }

  private get band(): { top: number; bottom: number } {
    return this.levelBand ?? { top: this.bandTop, bottom: this.bandBottom };
  }

  private getBandAtX(worldX: number): { top: number; bottom: number } {
    if (!this.levelMode || !this.colliderCells.length) return this.band;
    const gs = this.colliderGrid; const k = gs * Math.SQRT1_2;
    // Та сама ізо-ґратка, що у редакторі: підлогова клітинка (cx,cy) лежить на
    // editorX = cx*gs+cy*k, editorY = cy*k. gameY = bandBottom + editorY.
    // Прохідна смуга при X = вертикальний (по глибині) діапазон намальованих
    // підлогових клітинок, що накривають цей X. Тож персонаж ходить ТІЛЬКИ по них.
    let minY = Infinity, maxY = -Infinity;
    for (const c of this.colliderCells) {
      const p = c.split(',');
      if ((p[2] ?? 'h') !== 'h') continue;
      const cx = Number(p[0]), cy = Number(p[1]);
      if (this.blockedCells.has(cx + ',' + cy)) continue; // вирізано футпринтом — не прохідно
      const x0 = cx * gs + cy * k, x1 = (cx + 1) * gs + (cy + 1) * k;
      if (worldX < x0 || worldX >= x1) continue;
      const y0 = cy * k, y1 = (cy + 1) * k;
      if (y0 < minY) minY = y0;
      if (y1 > maxY) maxY = y1;
    }
    if (minY === Infinity) return this.band;
    return { top: this.bandBottom + minY, bottom: this.bandBottom + maxY };
  }

  // Елевація поверхні (px) у точці (gameX, gameY): висота клітинки-платформи під нею,
  // або null = підлоги нема (отвір/край). Та сама ізо-ґратка, що в редакторі
  // (editorY = gameY - bandBottom). Гравець упирається в клітинку, чия поверхня вища
  // за його поточну висоту (= стіна/сходинка), і приземляється на ту, що ≤ висоти.
  private surfaceAt(gameX: number, gameY: number): number | null {
    if (!this.levelMode || !this.floorSet.size) {
      const b = this.band;
      return (gameY >= b.top && gameY <= b.bottom) ? 0 : null;
    }
    const gs = this.colliderGrid; const k = gs * Math.SQRT1_2;
    const editorY = gameY - this.bandBottom;
    const fcx = (gameX - editorY) / gs, fcy = editorY / k;
    const cx = Math.floor(fcx), cy = Math.floor(fcy);
    const lvl = (ix: number, iy: number): number => this.cellLevel.get(ix + ',' + iy) ?? 0;
    if (this.floorSet.has(cx + ',' + cy) && !this.blockedCells.has(cx + ',' + cy)) return lvl(cx, cy) * gs;
    // Авто-фаска: порожня клітинка з двома замальованими СУМІЖНИМИ сторонами =
    // внутрішній кут; половинка-трикутник до того кута прохідна (зрізаємо кут по
    // діагоналі). fx,fy — локальні 0..1 у клітинці; "/"=fx+fy, "\"=fx−fy.
    // Фаска успадковує висоту сусідньої клітинки-платформи, яку згладжує.
    const has = (ix: number, iy: number): boolean => this.floorSet.has(ix + ',' + iy) && !this.blockedCells.has(ix + ',' + iy);
    const fx = fcx - cx, fy = fcy - cy;
    const L = has(cx - 1, cy), R = has(cx + 1, cy), U = has(cx, cy - 1), D = has(cx, cy + 1);
    if (L && U && fx + fy < 1) return lvl(cx - 1, cy) * gs; // верх-ліво (діагональ /)
    if (R && D && fx + fy > 1) return lvl(cx + 1, cy) * gs; // низ-право  (діагональ /)
    return null;
  }

  create(): void {
    this.finished = false;
    this.enemies = [];
    this.waveSpawned = false;
    this.cleared = false;
    this.accumulator = 0;
    this.simTime = 0;
    this.started = false;
    this.playerSpawned = false;
    this.parallaxAnchored = false; this.parallaxLayers = []; this.lastCamScrollX = NaN;
    this.levelAnims = []; this.lvlAnimTime = 0;
    this.remotes = {};
    this.netStates = {};
    this.levelReady = new Promise<void>((res) => { this.resolveLevelReady = res; });

    this.cameras.main.setBackgroundColor('#2a2233');
    this.cameras.main.setZoom(RENDER_SCALE); // backing×RENDER_SCALE + zoom = те саме поле огляду, але різкіше
    this.cameras.main.postFX.clear(); // скинути ч/б з минулого життя сцени (камера переживає restart)
    this.bwActive = false;
    this.computeLayout();

    // Фон: "небо" зверху + смуга підлоги знизу (присмерковий тон у дусі Don't Starve).
    // Depth -2000/-1999: нижче sky-шару рівня (-1400) — не перекриває ассети.
    this.skyRect    = this.add.rectangle(0, 0, 10, 10, 0x3a3148).setDepth(-2000);
    this.groundRect = this.add.rectangle(0, 0, 10, 10, 0x4a3f2e).setDepth(-1999);
    this.horizon    = this.add.rectangle(0, 0, 10, 3, 0x000000, 0.25).setDepth(-1998);
    this.gateLine   = this.add.rectangle(0, 0, 6, 10, 0x000000, 0.25).setDepth(-1997);

    // Ambient/fog overlay: world-space (scrollFactor=1), поверх ассетів (depth 8000).
    // Переміщується з камерою → рівномірно тонує весь видимий рівень (час доби).
    this.ambientRect = this.add.rectangle(WORLD_WIDTH / 2, 0, WORLD_WIDTH * 3, 10, 0x000000, 0).setDepth(8000);
    this.fogRect     = this.add.rectangle(WORLD_WIDTH / 2, 0, WORLD_WIDTH * 3, 10, 0x8899bb, 0).setDepth(8001);
    // Дощ/сніг: 3 world-space шари (як спрайти), малюємо по camera.worldView → завжди
    // покриває весь видимий екран. Дальній і ближній — з блюром (кінематографічний дощ).
    this.weatherFar  = this.add.graphics().setDepth(8002);
    this.weatherMid  = this.add.graphics().setDepth(8003);
    this.weatherNear = this.add.graphics().setDepth(8004);
    try {
      this.weatherFar.postFX.addBlur(1, 2, 2, 1.0);
      this.weatherNear.postFX.addBlur(1, 2, 2, 1.6);
    } catch { /* postFX недоступний на деяких рендерерах — лишаємо без блюру */ }
    this.atmosphere = null; this.atmTime = 0; this.weatherTime = 0;

    // Магазин — ціль рівня
    this.goal = this.add.rectangle(WORLD_WIDTH - 120, 0, 70, 120, 0xffd000).setOrigin(0.5, 1);
    this.goalLabel = this.add.text(0, 0, 'МАГАЗИН', {
      fontFamily: 'monospace',
      fontSize: '16px',
      color: '#ffd000',
    });
    this.repositionWorld();

    // Сховати екран завантаження — фон готовий, різкого мигання не буде
    const loadScreen = document.getElementById('loadScreen');
    if (loadScreen) {
      const fill = document.getElementById('loadFill');
      if (fill) fill.style.width = '100%';
      setTimeout(() => {
        loadScreen.classList.add('hide');
        setTimeout(() => loadScreen.remove(), 500);
      }, 150);
    }

    // Герой
    this.player = new Player(this, 90, this.bandBottom - 10);
    this.player.maxX = GATE_X - 30;
    this.controls = new InputController(this);
    this.cameras.main.startFollow(this.player, true, 0.08, 0);

    // Персонаж завантажується НЕ тут, а коли лобі дасть старт (подія 'lobbyStart'):
    // соло (порожній код) → свій персонаж; кооп → обраний у лобі + інші гравці.
    this.character = null;
    this.myId = getPlayerId();
    this.libReady = loadCharLibrary().then((l) => { this.lib = l; });

    const onStart = (ev: Event): void => {
      const code = (ev as CustomEvent<{ code?: string }>).detail?.code ?? '';
      void this.beginPlay(code);
    };
    window.addEventListener('lobbyStart', onStart);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      window.removeEventListener('lobbyStart', onStart);
      this.unwatchState?.();
    });
    // Якщо лобі немає (вбудований прев'ю студії) — одразу соло, щоб персонаж зʼявився.
    const lobbyEl = document.getElementById('lobby');
    if (!lobbyEl || lobbyEl.classList.contains('hidden')) void this.beginPlay('');

    // Рівень із редактора (IndexedDB zag_level або public/level.json)
    this.levelMode = false;
    const lvP: Promise<LevelDoc | null> = idbGet<LevelDoc>('zag_level')
      .then((stored) => stored ?? fetch(`${import.meta.env.BASE_URL}level.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null))
      .catch(() => null);
    lvP.then((doc) => { if (doc && doc.placed) this.applyLevel(doc); this.resolveLevelReady(); })
      .catch(() => this.resolveLevelReady());

    // HUD — три бари (серце / сонце / череп)
    this.buildHudLayout();
    this.createHudGraphics();

    this.banner = this.add
      .text(0, 0, '', { fontFamily: 'monospace', fontSize: '20px', color: '#ffd000' })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(10000);

    // Реакція на зміну розміру вікна Telegram / браузера
    this.scale.on('resize', this.onResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.scale.off('resize', this.onResize, this));

    // Нода «Діалог» у поведінці ворога просить відкрити діалогову кульку.
    const onDialog = (d: { graph: NodeGraph; nodeId: string; getHeadPos?: () => { wx: number; wy: number }; onOutcome?: (o: 'positive' | 'negative') => void }): void => {
      if (isDialogActive()) return;
      // getHeadPos — живий callback: кожного кадру запитуємо поточну позицію голови
      // ворога, тож кулька й хвіст слідкують навіть якщо ворог рухається і камера їде.
      const getAnchor = d.getHeadPos
        ? (): { x: number; y: number } => {
            const { wx, wy } = d.getHeadPos!();
            const cam = this.cameras.main;
            const v = cam.worldView;
            const canvas = this.sys.game.canvas;
            const rect = canvas.getBoundingClientRect();
            return {
              x: rect.left + (wx - v.x) / v.width  * rect.width,
              y: rect.top  + (wy - v.y) / v.height * rect.height,
            };
          }
        : undefined;
      openDialog(d.graph, d.nodeId, { getAnchor, onOutcome: d.onOutcome });
    };
    this.events.on('enemyDialog', onDialog);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.events.off('enemyDialog', onDialog));
  }

  // Рахує смугу підлоги під поточний розмір екрана (без зуму: 1 світ = 1 піксель,
  // тож HUD і спрайти лишаються чіткими та на місцях, а чорних полів немає).
  private computeLayout(): void {
    this.worldH = this.logicalH;
    this.bandBottom = this.worldH - FLOOR_MARGIN;
    this.bandTop = Math.max(this.worldH * 0.28, this.bandBottom - BAND_DEPTH);
    if (this.levelMode) this.cameras.main.setBounds(this.levelStart, 0, Math.max(1, this.levelEnd - this.levelStart), this.worldH);
    else this.cameras.main.setBounds(0, 0, WORLD_WIDTH, this.worldH);
  }

  // Застосувати рівень із редактора: візуал + спавн + межі камери/гравця.
  private applyLevel(doc: LevelDoc): void {
    this.levelMode = true;
    const hasSky = !!doc.atmosphere?.sky?.enabled;
    this.skyRect.setVisible(hasSky); this.groundRect.setVisible(hasSky); this.horizon.setVisible(hasSky);
    this.gateLine.setVisible(false); this.goal.setVisible(false); this.goalLabel.setVisible(false);
    this.atmosphere = doc.atmosphere ?? null; this.atmTime = 0; this.weatherTime = 0;
    // Скидаємо overlays одразу, щоб не лишилось від минулого рівня
    this.ambientRect.setFillStyle(0x000000, 0);
    this.fogRect.setFillStyle(0x8899bb, 0);
    this.weatherFar.clear(); this.weatherMid.clear(); this.weatherNear.clear();
    for (const e of this.enemies) e.destroy();
    this.enemies = [];
    this.levelStart = doc.start ?? 0;
    this.levelEnd = Math.max(this.levelStart + 200, doc.end ?? WORLD_WIDTH);
    this.player.minX = this.levelStart + 20;
    this.player.maxX = this.levelEnd - 20;

    // Прохідна смуга (глибина) — з намальованих колайдерів. Координати ті самі,
    // що й у візуалі рівня (gameY = bandBottom + редакторний y), тож персонаж
    // ходить саме там, де намальовано «де можна ходити». Нема колайдерів -> дефолт.
    // Висота намальованої зони = глибина прохідної смуги. Смугу кладемо так, щоб
    // її передній край був на лінії підлоги (найближче до камери), а вглиб вона
    // тягнеться вгору по екрану. Це тримає всю зону у видимій частині (редактор
    // має «землю» на 60% висоти, а гра — біля самого низу, тож пряме перенесення
    // редакторного Y затягувало б персонажа за нижній край екрана).
    this.colliderCells = doc.collider ?? [];
    this.colliderGrid = doc.grid ?? 48;
    // Набір підлогових клітинок + їхні рівні висоти (для прохідності й елевації).
    // Формат клітинки: "cx,cy,h" (рівень 0) або "cx,cy,h,L" (піднята платформа L).
    this.floorSet.clear();
    this.cellLevel.clear();
    // Зелені override-клітинки: ручний колайдер прохідності ("cx,cy,g") — примусово прохідні.
    this.greenCells.clear();
    for (const c of this.colliderCells) { const p = c.split(','); if (p[2] === 'g') this.greenCells.add(p[0] + ',' + p[1]); }
    // Compute global fallback band from all cells (used when no cells at player's X)
    this.levelBand = null;
    if (this.colliderCells.length) {
      const gs = this.colliderGrid; const k = gs * Math.SQRT1_2;
      let minY = Infinity, maxY = -Infinity;
      for (const c of this.colliderCells) {
        const p = c.split(','); if ((p[2] ?? 'h') !== 'h') continue;
        const cy = Number(p[1]); if (!Number.isFinite(cy)) continue;
        const key = p[0] + ',' + p[1];
        this.floorSet.add(key);
        const lvl = Number(p[3]) || 0; if (lvl) this.cellLevel.set(key, lvl);
        const y0 = cy * k, y1 = (cy + 1) * k;
        if (y0 < minY) minY = y0; if (y1 > maxY) maxY = y1;
      }
      if (minY !== Infinity) this.levelBand = { top: this.bandBottom + minY, bottom: this.bandBottom + maxY };
    }
    // Футпринти ассетів — вирізаємо клітинки з прохідної підлоги (ті самі ізо-координати,
    // що й колайдери: центр ассета = p.x,p.y у редакторному просторі = p.x, editorY=p.y у грі).
    this.blockedCells.clear();
    {
      const gs = this.colliderGrid;
      const fpMap = new Map<string, { cells: { dx: number; dy: number }[] }>();
      for (const a of doc.assets) if (a.footprint?.cells?.length) fpMap.set(a.id, a.footprint);
      if (fpMap.size) for (const p of doc.placed) {
        const f = fpMap.get(p.asset); if (!f) continue;
        for (const c of footprintWorldCells(f, { x: p.x, y: p.y, scale: p.scale, flip: p.flip, rot: p.rot }, p.x, p.y, gs)) this.blockedCells.add(c);
      }
      // Зелені override-клітинки перемагають виріз: знімаємо блок і гарантуємо підлогу (рівень 0, якщо ще нема).
      for (const g of this.greenCells) { this.blockedCells.delete(g); if (!this.floorSet.has(g)) this.floorSet.add(g); }
    }

    // Вороги з намальованих зон 3×3: позиція в межах зони — детермінована (однакова
    // на всіх клієнтах коопу й між перезаходами), щоб не було розсинхрону.
    if (doc.enemySpawns && doc.enemySpawns.length) {
      const gs = this.colliderGrid, k = gs * Math.SQRT1_2;
      const rnd = (a: number, b: number): number => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };
      const toAttach: Array<{ enemy: Enemy; charId: string }> = [];
      for (const z of doc.enemySpawns) {
        const p = z.split(','); const acx = Number(p[0]), acy = Number(p[1]);
        if (!Number.isFinite(acx) || !Number.isFinite(acy)) continue;
        const rcx = acx + rnd(acx, acy) * 3, rcy = acy + rnd(acy, acx) * 3;
        const gx = rcx * gs + rcy * k, gy = this.bandBottom + rcy * k;
        const enemy = new Enemy(this, gx, gy);
        this.enemies.push(enemy);
        if (p[2]) toAttach.push({ enemy, charId: p[2] });
      }
      if (toAttach.length) {
        void (this.libReady ?? Promise.resolve()).then(async () => {
          // Опубліковані поведінки з репо (працюють на всіх пристроях/коопі), один раз.
          const pub = await loadPublishedBehaviors();
          toAttach.forEach(({ enemy, charId }, i) => {
            const d = docById(this.lib, charId);
            if (d) void enemy.attachChar(d, `npc_${i}_`);
            // нодова поведінка цього ворога (1 крок = 1 клітинка колайдера = gs px):
            // спершу локальна IDB (свіжі правки автора), фолбек — опублікований граф.
            void idbGet<NodeGraph>('zag_behavior_' + charId)
              .then((bg) => enemy.setBehavior(bg ?? pub[charId] ?? null, gs))
              .catch(() => enemy.setBehavior(pub[charId] ?? null, gs));
          });
        });
      }
    }

    // Точки спавна (кооп): або масив doc.spawns, або один doc.spawn (сумісність). До 5.
    this.spawns = (doc.spawns && doc.spawns.length ? doc.spawns : [doc.spawn ?? { x: this.levelStart + 60, y: 0 }]).slice(0, 5);
    this.cameras.main.setBounds(this.levelStart, 0, this.levelEnd - this.levelStart, this.worldH);
    this.parallaxAnchored = false; this.parallaxLayers = []; this.lastCamScrollX = NaN;
    this.levelAnims = []; this.lvlAnimTime = 0;
    void buildLevelView(this, doc, this.bandBottom).then(() => this.collectParallaxLayers());
    this.banner.setText('');
  }

  // Зібрати паралакс-спрайти (LevelView тегає їх data 'plxSf'/'plxBaseX'). Анкер застосуємо
  // в update(), коли камера стабілізується на стартовому кадрі.
  private collectParallaxLayers(): void {
    this.parallaxLayers = [];
    this.levelAnims = [];
    this.lvlKfAnims = [];
    this.lvlBakedAnims = [];
    for (const o of this.children.list) {
      const im = o as Phaser.GameObjects.Image;
      if (!im.getData) continue;
      const isPlx = im.getData('plxSf') != null;
      if (isPlx) this.parallaxLayers.push({ im, baseX: im.getData('plxBaseX') as number, sf: im.getData('plxSf') as number });
      const anim = im.getData('lvlAnim') as PlacedAnim | undefined;
      if (anim) this.levelAnims.push({ im, anim, isPlx, based: false, bx: 0, by: 0, br: 0 });
      const kfData = im.getData('lvlKfDeform') as { deform: PlacedDeform; W: number; H: number; N: number; scale: number; flip: number } | undefined;
      if (kfData) {
        const { deform, W, H, N, scale, flip } = kfData;
        const idx: number[] = [];
        for (let row = 0; row < N; row++) for (let col = 0; col < N; col++) {
          const i = row * (N + 1) + col;
          idx.push(i, i + 1, i + N + 1, i + 1, i + N + 2, i + N + 1);
        }
        this.lvlKfAnims.push({ mesh: o as Phaser.GameObjects.Mesh, deform, W, H, N, scale, flip, idx });
      }
      const bakedData = im.getData('lvlBakedAnim') as { deform: PlacedDeform; W: number; H: number; N: number; scale: number; flip: number; anim: PlacedAnim } | undefined;
      if (bakedData) {
        const { deform, W, H, N, scale, flip, anim } = bakedData;
        const idx: number[] = [];
        for (let row = 0; row < N; row++) for (let col = 0; col < N; col++) {
          const i = row * (N + 1) + col;
          idx.push(i, i + 1, i + N + 1, i + 1, i + N + 2, i + N + 1);
        }
        this.lvlBakedAnims.push({ mesh: o as Phaser.GameObjects.Mesh, deform, W, H, N, scale, flip, anim, idx });
      }
    }
  }

  // Кейфрейм-анімація деформованих мешів: перебудовуємо вершини щокадру.
  // Після addVertices одразу форсуємо preUpdate — бо Phaser.Mesh.preUpdate виконується
  // ДО scene.update, тому нові вершини (vx/vy=0) інакше дійшли б до рендеру невидимими.
  private updateKfAnims(dt: number): void {
    if (!this.lvlKfAnims.length) return;
    this.lvlKfTime += dt;
    for (const a of this.lvlKfAnims) {
      const interpDeform = deformKfAt(a.deform, this.lvlKfTime);
      const N = a.N, verts: number[] = [], uvs: number[] = [];
      for (let row = 0; row <= N; row++) for (let col = 0; col <= N; col++) {
        const t = col / N, s = row / N;
        const pos = deformImgPt(interpDeform, a.W, a.H, t, s);
        verts.push(pos.x * a.scale * a.flip, -pos.y * a.scale);
        uvs.push(t, s);
      }
      a.mesh.clear();
      a.mesh.addVertices(verts, uvs, a.idx, false);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (a.mesh as any).preUpdate();
    }
  }

  // Запечені деформи: форма фіксована у world-space, UV крутиться анімацією.
  // Оновлюємо лише tu/tv в існуючих вершинах — без clear()/addVertices(), щоб
  // не зкидати vx/vy до нуля між preUpdate і рендером.
  private updateBakedAnims(): void {
    if (!this.lvlBakedAnims.length) return;
    for (const a of this.lvlBakedAnims) {
      const off = animOffset(a.anim, this.lvlAnimTime);
      const rotRad = -(off.rot * Math.PI) / 180;
      const cosA = Math.cos(rotRad), sinA = Math.sin(rotRad);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mv = (a.mesh as any).vertices as Array<any>;
      if (!mv?.length) continue;
      for (let i = 0; i < mv.length; i++) {
        const origIdx = a.idx[i];
        const col = origIdx % (a.N + 1);
        const row = Math.floor(origIdx / (a.N + 1));
        const t = col / a.N, s = row / a.N;
        const ux = t - 0.5, uy = s - 0.5;
        mv[i].tu = 0.5 + ux * cosA - uy * sinA;
        mv[i].tv = 0.5 + ux * sinA + uy * cosA;
      }
    }
  }

  // Програти анімації ассетів рівня. Базу позиції фіксуємо лениво: для паралакс-шарів —
  // після анкера (бо анкер змінює im.x), для решти — одразу.
  private updateLevelAnims(dt: number): void {
    this.lvlAnimTime += dt;
    if (!this.levelAnims.length) return;
    for (const a of this.levelAnims) {
      if (!a.based) {
        if (a.isPlx && !this.parallaxAnchored) continue;
        a.bx = a.im.x; a.by = a.im.y; a.br = a.im.rotation; a.based = true;
      }
      const off = animOffset(a.anim, this.lvlAnimTime);
      if (a.anim.type === 'rotate') a.im.setRotation(a.br + (off.rot * Math.PI) / 180);
      else a.im.setPosition(a.bx + off.dx, a.by + off.dy);
    }
  }

  // Прив'язати паралакс-шари до ФАКТИЧНОЇ scrollX камери на стартовому кадрі: коли камера
  // стала на місце (зсув між кадрами < 0.5px), кожен шар зсуваємо так, щоб при цій scrollX він
  // лягав рівно туди, де намальований (як map, sf=1). Далі — нормальний паралакс відносно цього.
  private anchorParallaxOnSettle(): void {
    if (this.parallaxAnchored || !this.playerSpawned || !this.parallaxLayers.length) return;
    const sx = this.cameras.main.scrollX;
    if (Number.isFinite(this.lastCamScrollX) && Math.abs(sx - this.lastCamScrollX) < 0.5) {
      for (const L of this.parallaxLayers) L.im.x = L.baseX - sx * (1 - L.sf);
      this.parallaxAnchored = true;
    }
    this.lastCamScrollX = sx;
  }

  // Точка спавна гравця за слотом (індексом у лобі). Y — центр прохідної смуги в тому X.
  private spawnPoint(slot: number): { x: number; y: number } {
    const list = this.spawns.length ? this.spawns : [{ x: this.levelStart + 60, y: 0 }];
    const sp = list[slot % list.length];
    const b = this.getBandAtX(sp.x);
    return { x: sp.x, y: (b.top + b.bottom) / 2 };
  }

  // Старт гри після лобі. code === '' → соло; інакше кооп (синхронізація через Firebase).
  private async beginPlay(code: string): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.lobbyCode = code;
    this.isMulti = !!code;
    await Promise.all([this.levelReady, this.libReady ?? Promise.resolve()]);

    // Який персонаж у мене: обраний у лобі (кооп) -> з бібліотеки; інакше zag_game_char / public.
    this.myCharId = getChosenChar() ?? '';
    let myDoc = docById(this.lib, this.myCharId);
    if (!myDoc) myDoc = await this.resolveSoloDoc();
    if (myDoc) await this.buildLocalCharacter(myDoc, 'me_');

    // Слот спавна: соло -> 0; кооп -> позиція в лобі за порядком приєднання.
    let slot = 0;
    if (this.isMulti) {
      try {
        const players = await getLobbyPlayers(code);
        const i = players.findIndex((p) => p.id === this.myId);
        slot = i >= 0 ? i : 0;
      } catch { slot = 0; }
    }
    const sp = this.spawnPoint(slot);
    this.player.spawnAt(sp.x, sp.y);
    // Снеп камери на спавн (без повільного панорамування з 0) — і фіксована точка для анкера паралаксу.
    this.cameras.main.centerOn(sp.x, this.cameras.main.midPoint.y);
    this.playerSpawned = true;

    if (this.isMulti) {
      this.unwatchState = watchGameState(code, (states) => { this.netStates = states; });
    }
  }

  private async resolveSoloDoc(): Promise<CharDoc | null> {
    try { const s = localStorage.getItem('zag_game_char'); if (s) return JSON.parse(s) as CharDoc; } catch { /* ignore */ }
    try { const r = await fetch(`${import.meta.env.BASE_URL}character.json`); if (r.ok) return await r.json() as CharDoc; } catch { /* ignore */ }
    return null;
  }

  // Будує локального персонажа + вішає хоткеї анімацій (як було, але для будь-якого doc).
  private async buildLocalCharacter(doc: CharDoc, prefix: string): Promise<void> {
    if (!doc.slots || !doc.images) return;
    const c = await CutoutCharacter.load(this, doc, prefix).catch(() => null);
    if (!c) return;
    this.character = c;
    this.add.existing(c);
    this.player.setVisible(false);
    if (doc.clips) {
      const hotkeyHandler = (ev: KeyboardEvent): void => {
        if (!this.character) return;
        for (const [name, clip] of Object.entries(doc.clips!)) {
          if (!clip.hotkey) continue;
          if (ev.code === clip.hotkey || ev.key.toLowerCase() === clip.hotkey) {
            this.character.setAnim(name);
            this.hotkeyAnimEnd = this.simTime + clip.duration * 1000;
          }
        }
      };
      window.addEventListener('keydown', hotkeyHandler);
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => window.removeEventListener('keydown', hotkeyHandler));
    }
  }

  // ── Синхронізація гравців у кооп-режимі ──
  private pushMyState(time: number): void {
    if (time - this.lastNetPush < 80) return; // ~12 апдейтів/сек — щадимо Firebase
    this.lastNetPush = time;
    const p = this.player;
    pushPlayerState(this.lobbyCode, {
      x: p.floorX, y: p.floorY, z: p.airHeight, hp: p.hp, maxHp: PLAYER.maxHp,
      anim: this.curAnim, facing: p.facing, charId: this.myCharId, name: getPlayerName(), t: time,
    });
  }

  private syncRemotes(dt: number): void {
    const seen = new Set<string>();
    for (const [id, st] of Object.entries(this.netStates)) {
      if (id === this.myId) continue;
      seen.add(id);
      let r = this.remotes[id];
      if (!r) {
        r = { container: null, loading: false, charId: st.charId, rx: st.x, ry: st.y, rz: st.z ?? 0, tx: st.x, ty: st.y, tz: st.z ?? 0, anim: st.anim, facing: st.facing };
        this.remotes[id] = r;
      }
      r.tx = st.x; r.ty = st.y; r.tz = st.z ?? 0; r.anim = st.anim; r.facing = st.facing;
      // лінива загрузка персонажа цього гравця
      if (!r.container && !r.loading) {
        const doc = docById(this.lib, st.charId);
        if (doc) {
          r.loading = true;
          CutoutCharacter.load(this, doc, 'r_' + id + '_').then((c) => {
            if (this.remotes[id] === r) { r.container = c; this.add.existing(c); }
            else c.destroy();
          }).catch(() => { r.loading = false; });
        }
      }
      // згладжування позиції + рендер (rz — висота підскоку, піднімає над землею)
      r.rx += (r.tx - r.rx) * Math.min(1, dt * 12);
      r.ry += (r.ty - r.ry) * Math.min(1, dt * 12);
      r.rz += (r.tz - r.rz) * Math.min(1, dt * 18); // стрибок реагує трохи швидше
      if (r.container) {
        r.container.setAnim(r.anim);
        r.container.tick(dt, r.facing);
        r.container.setPosition(r.rx, r.ry - r.container.feetOffset() - r.rz);
        r.container.setDepth(r.ry + 0.1); // глибина за підлогою, не за висотою
      }
    }
    // прибрати тих, хто вийшов
    for (const id of Object.keys(this.remotes)) {
      if (!seen.has(id)) { this.remotes[id].container?.destroy(); delete this.remotes[id]; }
    }
  }

  private repositionWorld(): void {
    const h = this.worldH;
    this.skyRect.setPosition(WORLD_WIDTH / 2, this.bandTop / 2).setSize(WORLD_WIDTH, this.bandTop);
    this.groundRect.setPosition(WORLD_WIDTH / 2, (this.bandTop + h) / 2).setSize(WORLD_WIDTH, h - this.bandTop);
    this.horizon.setPosition(WORLD_WIDTH / 2, this.bandTop).setSize(WORLD_WIDTH, 3);
    this.gateLine.setPosition(GATE_X, (this.bandTop + h) / 2).setSize(6, h - this.bandTop);
    this.goal.setPosition(WORLD_WIDTH - 120, this.bandBottom).setDepth(this.bandBottom - 1);
    this.goalLabel.setPosition(WORLD_WIDTH - 162, this.bandBottom - 150);
    // world-space overlays (scrollFactor=1): розміром на весь рівень по ширині та висоту кадру
    const H = this.worldH;
    this.ambientRect?.setSize(WORLD_WIDTH * 3, H).setPosition(WORLD_WIDTH / 2, H / 2);
    this.fogRect?.setSize(WORLD_WIDTH * 3, H).setPosition(WORLD_WIDTH / 2, H / 2);
  }

  private onResize(): void {
    this.computeLayout();
    this.repositionWorld();
    if (this.banner) this.banner.setPosition(this.logicalW / 2 + this.uiOffX, 84 + this.uiOffY);
    this.buildHudLayout();
    this.createHudGraphics();
    this.player?.clampDepth(this.band.top, this.band.bottom);
    for (const e of this.enemies) e.clampDepth(this.band.top, this.band.bottom);
  }

  // ── HUD helpers ─────────────────────────────────────────────────────────────

  private buildHudLayout(): void {
    const w = this.logicalW;
    const margin = 10;
    const iconD = 48;   // діаметр іконки
    const gap = 8;      // відступ іконка → бар
    const arrowW = 12;  // ширина стрілки на кінці
    const barW = (w - 2 * margin - 3 * (iconD + gap + arrowW)) / 3;
    const step = iconD + gap + barW + arrowW;
    const keys = ['hud_heart', 'hud_sun', 'hud_skull'];
    this.hudLayout = keys.map((iconKey, i) => ({
      iconKey,
      iconCx: margin + iconD / 2 + i * step,
      barX:   margin + iconD + gap + i * step,
      barW,
    }));
  }

  // Геометрія стрічки стаміни: під баром ХП (hudLayout[0]), вдвічі вужча (висота) і
  // вдвічі коротша (ширина). barYC=26, barH=16 → нижній край ХП ≈ 34.
  private staminaRect(): { x: number; y: number; w: number; h: number } {
    const hp = this.hudLayout[0];
    const barH = 16, barY = 26 - barH / 2;
    return { x: hp ? hp.barX : 10, y: barY + barH + 3, w: (hp ? hp.barW : 100) / 2, h: barH / 2 };
  }

  private createHudGraphics(): void {
    this.hudBars?.destroy();   this.hudBars  = null;
    this.hudFills?.destroy();  this.hudFills = null;
    this.hudIcons.forEach((img) => img.destroy());
    this.hudIcons = [];

    const barYC = 26, barH = 16, arrowW = 12;
    const barY  = barYC - barH / 2;

    // Контури барів (графіку зсуваємо на uiOff — компенсація зуму камери для sf=0)
    this.hudBars = this.add.graphics().setScrollFactor(0).setDepth(10001).setPosition(this.uiOffX, this.uiOffY);
    this.hudBars.lineStyle(2, 0xffffff, 0.85);
    for (const { barX, barW } of this.hudLayout) {
      this.hudBars.strokePoints([
        { x: barX,             y: barY      },
        { x: barX + barW,      y: barY      },
        { x: barX + barW + arrowW, y: barYC },
        { x: barX + barW,      y: barY + barH },
        { x: barX,             y: barY + barH },
      ], true);
    }
    // Контур стрічки стаміни — під ХП, вдвічі вужча й коротша.
    const st = this.staminaRect();
    this.hudBars.strokeRect(st.x, st.y, st.w, st.h);

    // Іконки
    for (const { iconKey, iconCx } of this.hudLayout) {
      this.hudIcons.push(
        this.add.image(iconCx + this.uiOffX, barYC + this.uiOffY, iconKey)
          .setScrollFactor(0)
          .setDepth(10002)
          .setDisplaySize(46, 46),
      );
    }

    // Заливки (перемальовуються при зміні HP) — графіку зсуваємо на uiOff
    this.hudFills = this.add.graphics().setScrollFactor(0).setDepth(10000).setPosition(this.uiOffX, this.uiOffY);
    this.hudSig = ''; // примусове перемалювання
    this.updateHud();
  }

  // Поточні заповнення барів 0..1: [ХП, Біль у спині, Тривожність].
  private hudPcts(): [number, number, number, number] {
    const p = this.player;
    const cl = (v: number): number => Math.max(0, Math.min(1, v));
    return [
      cl(p.hp / PLAYER.maxHp),
      cl(p.backPain / STATS.painMax),
      cl(p.anxiety / STATS.anxietyMax),
      cl(p.stamina / PLAYER.maxStamina),
    ];
  }

  private updateHud(): void {
    if (!this.hudFills || !this.player) return;
    const [hpPct, painPct, anxPct, stamPct] = this.hudPcts();
    // Перемальовуємо заливку лише коли щось змінилось (квантуємо до сотих).
    const sig = [hpPct, painPct, anxPct, stamPct].map((v) => Math.round(v * 100)).join(',');
    if (sig === this.hudSig) return;
    this.hudSig = sig;

    const barYC = 26, barH = 16, arrowW = 12;
    const barY  = barYC - barH / 2;
    this.hudFills.clear();
    this.hudFills.fillStyle(0xffffff, 0.85);

    const mainPcts = [hpPct, painPct, anxPct];
    for (let i = 0; i < this.hudLayout.length; i++) {
      const { barX, barW } = this.hudLayout[i];
      const pct = mainPcts[i] ?? 1;
      if (pct <= 0) continue;
      if (pct >= 1) {
        // Повна стрілка
        this.hudFills.fillPoints([
          { x: barX + 1,             y: barY + 2      },
          { x: barX + barW - 1,      y: barY + 2      },
          { x: barX + barW + arrowW - 2, y: barYC     },
          { x: barX + barW - 1,      y: barY + barH - 2 },
          { x: barX + 1,             y: barY + barH - 2 },
        ], true);
      } else {
        // Частковий прямокутник
        this.hudFills.fillRect(barX + 1, barY + 2, (barW - 2) * pct, barH - 4);
      }
    }

    // Заливка стрічки стаміни.
    if (stamPct > 0) {
      const st = this.staminaRect();
      this.hudFills.fillRect(st.x + 1, st.y + 1, Math.max(0, (st.w - 2) * stamPct), st.h - 2);
    }
  }

  // Ч/б екран при тривожності 100% (тимчасовий плейсхолдер «ультрапохмурого режиму»).
  private updateAnxietyFx(): void {
    if (!this.player) return;
    const want = this.player.anxiety >= STATS.anxietyMax;
    if (want === this.bwActive) return;
    this.bwActive = want;
    const cam = this.cameras.main;
    // На цю камеру вішаємо лише цей ефект, тож clear() безпечно знімає його.
    cam.postFX.clear();
    if (want) cam.postFX.addColorMatrix().grayscale(1);
  }

  // ────────────────────────────────────────────────────────────────────────────

  private spawnWave(): void {
    this.waveSpawned = true;
    const mid = (this.bandTop + this.bandBottom) / 2;
    const spots: Array<[number, number]> = [
      [950, this.bandTop + 24],
      [1060, this.bandBottom - 10],
      [1120, mid],
    ];
    for (const [x, y] of spots) this.enemies.push(new Enemy(this, x, y));
    this.banner.setPosition(this.logicalW / 2 + this.uiOffX, 84 + this.uiOffY).setText('БИЙСЯ! Зачисти ворогів');
  }

  // Phaser викликає update щокадру; ми накопичуємо час і крутимо симуляцію
  // фіксованими кроками — однаково на будь-якому FPS.
  update(_time: number, delta: number): void {
    if (this.finished) return;
    if (!this.parallaxAnchored) this.anchorParallaxOnSettle();
    const dtS = Math.min(delta / 1000, 0.1);
    this.updateLevelAnims(dtS);
    this.updateKfAnims(dtS);
    this.updateBakedAnims();
    this.accumulator += Math.min(delta / 1000, 0.1);
    while (this.accumulator >= FIXED_DT) {
      this.step(FIXED_DT);
      this.accumulator -= FIXED_DT;
    }
    if (this.atmosphere) {
      const dt = Math.min(delta / 1000, 0.1);
      this.atmTime += dt;
      this.weatherTime += dt;
      this.updateAtmosphere();
    }
  }

  private step(dt: number): void {
    this.simTime += dt * 1000;
    const time = this.simTime;
    const band = this.getBandAtX(this.player.floorX);

    const cmd = this.controls.sample();
    this.player.update(cmd, time, dt, (x, y) => this.surfaceAt(x, y));

    // Синхронізуємо зібраного персонажа з гравцем (позиція, анімація, напрям)
    if (this.character) {
      const p = this.player;
      const justLanded = p.grounded && !this.wasGrounded;
      this.wasGrounded = p.grounded;
      if (justLanded) this.landAnimUntil = time + 180;
      const inLanding = time < this.landAnimUntil && p.grounded;
      const natural = !p.grounded || inLanding ? 'jump'
        : p.isHurt(time) ? 'hurt'
        : p.isInAttack(time) ? 'attack'
        : p.moving ? (p.running ? 'run' : 'walk') : 'idle';
      if (time >= this.hotkeyAnimEnd) { this.curAnim = natural; this.character.setAnim(natural); }
      const moveSpeed = p.moving ? PLAYER.speed * (p.running ? 1.7 : 1) : 0;
      const landingT = inLanding ? (this.landAnimUntil - time) / 180 : 0;
      this.character.tick(dt, this.player.facing, { speed: moveSpeed, jumpVel: p.jumpVel, landingT });
      this.character.setPosition(this.player.x, this.player.y - this.character.feetOffset());
      this.character.setDepth(this.player.depth + 0.1);
    }

    // Кооп: шлемо свою позицію й малюємо інших гравців
    if (this.isMulti) { this.pushMyState(time); this.syncRemotes(dt); }

    // Тригер хвилі (демо-арена; у режимі рівня вимкнено)
    if (!this.levelMode && !this.waveSpawned && this.player.floorX > WAVE_TRIGGER_X) this.spawnWave();

    // Удар гравця: зона перед ним з урахуванням глибини
    if (this.player.isAttacking(time) && this.player.grounded) {
      for (const e of [...this.enemies]) {
        if (!e.vulnerable(time)) continue;
        const dx = (e.floorX - this.player.floorX) * this.player.facing;
        const dy = Math.abs(e.floorY - this.player.floorY);
        if (dx > 0 && dx <= PLAYER.attackReach && dy <= PLAYER.attackDepth) {
          const dead = e.hurt(PLAYER.attackDamage, time, this.player.floorX);
          if (dead) {
            e.destroy();
            this.enemies = this.enemies.filter((x) => x !== e);
          }
        }
      }
    }

    // Вороги думають і б'ють
    for (const e of this.enemies) {
      const dmg = e.think(this.player, time, dt, band);
      if (dmg > 0) this.player.takeDamage(time, dmg, e.floorX);
    }

    // Арена зачищена — відкриваємо шлях
    if (!this.levelMode && this.waveSpawned && !this.cleared && this.enemies.length === 0) {
      this.cleared = true;
      this.player.maxX = WORLD_WIDTH - 20;
      this.gateLine.setVisible(false);
      this.banner.setPosition(this.logicalW / 2 + this.uiOffX, 84 + this.uiOffY).setText('ШЛЯХ ВІЛЬНИЙ! До магазину →');
      this.time.delayedCall(1600, () => this.banner.setText(''));
    }

    // Досягнення магазину (демо; у режимі рівня вимкнено)
    if (!this.levelMode && this.cleared && Math.abs(this.player.floorX - this.goal.x) < 55) {
      this.completeLevel();
    }

    // HUD + ч/б режим + смерть
    this.updateHud();
    this.updateAnxietyFx();
    if (this.player.hp <= 0) this.scene.restart();
  }

  private updateAtmosphere(): void {
    const atm = this.atmosphere!;
    // Небо
    if (atm.sky?.enabled) {
      const s = evalSky(atm.sky, this.atmTime);
      this.skyRect.setFillStyle(s.skyColor);
      this.groundRect.setFillStyle(s.groundColor);
    }
    // Час доби — ambient tint поверх всіх ассетів
    if (atm.tod?.enabled) {
      const s = evalTod(atm.tod, this.atmTime);
      this.ambientRect.setFillStyle(s.ambientColor, s.ambientAlpha);
    } else {
      this.ambientRect.setFillStyle(0x000000, 0);
    }
    // Погода
    if (atm.weather?.enabled) {
      const s = evalWeather(atm.weather, this.atmTime);
      this.fogRect.setFillStyle(0x8899bb, s.fogAlpha * 0.5);
      this.drawWeatherFx(s.type, s);
    } else {
      this.fogRect.setFillStyle(0x8899bb, 0);
      this.weatherFar.clear(); this.weatherMid.clear(); this.weatherNear.clear();
    }
  }

  // Палітра крапель: варіації базового кольору (яскравість + легкий зсув у синь).
  private rainPalette(hex: string): number[] {
    const h = hex.replace('#', '').padStart(6, '0');
    const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    const cl = (v: number): number => Math.max(0, Math.min(255, Math.round(v)));
    const mk = (mr: number, mg: number, mb: number): number => (cl(r * mr) << 16) | (cl(g * mg) << 8) | cl(b * mb);
    return [
      mk(0.72, 0.78, 0.92),   // темніша, синюватіша
      mk(0.90, 0.95, 1.0),
      mk(1.0,  1.0,  1.0),    // базова
      mk(1.12, 1.12, 1.18),   // світліша
    ];
  }

  private drawWeatherFx(type: WeatherType, ws: import('../level/atmosphere').WeatherState): void {
    this.weatherFar.clear(); this.weatherMid.clear(); this.weatherNear.clear();
    if (type === 'clear' || type === 'fog') return;

    // Малюємо у світових координатах рівно по тому, що бачить камера зараз.
    const view = this.cameras.main.worldView;
    const X0 = view.x, Y0 = view.y, W = view.width, H = view.height;
    const t = this.weatherTime;
    const GR  = 0.6180339887;
    const GR2 = 0.7548776662;

    if (type === 'rain') {
      const angle   = Math.tan((ws.rainDir ?? 15) * Math.PI / 180);
      const spd     = ws.rainSpeed ?? 600;
      const baseLen = ws.rainDropLen ?? 16;
      const palette = this.rainPalette(ws.rainColor ?? '#aaddff');

      // Три шари. Краплі ПАДАЮТЬ ВЕРТИКАЛЬНО (анімується тільки sy), нахил дає скіс самої смуги —
      // жодного бічного дрейфу всього поля, тож дощ завжди рівномірно покриває екран.
      // Ближній: довгі, швидкі, рідкі смуги (motion-blur ефект). Дальній: короткі, повільні, бліді.
      const layers: Array<{ gfx: Phaser.GameObjects.Graphics; sm: number; lm: number; w: number; a: number; n: number; seed: number }> = [
        { gfx: this.weatherFar,  sm: 0.7, lm: 0.5, w: 1.0, a: ws.rainFar  ?? 0.35, n: 70, seed: 0    },
        { gfx: this.weatherMid,  sm: 1.0, lm: 1.0, w: 1.6, a: ws.rainMid  ?? 0.7,  n: 90, seed: 777  },
        { gfx: this.weatherNear, sm: 2.4, lm: 3.2, w: 3.0, a: ws.rainNear ?? 1.0,  n: 26, seed: 1337 },
      ];

      for (const l of layers) {
        if (l.a < 0.01) continue;
        const speed = spd * l.sm;
        const len   = baseLen * l.lm;
        const OH    = H + len + 60;
        const OW    = W + Math.abs(angle) * len + 80;
        for (let i = 0; i < l.n; i++) {
          const hf = ((i + l.seed) * GR)  % 1;
          const vf = ((i + l.seed) * GR2) % 1;
          // x фіксований per-drop (рівномірний розподіл), анімується лише вертикальна фаза
          const baseX = X0 - 40 + hf * OW;
          const sy    = Y0 - 40 + ((vf * OH + t * speed) % OH);
          const col   = palette[(i + l.seed) % palette.length];
          l.gfx.lineStyle(l.w, col, Math.min(1, l.a));
          l.gfx.beginPath();
          l.gfx.moveTo(baseX, sy);
          l.gfx.lineTo(baseX + len * angle, sy + len);
          l.gfx.strokePath();
        }
      }
    } else if (type === 'snow') {
      const SPEED = 70;
      this.weatherMid.fillStyle(0xffffff, 0.7);
      for (let i = 0; i < 70; i++) {
        const hf = (i * GR)  % 1;
        const vf = (i * GR2) % 1;
        const drift = Math.sin(t * 0.45 + i * 1.1) * 25;
        const OH = H + 50, OW = W + 100;
        const sy = Y0 + ((vf * OH + t * SPEED) % OH) - 25;
        const sx = X0 + ((hf * OW + drift) % OW + OW) % OW - 50;
        this.weatherMid.fillCircle(sx, sy, 1.5 + (i % 4) * 0.6);
      }
    }
  }

  private completeLevel(): void {
    this.finished = true;
    void saveValue('level1', 'done'); // прогрес у Telegram CloudStorage

    const cx = this.logicalW / 2 + this.uiOffX;
    const cy = this.logicalH / 2 + this.uiOffY;
    this.add
      .text(cx, cy - 20, 'ПИВО ДОБУТО! 🍺', { fontFamily: 'monospace', fontSize: '28px', color: '#ffd000' })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(10000);
    this.add
      .text(cx, cy + 20, 'Рівень 1 пройдено', { fontFamily: 'monospace', fontSize: '16px', color: '#ffffff' })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(10000);
  }
}
