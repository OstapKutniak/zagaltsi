import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { GameScene } from './scenes/GameScene';
import { initTelegram } from './telegram';
import { setupViewport } from './viewport';

initTelegram();

// Scale.NONE: розміром керуємо вручну через setupViewport (заповнення вікна +
// автоповорот у ландшафт). Бітемап рухається по власній площині з глибиною;
// Arcade-фізика не потрібна — рух і зіткнення рахуємо вручну (детермінована симуляція).
// FIT: фіксований дизайн-кадр (як на телефоні), масштабується під вікно з чорними
// полями (леттербокс) — однаковий вид на ПК і телефоні. Поля згодом замінимо дизайном.
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
