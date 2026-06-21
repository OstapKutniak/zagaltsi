// Усі ігрові константи зібрані тут — крути значення, не лазячи в логіку.

// Логічний кадр гри (поле огляду) — НЕ міняти, від нього залежать усі позиції/масштаби.
export const LOGICAL_W = 1280;
export const LOGICAL_H = 576;
// Суперсемплінг: backing-канвас рендериться у RENDER_SCALE× більшій роздільності, а
// камера масштабується тим самим множником → поле огляду те саме (1280×576 світу), але
// пікселів удвічі більше. Прибирає піксельність на десктопі й розмазування при русі
// камери (менше суб-піксельного зсуву). Світові координати/швидкості не зачіпає.
// Можна зменшити через налаштування гри (зберігається в localStorage zag_render_scale).
function _getRenderScale(): number {
  try { const v = localStorage.getItem('zag_render_scale'); if (v) { const n = Number(v); if (n > 0) return n; } } catch {}
  return 2;
}
export const RENDER_SCALE = _getRenderScale();

// Загальна довжина рівня у світових пікселях (горизонтальний скрол).
export const WORLD_WIDTH = 2600;

// "Стрічка" підлоги (глибина) рахується динамічно від висоти екрана:
// смуга такої висоти притиснута до низу, решта простору вгорі — небо.
export const BAND_DEPTH = 184; // висота прохідної смуги (рух вглиб/назовні)
export const FLOOR_MARGIN = 26; // відступ смуги від низу екрана

export const JUMP = {
  power: 560, // початкова вертикальна швидкість підскоку
  gravity: 1800, // тяжіння для висоти стрибка (z)
};

export const PLAYER = {
  speed: 230,
  maxHp: 5,
  attackActive: 110, // мс, скільки активний хітбокс удару
  attackCooldown: 260, // мс між ударами
  attackReach: 66, // довжина зони удару по X
  attackDepth: 38, // допуск по глибині (Y)
  attackDamage: 1,
  invulnDuration: 700, // мс невразливості після отримання шкоди
};

export const ENEMY = {
  speed: 95,
  hp: 2,
  attackRange: 48, // дистанція, з якої б'є гравця
  attackDepth: 32,
  attackCooldown: 850, // мс між ударами ворога
  damage: 1,
};
