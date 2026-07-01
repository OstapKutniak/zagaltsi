import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { MenuScene } from './scenes/MenuScene';
import { SectionScene } from './scenes/SectionScene';
import { GameScene } from './scenes/GameScene';
import { ColorGradePipeline } from './scenes/ColorGradePipeline';
import { initTelegram } from './telegram';
import { setupViewport } from './viewport';
import { initLobbyUI } from './multiplayer/lobbyUI';
import { LOGICAL_W, LOGICAL_H, RENDER_SCALE } from './config';

initTelegram();
initLobbyUI();

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
  scene: [BootScene, MenuScene, SectionScene, GameScene],
});

setupViewport(game);

// Dev-only: доступ до інстансу гри з консолі для дебагу (у проді не активний).
if (import.meta.env.DEV) (window as unknown as { __game: Phaser.Game }).__game = game;
