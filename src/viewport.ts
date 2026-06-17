import type Phaser from 'phaser';

// Камера фіксована 20:9 через Phaser Scale.FIT (див. main.ts) — він сам вписує
// кадр у вікно з леттербоксом і слухає resize. Тут лишаємо тільки явний refresh
// на події, які Phaser може не зловити сам (orientationchange, Telegram viewport).
export function setupViewport(game: Phaser.Game): void {
  const refresh = (): void => { game.scale.refresh(); };
  window.addEventListener('orientationchange', () => setTimeout(refresh, 120));
  const tgWebApp = (
    window as unknown as { Telegram?: { WebApp?: { onEvent?: (event: string, cb: () => void) => void } } }
  ).Telegram?.WebApp;
  tgWebApp?.onEvent?.('viewportChanged', refresh);
}
