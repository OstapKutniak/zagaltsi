import Phaser from 'phaser';
import { LOGICAL_W, LOGICAL_H } from '../config';
import { loadQuests, type Quest } from '../story/quests';
import { takenQuests } from '../story/questState';
import { listPlayers } from '../players';
import {
  myKhorugvaId, createKhorugva, watchKhorugva, memberList, callToGather,
  leaveKhorugva, BOT_USERNAME, APP_SHORT, type Khorugva,
} from '../khorugva';
import { loadMemberThumb } from '../multiplayer/sharedChars';
import { getPlayerId } from '../multiplayer/lobby';

// Прості «списки по центру» для ріалтайм-морфу розділів у лоббі (Житло↔Квести,
// ↔Досягнення) — БЕЗ зміни сцени: фон/вогонь/персонаж лишаються, з'являється
// лише панель. Повні сцени (дошка QuestsScene, AchievementsScene) далі живуть
// для deep-link'ів з бота. Кожен білдер повертає { destroy() }.

const FONT = 'Georgia, "Times New Roman", serif';
const COL_TEXT = '#e5d8bc';
const COL_HOVER = '#ffcf8f';
const COL_GOLD = 0xcbb98a;
const COL_DIM = '#8a8496';

export interface PagePanel { destroy(): void }

// Клітинки-портрети праворуч — тими самими координатами, що слоти спорядження
// в Інвентарі (invPanel), щоб Хоругва була «як інвентар, тільки портрети».
const CELL_X = 1185;
const CELL_Y0 = 128;
const CELL_SIZE = 68;
const CELL_GAP = 22;

function panel(scene: Phaser.Scene): { add: <T extends Phaser.GameObjects.GameObject>(o: T) => T; destroy: () => void } {
  let ui: Phaser.GameObjects.GameObject[] = [];
  return {
    add: <T extends Phaser.GameObjects.GameObject>(o: T): T => { ui.push(o); return o; },
    destroy: (): void => { for (const o of ui) o.destroy(); ui = []; },
  };
}

// ── Квести: центрований список узятих завдань; тап — розгорнутий текст ─────────
export function buildQuestsPanel(scene: Phaser.Scene, offX: number, offY: number): PagePanel {
  const p = panel(scene);
  const cx = LOGICAL_W / 2 + offX;
  let overlay: Phaser.GameObjects.Container | null = null;

  const loading = p.add(scene.add.text(cx, 210 + offY, 'Гортаємо сувої…', {
    fontFamily: FONT, fontSize: '20px', color: COL_DIM,
  }).setOrigin(0.5).setScrollFactor(0).setDepth(30));

  const openQuest = (q: Quest): void => {
    overlay?.destroy(true);
    const w = 520, h = 340, W = scene.cameras.main.width, H = scene.cameras.main.height;
    const c = scene.add.container(W / 2, H / 2).setScrollFactor(0).setDepth(120);
    const g = scene.add.graphics();
    g.fillStyle(0x000000, 0.55); g.fillRect(-W / 2, -H / 2, W, H);
    g.fillStyle(0x0c0906, 0.6); g.fillRect(-w / 2 + 8, -h / 2 + 9, w, h);
    g.fillStyle(0xe4d6b0, 1); g.fillRect(-w / 2, -h / 2, w, h);
    g.fillStyle(0xc4b28c, 1); g.fillRect(-w / 2, -h / 2, w, 10);
    c.add(g);
    c.add(scene.add.text(0, -h / 2 + 30, (q.cat === 'main' ? '★ ' : '') + q.title, {
      fontFamily: FONT, fontStyle: 'small-caps', fontSize: '26px', color: '#2b2115',
      wordWrap: { width: w - 60 }, align: 'center',
    }).setOrigin(0.5, 0));
    c.add(scene.add.text(0, -h / 2 + 76, q.text || '(без опису)', {
      fontFamily: FONT, fontSize: '17px', color: '#3a2e1e', lineSpacing: 5, wordWrap: { width: w - 60 },
    }).setOrigin(0.5, 0));
    const close = scene.add.zone(0, 0, W, H).setInteractive();
    close.on('pointerup', () => { c.destroy(true); overlay = null; });
    c.add(close);
    overlay = c;
    p.add(c);
  };

  void loadQuests().then((store) => {
    if (!scene.scene.isActive()) return;
    loading.destroy();
    const taken = takenQuests();
    const quests = store.quests
      .filter((q) => !q.giver || taken[q.id])
      .sort((a, b) => (a.cat === 'main' ? -1 : 1) - (b.cat === 'main' ? -1 : 1));
    if (!quests.length) {
      p.add(scene.add.text(cx, 220 + offY, 'Сувої поки чисті — завдання прийдуть у мандрах', {
        fontFamily: FONT, fontStyle: 'italic', fontSize: '20px', color: COL_DIM,
      }).setOrigin(0.5).setScrollFactor(0).setDepth(30));
      return;
    }
    const n = Math.min(quests.length, 7);
    const startY = 200 + offY - ((n - 1) * 44) / 2 + 20;
    quests.slice(0, n).forEach((q, i) => {
      const y = startY + i * 44;
      const t = p.add(scene.add.text(cx, y, (q.cat === 'main' ? '★ ' : '') + q.title, {
        fontFamily: FONT, fontStyle: 'small-caps', fontSize: '26px', color: COL_TEXT,
      }).setOrigin(0.5).setScrollFactor(0).setDepth(30)
        .setShadow(1, 2, '#000', 5, false, true).setInteractive({ useHandCursor: true }));
      t.on('pointerover', () => t.setColor('#ffcf8f'));
      t.on('pointerout', () => t.setColor(COL_TEXT));
      t.on('pointerup', () => openQuest(q));
    });
  });

  return { destroy(): void { overlay?.destroy(true); overlay = null; p.destroy(); } };
}

// ── Досягнення: центрований список гравців (реєстр у Firebase) ─────────────────
export function buildAchievementsPanel(scene: Phaser.Scene, offX: number, offY: number): PagePanel {
  const p = panel(scene);
  const cx = LOGICAL_W / 2 + offX;

  const loading = p.add(scene.add.text(cx, 210 + offY, 'Гортаємо літопис…', {
    fontFamily: FONT, fontSize: '20px', color: COL_DIM,
  }).setOrigin(0.5).setScrollFactor(0).setDepth(30));

  void listPlayers().then((players) => {
    if (!scene.scene.isActive()) return;
    loading.destroy();
    if (!players.length) {
      p.add(scene.add.text(cx, 220 + offY, 'Літопис поки порожній', {
        fontFamily: FONT, fontStyle: 'italic', fontSize: '20px', color: COL_DIM,
      }).setOrigin(0.5).setScrollFactor(0).setDepth(30));
      return;
    }
    const x0 = cx - 250, x1 = cx + 250;
    const n = Math.min(players.length, 8);
    const startY = LOGICAL_H / 2 + offY - ((n - 1) * 44) / 2;
    players.slice(0, n).forEach((pl, i) => {
      const y = startY + i * 44;
      const nick = pl.username ? '@' + pl.username : pl.name;
      p.add(scene.add.text(x0, y, nick, {
        fontFamily: FONT, fontStyle: 'small-caps', fontSize: '25px', color: COL_TEXT,
      }).setOrigin(0, 0.5).setScrollFactor(0).setDepth(30).setShadow(1, 2, '#000', 5, false, true));
      p.add(scene.add.text(x1, y, '0', {
        fontFamily: FONT, fontSize: '25px', color: '#9a8f78',
      }).setOrigin(1, 0.5).setScrollFactor(0).setDepth(30));
      const g = p.add(scene.add.graphics().setScrollFactor(0).setDepth(29));
      g.lineStyle(1, 0x3a3040, 1);
      g.beginPath(); g.moveTo(x0, y + 18); g.lineTo(x1, y + 18); g.strokePath();
    });
  });

  return { destroy(): void { p.destroy(); } };
}

// ── Хоругва: 5 клітинок-портретів праворуч (як слоти інвентаря) + дії по центру ─
// Морф-версія: ліве меню/фон/персонаж лишаються. Портрети побратимів — реальні
// (зі спільного каналу shared_chars), живлення — watchKhorugva. Немає загону →
// «Створити»; є → «Оголосити збір» / «Скопіювати запрошення» / «Покинути».
export function buildKhorugvaPanel(scene: Phaser.Scene, offX: number, offY: number): PagePanel {
  const cx = LOGICAL_W / 2 + offX;
  let objs: Phaser.GameObjects.GameObject[] = [];
  let gen = 0;
  let watchedId: string | null = null;
  let unwatch: (() => void) | null = null;
  let currentKh: Khorugva | null = null;
  let busy = false;

  const add = <T extends Phaser.GameObjects.GameObject>(o: T): T => { objs.push(o); return o; };
  const clear = (): void => { for (const o of objs) o.destroy(); objs = []; };

  const setStatus = (s: string): Phaser.GameObjects.Text => add(scene.add.text(cx, 470 + offY, s, {
    fontFamily: FONT, fontSize: '18px', color: COL_DIM,
  }).setOrigin(0.5).setScrollFactor(0).setDepth(31));

  const btn = (y: number, label: string, cb: () => void, size = 26): Phaser.GameObjects.Text => {
    const t = add(scene.add.text(cx, y + offY, label, {
      fontFamily: FONT, fontStyle: 'small-caps', fontSize: size + 'px', color: COL_TEXT,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(31).setShadow(1, 2, '#000', 5, false, true)
      .setInteractive({ useHandCursor: true }));
    t.on('pointerover', () => t.setColor(COL_HOVER));
    t.on('pointerout', () => t.setColor(COL_TEXT));
    t.on('pointerup', cb);
    return t;
  };

  // Клітинка портрета i (0..4): рамка + портрет побратима (thumb) або ініціал.
  const cell = (i: number, m: { id: string; name: string; charId?: string } | null): void => {
    const x = CELL_X + offX;
    const y = CELL_Y0 + i * (CELL_SIZE + CELL_GAP) + offY;
    const g = add(scene.add.graphics().setScrollFactor(0).setDepth(30));
    g.fillStyle(0x14101a, m ? 0.92 : 0.6);
    g.fillRoundedRect(x - CELL_SIZE / 2, y - CELL_SIZE / 2, CELL_SIZE, CELL_SIZE, 9);
    g.lineStyle(2, m ? COL_GOLD : 0x3a3346, 1);
    g.strokeRoundedRect(x - CELL_SIZE / 2, y - CELL_SIZE / 2, CELL_SIZE, CELL_SIZE, 9);
    if (!m) return;

    const isMe = m.id === getPlayerId();
    const init = add(scene.add.text(x, y - 4, (m.name || '?').slice(0, 1).toUpperCase(), {
      fontFamily: FONT, fontSize: '30px', color: COL_TEXT,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(31));
    add(scene.add.text(x, y + CELL_SIZE / 2 + 3, isMe ? 'ти' : m.name, {
      fontFamily: FONT, fontStyle: 'small-caps', fontSize: '13px', color: isMe ? COL_HOVER : COL_TEXT,
    }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(31).setShadow(1, 1, '#000', 4, false, true));

    const myGen = gen;
    void loadMemberThumb(m.id, m.charId ?? '').then((thumb) => {
      if (!thumb || myGen !== gen || !scene.scene.isActive()) return;
      const key = 'khp_' + m.id;
      const place = (): void => {
        if (myGen !== gen || !scene.scene.isActive()) return;
        init.destroy();
        const im = add(scene.add.image(x, y, key).setScrollFactor(0).setDepth(31));
        im.setScale(Math.min((CELL_SIZE - 8) / im.width, (CELL_SIZE - 8) / im.height));
      };
      if (scene.textures.exists(key)) place();
      else { scene.textures.once('addtexture-' + key, place); scene.textures.addBase64(key, thumb); }
    });
  };

  const render = (): void => {
    clear();
    gen++;
    const khId = myKhorugvaId();

    // Підписка на загін (перепідключаємось лише при зміні id).
    if (khId && watchedId !== khId) {
      unwatch?.(); watchedId = khId;
      unwatch = watchKhorugva(khId, (kh) => { currentKh = kh; if (scene.scene.isActive()) render(); });
    } else if (!khId && watchedId) {
      unwatch?.(); unwatch = null; watchedId = null; currentKh = null;
    }

    const members = khId ? memberList(currentKh) : [];
    add(scene.add.text(cx, 108 + offY, `Побратимів: ${members.length}/5`, {
      fontFamily: FONT, fontStyle: 'small-caps', fontSize: '20px', color: '#8a8171',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(31));
    for (let i = 0; i < 5; i++) cell(i, members[i] ?? null);

    if (!khId) {
      btn(280, 'Створити', () => {
        if (busy) return; busy = true;
        setStatus('Розгортаємо хоругву…');
        void createKhorugva()
          .then(() => { busy = false; render(); })
          .catch((e) => { busy = false; render(); setStatus('Не вдалося: ' + String(e?.message ?? e)); });
      });
      return;
    }

    // «По центру оголосити збір» + запрошення + вихід.
    btn(250, 'Оголосити збір', () => {
      const nick = window.prompt('Телеграм-нік гравця (напр. @friend):', '@');
      if (!nick || nick.replace(/^@/, '').trim().length < 2) return;
      setStatus('Скликаємо…');
      void callToGather(nick, khId)
        .then((r) => setStatus(r.botSent
          ? `Гонець побіг до ${nick} — сповіщення в боті`
          : `${nick} ще не знайомий з ботом — кинь запрошення (нижче)`))
        .catch((e) => setStatus('Не вдалося: ' + String(e?.message ?? e)));
    });
    btn(300, 'Скопіювати запрошення', () => {
      const link = `https://t.me/${BOT_USERNAME}/${APP_SHORT}?startapp=kh_${khId}`;
      const done = (): void => { setStatus('Запрошення скопійовано — кинь другу в чат'); };
      if (navigator.clipboard?.writeText) navigator.clipboard.writeText(link).then(done, () => window.prompt('Скопіюй запрошення:', link));
      else window.prompt('Скопіюй запрошення:', link);
    }, 22);
    btn(346, 'Покинути', () => {
      if (busy) return; busy = true;
      void leaveKhorugva(khId).catch(() => { /* офлайн — все одно забуваємо */ }).then(() => { busy = false; render(); });
    }, 22);
  };

  render();
  return { destroy(): void { unwatch?.(); unwatch = null; watchedId = null; clear(); } };
}
