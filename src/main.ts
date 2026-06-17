import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { GameScene } from './scenes/GameScene';
import { initTelegram } from './telegram';
import { setupViewport } from './viewport';

initTelegram();

// Камера ФІКСОВАНА 20:9 (1280×576). Scale.FIT вписує цей кадр у будь-яке вікно
// з леттербоксом (чорні поля), autoCenter центрує. Логічний розмір сцени завжди
// 1280×576 — тож гра однакова скрізь (і в превʼю студії, і на телефоні).
const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#2a2233',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: 1280,
    height: 576,
  },
  scene: [BootScene, GameScene],
});

setupViewport(game);
