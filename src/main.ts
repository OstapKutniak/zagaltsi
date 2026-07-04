import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { MenuScene } from './scenes/MenuScene';
import { SectionScene } from './scenes/SectionScene';
import { WorldScene } from './scenes/WorldScene';
import { LocationScene } from './scenes/LocationScene';
import { QuestsScene } from './scenes/QuestsScene';
import { AchievementsScene } from './scenes/AchievementsScene';
import { InventoryScene } from './scenes/InventoryScene';
import { GameScene } from './scenes/GameScene';
import { ColorGradePipeline } from './scenes/ColorGradePipeline';
import { initTelegram, getStartParam } from './telegram';
import { setupViewport } from './viewport';
import { initLobbyUI } from './multiplayer/lobbyUI';
import { registerPlayer } from './players';
import { joinKhorugva, myKhorugvaId } from './khorugva';
import { startPartyNavSync } from './multiplayer/partyNav';
import { LOGICAL_W, LOGICAL_H, RENDER_SCALE } from './config';

initTelegram();
initLobbyUI();
registerPlayer(); // реєстр гравців (Firebase) — для «Досягнень»

// Камера ФІКСОВАНА 20:9: логічний кадр завжди 1280×576 (Scale.NONE — без
// авто-масштабування Phaser, бо його FIT нестабільно перефітує при resize).
// Вписування в будь-яке вікно з леттербоксом рахуємо ВРУЧНУ у viewport.ts
// (детерміновано). Той самий цілісний кадр скрізь — у грі, у превʼю студії, у TG.
const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#2a2233',
  // backing-роздільність у RENDER_SCALE× більша; камера зумиться тим самим множником у
  // GameScene, тож поле огляду лишається LOGICAL_W×LOGICAL_H. viewport.ts CSS-вписує канвас
  // у вікно (downscale → різко). roundPixels ВИМКНЕНО: при плавному follow камери воно
  // округлювало кожну частину персонажа окремо → дрож і «піксельність». Суперсемплінг
  // (RENDER_SCALE) дає різкість і без округлення.
  render: { antialias: true, roundPixels: false },
  scale: {
    mode: Phaser.Scale.NONE,
    width: LOGICAL_W * RENDER_SCALE,
    height: LOGICAL_H * RENDER_SCALE,
  },
  pipeline: { ColorGrade: ColorGradePipeline } as unknown as Phaser.Types.Core.PipelineConfig,
  scene: [BootScene, MenuScene, SectionScene, WorldScene, LocationScene, QuestsScene, AchievementsScene, InventoryScene, GameScene],
});

setupViewport(game);

// Хоругва йде за головним: коли лідер переходить (карта/локація/рівень) — той
// самий екран отримують усі побратими. Соло-гравці (без хоругви) не зачеплені.
startPartyNavSync((intent) => {
  const active = game.scene.getScenes(true).find((s) => s.scene.key !== 'Boot');
  if (!active) return;
  if (intent.scene === 'Game') {
    const levelId = String(intent.data?.levelId ?? '');
    try { const kh = myKhorugvaId(); if (kh) sessionStorage.setItem('zag_coop_lobby', kh); } catch { /* ignore */ }
    void import('./level/launch').then(({ stageLevelById }) =>
      stageLevelById(levelId).finally(() => { if (active.scene.isActive()) active.scene.start('Game'); }));
  } else {
    active.scene.start(intent.scene, intent.data ?? {});
  }
});

// Deep-link роутинг (кнопки бота / сповіщення збору): ?startapp=<param>.
// zhytlo→Житло, mandry→Карта, khorugva→Хоругва, zavdannya→Завдання,
// dosyagnennya→Досягнення, inventar→Інвентар, kh_<id>→приєднатись до хоругви.
const START_ROUTES: Record<string, { scene: string; data?: object }> = {
  zhytlo: { scene: 'Menu' },
  mandry: { scene: 'World', data: {} },
  zavdannya: { scene: 'Quests' },
  dosyagnennya: { scene: 'Achievements' },
  inventar: { scene: 'Inventory' },
};
// Енкаунтер «у вашій локації хтось є» (кнопка «Перевірити» з бота): відкриваємо
// ПОТОЧНУ локацію мандрівника з випадковим невзятим квестом, у якого є «Хто дає».
async function openEncounter(menu: Phaser.Scene): Promise<void> {
  const [{ loadWorldsForGame, findGlobalWorld, loadTravel }, { loadQuests }, { takenQuests }] = await Promise.all([
    import('./world/worldData'), import('./story/quests'), import('./story/questState'),
  ]);
  const worlds = await loadWorldsForGame();
  const t = loadTravel();
  let world = worlds.find((w) => w.id === t?.worldId) ?? null;
  let node = world?.nodes.find((n) => n.id === t?.nodeId && n.type === 'location') ?? null;
  if (!node) {
    // мандрівник ще ніде не був (або стоїть на регіоні) → перша ЛОКАЦІЯ будь-якого
    // світу (глобальний зазвичай має лише регіони, тож шукаємо по всіх)
    const ordered = [findGlobalWorld(worlds), ...worlds].filter((w): w is NonNullable<typeof w> => !!w);
    for (const w of ordered) {
      const n = w.nodes.find((x) => x.type === 'location');
      if (n) { world = w; node = n; break; }
    }
  }
  if (!world || !node) { menu.scene.start('World', {}); return; }
  const taken = takenQuests();
  const store = await loadQuests();
  const candidates = store.quests.filter((q) => q.giver && !taken[q.id]);
  const quest = candidates[Math.floor(Math.random() * candidates.length)] ?? null;
  menu.scene.start('Location', {
    nodeId: node.id, label: node.label, locationId: node.locationId, worldId: world.id,
    icon: node.icon ?? '', encounterQuestId: quest?.id,
  });
}

const startParam = getStartParam();
if (startParam) {
  // Меню стартує з Boot; перемикаємось, щойно воно піднялось.
  game.events.once(Phaser.Core.Events.READY, () => {
    const menu = game.scene.getScene('Menu');
    menu?.events.once(Phaser.Scenes.Events.CREATE, () => {
      if (startParam.startsWith('kh_')) {
        void joinKhorugva(startParam.slice(3))
          .catch(() => null)
          .then(() => menu.scene.start('Menu', { startPage: 'khorugva' }));
      } else if (startParam === 'khorugva') {
        menu.scene.start('Menu', { startPage: 'khorugva' });
      } else if (startParam === 'enc') {
        void openEncounter(menu).catch(() => menu.scene.start('World', {}));
      } else {
        const r = START_ROUTES[startParam];
        if (r && r.scene !== 'Menu') menu.scene.start(r.scene, r.data);
      }
    });
  });
}

// Dev-only: доступ до інстансу гри з консолі для дебагу (у проді не активний).
if (import.meta.env.DEV) (window as unknown as { __game: Phaser.Game }).__game = game;
