import Phaser from 'phaser';
import { WORLD_WIDTH, BAND_DEPTH, FLOOR_MARGIN, PLAYER } from '../config';
import { InputController } from '../core/input';
import { Player } from '../entities/Player';
import { Enemy } from '../entities/Enemy';
import { CutoutCharacter, type CharDoc } from '../anim/CutoutCharacter';
import { buildLevelView, type LevelDoc } from '../level/LevelView';
import { saveValue } from '../telegram';
import { idbGet } from '../store';
import {
  pushPlayerState, watchGameState, getLobbyPlayers, getChosenChar,
  getPlayerId, getPlayerName, type PlayerState,
} from '../multiplayer/lobby';
import { loadCharLibrary, docById, type LibItem } from '../charlib';

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

  private banner!: Phaser.GameObjects.Text;

  // HUD — три бари з іконками
  private hudBars: Phaser.GameObjects.Graphics | null = null;
  private hudFills: Phaser.GameObjects.Graphics | null = null;
  private hudIcons: Phaser.GameObjects.Image[] = [];
  private hudLayout: Array<{ iconKey: string; iconCx: number; barX: number; barW: number }> = [];
  private lastHp = -1;

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
  private accumulator = 0;
  private simTime = 0; // власний час симуляції (мс), незалежний від кадрів
  private hotkeyAnimEnd = 0; // поки simTime < цього — не скидаємо анімацію від хоткея

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
      const x0 = cx * gs + cy * k, x1 = (cx + 1) * gs + (cy + 1) * k;
      if (worldX < x0 || worldX >= x1) continue;
      const y0 = cy * k, y1 = (cy + 1) * k;
      if (y0 < minY) minY = y0;
      if (y1 > maxY) maxY = y1;
    }
    if (minY === Infinity) return this.band;
    return { top: this.bandBottom + minY, bottom: this.bandBottom + maxY };
  }

  // Поклітинкова прохідність: точка (gameX, gameY) лежить на намальованій підлозі?
  // Інверсія тієї ж ізо-ґратки, що в редакторі (editorY = gameY - bandBottom).
  private walkableAt(gameX: number, gameY: number): boolean {
    if (!this.levelMode || !this.floorSet.size) {
      const b = this.band;
      return gameY >= b.top && gameY <= b.bottom;
    }
    const gs = this.colliderGrid; const k = gs * Math.SQRT1_2;
    const editorY = gameY - this.bandBottom;
    const cx = Math.floor((gameX - editorY) / gs);
    const cy = Math.floor(editorY / k);
    return this.floorSet.has(cx + ',' + cy);
  }

  create(): void {
    this.finished = false;
    this.enemies = [];
    this.waveSpawned = false;
    this.cleared = false;
    this.accumulator = 0;
    this.simTime = 0;
    this.started = false;
    this.remotes = {};
    this.netStates = {};
    this.levelReady = new Promise<void>((res) => { this.resolveLevelReady = res; });

    this.cameras.main.setBackgroundColor('#2a2233');
    this.computeLayout();

    // Фон: "небо" зверху + смуга підлоги знизу (присмерковий тон у дусі Don't Starve)
    this.skyRect = this.add.rectangle(0, 0, 10, 10, 0x3a3148).setDepth(-1000);
    this.groundRect = this.add.rectangle(0, 0, 10, 10, 0x4a3f2e).setDepth(-1000);
    this.horizon = this.add.rectangle(0, 0, 10, 3, 0x000000, 0.25).setDepth(-999);
    this.gateLine = this.add.rectangle(0, 0, 6, 10, 0x000000, 0.25).setDepth(-998);

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
  }

  // Рахує смугу підлоги під поточний розмір екрана (без зуму: 1 світ = 1 піксель,
  // тож HUD і спрайти лишаються чіткими та на місцях, а чорних полів немає).
  private computeLayout(): void {
    this.worldH = this.scale.height;
    this.bandBottom = this.worldH - FLOOR_MARGIN;
    this.bandTop = Math.max(this.worldH * 0.28, this.bandBottom - BAND_DEPTH);
    if (this.levelMode) this.cameras.main.setBounds(this.levelStart, 0, Math.max(1, this.levelEnd - this.levelStart), this.worldH);
    else this.cameras.main.setBounds(0, 0, WORLD_WIDTH, this.worldH);
  }

  // Застосувати рівень із редактора: візуал + спавн + межі камери/гравця.
  private applyLevel(doc: LevelDoc): void {
    this.levelMode = true;
    this.skyRect.setVisible(false); this.groundRect.setVisible(false); this.horizon.setVisible(false);
    this.gateLine.setVisible(false); this.goal.setVisible(false); this.goalLabel.setVisible(false);
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
    // Набір підлогових клітинок для поклітинкової прохідності (отвори блокують).
    this.floorSet.clear();
    // Compute global fallback band from all cells (used when no cells at player's X)
    this.levelBand = null;
    if (this.colliderCells.length) {
      const gs = this.colliderGrid; const k = gs * Math.SQRT1_2;
      let minY = Infinity, maxY = -Infinity;
      for (const c of this.colliderCells) {
        const p = c.split(','); if ((p[2] ?? 'h') !== 'h') continue;
        const cy = Number(p[1]); if (!Number.isFinite(cy)) continue;
        this.floorSet.add(p[0] + ',' + p[1]);
        const y0 = cy * k, y1 = (cy + 1) * k;
        if (y0 < minY) minY = y0; if (y1 > maxY) maxY = y1;
      }
      if (minY !== Infinity) this.levelBand = { top: this.bandBottom + minY, bottom: this.bandBottom + maxY };
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
        void (this.libReady ?? Promise.resolve()).then(() => {
          toAttach.forEach(({ enemy, charId }, i) => {
            const d = docById(this.lib, charId);
            if (d) void enemy.attachChar(d, `npc_${i}_`);
          });
        });
      }
    }

    // Точки спавна (кооп): або масив doc.spawns, або один doc.spawn (сумісність). До 5.
    this.spawns = (doc.spawns && doc.spawns.length ? doc.spawns : [doc.spawn ?? { x: this.levelStart + 60, y: 0 }]).slice(0, 5);
    this.cameras.main.setBounds(this.levelStart, 0, this.levelEnd - this.levelStart, this.worldH);
    void buildLevelView(this, doc, this.bandBottom);
    this.banner.setText('');
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
  }

  private onResize(): void {
    this.computeLayout();
    this.repositionWorld();
    if (this.banner) this.banner.setPosition(this.scale.width / 2, 84);
    this.buildHudLayout();
    this.createHudGraphics();
    this.player?.clampDepth(this.band.top, this.band.bottom);
    for (const e of this.enemies) e.clampDepth(this.band.top, this.band.bottom);
  }

  // ── HUD helpers ─────────────────────────────────────────────────────────────

  private buildHudLayout(): void {
    const w = this.scale.width;
    const margin = 10;
    const iconD = 36;   // діаметр іконки
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

  private createHudGraphics(): void {
    this.hudBars?.destroy();   this.hudBars  = null;
    this.hudFills?.destroy();  this.hudFills = null;
    this.hudIcons.forEach((img) => img.destroy());
    this.hudIcons = [];

    const barYC = 26, barH = 16, arrowW = 12;
    const barY  = barYC - barH / 2;

    // Контури барів
    this.hudBars = this.add.graphics().setScrollFactor(0).setDepth(10001);
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

    // Іконки
    for (const { iconKey, iconCx } of this.hudLayout) {
      this.hudIcons.push(
        this.add.image(iconCx, barYC, iconKey)
          .setScrollFactor(0)
          .setDepth(10002)
          .setDisplaySize(34, 34),
      );
    }

    // Заливки (перемальовуються при зміні HP)
    this.hudFills = this.add.graphics().setScrollFactor(0).setDepth(10000);
    this.lastHp = -1; // примусове перемалювання
    this.updateHud();
  }

  private updateHud(): void {
    if (!this.hudFills || !this.player) return;
    const hp = this.player.hp;
    if (hp === this.lastHp) return;
    this.lastHp = hp;

    const barYC = 26, barH = 16, arrowW = 12;
    const barY  = barYC - barH / 2;
    this.hudFills.clear();
    this.hudFills.fillStyle(0xffffff, 0.85);

    for (let i = 0; i < this.hudLayout.length; i++) {
      const { barX, barW } = this.hudLayout[i];
      const pct = i === 0 ? Math.max(0, Math.min(1, hp / PLAYER.maxHp)) : 1;
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
    this.banner.setPosition(this.scale.width / 2, 84).setText('БИЙСЯ! Зачисти ворогів');
  }

  // Phaser викликає update щокадру; ми накопичуємо час і крутимо симуляцію
  // фіксованими кроками — однаково на будь-якому FPS.
  update(_time: number, delta: number): void {
    if (this.finished) return;
    this.accumulator += Math.min(delta / 1000, 0.1);
    while (this.accumulator >= FIXED_DT) {
      this.step(FIXED_DT);
      this.accumulator -= FIXED_DT;
    }
  }

  private step(dt: number): void {
    this.simTime += dt * 1000;
    const time = this.simTime;
    const band = this.getBandAtX(this.player.floorX);

    const cmd = this.controls.sample();
    this.player.update(cmd, time, dt, (x, y) => this.walkableAt(x, y));

    // Синхронізуємо зібраного персонажа з гравцем (позиція, анімація, напрям)
    if (this.character) {
      const p = this.player;
      const natural = !p.grounded ? 'jump' : p.isHurt(time) ? 'hurt' : p.isInAttack(time) ? 'attack' : p.moving ? (p.running ? 'run' : 'walk') : 'idle';
      if (time >= this.hotkeyAnimEnd) { this.curAnim = natural; this.character.setAnim(natural); }
      this.character.tick(dt, this.player.facing);
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
      this.banner.setPosition(this.scale.width / 2, 84).setText('ШЛЯХ ВІЛЬНИЙ! До магазину →');
      this.time.delayedCall(1600, () => this.banner.setText(''));
    }

    // Досягнення магазину (демо; у режимі рівня вимкнено)
    if (!this.levelMode && this.cleared && Math.abs(this.player.floorX - this.goal.x) < 55) {
      this.completeLevel();
    }

    // HUD + смерть
    this.updateHud();
    if (this.player.hp <= 0) this.scene.restart();
  }

  private completeLevel(): void {
    this.finished = true;
    void saveValue('level1', 'done'); // прогрес у Telegram CloudStorage

    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2;
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
