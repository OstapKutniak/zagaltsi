import Phaser from 'phaser';
import { LOGICAL_W, LOGICAL_H } from '../config';
import { loadQuests, type Quest } from '../story/quests';
import { takenQuests } from '../story/questState';
import { listPlayers } from '../players';

// Прості «списки по центру» для ріалтайм-морфу розділів у лоббі (Житло↔Квести,
// ↔Досягнення) — БЕЗ зміни сцени: фон/вогонь/персонаж лишаються, з'являється
// лише панель. Повні сцени (дошка QuestsScene, AchievementsScene) далі живуть
// для deep-link'ів з бота. Кожен білдер повертає { destroy() }.

const FONT = 'Georgia, "Times New Roman", serif';
const COL_TEXT = '#e5d8bc';
const COL_DIM = '#8a8496';

export interface PagePanel { destroy(): void }

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
