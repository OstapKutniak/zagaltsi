import Phaser from 'phaser';

// Ввід оформлений як "команди", а не прямі звернення до клавіатури.
// Це дозволяє згодом слати ті самі команди по мережі (кооп) без переробки логіки.

export interface InputCommand {
  left: boolean;
  right: boolean;
  jump: boolean; // фронт сигналу: натиснуто саме цього кадру
  jumpHeld: boolean; // утримується
  attack: boolean; // фронт сигналу
}

type StateKey = 'left' | 'right' | 'jumpHeld' | 'attackHeld';

export class InputController {
  private state: Record<StateKey, boolean> = {
    left: false,
    right: false,
    jumpHeld: false,
    attackHeld: false,
  };
  private prevJump = false;
  private prevAttack = false;

  constructor(scene: Phaser.Scene) {
    const kb = scene.input.keyboard;
    if (kb) {
      const bind = (codes: string[], key: StateKey) => {
        for (const code of codes) {
          const k = kb.addKey(code);
          k.on('down', () => { this.state[key] = true; });
          k.on('up', () => { this.state[key] = false; });
        }
      };
      bind(['LEFT', 'A'], 'left');
      bind(['RIGHT', 'D'], 'right');
      bind(['UP', 'W', 'SPACE'], 'jumpHeld');
      bind(['J', 'K', 'F'], 'attackHeld');
    }
    this.bindTouch();
  }

  private bindTouch(): void {
    const map: Array<[string, StateKey]> = [
      ['btn-left', 'left'],
      ['btn-right', 'right'],
      ['btn-jump', 'jumpHeld'],
      ['btn-attack', 'attackHeld'],
    ];
    for (const [id, key] of map) {
      const el = document.getElementById(id);
      if (!el) continue;
      const set = (value: boolean) => (e: Event) => {
        e.preventDefault();
        this.state[key] = value;
      };
      el.addEventListener('touchstart', set(true), { passive: false });
      el.addEventListener('touchend', set(false), { passive: false });
      el.addEventListener('touchcancel', set(false), { passive: false });
      el.addEventListener('mousedown', set(true));
      el.addEventListener('mouseup', set(false));
      el.addEventListener('mouseleave', set(false));
    }
  }

  // Знімок вводу за кадр. Фронти (jump/attack) рахуються тут.
  sample(): InputCommand {
    const jump = this.state.jumpHeld && !this.prevJump;
    const attack = this.state.attackHeld && !this.prevAttack;
    this.prevJump = this.state.jumpHeld;
    this.prevAttack = this.state.attackHeld;
    return {
      left: this.state.left,
      right: this.state.right,
      jump,
      jumpHeld: this.state.jumpHeld,
      attack,
    };
  }
}
