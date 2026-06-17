import type Phaser from 'phaser';

// Камера фіксована 20:9 (1280×576, Scale.NONE). Тут ВРУЧНУ вписуємо канвас у вікно
// з леттербоксом: масштаб = min(вікно/кадр) по обох осях (показує ВЕСЬ кадр, без
// обрізання), канвас центруємо. Робимо це самі (а не Phaser FIT), бо так
// детерміновано перефітується при будь-якій зміні розміру — і вікна браузера, і
// iframe-превʼю в студії. Поле огляду НЕ міняється — лише розмір зображення.
const W = 1280, H = 576;

export function setupViewport(game: Phaser.Game): void {
  const apply = (): void => {
    const cv = game.canvas;
    if (!cv) return;
    const winW = window.innerWidth, winH = window.innerHeight;
    const s = Math.min(winW / W, winH / H);
    const cw = Math.round(W * s), ch = Math.round(H * s);
    cv.style.position = 'absolute';
    cv.style.width = cw + 'px';
    cv.style.height = ch + 'px';
    cv.style.left = Math.round((winW - cw) / 2) + 'px';
    cv.style.top = Math.round((winH - ch) / 2) + 'px';
  };

  apply();
  window.addEventListener('resize', apply);
  window.addEventListener('orientationchange', () => setTimeout(apply, 120));

  if (typeof ResizeObserver !== 'undefined') {
    const host = document.getElementById('game') ?? document.body;
    let raf = 0;
    const ro = new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(apply); });
    ro.observe(host);
  }

  const tgWebApp = (
    window as unknown as { Telegram?: { WebApp?: { onEvent?: (event: string, cb: () => void) => void } } }
  ).Telegram?.WebApp;
  tgWebApp?.onEvent?.('viewportChanged', apply);

  // студія-превʼю (iframe) може смикнути перефіт після зміни свого розміру
  (window as unknown as { __zagRefit?: () => void }).__zagRefit = apply;
}
