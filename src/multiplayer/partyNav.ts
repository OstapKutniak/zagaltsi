import { ref, set, onValue, type Unsubscribe } from 'firebase/database';
import { db } from '../firebase';
import { myKhorugvaId } from '../khorugva';
import { getPlayerId } from './lobby';

// Навігація хоругви веде ГОЛОВНИЙ (лідер): куди пішов він — туди їдуть екрани
// всіх побратимів. Лідер пише «намір» у Firebase khorugvas/<id>/nav, решта
// слухає і повторює перехід сцен. Соло-гравці (без хоругви) не зачеплені.

export interface NavIntent {
  scene: 'World' | 'Location' | 'Menu' | 'Game';
  data?: Record<string, unknown>;
  at: number;
  by: string;
}

// Лідер оголошує напрям (веде хоругву). Ведений НЕ пише (перевірка на боці
// викликача через iAmLeaderCached), але дублюємо запобіжник тут через `by`.
export function broadcastNav(scene: NavIntent['scene'], data?: Record<string, unknown>): void {
  const id = myKhorugvaId(); if (!id) return;
  const intent: NavIntent = { scene, data: data ?? {}, at: Date.now(), by: getPlayerId() };
  set(ref(db, `khorugvas/${id}/nav`), intent).catch(() => {});
}

// Глобальний слухач: коли лідер кудись пішов — застосувати той самий перехід.
// Свій же намір ігноруємо (я і так уже там). Перепідключається при зміні хоругви.
let unwatch: Unsubscribe | null = null;
let watchedId: string | null = null;
let lastAppliedAt = 0;

export function startPartyNavSync(apply: (intent: NavIntent) => void): void {
  const tick = (): void => {
    const id = myKhorugvaId();
    if (id === watchedId) return;
    unwatch?.(); unwatch = null; watchedId = id;
    if (!id) return;
    unwatch = onValue(ref(db, `khorugvas/${id}/nav`), (snap) => {
      const intent = snap.val() as NavIntent | null;
      if (!intent || intent.at <= lastAppliedAt) return;
      lastAppliedAt = intent.at;
      if (intent.by === getPlayerId()) return; // я і є ініціатор — не веду сам себе
      try { apply(intent); } catch { /* сцена могла бути ще не готова */ }
    });
  };
  tick();
  setInterval(tick, 4000); // хоругва могла з'явитись/змінитись — перевіряємо періодично
}
