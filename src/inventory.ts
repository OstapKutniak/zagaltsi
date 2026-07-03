// Інвентар: каталог речей (плейсхолдери), стан «що вдягнено» (localStorage)
// і процедурні білі іконки для слотів/смуги речей. Візуал на персонажі —
// CutoutCharacter.setEquipment (білі силуети поверх частин + меч у руці).

import type Phaser from 'phaser';

export type EquipSlot = 'helmet' | 'armor' | 'pants' | 'weapon' | 'accessory';

export const SLOT_LABELS: Record<EquipSlot, string> = {
  helmet: 'Шолом',
  armor: 'Обладунок',
  pants: 'Штани',
  weapon: 'Зброя',
  accessory: 'Аксесуар',
};
export const SLOT_ORDER: EquipSlot[] = ['helmet', 'armor', 'pants', 'weapon', 'accessory'];

export interface InvItem { id: string; name: string; slot: EquipSlot }

// Поки що весь каталог = те, що «в нас є». Далі сюди приїдуть дропи/крамниці.
export const CATALOG: InvItem[] = [
  { id: 'helm_white', name: 'Білий шолом', slot: 'helmet' },
  { id: 'armor_white', name: 'Білий обладунок', slot: 'armor' },
  { id: 'pants_white', name: 'Білі штани', slot: 'pants' },
  { id: 'sword_plain', name: 'Простий меч', slot: 'weapon' },
  { id: 'charm_plain', name: 'Оберіг', slot: 'accessory' },
];

export type EquipState = Partial<Record<EquipSlot, string | null>>;

const KEY = 'zag_equip';
export function loadEquip(): EquipState {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') as EquipState; } catch { return {}; }
}
export function saveEquip(s: EquipState): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

// ── Процедурні білі іконки речей (канва 64×64, лінійний стиль) ────────────────
function iconCanvas(slot: EquipSlot): HTMLCanvasElement {
  const c = document.createElement('canvas'); c.width = 64; c.height = 64;
  const x = c.getContext('2d')!;
  x.strokeStyle = '#f2efe8'; x.fillStyle = 'rgba(242,239,232,0.16)';
  x.lineWidth = 3; x.lineJoin = 'round'; x.lineCap = 'round';
  const P = (pts: Array<[number, number]>, close = true): void => {
    x.beginPath(); x.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) x.lineTo(pts[i][0], pts[i][1]);
    if (close) x.closePath();
    x.fill(); x.stroke();
  };
  if (slot === 'helmet') {
    // купол з наносником
    x.beginPath(); x.arc(32, 32, 18, Math.PI, 0); x.lineTo(50, 40); x.lineTo(14, 40); x.closePath(); x.fill(); x.stroke();
    x.beginPath(); x.moveTo(32, 14); x.lineTo(32, 50); x.stroke();
  } else if (slot === 'armor') {
    // нагрудник з плечима
    P([[20, 14], [44, 14], [52, 22], [46, 30], [44, 50], [32, 56], [20, 50], [18, 30], [12, 22]]);
    x.beginPath(); x.moveTo(32, 20); x.lineTo(32, 50); x.stroke();
  } else if (slot === 'pants') {
    // штани
    P([[22, 12], [42, 12], [44, 34], [40, 54], [34, 54], [32, 36], [30, 54], [24, 54], [20, 34]]);
  } else if (slot === 'weapon') {
    // меч вістрям униз
    P([[32, 56], [27, 44], [27, 20], [32, 12], [37, 20], [37, 44]]);
    x.beginPath(); x.moveTo(20, 20); x.lineTo(44, 20); x.stroke(); // гарда
    x.beginPath(); x.arc(32, 10, 3, 0, Math.PI * 2); x.stroke();  // яблуко
  } else {
    // оберіг на шнурку
    x.beginPath(); x.moveTo(20, 12); x.quadraticCurveTo(32, 26, 44, 12); x.stroke();
    x.beginPath(); x.arc(32, 38, 12, 0, Math.PI * 2); x.fill(); x.stroke();
    x.beginPath(); x.arc(32, 38, 5, 0, Math.PI * 2); x.stroke();
  }
  return c;
}

// Текстура іконки речі в сцені (кеш по слоту — вигляд поки однаковий у межах слота).
export function itemIconTexture(scene: Phaser.Scene, item: InvItem): string {
  const key = 'inv_icon_' + item.slot;
  if (!scene.textures.exists(key)) scene.textures.addCanvas(key, iconCanvas(item.slot));
  return key;
}
