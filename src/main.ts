import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { MenuScene } from './scenes/MenuScene';
import { SectionScene } from './scenes/SectionScene';
import { WorldScene } from './scenes/WorldScene';
import { LocationScene } from './scenes/LocationScene';
import { QuestsScene } from './scenes/QuestsScene';
import { AchievementsScene } from './scenes/AchievementsScene';
import { KhorugvaScene } from './scenes/KhorugvaScene';
import { GameScene } from './scenes/GameScene';
import { ColorGradePipeline } from './scenes/ColorGradePipeline';
import { initTelegram, getStartParam } from './telegram';
import { setupViewport } from './viewport';
import { initLobbyUI } from './multiplayer/lobbyUI';
import { registerPlayer } from './players';
import { joinKhorugva } from './khorugva';
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
  scene: [BootScene, MenuScene, SectionScene, WorldScene, LocationScene, QuestsScene, AchievementsScene, KhorugvaScene, GameScene],
});

setupViewport(game);

// Deep-link роутинг (кнопки бота / сповіщення збору): ?startapp=<param>.
// zhytlo→Житло, mandry→Карта, khorugva→Хоругва, zavdannya→Завдання,
// dosyagnennya→Досягнення, inventar→Інвентар, kh_<id>→приєднатись до хоругви.
const START_ROUTES: Record<string, { scene: string; data?: object }> = {
  zhytlo: { scene: 'Menu' },
  mandry: { scene: 'World', data: {} },
  khorugva: { scene: 'Khorugva' },
  zavdannya: { scene: 'Quests' },
  dosyagnennya: { scene: 'Achievements' },
  inventar: { scene: 'Section', data: { title: 'Інвентар', from: 'Menu' } },
};
const startParam = getStartParam();
if (startParam) {
  // Меню стартує з Boot; перемикаємось, щойно воно піднялось.
  game.events.once(Phaser.Core.Events.READY, () => {
    const menu = game.scene.getScene('Menu');
    menu?.events.once(Phaser.Scenes.Events.CREATE, () => {
      if (startParam.startsWith('kh_')) {
        void joinKhorugva(startParam.slice(3))
          .catch(() => null)
          .then(() => menu.scene.start('Khorugva'));
      } else {
        const r = START_ROUTES[startParam];
        if (r && r.scene !== 'Menu') menu.scene.start(r.scene, r.data);
      }
    });
  });
}

// Dev-only: доступ до інстансу гри з консолі для дебагу (у проді не активний).
if (import.meta.env.DEV) (window as unknown as { __game: Phaser.Game }).__game = game;
