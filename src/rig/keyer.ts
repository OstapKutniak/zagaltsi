// Вирізання рівного фону в браузері — той самий метод, що в scripts/extract_parts.mjs:
// колор-кей із "тестом плоского острова" (прибираємо зв'язні області кольору фону,
// де >= FLAT_FRAC пікселів — точний фон; зникають і зовнішнє "море", і замкнені кишені,
// а текстурована майже-сіра шкіра лишається) + ерозія краю проти ореолу + м'яке покриття.

const FUZZINESS = 34;
const TIGHT_TOL = 8;
const FLAT_FRAC = 0.6;
const ERODE = 2;

// Завантажити dataURL/URL у <img>.
export function loadImageEl(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => rej(new Error('image load failed'));
    im.src = src;
  });
}

// Універсальна вирізка фону для будь-якого PNG (усі редактори). Якщо doKey=false
// або фон не суцільний — повертає вхідний рядок без змін. Інакше — PNG dataURL з альфою.
export async function keyDataUrl(src: string, doKey = true): Promise<string> {
  if (!doKey) return src;
  try {
    const img = await loadImageEl(src);
    if (!hasSolidBackground(img)) return src;
    return keyImage(img).toDataURL('image/png');
  } catch {
    return src;
  }
}

export function imageToCanvas(img: HTMLImageElement): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  c.getContext('2d')!.drawImage(img, 0, 0);
  return c;
}

// Чи схоже, що в картинки суцільний (непрозорий, однотонний) фон, який варто чистити.
export function hasSolidBackground(img: HTMLImageElement): boolean {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const d = imageToCanvas(img).getContext('2d')!.getImageData(0, 0, w, h).data;
  const corner = (x: number, y: number): number[] => {
    const i = (y * w + x) * 4;
    return [d[i], d[i + 1], d[i + 2], d[i + 3]];
  };
  const cs = [corner(0, 0), corner(w - 1, 0), corner(0, h - 1), corner(w - 1, h - 1)];
  if (cs.some((c) => c[3] < 200)) return false; // вже є прозорість — не чіпаємо
  const dst = (a: number[], b: number[]): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  return dst(cs[0], cs[1]) < 25 && dst(cs[0], cs[2]) < 25 && dst(cs[0], cs[3]) < 25;
}

export function keyImage(img: HTMLImageElement): HTMLCanvasElement {
  const W = img.naturalWidth;
  const H = img.naturalHeight;
  const canvas = imageToCanvas(img);
  const ctx = canvas.getContext('2d')!;
  const id = ctx.getImageData(0, 0, W, H);
  const data = id.data;
  const at = (x: number, y: number): number => (y * W + x) * 4;

  const corners = [[0, 0], [W - 1, 0], [0, H - 1], [W - 1, H - 1]].map(([x, y]) => {
    const i = at(x, y);
    return [data[i], data[i + 1], data[i + 2]];
  });
  const bg = [0, 1, 2].map((k) => Math.round(corners.reduce((s, c) => s + c[k], 0) / corners.length));
  const dist = (i: number): number => Math.hypot(data[i] - bg[0], data[i + 1] - bg[1], data[i + 2] - bg[2]);

  const isBg = new Uint8Array(W * H);
  for (let p = 0; p < W * H; p++) isBg[p] = dist(p * 4) <= FUZZINESS ? 1 : 0;

  const lab = new Int32Array(W * H);
  const area = [0];
  const exact = [0];
  let cc = 0;
  for (let p0 = 0; p0 < W * H; p0++) {
    if (!isBg[p0] || lab[p0]) continue;
    cc++;
    area.push(0);
    exact.push(0);
    const st = [p0];
    lab[p0] = cc;
    while (st.length) {
      const q = st.pop() as number;
      area[cc]++;
      if (dist(q * 4) <= TIGHT_TOL) exact[cc]++;
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
    const lid = lab[p];
    const flat = lid && exact[lid] / area[lid] >= FLAT_FRAC;
    fg[p] = flat ? 0 : 1;
  }
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

  const cover = (x: number, y: number): number => {
    let c = 0;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        if (fg[ny * W + nx]) c++;
      }
    return Math.round((c / 9) * 255);
  };
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const p = y * W + x;
      data[p * 4 + 3] = fg[p] ? cover(x, y) : 0;
    }
  ctx.putImageData(id, 0, 0);
  return canvas;
}
