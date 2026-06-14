import Phaser from 'phaser';

// Ввід оформлений як "команди", а не прямі звернення до клавіатури.
// Це дозволяє згодом слати ті самі команди по мережі (кооп) без переробки логіки.

export interface InputCommand {
  left: boolean;
  right: boolean;
  up: boolean; // рух углиб сцени
  down: boolean; // рух назовні (до камери)
  jump: boolean; // фронт сигналу: натиснуто саме цього кадру
  attack: boolean; // фронт сигналу
}

type StateKey = 'left' | 'right' | 'up' | 'down' | 'jump' | 'attack';

export class InputController {
  private held: Record<StateKey, boolean> = {
    left: false,
    right: false,
    up: false,
    down: false,
    jump: false,
    attack: false,
  };
  private prevJump = false;
  private prevAttack = false;

  constructor(scene: Phaser.Scene) {
    const kb = scene.input.keyboard;
    if (kb) {
      const bind = (codes: string[], key: StateKey) => {
        for (const code of codes) {
          const k = kb.addKey(code);
          k.on('down', () => { this.held[key] = true; });
          k.on('up', () => { this.held[key] = false; });
        }
      };
      bind(['LEFT', 'A'], 'left');
      bind(['RIGHT', 'D'], 'right');
      bind(['UP', 'W'], 'up');
      bind(['DOWN', 'S'], 'down');
      bind(['SPACE', 'K'], 'jump');
      bind(['J', 'F'], 'attack');
    }
    this.bindTouch();
  }

  private bindTouch(): void {
    const map: Array<[string, StateKey]> = [
      ['btn-left', 'left'],
      ['btn-right', 'right'],
      ['btn-up', 'up'],
      ['btn-down', 'down'],
      ['btn-jump', 'jump'],
      ['btn-attack', 'attack'],
    ];
    for (const [id, key] of map) {
      const el = document.getElementById(id);
      if (!el) continue;
      const set = (value: boolean) => (e: Event) => {
        e.preventDefault();
        this.held[key] = value;
      };
      el.addEventListener('touchstart', set(true), { passive: false });
      el.addEventListener('touchend', set(false), { passive: false });
      el.addEventListener('touchcancel', set(false), { passive: false });
      el.addEventListener('mousedown', set(true));
      el.addEventListener('mouseup', set(false));
      el.addEventListener('mouseleave', set(false));
    }
  }

  // Знімок вводу за крок симуляції. Фронти (jump/attack) рахуються тут.
  sample(): InputCommand {
    const jump = this.held.jump && !this.prevJump;
    const attack = this.held.attack && !this.prevAttack;
    this.prevJump = this.held.jump;
    this.prevAttack = this.held.attack;
    return {
      left: this.held.left,
      right: this.held.right,
      up: this.held.up,
      down: this.held.down,
      jump,
      attack,
    };
  }
}
