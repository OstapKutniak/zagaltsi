import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { GameScene } from './scenes/GameScene';
import { initTelegram } from './telegram';

initTelegram();

// RESIZE: канвас завжди дорівнює розміру вікна Telegram/браузера — без чорних полів.
// Бітемап рухається по власній площині з глибиною; Arcade-фізика не потрібна,
// рух і зіткнення рахуємо вручну (це й тримає симуляцію детермінованою).
new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#2a2233',
  scale: {
    mode: Phaser.Scale.RESIZE,
    width: window.innerWidth,
    height: window.innerHeight,
  },
  scene: [BootScene, GameScene],
});
