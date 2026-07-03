import { MenuScene } from './MenuScene';

// «Інвентар» як окрема сцена потрібна лише для прямого входу (deep-link ?startapp=inventar
// чи стара кнопка scene.start('Inventory')). Це та сама хатина, що стартує одразу на
// сторінці 'inventory' (персонаж стоїть). Усередині гри перехід Житло↔Інвентар —
// реальночасний, у межах однієї сцени Menu (MenuScene.gotoPage), без перезапуску.
export class InventoryScene extends MenuScene {
  protected initialPage = 'inventory';
  constructor() { super('Inventory'); }
}
