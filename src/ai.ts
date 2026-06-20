// Генерація ігрових ассетів через Fal (REST, без SDK). Пайплайн:
//   промпт (+опц. реф-зображення) → FLUX → авто-виріз фону (BiRefNet) → прозорий PNG.
// Ключ: VITE_FAL_KEY з .env (потрапляє в клієнтський бандл — ок для особистого інструмента).
//
// Передпромпт стилю — чернетка під козацький стиль; перепишемо коли визначимось остаточно.

const FAL_KEY = import.meta.env.VITE_FAL_KEY as string | undefined;

const STYLE_PREPROMPT =
  'Ukrainian Cossack folk-art video game asset, hand-painted 2D illustration, ' +
  'thick dark ink outlines, muted earthy desaturated color palette, moody grim ' +
  'Darkest Dungeon and Don\'t Starve aesthetic, side view, single object centered, ' +
  'isolated on a flat plain light-grey background, even lighting, no cast shadow, no text, no watermark';

const TXT2IMG = 'fal-ai/flux/dev';
const IMG2IMG = 'fal-ai/flux/dev/image-to-image';
const REMBG = 'fal-ai/birefnet'; // авто-виріз фону

interface FalImage { url: string }

async function falRun(model: string, body: Record<string, unknown>): Promise<unknown> {
  if (!FAL_KEY) throw new Error('Немає VITE_FAL_KEY у .env');
  const res = await fetch('https://fal.run/' + model, {
    method: 'POST',
    headers: { 'Authorization': 'Key ' + FAL_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Fal ${model}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

function firstImageUrl(out: unknown): string | null {
  const o = out as { images?: FalImage[]; image?: FalImage };
  return o?.images?.[0]?.url ?? o?.image?.url ?? null;
}

// Завантажити URL результату → dataURL (Fal CDN віддає з CORS, тож canvas не «брудниться»).
async function urlToDataUrl(url: string): Promise<string> {
  const blob = await (await fetch(url)).blob();
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = () => reject(new Error('Не вдалося прочитати результат'));
    fr.readAsDataURL(blob);
  });
}

export interface GenOptions {
  prompt: string;
  refDataUrl?: string | null; // опційний реф (data URL або http URL)
  removeBg?: boolean;         // авто-виріз фону (за замовч. так)
}

// Згенерувати ассет. Повертає прозорий PNG як dataURL.
export async function generateGameAsset(opts: GenOptions): Promise<string> {
  const userPrompt = (opts.prompt || '').trim();
  if (!userPrompt && !opts.refDataUrl) throw new Error('Потрібен промпт або реф-зображення');
  const fullPrompt = userPrompt ? `${userPrompt}, ${STYLE_PREPROMPT}` : STYLE_PREPROMPT;

  let out: unknown;
  if (opts.refDataUrl) {
    out = await falRun(IMG2IMG, {
      prompt: fullPrompt,
      image_url: opts.refDataUrl,
      strength: 0.85, // 1 = ігнорувати реф, менше = ближче до рефа
      num_images: 1,
      image_size: 'square_hd',
    });
  } else {
    out = await falRun(TXT2IMG, {
      prompt: fullPrompt,
      num_images: 1,
      image_size: 'square_hd',
    });
  }
  let imgUrl = firstImageUrl(out);
  if (!imgUrl) throw new Error('Fal не повернув зображення');

  if (opts.removeBg !== false) {
    const cut = await falRun(REMBG, { image_url: imgUrl });
    imgUrl = firstImageUrl(cut) ?? imgUrl;
  }
  return urlToDataUrl(imgUrl);
}

export const hasFalKey = (): boolean => !!FAL_KEY;
