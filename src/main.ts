import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { GameScene } from './scenes/GameScene';
import { initTelegram } from './telegram';
import { setupViewport } from './viewport';

initTelegram();

// Scale.NONE: розміром керуємо вручну через setupViewport (заповнення вікна +
// автоповорот у ландшафт). Бітемап рухається по власній площині з глибиною;
// Arcade-фізика не потрібна — рух і зіткнення рахуємо вручну (детермінована симуляція).
// NONE: рендеримо в нативному розширенні екрана (чітко, без апскейл-блюру).
// setupViewport заповнює вікно й повертає сцену на телефоні в ландшафт.
const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#2a2233',
  scale: {
    mode: Phaser.Scale.NONE,
    width: window.innerWidth,
    height: window.innerHeight,
  },
  scene: [BootScene, GameScene],
});

setupViewport(game);
