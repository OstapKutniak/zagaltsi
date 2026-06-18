import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { GameScene } from './scenes/GameScene';
import { initTelegram } from './telegram';
import { setupViewport } from './viewport';
import { initLobbyUI } from './multiplayer/lobbyUI';

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
  scale: {
    mode: Phaser.Scale.NONE,
    width: 1280,
    height: 576,
  },
  scene: [BootScene, GameScene],
});

setupViewport(game);
