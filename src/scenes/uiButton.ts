import Phaser from 'phaser';

// Ховає HTML-оверлей завантаження (#loadScreen в index.html). Викликається першою
// видимою сценою (меню або гра) — щойно є що показати. Ідемпотентно: якщо оверлея
// вже нема (прибрали раніше), нічого не робить.
export function hideLoadScreen(): void {
  const loadScreen = document.getElementById('loadScreen');
  if (!loadScreen) return;
  const fill = document.getElementById('loadFill');
  if (fill) fill.style.width = '100%';
  setTimeout(() => {
    loadScreen.classList.add('hide');
    setTimeout(() => loadScreen.remove(), 500);
  }, 150);
}

// Тач-керування (#touch: джойстик + удар/стрибок) — ЛИШЕ в бітемап-рівні.
// GameScene вмикає на створенні й вимикає на shutdown; меню/карти/локації ховають захисно.
export function setTouchUI(on: boolean): void {
  const el = document.getElementById('touch');
  if (el) el.style.display = on ? '' : 'none';
}

// Проста текстова кнопка (без іконок/оформлення — за конвенцією проєкту).
// Прямокутник-підкладка + напис, hover підсвічує. Повертає підкладку (для позиціювання).
export function makeTextButton(
  scene: Phaser.Scene,
  x: number,
  y: number,
  label: string,
  onClick: () => void,
  opts: { w?: number; h?: number } = {},
): Phaser.GameObjects.Rectangle {
  const w = opts.w ?? 360;
  const h = opts.h ?? 56;
  const bg = scene.add.rectangle(x, y, w, h, 0x2f2838)
    .setScrollFactor(0)
    .setStrokeStyle(2, 0x5a4f6a)
    .setInteractive({ useHandCursor: true });
  const txt = scene.add.text(x, y, label, {
    fontFamily: 'system-ui, sans-serif',
    fontSize: '26px',
    color: '#d8d0c0',
  }).setOrigin(0.5).setScrollFactor(0);

  bg.on('pointerover', () => { bg.setFillStyle(0x3f3550); txt.setColor('#ffffff'); });
  bg.on('pointerout',  () => { bg.setFillStyle(0x2f2838); txt.setColor('#d8d0c0'); });
  bg.on('pointerup', onClick);
  return bg;
}
