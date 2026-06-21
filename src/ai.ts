// Генерація ігрових ассетів через OpenAI Images (gpt-image-1). Пайплайн:
//   промпт (+опц. реф-зображення) → gpt-image-1 → прозорий PNG (фон вирізає сама модель).
// gpt-image-1 уміє background:transparent, тож окремий крок вирізу фону більше не потрібен.
//
// Ключ: на деплої — у воркері-проксі (секрет OPENAI_KEY), у бандл НЕ потрапляє.
//       локально — VITE_OPENAI_KEY з .env (ок для особистого інструмента).

const OPENAI_KEY = import.meta.env.VITE_OPENAI_KEY as string | undefined;
// URL воркера-проксі (Cloudflare). Той самий, що був для fal (repo variable VITE_FAL_PROXY),
// просто всередині воркер тепер кличе OpenAI. Заданий → усі виклики йдуть через нього (деплой).
const AI_PROXY = import.meta.env.VITE_FAL_PROXY as string | undefined;

// Спільна основа стилю — Darkest Dungeon 1 ink-wash з обмеженою палітрою.
// Акцент на "майже монохромний" щоб модель не додавала яскравих кольорів.
const STYLE_BASE =
  'video game 2D sprite, Ukrainian folk dark fantasy setting, ' +
  'Darkest Dungeon 1 original art style: aggressive crosshatching and hatching, thick uneven black ink outlines, ' +
  'near-monochrome desaturated palette — charcoal black, ash grey, aged parchment yellow — muted rust-red accents only, ' +
  'NO bright colors, NO saturated greens, NO vivid blues or teals, colors almost completely washed-out and aged, ' +
  'dark oppressive grim atmosphere, high contrast with deep shadow regions and pale highlights, ' +
  'isolated on transparent background, no cast shadow on ground, no text, no watermark';

// Персонажі — рівне освітлення (спрайт може перевертатись).
const STYLE_CHAR =
  STYLE_BASE + ', ' +
  'full body character, front-facing or slight 3/4 view, even ambient lighting';

// Декорації/пропси рівня — фіксоване освітлення зверху-зліва для узгодженості сцени.
const STYLE_PROP =
  STYLE_BASE + ', ' +
  'environment prop or decoration, lit from upper-left, darker right and bottom edges of the object';

const MODEL = 'gpt-image-1';
const SIZE = '1024x1024';

// dataURL → Blob (для multipart-режиму edits у локальному прямому виклику).
function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(',');
  const meta = dataUrl.slice(0, comma);
  const b64 = dataUrl.slice(comma + 1);
  const mime = (meta.match(/data:([^;]+)/) || [])[1] || 'image/png';
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

// Відповідь OpenAI Images → dataURL (png). Формат: { data: [{ b64_json }] }.
function openaiOutToDataUrl(out: unknown): string {
  const o = out as { data?: Array<{ b64_json?: string; url?: string }> };
  const b64 = o?.data?.[0]?.b64_json;
  if (b64) return 'data:image/png;base64,' + b64;
  const url = o?.data?.[0]?.url;
  if (url) return url; // на випадок, якщо колись повертатимуть URL
  throw new Error('OpenAI не повернув зображення');
}

// Один виклик генерації. prompt — повний промпт; refDataUrl — опційний реф (тоді режим edits).
// Повертає dataURL прозорого PNG.
async function openaiImage(prompt: string, refDataUrl?: string | null): Promise<string> {
  // Режим проксі (деплой): шлемо { prompt, size, image? } на воркер, ключ — на сервері.
  if (AI_PROXY) {
    const res = await fetch(AI_PROXY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, size: SIZE, image: refDataUrl || undefined }),
    });
    if (!res.ok) throw new Error(`Проксі gpt-image: ${res.status} ${(await res.text()).slice(0, 200)}`);
    return openaiOutToDataUrl(await res.json());
  }

  // Прямий виклик із ключем (локальна розробка з .env). На деплої НЕ використовувати — ключ публічний.
  if (!OPENAI_KEY) throw new Error('Немає VITE_FAL_PROXY (деплой) або VITE_OPENAI_KEY (локально)');

  if (refDataUrl) {
    // image-to-image → /v1/images/edits (multipart/form-data).
    const fd = new FormData();
    fd.append('model', MODEL);
    fd.append('prompt', prompt);
    fd.append('size', SIZE);
    fd.append('background', 'transparent');
    fd.append('output_format', 'png');
    fd.append('n', '1');
    fd.append('image', dataUrlToBlob(refDataUrl), 'ref.png');
    const res = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + OPENAI_KEY },
      body: fd,
    });
    if (!res.ok) throw new Error(`OpenAI edits: ${res.status} ${(await res.text()).slice(0, 200)}`);
    return openaiOutToDataUrl(await res.json());
  }

  // text-to-image → /v1/images/generations (JSON).
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + OPENAI_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, prompt, size: SIZE, background: 'transparent', output_format: 'png', n: 1 }),
  });
  if (!res.ok) throw new Error(`OpenAI generations: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return openaiOutToDataUrl(await res.json());
}

export interface GenOptions {
  prompt: string;
  refDataUrl?: string | null; // опційний реф (data URL)
  context?: 'char' | 'prop';  // char = рівне освітлення; prop = світло зверху-зліва
  removeBg?: boolean;         // лишено для сумісності; gpt-image-1 і так дає прозорий фон (ігнорується)
}

// Згенерувати ассет. Повертає прозорий PNG як dataURL.
export async function generateGameAsset(opts: GenOptions): Promise<string> {
  const userPrompt = (opts.prompt || '').trim();
  if (!userPrompt && !opts.refDataUrl) throw new Error('Потрібен промпт або реф-зображення');
  const stylePreprompt = opts.context === 'char' ? STYLE_CHAR : STYLE_PROP;
  const fullPrompt = userPrompt ? `${userPrompt}, ${stylePreprompt}` : stylePreprompt;
  return openaiImage(fullPrompt, opts.refDataUrl);
}

// Чи є чим генерувати (проксі на деплої або ключ локально). Назву лишено для сумісності з editor.ts.
export const hasFalKey = (): boolean => !!(AI_PROXY || OPENAI_KEY);
