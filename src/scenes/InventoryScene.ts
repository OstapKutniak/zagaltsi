import { MenuScene } from './MenuScene';
import type { CutoutCharacter } from '../anim/CutoutCharacter';
import { buildInvPanel, applyEquipTo, type InvPanel } from './invPanel';
import { loadEquip } from '../inventory';

// Сторінка «Інвентар» — та сама хатина (успадковує Житло: фон/вогонь/шторм/кнопки),
// але персонаж ВСТАВ з лавки і стоїть в айдлі. UI панелі — спільний buildInvPanel
// (той самий, що малює ріалтайм-морф Житло↔Інвентар у MenuScene).
// Ця сцена лишається для deep-link ?startapp=inventar (пряме відкриття з бота).
export class InventoryScene extends MenuScene {
  private panel: InvPanel | null = null;

  constructor() { super('Inventory'); }

  protected pageTitle(): string { return 'ІНВЕНТАР'; }

  // Встав з лавки: айдл, трохи правіше сидячої позиції, ступні на підлозі.
  protected charSetup(): { anim: string; x: number; y: number; scale: number; feetY?: number } {
    const C = this.fx.char;
    return { anim: 'idle', x: C.x + 55, y: C.y, scale: C.scale, feetY: 522 };
  }

  protected onCharReady(char: CutoutCharacter): void {
    applyEquipTo(char, loadEquip());
  }

  protected afterBuild(offX: number, offY: number): void {
    this.panel?.destroy();
    this.panel = buildInvPanel(this, offX, offY, () => this.lobbyChar);
  }
}
