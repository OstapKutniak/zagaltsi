import Phaser from 'phaser';
import { MENU_FONT } from './menuTheme';
import { loadCharLibrary, type LibItem } from '../charlib';
import type { KhMember } from '../khorugva';

// Квадрат-портрет учасника хоругви: рамка + мініатюра персонажа з бібліотеки
// (LibItem.thumb, dataURL) або перша літера імені; порожній слот — тьмяна рамка.

let _libP: Promise<LibItem[]> | null = null;
function lib(): Promise<LibItem[]> { _libP ??= loadCharLibrary().catch(() => []); return _libP; }

function addBase64Texture(scene: Phaser.Scene, key: string, dataURL: string): Promise<boolean> {
  return new Promise((res) => {
    if (scene.textures.exists(key)) { res(true); return; }
    const onAdd = (k: string): void => { if (k === key) { scene.textures.off('addtexture', onAdd); res(true); } };
    scene.textures.on('addtexture', onAdd);
    try { scene.textures.addBase64(key, dataURL); } catch { scene.textures.off('addtexture', onAdd); res(false); }
    setTimeout(() => { scene.textures.off('addtexture', onAdd); res(scene.textures.exists(key)); }, 2500);
  });
}

// Малює слот size×size у (x,y) (верхній лівий кут). member=null → порожній.
export function drawKhSlot(scene: Phaser.Scene, x: number, y: number, size: number, member: KhMember | null): void {
  const g = scene.add.graphics().setScrollFactor(0).setDepth(50);
  g.fillStyle(0x120d14, member ? 0.85 : 0.5);
  g.fillRect(x, y, size, size);
  g.lineStyle(2, member ? 0x8a7a5c : 0x3a3240, 1);
  g.strokeRect(x, y, size, size);
  if (!member) return;

  const letter = (): void => {
    if (!scene.scene.isActive()) return;
    scene.add.text(x + size / 2, y + size / 2, (member.name || '?').slice(0, 1).toUpperCase(), {
      fontFamily: MENU_FONT, fontSize: Math.round(size * 0.5) + 'px', color: '#d8c9a3',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(51);
  };

  void lib().then(async (items) => {
    if (!scene.scene.isActive()) return;
    const it = items.find((i) => i.id === member.charId && i.thumb)
      ?? items.find((i) => i.cat === 'char' && i.thumb);
    if (!it?.thumb) { letter(); return; }
    const key = 'khthumb_' + it.id;
    const ok = await addBase64Texture(scene, key, it.thumb);
    if (!ok || !scene.scene.isActive()) { letter(); return; }
    const im = scene.add.image(x + size / 2, y + size / 2, key).setScrollFactor(0).setDepth(51);
    const sc = Math.min((size - 6) / im.width, (size - 6) / im.height);
    im.setScale(sc);
  });
}
