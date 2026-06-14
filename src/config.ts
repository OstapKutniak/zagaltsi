// Усі ігрові константи зібрані тут — крути значення, не лазячи в логіку.

export const GAME_WIDTH = 960;
export const GAME_HEIGHT = 540;
export const GRAVITY = 1400;

export const PLAYER = {
  speed: 220,
  jumpVelocity: 560,
  maxHp: 3,
  attackDuration: 120, // мс, скільки активний хітбокс удару
  attackCooldown: 320, // мс між ударами
  attackRange: 46, // довжина хітбокса перед героєм
  attackWidth: 40, // висота хітбокса
  invulnDuration: 800, // мс невразливості після отримання шкоди
};

export const ENEMY = {
  speed: 60,
  hp: 1,
};
