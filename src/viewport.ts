import type Phaser from 'phaser';

// Тримає гру горизонтальною й на весь екран.
// - Десктоп / ландшафт: сцена заповнює вікно як є.
// - Портрет (телефон вертикально): повертаємо сцену на 90°, щоб бітемап
//   завжди був у ландшафті. Гравець розвертає телефон — і грає горизонтально.
// Заодно явно повідомляємо Phaser про новий розмір (фікс «застрягло маленьким»).
export function setupViewport(game: Phaser.Game): void {
  const stage = document.getElementById('stage');
  if (!stage) return;

  const apply = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const portrait = h > w;

    if (portrait) {
      // Ландшафтна сцена, повернута на 90° навколо верхнього-лівого кута.
      stage.style.left = `${w}px`;
      stage.style.top = '0px';
      stage.style.width = `${h}px`;
      stage.style.height = `${w}px`;
      stage.style.transform = 'rotate(90deg)';
    } else {
      stage.style.left = '0px';
      stage.style.top = '0px';
      stage.style.width = `${w}px`;
      stage.style.height = `${h}px`;
      stage.style.transform = 'none';
    }
    // Scale.FIT сам вписує дизайн у #stage із чорними полями — лише оновлюємо.
    game.scale.refresh();
  };

  apply();
  window.addEventListener('resize', apply);
  window.addEventListener('orientationchange', apply);

  // Telegram повідомляє про зміну в'юпорта окремою подією (фулскрін тощо).
  const tgWebApp = (
    window as unknown as { Telegram?: { WebApp?: { onEvent?: (event: string, cb: () => void) => void } } }
  ).Telegram?.WebApp;
  tgWebApp?.onEvent?.('viewportChanged', apply);
}
