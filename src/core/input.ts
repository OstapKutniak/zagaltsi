import Phaser from 'phaser';

// Ввід оформлений як "команди", а не прямі звернення до клавіатури.
// Це дозволяє згодом слати ті самі команди по мережі (кооп) без переробки логіки.

export interface InputCommand {
  left: boolean;
  right: boolean;
  up: boolean; // рух углиб сцени
  down: boolean; // рух назовні (до камери)
  run: boolean; // Shift / далеко відхилений джойстик — біг
  jump: boolean; // фронт сигналу: натиснуто саме цього кадру
  attack: boolean; // фронт сигналу
}

type StateKey = 'left' | 'right' | 'up' | 'down' | 'run' | 'jump' | 'attack';

export class InputController {
  private held: Record<StateKey, boolean> = {
    left: false, right: false, up: false, down: false, run: false, jump: false, attack: false,
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
      bind(['SHIFT'], 'run');
      bind(['SPACE', 'K'], 'jump');
      bind(['J', 'F'], 'attack');
    }
    this.bindTouch();
    this.bindJoystick();
  }

  private bindTouch(): void {
    const map: Array<[string, StateKey]> = [
      ['btn-jump', 'jump'],
      ['btn-attack', 'attack'],
    ];
    for (const [id, key] of map) {
      const el = document.getElementById(id);
      if (!el) continue;
      const set = (value: boolean) => (e: Event) => { e.preventDefault(); this.held[key] = value; };
      el.addEventListener('touchstart', set(true), { passive: false });
      el.addEventListener('touchend', set(false), { passive: false });
      el.addEventListener('touchcancel', set(false), { passive: false });
      el.addEventListener('mousedown', set(true));
      el.addEventListener('mouseup', set(false));
      el.addEventListener('mouseleave', set(false));
    }
  }

  // Віртуальний джойстик. На телефоні сцену повернуто на 90° (див. viewport.ts),
  // тож екранний вектор перетворюємо в ігрові осі.
  private bindJoystick(): void {
    const stick = document.getElementById('stick');
    const knob = document.getElementById('stickKnob');
    if (!stick || !knob) return;
    const R = 56;
    let active = false;
    let cx = 0;
    let cy = 0;

    const start = (x: number, y: number): void => {
      active = true;
      const r = stick.getBoundingClientRect();
      cx = r.left + r.width / 2;
      cy = r.top + r.height / 2;
      this.moveStick(knob, R, x - cx, y - cy);
    };
    const move = (x: number, y: number): void => { if (active) this.moveStick(knob, R, x - cx, y - cy); };
    const end = (): void => {
      active = false;
      knob.style.transform = '';
      this.held.left = this.held.right = this.held.up = this.held.down = this.held.run = false;
    };

    stick.addEventListener('touchstart', (e) => { e.preventDefault(); const t = e.changedTouches[0]; start(t.clientX, t.clientY); }, { passive: false });
    stick.addEventListener('touchmove', (e) => { e.preventDefault(); const t = e.changedTouches[0]; move(t.clientX, t.clientY); }, { passive: false });
    stick.addEventListener('touchend', (e) => { e.preventDefault(); end(); }, { passive: false });
    stick.addEventListener('touchcancel', () => end());
    stick.addEventListener('mousedown', (e) => start(e.clientX, e.clientY));
    window.addEventListener('mousemove', (e) => move(e.clientX, e.clientY));
    window.addEventListener('mouseup', () => { if (active) end(); });
  }

  // sdx/sdy — екранний відступ від центра. Переводимо в ігрові осі з урахуванням
  // повороту сцени на телефоні; рухаємо кнопку й виставляємо напрямки/біг.
  private moveStick(knob: HTMLElement, R: number, sdx: number, sdy: number): void {
    const portrait = window.innerHeight > window.innerWidth;
    const ax = portrait ? sdy : sdx; // ігрова вісь X
    const ay = portrait ? -sdx : sdy; // ігрова вісь Y
    const d = Math.hypot(ax, ay);
    const f = d > R ? R / d : 1;
    knob.style.transform = `translate(${ax * f}px, ${ay * f}px)`;
    const dead = 0.32;
    const nx = ax / R;
    const ny = ay / R;
    this.held.left = nx < -dead;
    this.held.right = nx > dead;
    this.held.up = ny < -dead;
    this.held.down = ny > dead;
    this.held.run = d > R * 0.82; // далеко відхилив — біг
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
      run: this.held.run,
      jump,
      attack,
    };
  }
}
