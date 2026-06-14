// Усі ігрові константи зібрані тут — крути значення, не лазячи в логіку.

export const GAME_WIDTH = 960;
export const GAME_HEIGHT = 540;
export const WORLD_WIDTH = 2600;

// Прохідна "стрічка" підлоги (глибина). Гравець ходить у цьому діапазоні по Y —
// це і є простір вглиб/назовні, як у Golden Axe чи Streets of Rage.
export const BAND = {
  top: 320,
  bottom: 510,
};

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
