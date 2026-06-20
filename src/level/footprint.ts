// Футпринт ассета: набір ізо-клітинок (у власній системі координат ассета,
// scale-незалежний), що визначає непрохідну зону + плановість («персонаж за деревом»).
//
// Авторинг: клітинки малюються поверх ассета при scale=1, де 1 px зображення = 1 світова
// одиниця, а 1 клітинка = `grid` одиниць. Якорем (центром) є ЦЕНТР зображення — туди ж
// мапиться світова точка розміщення (editor: p.x,p.y; game: p.x, floorY+p.y).
//
// Масштаб «випадає» сам: ми НЕ зберігаємо кількість клітинок. При виставленні з масштабом s
// кожну світову клітинку-кандидата зворотно трансформуємо в локальний простір ассета
// (÷ s, скасування flip/rot) і дивимось, чи попала вона в намальовану маску. Більший ассет →
// у маску попадає щільніша сітка світових клітинок → накриває більше клітинок.

export interface Footprint { cells: { dx: number; dy: number }[] }

export interface FootInstance { x: number; y: number; scale: number; flip: number; rot: number }

// Ізо-геометрія (та сама, що в editor.ts / GameScene.ts):
//   світова точка клітинки-кута:  X = ix*gs + iy*k,  Y = iy*k,  де k = gs/√2
//   зворотно:  cx = floor((X - Y)/gs),  cy = floor(Y/k)
//   центр клітинки (cx,cy):  X = (cx+0.5)*gs + (cy+0.5)*k,  Y = (cy+0.5)*k
const cellOf = (X: number, Y: number, gs: number): { cx: number; cy: number } => {
  const k = gs * Math.SQRT1_2;
  return { cx: Math.floor((X - Y) / gs), cy: Math.floor(Y / k) };
};
const cellCenter = (cx: number, cy: number, gs: number): { x: number; y: number } => {
  const k = gs * Math.SQRT1_2;
  return { x: (cx + 0.5) * gs + (cy + 0.5) * k, y: (cy + 0.5) * k };
};

// Світові ізо-клітинки, що їх займає футпринт інстансу. ox,oy — світова точка центру ассета
// (editor: p.x,p.y; game: p.x, floorY+p.y). Повертає рядки "cx,cy".
export function footprintWorldCells(fp: Footprint, inst: FootInstance, ox: number, oy: number, gs: number): string[] {
  if (!fp.cells.length) return [];
  const s = inst.scale || 1, f = inst.flip || 1, rad = ((inst.rot || 0) * Math.PI) / 180;
  const cosr = Math.cos(rad), sinr = Math.sin(rad);
  const local = new Set(fp.cells.map((c) => c.dx + ',' + c.dy));

  // Пряма трансформація локальної точки (відносно центру) у світ: rot → scale(s*f, s) → +центр.
  const toWorld = (lx: number, ly: number): { x: number; y: number } => {
    const rx = lx * cosr - ly * sinr, ry = lx * sinr + ly * cosr; // rot
    return { x: ox + rx * s * f, y: oy + ry * s };
  };
  // Зворотна: світова точка → локальна (для перевірки попадання в маску).
  const toLocal = (X: number, Y: number): { x: number; y: number } => {
    const dx = (X - ox) / (s * f), dy = (Y - oy) / s; // un-scale/flip
    return { x: dx * cosr + dy * sinr, y: -dx * sinr + dy * cosr }; // un-rot (R^-1 = R^T)
  };

  // Світовий AABB футпринта (за 4 кутами кожної локальної клітинки) → діапазон клітинок-кандидатів.
  let minCx = Infinity, maxCx = -Infinity, minCy = Infinity, maxCy = -Infinity;
  const k = gs * Math.SQRT1_2;
  const cornerLocal = (ix: number, iy: number): { x: number; y: number } => ({ x: ix * gs + iy * k, y: iy * k });
  for (const c of fp.cells) {
    for (const [ix, iy] of [[c.dx, c.dy], [c.dx + 1, c.dy], [c.dx + 1, c.dy + 1], [c.dx, c.dy + 1]] as const) {
      const lp = cornerLocal(ix, iy);
      const w = toWorld(lp.x, lp.y);
      const wc = cellOf(w.x, w.y, gs);
      if (wc.cx < minCx) minCx = wc.cx; if (wc.cx > maxCx) maxCx = wc.cx;
      if (wc.cy < minCy) minCy = wc.cy; if (wc.cy > maxCy) maxCy = wc.cy;
    }
  }
  // Семплюємо центр кожної світової клітинки-кандидата → локальна клітинка → у масці?
  const out: string[] = [];
  for (let cy = minCy - 1; cy <= maxCy + 1; cy++) {
    for (let cx = minCx - 1; cx <= maxCx + 1; cx++) {
      const cc = cellCenter(cx, cy, gs);
      const lp = toLocal(cc.x, cc.y);
      const lc = cellOf(lp.x, lp.y, gs);
      if (local.has(lc.cx + ',' + lc.cy)) out.push(cx + ',' + cy);
    }
  }
  return out;
}

// Глибина для плановості: найбільший (передній/ближчий) світовий Y серед клітинок футпринта.
// Персонаж із floorY більшим за це — попереду ассета; меншим — позаду. Світовий Y клітинки =
// нижня грань (cy+1)*k у локальних editor-координатах; для гри додають floorY ззовні.
export function footprintFrontEditorY(cells: string[], gs: number): number {
  const k = gs * Math.SQRT1_2;
  let maxY = -Infinity;
  for (const c of cells) { const cy = Number(c.split(',')[1]); const y = (cy + 1) * k; if (y > maxY) maxY = y; }
  return maxY === -Infinity ? 0 : maxY;
}
