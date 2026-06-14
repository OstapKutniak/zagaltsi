// Авто-нарізка аркуша на частини методом "колор-нокаут рівного фону"
// (як flat-bg метод аддона BlenderAIReplace):
//   1) фон = середній колір кутів;
//   2) flood-fill фону ВІД КРАЇВ (тільки зв'язаний із краєм сірий -> прозоро,
//      внутрішні пікселі не дірявимо);
//   3) ерозія краю на EROD e px -> прибирає сірий ореол (fringe);
//   4) зв'язні області -> окремі частини, edge-feather + despill.
// Запуск: node scripts/extract_parts.mjs
import sharp from 'sharp';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

const SRC = 'D:/Hobby/Claude/zagaltsi/Characters/Ostap/Rig_Parts/source/Sheet.png';
const OUT = 'D:/Hobby/Claude/zagaltsi/Characters/Ostap/Rig_Parts/_auto';

const FUZZINESS = 34; // допуск кольору фону
const ERODE = 2; // на скільки px стиснути край (вбити ореол)
const MIN_AREA = 350; // мінімальна площа області

mkdirSync(OUT, { recursive: true });

const { data, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width;
const H = info.height;
const C = info.channels;
const at = (x, y) => (y * W + x) * C;

const corners = [[0, 0], [W - 1, 0], [0, H - 1], [W - 1, H - 1]].map(([x, y]) => {
  const i = at(x, y);
  return [data[i], data[i + 1], data[i + 2]];
});
const bg = [0, 1, 2].map((k) => Math.round(corners.reduce((s, c) => s + c[k], 0) / corners.length));
const dist = (i) => Math.hypot(data[i] - bg[0], data[i + 1] - bg[1], data[i + 2] - bg[2]);

// 1) КОЛОР-КЕЙ З "ПЛОСКИМ ОСТРОВОМ" (метод аддона):
// кандидати у фон — пікселі, близькі до кольору фону; але прибираємо лише ті
// зв'язні області, де >= FLAT_FRAC пікселів ТОЧНО фон. Так зникають зовнішнє "море"
// І замкнені кишені (діра у волоссі, проміжок між ногами), а текстурована майже-сіра
// шкіра лишається (вона не "плоска") — тож усередині фігури немає дірок.
const TIGHT_TOL = 8; // "точно колір фону"
const FLAT_FRAC = 0.6; // яка частка має бути точним фоном, щоб область = фон

const isBg = new Uint8Array(W * H);
for (let p = 0; p < W * H; p++) isBg[p] = dist(p * C) <= FUZZINESS ? 1 : 0;

const lab = new Int32Array(W * H);
const areaArr = [0];
const exactArr = [0];
let cc = 0;
for (let p0 = 0; p0 < W * H; p0++) {
  if (!isBg[p0] || lab[p0]) continue;
  cc++;
  areaArr.push(0);
  exactArr.push(0);
  const st = [p0];
  lab[p0] = cc;
  while (st.length) {
    const q = st.pop();
    areaArr[cc]++;
    if (dist(q * C) <= TIGHT_TOL) exactArr[cc]++;
    const qx = q % W, qy = (q / W) | 0;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const nx = qx + dx, ny = qy + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const np = ny * W + nx;
        if (isBg[np] && !lab[np]) {
          lab[np] = cc;
          st.push(np);
        }
      }
  }
}

let fg = new Uint8Array(W * H);
for (let p = 0; p < W * H; p++) {
  const id = lab[p];
  const flatBg = id && exactArr[id] / areaArr[id] >= FLAT_FRAC;
  fg[p] = flatBg ? 0 : 1;
}

// 2) ерозія краю (вбити сірий ореол)
for (let k = 0; k < ERODE; k++) {
  const next = new Uint8Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const p = y * W + x;
      if (!fg[p]) continue;
      if ((x > 0 && !fg[p - 1]) || (x < W - 1 && !fg[p + 1]) || (y > 0 && !fg[p - W]) || (y < H - 1 && !fg[p + W])) continue;
      next[p] = 1;
    }
  fg = next;
}

// 4) зв'язні компоненти переднього плану
const label = new Int32Array(W * H);
const comps = [];
let cur = 0;
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const p = y * W + x;
    if (!fg[p] || label[p]) continue;
    cur++;
    let minx = x, miny = y, maxx = x, maxy = y, area = 0;
    const st = [p];
    label[p] = cur;
    while (st.length) {
      const q = st.pop();
      const qx = q % W, qy = (q / W) | 0;
      area++;
      if (qx < minx) minx = qx;
      if (qx > maxx) maxx = qx;
      if (qy < miny) miny = qy;
      if (qy > maxy) maxy = qy;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = qx + dx, ny = qy + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const np = ny * W + nx;
          if (fg[np] && !label[np]) {
            label[np] = cur;
            st.push(np);
          }
        }
    }
    comps.push({ id: cur, minx, miny, maxx, maxy, area });
  }
}

const kept = comps.filter((c) => c.area >= MIN_AREA).sort((a, b) => a.miny - b.miny || a.minx - b.minx);
kept.forEach((c, i) => (c.n = i + 1));

// edge-feather: альфа = покриття fg у вікні 3x3 (м'який край)
const coverAlpha = (sx, sy) => {
  let cnt = 0;
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const nx = sx + dx, ny = sy + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      if (fg[ny * W + nx]) cnt++;
    }
  return Math.round((cnt / 9) * 255);
};

for (const c of kept) {
  const w = c.maxx - c.minx + 1;
  const h = c.maxy - c.miny + 1;
  const out = Buffer.alloc(w * h * 4, 0);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const sx = c.minx + x, sy = c.miny + y;
      const sp = sy * W + sx;
      if (label[sp] !== c.id) continue;
      const si = sp * C, di = (y * w + x) * 4;
      // ерозія краю вже прибрала ореол; альфа = м'яке покриття (як flat-метод аддона)
      out[di] = data[si];
      out[di + 1] = data[si + 1];
      out[di + 2] = data[si + 2];
      out[di + 3] = coverAlpha(sx, sy);
    }
  await sharp(out, { raw: { width: w, height: h, channels: 4 } })
    .png()
    .toFile(join(OUT, `part_${String(c.n).padStart(3, '0')}.png`));
}

const rects = kept
  .map((c) => {
    const w = c.maxx - c.minx + 1, h = c.maxy - c.miny + 1;
    return (
      `<rect x="${c.minx}" y="${c.miny}" width="${w}" height="${h}" fill="none" stroke="#ff2d55" stroke-width="3"/>` +
      `<text x="${c.minx + 4}" y="${c.miny + 28}" font-size="30" fill="#ff2d55" font-family="sans-serif" font-weight="bold">${c.n}</text>`
    );
  })
  .join('');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${rects}</svg>`;
await sharp(SRC).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).png().toFile(join(OUT, '_overview.png'));

writeFileSync(join(OUT, '_index.json'), JSON.stringify(kept, null, 2));
console.log(`bg=${bg.join(',')}  components=${comps.length}  kept=${kept.length}`);
for (const c of kept)
  console.log(`#${c.n}\tbbox=(${c.minx},${c.miny})\t${c.maxx - c.minx + 1}x${c.maxy - c.miny + 1}\tarea=${c.area}`);
