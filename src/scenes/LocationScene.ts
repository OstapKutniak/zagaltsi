import Phaser from 'phaser';
import { LOGICAL_W, LOGICAL_H, RENDER_SCALE } from '../config';
import { setTouchUI } from './uiButton';
import {
  type LocationDoc, loadLocationsForGame, locationForNode, type WorldNode,
} from '../world/worldData';
import {
  type Atmosphere, type LayerTint, type WeatherState, type LayerKey, type FogLayer as AtmFogLayer,
  parseHex, hexToInt, evalTod, evalWeather,
} from '../level/atmosphere';
import { ColorGradePipeline } from './ColorGradePipeline';
import { FxSprites } from '../level/fxSprites';
import { enterLocation, leaveLocation, watchLocationPresence, type PresenceEntry } from '../multiplayer/presence';
import { getPlayerId } from '../multiplayer/lobby';
import { loadMemberThumb } from '../multiplayer/sharedChars';
import { loadCharLibrary, type LibItem } from '../charlib';
import { oakScene } from '../world/locationArt';
import { ensureFogTexture } from '../level/fogTexture';
import { CutoutCharacter } from '../anim/CutoutCharacter';
import { dialogsKey, loadPublishedDialogs, type DialogDoc } from '../dialogs';
import { playDialogDoc, closeDialogPlay } from '../dialogPlay';
import { loadQuests, type Quest } from '../story/quests';
import { acceptQuest, reportProgress, questsForAcq, turnInWithGiver } from '../story/questState';
import { rewardLabel } from '../story/profile';
import { idbGet } from '../store';

// Сцена локації (хаб): арт із Редактора Локацій (фон + розставлені будівлі), а поки
// його нема — білі куби-заглушки. Внизу — 5 слотів Хоругви (як герої в HoMM):
// хто з гравців зараз у ЦІЙ локації (Firebase presence), той у слоті.

const MENU_FONT = 'Georgia, "Times New Roman", serif';
const COL_TEXT = '#e5d8bc';

export class LocationScene extends Phaser.Scene {
  private nodeId = '';
  private label = '';
  private locationId: string | undefined;
  private worldId = '';
  private offX = 0; private offY = 0;
  private unwatch: (() => void) | null = null;
  private slotObjs: Phaser.GameObjects.GameObject[] = [];
  private lib: LibItem[] = [];
  private presGen = 0; // покоління слотів — щоб async-мініатюра не лягла у вже стерті слоти
  private boardOverlay: Phaser.GameObjects.Container | null = null; // оверлей дошки оголошень

  constructor() { super('Location'); }

  private icon = '';
  private encounterQuestId: string | null = null; // енкаунтер: НПС з квестом на передньому плані
  private npc: CutoutCharacter | null = null;

  // ── Атмосфера локації (плановість/погода/віньєтка/баланс) — як у бітемапі ──
  private atm: Atmosphere | null = null;
  private atmTime = 0;
  private rainGfx: Phaser.GameObjects.Graphics | null = null;
  private fogSprites = new Map<string, Phaser.GameObjects.TileSprite>();
  private lightningRect: Phaser.GameObjects.Rectangle | null = null;
  private lightningNext = 6;
  private lightningOn = 0;
  private lightningDur = 0.35;
  private colorGradePipe: ColorGradePipeline | null = null;
  private placedFx = new FxSprites(); // анімація/деформація будівель з редактора

  init(data: { nodeId?: string; label?: string; locationId?: string; worldId?: string; icon?: string; encounterQuestId?: string }): void {
    this.nodeId = data?.nodeId ?? '';
    this.label = data?.label ?? 'Локація';
    this.locationId = data?.locationId;
    this.worldId = data?.worldId ?? '';
    this.icon = data?.icon ?? '';
    this.encounterQuestId = data?.encounterQuestId ?? null;
  }

  create(): void {
    setTouchUI(false); // джойстик/кнопки — лише в бітемапі
    const cam = this.cameras.main;
    cam.setZoom(RENDER_SCALE);
    cam.setBackgroundColor('#17131c');
    this.offX = LOGICAL_W * (RENDER_SCALE - 1) / 2;
    this.offY = LOGICAL_H * (RENDER_SCALE - 1) / 2;
    this.slotObjs = [];

    // Заголовок і назад
    this.add.text(LOGICAL_W / 2 + this.offX, 40 + this.offY, this.label, {
      fontFamily: MENU_FONT, fontStyle: 'small-caps', fontSize: '34px', color: '#efe3c8',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(20).setShadow(2, 3, '#000000', 7, false, true);
    const back = this.add.text(36 + this.offX, 34 + this.offY, '‹ До карти', {
      fontFamily: MENU_FONT, fontStyle: 'small-caps', fontSize: '24px', color: COL_TEXT,
    }).setOrigin(0, 0.5).setScrollFactor(0).setDepth(20)
      .setShadow(1, 2, '#000000', 6, false, true)
      .setInteractive({ useHandCursor: true });
    back.on('pointerover', () => back.setColor('#ffcf8f'));
    back.on('pointerout', () => back.setColor(COL_TEXT));
    back.on('pointerup', () => {
      // Повернутись на карту може будь-хто (особисто, не застрягаєш). Але напрям
      // подорожі далі обирає лише головний — це гейтить WorldScene.
      void import('../khorugva').then(({ iAmLeaderCached }) => {
        if (iAmLeaderCached()) void import('../multiplayer/partyNav').then(({ broadcastNav }) => broadcastNav('World', { worldId: this.worldId }));
      }).finally(() => this.scene.start('World', { worldId: this.worldId }));
    });

    // Скидання атмосфери (scene.start перевикористовує інстанс сцени)
    this.atm = null; this.atmTime = 0;
    this.rainGfx = null; this.fogSprites.clear();
    this.lightningRect = null; this.lightningOn = 0; this.lightningNext = 4 + Math.random() * 8;
    this.colorGradePipe = null;
    this.placedFx.clear();

    void this.renderLocation();
    this.setupPresence();
    this.npc = null;
    // НПС локації: з бота-енкаунтера (encounterQuestId) АБО квест-видавець, привʼязаний
    // до цієї локації (acq='location_npc'), — виходить назустріч і дає квест.
    const npcQuestId = this.encounterQuestId ?? this.locationNpcQuest();
    if (npcQuestId) void this.spawnEncounter(npcQuestId);

    // Ціль квесту «дійти до локації»: зайшли у вузол → прогрес.
    if (this.nodeId) for (const q of reportProgress('reach', this.nodeId)) this.questDoneToast(q);

    // Дошка оголошень: контракти (acq='board'), привʼязані до цієї локації.
    this.buildBoard();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.unwatch?.(); this.unwatch = null;
      this.boardOverlay?.destroy(true); this.boardOverlay = null;
      closeDialogPlay();
      leaveLocation();
    });
  }

  update(_t: number, dtMs: number): void {
    this.npc?.tick(dtMs / 1000, -1); // гість дивиться ліворуч (до гравця/центру)
    this.placedFx.tick(Math.min(dtMs / 1000, 0.1)); // анімація/деформація будівель
    if (this.atm) {
      const dt = Math.min(dtMs / 1000, 0.1);
      this.atmTime += dt;
      this.updateWeather(dt);
    }
  }

  // ── Атмосфера: статичні тінти + анімована погода (дощ/туман/блискавка) ─────
  private static layerTint(lt: LayerTint): number {
    const [cr, cg, cb] = parseHex(lt.color);
    const r = Math.round(255 + (cr - 255) * lt.alpha);
    const g = Math.round(255 + (cg - 255) * lt.alpha);
    const b = Math.round(255 + (cb - 255) * lt.alpha);
    return (r << 16) | (g << 8) | b;
  }

  private setupAtmosphere(doc: LocationDoc, bgImg: Phaser.GameObjects.Image | null, placedImgs: Phaser.GameObjects.Image[]): void {
    this.atm = doc.atmosphere ?? null;
    if (!this.atm) return;
    // Плановість: bg-тінт на фон, map-тінт на будівлі (статично, фаза 0)
    if (this.atm.tod?.enabled) {
      const s = evalTod(this.atm.tod, 0);
      const bgLt = s.layers.bg, mapLt = s.layers.map;
      if (bgLt && bgLt.alpha > 0.005 && bgImg) bgImg.setTint(LocationScene.layerTint(bgLt));
      if (mapLt && mapLt.alpha > 0.005) for (const im of placedImgs) im.setTint(LocationScene.layerTint(mapLt));
    }
    // Віньєтка + кольоровий баланс — той самий post-shader, що в бітемапі (лише WebGL)
    if (this.game.renderer.type === Phaser.WEBGL && (this.atm.vignette?.enabled || this.atm.colorBalance?.enabled)) {
      this.cameras.main.setPostPipeline(ColorGradePipeline);
      const cgp = this.cameras.main.getPostPipeline(ColorGradePipeline);
      this.colorGradePipe = (Array.isArray(cgp) ? cgp[0] : cgp) as ColorGradePipeline ?? null;
      this.applyGrade();
    }
    // Погода: графіка дощу + прямокутник блискавки (створюються заздалегідь)
    if (this.atm.weather?.enabled) {
      this.rainGfx = this.add.graphics().setScrollFactor(0).setDepth(6);
      this.lightningRect = this.add.rectangle(
        LOGICAL_W / 2 + this.offX, LOGICAL_H / 2 + this.offY, LOGICAL_W * 3, LOGICAL_H * 3, 0xffffff, 0,
      ).setScrollFactor(0).setDepth(8).setVisible(false);
      ensureFogTexture(this);
    }
  }

  private applyGrade(): void {
    const p = this.colorGradePipe;
    if (!p) return;
    const cb = this.atm?.colorBalance;
    if (cb?.enabled) {
      p.brightness = cb.brightness ?? 1;
      p.contrast = (cb.contrast ?? 1) + (cb.cavity ?? 0) * 0.5;
      p.saturation = cb.saturation ?? 1;
      p.hue = (cb.hue ?? 0) * Math.PI / 180;
      p.shadowCol = ColorGradePipeline.parse(cb.shadowColor ?? '#000033');
      p.midCol = ColorGradePipeline.parse(cb.midColor ?? '#003300');
      p.highCol = ColorGradePipeline.parse(cb.highlightColor ?? '#ffffee');
      p.shadowStr = Math.min(1, cb.shadowStrength ?? 0);
      p.midStr = Math.min(1, cb.midStrength ?? 0);
      p.highStr = Math.min(1, cb.highlightStrength ?? 0);
    } else {
      p.brightness = 1; p.contrast = 1; p.saturation = 1; p.hue = 0;
      p.shadowStr = 0; p.midStr = 0; p.highStr = 0;
    }
    const vig = this.atm?.vignette;
    if (vig?.enabled) {
      p.vigStr = Math.max(0, Math.min(1, vig.strength ?? 0.6));
      p.vigCol = ColorGradePipeline.parse(vig.color ?? '#000000');
      p.vigTop = Math.max(0.02, Math.min(0.98, vig.top ?? 0.5));
      p.vigHasMask = false; // у локації віньєтка на весь кадр (без маски карти)
    } else p.vigStr = 0;
  }

  private updateWeather(dt: number): void {
    const wx = this.atm?.weather;
    if (!wx?.enabled) return;
    const ws = evalWeather(wx, this.atmTime);
    this.drawRain(ws);
    this.updateFogSprites(ws);
    this.updateLightning(ws, dt);
  }

  // Глибини туману: за будівлями (фон 1, будівлі 2) / перед будівлями / перед усім.
  private static FOG_DEPTH: Record<LayerKey, number> = { sky: 1.5, clouds: 1.5, bg: 1.5, frontbg: 3, map: 3, foreground: 4 };

  private updateFogSprites(ws: WeatherState): void {
    const active = ws.fog ? ws.fogLayers : {};
    const t = this.atmTime;
    for (const key of Object.keys(LocationScene.FOG_DEPTH) as LayerKey[]) {
      const fl = active[key] as AtmFogLayer | undefined;
      let sp = this.fogSprites.get(key);
      if (!fl || fl.alpha <= 0.004) { if (sp) sp.setVisible(false); continue; }
      if (!sp) {
        sp = this.add.tileSprite(LOGICAL_W / 2 + this.offX, LOGICAL_H / 2 + this.offY, LOGICAL_W + 6, LOGICAL_H + 6, 'fog_noise')
          .setOrigin(0.5).setScrollFactor(0).setDepth(LocationScene.FOG_DEPTH[key]);
        this.fogSprites.set(key, sp);
      }
      sp.setVisible(true);
      sp.setDepth(LocationScene.FOG_DEPTH[key]);
      sp.setTint(hexToInt(fl.color ?? '#c2ccd6'));
      sp.setAlpha(Math.max(0, Math.min(1, fl.alpha)));
      const scale = Math.max(0.3, fl.scale ?? 1);
      sp.setTileScale(scale, scale);
      const rad = (fl.dir ?? 0) * Math.PI / 180;
      const off = (fl.seed ?? 0) * 37.13;
      sp.tilePositionX = off + Math.cos(rad) * (fl.speed ?? 12) * t / scale;
      sp.tilePositionY = off * 0.7 + Math.sin(rad) * (fl.speed ?? 12) * t / scale;
    }
  }

  private rainPalette(hex: string): number[] {
    const h = hex.replace('#', '').padStart(6, '0');
    const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    const cl = (v: number): number => Math.max(0, Math.min(255, Math.round(v)));
    const mk = (mr: number, mg: number, mb: number): number => (cl(r * mr) << 16) | (cl(g * mg) << 8) | cl(b * mb);
    return [mk(0.72, 0.78, 0.92), mk(0.9, 0.95, 1), mk(1, 1, 1), mk(1.12, 1.12, 1.18)];
  }

  private drawRain(ws: WeatherState): void {
    const gfx = this.rainGfx;
    if (!gfx) return;
    gfx.clear();
    if (!ws.rain) return;
    const X0 = this.offX, Y0 = this.offY, W = LOGICAL_W, H = LOGICAL_H;
    const t = this.atmTime;
    const angle = Math.tan((ws.rainDir ?? 15) * Math.PI / 180);
    const spd = ws.rainSpeed ?? 600;
    const baseLen = ws.rainDropLen ?? 16;
    const palette = this.rainPalette(ws.rainColor ?? '#aaddff');
    const hash = (n: number): number => { const s = Math.sin(n * 127.1) * 43758.5453; return s - Math.floor(s); };
    const dropMul = Math.max(0.1, (ws.rainDrops ?? 100) / 100);
    const layers = [
      { sm: 0.7, lm: 0.5, w: 1.0, a: ws.rainFar  ?? 0.35, n: Math.round(70 * dropMul), seed: 11 },
      { sm: 1.0, lm: 1.0, w: 1.6, a: ws.rainMid  ?? 0.7,  n: Math.round(90 * dropMul), seed: 53 },
      { sm: 2.4, lm: 3.2, w: 3.0, a: ws.rainNear ?? 1.0,  n: Math.round(26 * dropMul), seed: 97 },
    ];
    for (const l of layers) {
      if (l.a < 0.01) continue;
      const speed = spd * l.sm;
      for (let i = 0; i < l.n; i++) {
        const rx   = (i + 0.5 + (hash(i + l.seed) - 0.5) * 0.5) / l.n;
        const rlen = 0.6 + hash(i + l.seed + 7) * 0.9;
        const ra   = 0.55 + hash(i + l.seed + 13) * 0.45;
        const rph  = hash(i + l.seed + 23);
        const len   = baseLen * l.lm * rlen;
        const drift = Math.abs(angle) * (H + len);
        const OW    = W + drift + 80;
        const OH    = H + len + 60;
        const baseX = X0 - 40 - (angle > 0 ? drift : 0) + rx * OW;
        const phase = ((rph * OH) + t * speed) % OH;
        const sy    = Y0 - 40 + phase;
        const sx    = baseX + phase * angle;
        gfx.lineStyle(l.w, palette[(i + l.seed) % palette.length], Math.min(1, l.a * ra));
        gfx.beginPath();
        gfx.moveTo(sx, sy);
        gfx.lineTo(sx + len * angle, sy + len);
        gfx.strokePath();
      }
    }
  }

  private updateLightning(ws: WeatherState, dt: number): void {
    const rect = this.lightningRect;
    if (!rect) return;
    if (!ws.lightning) { if (this.lightningOn > 0) { this.lightningOn = 0; rect.setVisible(false); } return; }
    if (this.lightningOn > 0) {
      this.lightningOn -= dt;
      const k = Math.max(0, this.lightningOn / this.lightningDur);
      const a = Math.max(0, Math.sin(k * Math.PI) * 0.85 + (k > 0.5 ? 0.1 : 0));
      if (this.lightningOn <= 0) rect.setVisible(false);
      else rect.setFillStyle(0xffffff, Math.min(0.9, a)).setVisible(true);
    } else {
      this.lightningNext -= dt;
      if (this.lightningNext <= 0) {
        const every = Math.max(0.5, ws.lightningEvery ?? 10);
        const vary = Math.max(0, Math.min(1, ws.lightningVary ?? 0.5));
        this.lightningDur = 0.35 * (1 - vary * 0.6 + Math.random() * vary * 1.2);
        this.lightningOn = this.lightningDur;
        this.lightningNext = every * (1 - vary + Math.random() * vary * 2);
      }
    }
  }

  // ── Енкаунтер: «у вашій локації хтось є» — НПС виходить на передній план,
  //    грає його діалог; кінцівка 'positive' → квест на дошку «Завдання». ─────
  private async spawnEncounter(questId: string): Promise<void> {
    const store = await loadQuests();
    const q = store.quests.find((x) => x.id === questId);
    if (!q?.giver || !this.scene.isActive()) return;
    const lib = await loadCharLibrary();
    const giver = lib.find((c) => c.id === q.giver);
    if (!giver?.doc?.images || !this.scene.isActive()) { this.startDialog(q); return; }
    const char = await CutoutCharacter.load(this, giver.doc, 'enc_' + giver.id + '_').catch(() => null);
    if (!char || !this.scene.isActive()) { this.startDialog(q); return; }
    char.setAnim('idle');
    // Передній план: праворуч від центру, «на землі», великим планом.
    const holder = this.add.container(LOGICAL_W / 2 + 240 + this.offX, LOGICAL_H - 118 + this.offY, [char]);
    holder.setScrollFactor(0).setDepth(30).setScale(0.9);
    this.npc = char;
    this.startDialog(q);
  }

  private startDialog(q: Quest): void {
    void this.loadDialog(q).then((doc) => {
      if (!this.scene.isActive()) return;
      if (!doc) {
        // діалогу нема — гість мовчки лишає записку: квест одразу на дошку
        acceptQuest(q);
        this.toastQuest();
        return;
      }
      playDialogDoc(doc, {
        onOutcome: (o) => {
          if (o === 'positive') {
            if (q.giver) {
              // Спершу ЗДАЧА: активні квести цього НПС з успіхом 'dialog_positive'
              // і виконаними цілями — завершуємо (revisit = здав квест).
              for (const done of turnInWithGiver(q.giver)) this.questDoneToast(done);
              // Ціль «поговорити з НПС» в інших активних квестах.
              for (const done of reportProgress('talk', q.giver)) this.questDoneToast(done);
            }
            acceptQuest(q); this.toastQuest();
          }
        },
      });
    });
  }

  private async loadDialog(q: Quest): Promise<DialogDoc | null> {
    if (!q.giver) return null;
    let docs: DialogDoc[] = [];
    // Опубліковані — надійний fetch; локальні (IDB) — з таймаут-гонкою, бо відкриття
    // IDB може «зависнути» (заблоковане інше з'єднання) і proміс не резолвиться.
    try {
      const pub = await loadPublishedDialogs();
      docs = [...(pub[q.giver] ?? [])];
    } catch { /* ignore */ }
    try {
      const local = await Promise.race([
        idbGet<DialogDoc[]>(dialogsKey(q.giver)),
        new Promise<null>((res) => setTimeout(() => res(null), 1500)),
      ]);
      if (Array.isArray(local)) for (const d of local) if (!docs.some((x) => x.id === d.id)) docs.push(d);
    } catch { /* ignore */ }
    return docs.find((d) => d.id === q.dialogId) ?? docs[0] ?? null;
  }

  private toastQuest(): void {
    const t = this.add.text(LOGICAL_W / 2 + this.offX, LOGICAL_H - 40 + this.offY, 'Нове завдання — на дошці', {
      fontFamily: MENU_FONT, fontStyle: 'italic', fontSize: '20px', color: '#ffcf8f',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(40).setShadow(1, 2, '#000000', 5, false, true);
    this.tweens.add({ targets: t, alpha: 0, delay: 2200, duration: 600, onComplete: () => t.destroy() });
  }

  private questDoneToast(q: Quest): void {
    const label = rewardLabel(q.reward);
    const t = this.add.text(LOGICAL_W / 2 + this.offX, LOGICAL_H - 66 + this.offY,
      `Квест виконано: ${q.title}` + (label ? `  (${label})` : ''), {
        fontFamily: MENU_FONT, fontStyle: 'italic', fontSize: '20px', color: '#ffcf8f',
      }).setOrigin(0.5).setScrollFactor(0).setDepth(40).setShadow(1, 2, '#000000', 5, false, true);
    this.tweens.add({ targets: t, alpha: 0, delay: 2800, duration: 700, onComplete: () => t.destroy() });
  }

  // ── Квести локації: НПС-видавець (acq='location_npc') + дошка контрактів (board) ─
  // Квест привʼязаний до локації, якщо його locationId збігається з id/вузлом цієї
  // локації (порожній locationId = «будь-де», глобальний контракт).
  private matchLoc(q: Quest): boolean {
    return !q.locationId || q.locationId === this.locationId || q.locationId === this.nodeId;
  }

  private locationNpcQuest(): string | undefined {
    return questsForAcq('location_npc', (q) => this.matchLoc(q) && !!q.giver)[0]?.id;
  }

  // Дошка оголошень: кнопка «Оголошення (N)» у кутку → оверлей зі списком контрактів.
  private buildBoard(): void {
    const contracts = questsForAcq('board', (q) => this.matchLoc(q));
    if (!contracts.length) return;
    const btn = this.add.text(LOGICAL_W - 30 + this.offX, 84 + this.offY, `Оголошення (${contracts.length})`, {
      fontFamily: MENU_FONT, fontStyle: 'small-caps', fontSize: '22px', color: COL_TEXT,
    }).setOrigin(1, 0.5).setScrollFactor(0).setDepth(30).setShadow(1, 2, '#000', 5, false, true)
      .setInteractive({ useHandCursor: true });
    btn.on('pointerover', () => btn.setColor('#ffcf8f'));
    btn.on('pointerout', () => btn.setColor(COL_TEXT));
    btn.on('pointerup', () => this.openBoard());
  }

  private openBoard(): void {
    this.boardOverlay?.destroy(true);
    const contracts = questsForAcq('board', (q) => this.matchLoc(q));
    const W = this.cameras.main.width, H = this.cameras.main.height;
    const c = this.add.container(W / 2, H / 2).setScrollFactor(0).setDepth(120);
    const bw = 560, bh = Math.min(H - 40, 120 + contracts.length * 66);
    // Затемнення на весь екран — клік поза панеллю закриває дошку.
    const backdrop = this.add.zone(0, 0, W, H).setInteractive();
    backdrop.on('pointerup', () => { c.destroy(true); this.boardOverlay = null; });
    c.add(backdrop);
    const g = this.add.graphics();
    g.fillStyle(0x000000, 0.55); g.fillRect(-W / 2, -H / 2, W, H);
    g.fillStyle(0x2b1f16, 1); g.fillRect(-bw / 2, -bh / 2, bw, bh);
    g.lineStyle(3, 0x4a3524, 1); g.strokeRect(-bw / 2, -bh / 2, bw, bh);
    c.add(g);
    // Блокер по панелі: клік по самій дошці НЕ закриває (перехоплює над backdrop).
    c.add(this.add.zone(0, 0, bw, bh).setInteractive());
    c.add(this.add.text(0, -bh / 2 + 22, 'ДОШКА ОГОЛОШЕНЬ', {
      fontFamily: MENU_FONT, fontStyle: 'small-caps', fontSize: '24px', color: '#efe3c8',
    }).setOrigin(0.5));
    if (!contracts.length) {
      c.add(this.add.text(0, 0, 'Усі контракти взято', {
        fontFamily: MENU_FONT, fontStyle: 'italic', fontSize: '18px', color: '#8a8171',
      }).setOrigin(0.5));
    }
    contracts.forEach((q, i) => {
      const y = -bh / 2 + 70 + i * 66;
      const rl = rewardLabel(q.reward);
      const row = this.add.container(0, y);
      const rg = this.add.graphics();
      rg.fillStyle(0xe4d6b0, 1); rg.fillRect(-bw / 2 + 20, 0, bw - 40, 56);
      row.add(rg);
      row.add(this.add.text(-bw / 2 + 34, 8, (q.cat === 'main' ? '★ ' : '') + q.title, {
        fontFamily: MENU_FONT, fontStyle: 'small-caps', fontSize: '18px', color: '#2b2115',
        wordWrap: { width: bw - 180 },
      }).setOrigin(0, 0));
      if (rl) row.add(this.add.text(-bw / 2 + 34, 32, 'Нагорода: ' + rl, {
        fontFamily: MENU_FONT, fontSize: '13px', color: '#5a4526',
      }).setOrigin(0, 0));
      const take = this.add.text(bw / 2 - 36, 28, 'Взяти', {
        fontFamily: MENU_FONT, fontStyle: 'small-caps', fontSize: '18px', color: '#7a3d12',
      }).setOrigin(1, 0.5).setInteractive({ useHandCursor: true });
      take.on('pointerup', () => {
        acceptQuest(q); this.toastQuest();
        this.openBoard(); // перемалювати (контракт зник зі списку)
      });
      row.add(take);
      c.add(row);
    });
    this.boardOverlay = c;
  }

  // ── Арт локації (або куби) ─────────────────────────────────────────────────
  private async renderLocation(): Promise<void> {
    const locs = await loadLocationsForGame();
    const fakeNode: WorldNode = { id: this.nodeId, label: this.label, x: 0, y: 0, type: 'location', locationId: this.locationId };
    const doc = locationForNode(fakeNode, locs);
    if (!this.scene.isActive()) return;
    if (doc && (doc.bg || doc.placed.length)) await this.renderDoc(doc);
    else if (this.icon === 'oak') this.renderOakScene(); // Дуб-Боржник — процедурна сцена-референс
    else this.renderPlaceholder();
  }

  // Силуетна сцена «Дуб-Боржник» у палітрі гри: небо/пагорб/земля → туман → дуб
  // з дуплом і підвішеними монетами → передній туман. Плановість — туман МІЖ шарами.
  private renderOakScene(): void {
    const cx = LOGICAL_W / 2 + this.offX, cy = LOGICAL_H / 2 + this.offY;
    if (!this.textures.exists('oak_back')) {
      const s = oakScene(LOGICAL_W, LOGICAL_H);
      this.textures.addCanvas('oak_back', s.back);
      this.textures.addCanvas('oak_front', s.front);
    }
    this.add.image(cx, cy, 'oak_back').setScrollFactor(0).setDepth(1);
    ensureFogTexture(this);
    // Туман ЗА дубом — щільніший, повзе праворуч.
    const fogBack = this.add.tileSprite(cx, cy + 40, LOGICAL_W + 6, 220, 'fog_noise')
      .setScrollFactor(0).setDepth(2).setTint(0x9a92ad).setAlpha(0.34);
    this.tweens.add({ targets: fogBack, tilePositionX: 512, duration: 46000, repeat: -1 });
    this.add.image(cx, cy, 'oak_front').setScrollFactor(0).setDepth(3);
    // Легкий передній туман біля землі — повзе ліворуч (протихід дає глибину).
    const fogFront = this.add.tileSprite(cx, LOGICAL_H - 90 + this.offY, LOGICAL_W + 6, 150, 'fog_noise')
      .setScrollFactor(0).setDepth(4).setTint(0xb3a9c4).setAlpha(0.22);
    this.tweens.add({ targets: fogFront, tilePositionX: -512, duration: 34000, repeat: -1 });
  }

  // Рендер LocationDoc: ФІКСОВАНЕ вікно — світовий прямокутник 1280×576 з центром
  // у (0,0) рендериться 1:1 у логічний кадр (те саме, що рамка 20:9 у редакторі).
  private async renderDoc(doc: LocationDoc): Promise<void> {
    const bgKey = 'locbg_' + doc.id;
    if (doc.bg && !this.textures.exists(bgKey)) {
      await new Promise<void>((res) => {
        this.textures.once('addtexture-' + bgKey, () => res());
        this.textures.addBase64(bgKey, doc.bg);
      });
    }
    if (!this.scene.isActive()) return;
    const s = 1;
    const ox = LOGICAL_W / 2 + this.offX; // світова (0,0) → центр кадру
    const oy = LOGICAL_H / 2 + this.offY;

    let bgImg: Phaser.GameObjects.Image | null = null;
    if (doc.bg) {
      // Фон центрований у світовій (0,0) — як у редакторі
      bgImg = this.add.image(ox, oy, bgKey).setOrigin(0.5).setScrollFactor(0).setDepth(1);
    }
    // Розставлені будівлі/ассети
    const placedImgs: Phaser.GameObjects.Image[] = [];
    for (const p of doc.placed) {
      const key = 'locp_' + doc.id + '_' + p.id;
      if (!this.textures.exists(key)) {
        await new Promise<void>((res) => {
          this.textures.once('addtexture-' + key, () => res());
          this.textures.addBase64(key, p.url);
        });
      }
      if (!this.scene.isActive()) return;
      // Плановість 1..7 (3 = дефолт) → глибина 1.6..2.8 (між фоном 1 і туманом 3).
      const depth = 2 + ((p.plan ?? 3) - 3) * 0.2;
      const go = this.placedFx.add(this, key, {
        x: ox + p.x * s, y: oy + p.y * s, rot: p.rot,
        scaleX: p.scale * s, scaleY: p.scale * s,
        flip: p.flip < 0 ? -1 : 1,
        depth,
        animScale: s, // dx/dy анімації руху — у світових одиницях локації
        anim: p.anim, deform: p.deform,
      });
      if (go instanceof Phaser.GameObjects.Image) placedImgs.push(go);
    }
    // Legacy смуги туману (старі, не мігровані доки) — лише поки нема атмосфери.
    if (doc.fogs?.length && !doc.atmosphere) {
      ensureFogTexture(this);
      const fogW = LOGICAL_W;
      const fogCx = LOGICAL_W / 2 + this.offX;
      for (const fg of doc.fogs) {
        const tint = parseInt((fg.tint || '#aaa1bd').replace('#', ''), 16);
        const ts = this.add.tileSprite(
          fogCx, oy + fg.y * s, fogW, Math.max(8, fg.h * s), 'fog_noise',
        ).setScrollFactor(0).setDepth(fg.front ? 3 : 1.5).setTint(tint).setAlpha(fg.alpha);
        const spd = fg.speed || 10;
        this.tweens.add({ targets: ts, tilePositionX: Math.sign(spd) * 512, duration: Math.max(4000, 512000 / Math.abs(spd)), repeat: -1 });
      }
    }
    // Атмосфера з редактора: тінти плановості, погода, віньєтка, баланс кольору.
    this.setupAtmosphere(doc, bgImg, placedImgs);
  }

  // Заглушка: «земля» + пара білих кубів-будівель, поки локацію не зібрано в редакторі.
  private renderPlaceholder(): void {
    const g = this.add.graphics().setScrollFactor(0).setDepth(1);
    const groundY = LOGICAL_H - 210 + this.offY;
    g.fillStyle(0x241e2c, 1);
    g.fillRect(this.offX, groundY, LOGICAL_W, 90);
    g.lineStyle(2, 0x3a3346, 1);
    g.lineBetween(this.offX, groundY, this.offX + LOGICAL_W, groundY);
    // два куби різного розміру
    const cube = (x: number, w: number, h: number): void => {
      g.fillStyle(0xf2efe8, 1);
      g.fillRect(x + this.offX, groundY - h, w, h);
      g.lineStyle(2, 0x141118, 1);
      g.strokeRect(x + this.offX, groundY - h, w, h);
    };
    cube(LOGICAL_W / 2 - 190, 150, 130);
    cube(LOGICAL_W / 2 + 60, 110, 95);
    this.add.text(LOGICAL_W / 2 + this.offX, groundY - 165, 'Локацію ще не зібрано — Редактор Локацій у studio', {
      fontFamily: MENU_FONT, fontSize: '16px', color: '#8a8171',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(2);
  }

  // ── Слоти Хоругви (5) ──────────────────────────────────────────────────────
  private setupPresence(): void {
    if (this.nodeId) enterLocation(this.nodeId);
    this.drawSlots([]); // одразу порожні рамки, себе домалює presence-снапшот
    if (this.nodeId) {
      this.unwatch = watchLocationPresence(this.nodeId, (list) => {
        if (this.scene.isActive()) this.drawSlots(list);
      });
    }
    void loadCharLibrary().then((l) => { this.lib = l; });
  }

  private drawSlots(list: PresenceEntry[]): void {
    for (const o of this.slotObjs) o.destroy();
    this.slotObjs = [];
    const gen = ++this.presGen;
    const myId = getPlayerId();
    // я — завжди в першому слоті; решта за часом заходу
    const others = list.filter((p) => p.id !== myId).slice(0, 4);
    const me = list.find((p) => p.id === myId) ?? { id: myId, name: 'Я', charId: '', t: 0 };
    const entries: (PresenceEntry | null)[] = [me, ...others];
    while (entries.length < 5) entries.push(null);

    const SLOT = 86, GAP = 14;
    const total = 5 * SLOT + 4 * GAP;
    const x0 = (LOGICAL_W - total) / 2 + this.offX;
    const y = LOGICAL_H - 96 + this.offY;

    const cap = this.add.text(LOGICAL_W / 2 + this.offX, y - 14, 'Хоругва', {
      fontFamily: MENU_FONT, fontStyle: 'small-caps', fontSize: '18px', color: '#8a8171',
    }).setOrigin(0.5, 1).setScrollFactor(0).setDepth(20);
    this.slotObjs.push(cap);

    entries.forEach((p, i) => {
      const x = x0 + i * (SLOT + GAP);
      const g = this.add.graphics().setScrollFactor(0).setDepth(20);
      g.fillStyle(0x1d1826, p ? 0.95 : 0.6);
      g.fillRoundedRect(x, y, SLOT, SLOT, 8);
      g.lineStyle(2, p ? 0xcbb98a : 0x3a3346, 1);
      g.strokeRoundedRect(x, y, SLOT, SLOT, 8);
      this.slotObjs.push(g);
      if (!p) return;

      // Ініціал одразу (поки вантажиться мініатюра — або якщо її нема).
      const init = this.add.text(x + SLOT / 2, y + SLOT / 2 - 6, (p.name || '?').slice(0, 1).toUpperCase(), {
        fontFamily: MENU_FONT, fontSize: '34px', color: COL_TEXT,
      }).setOrigin(0.5).setScrollFactor(0).setDepth(21);
      this.slotObjs.push(init);

      // Портрет: мій — з локальної бібліотеки; чужий — зі спільного каналу
      // (shared_chars/{id}), інакше портрет побратима не намалювати на цьому пристрої.
      void loadMemberThumb(p.id, p.charId).then((thumb) => {
        if (!thumb || gen !== this.presGen || !this.scene.isActive()) return;
        const key = 'pth_' + p.id;
        const place = (): void => {
          if (gen !== this.presGen || !this.scene.isActive()) return;
          init.destroy();
          const im = this.add.image(x + SLOT / 2, y + SLOT / 2, key).setScrollFactor(0).setDepth(21);
          const sc = Math.min((SLOT - 8) / im.width, (SLOT - 8) / im.height);
          im.setScale(sc);
          this.slotObjs.push(im);
        };
        if (this.textures.exists(key)) place();
        else { this.textures.once('addtexture-' + key, place); this.textures.addBase64(key, thumb); }
      });
      const nm = this.add.text(x + SLOT / 2, y + SLOT - 4, p.id === myId ? 'ти' : p.name, {
        fontFamily: MENU_FONT, fontSize: '13px', color: p.id === myId ? '#ffcf8f' : COL_TEXT,
      }).setOrigin(0.5, 1).setScrollFactor(0).setDepth(22).setShadow(1, 1, '#000', 4, false, true);
      this.slotObjs.push(nm);
    });
  }
}
