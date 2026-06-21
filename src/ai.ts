// Генерація ігрових ассетів через OpenAI Images (gpt-image-1). Пайплайн:
//   промпт (+ опц. реф-зображення як підказка) → gpt-image-1 generations → прозорий PNG.
// Важливо: /images/edits НЕ використовується — він "приклеюється" до реалізму вхідного фото.
// Реф-зображення → gpt-4o-mini описує сюжет → опис іде в text-to-image generations.
//
// Ключ: на деплої — у воркері-проксі (секрет OPENAI_KEY), у бандл НЕ потрапляє.
//       локально — VITE_OPENAI_KEY з .env (ок для особистого інструмента).

const OPENAI_KEY = import.meta.env.VITE_OPENAI_KEY as string | undefined;
// URL воркера-проксі (Cloudflare). Заданий → усі виклики йдуть через нього (деплой).
const AI_PROXY = import.meta.env.VITE_FAL_PROXY as string | undefined;

// Спільна основа стилю — Darkest Dungeon 1 ink-wash з обмеженою палітрою.
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

// Відповідь OpenAI Images → dataURL (png). Формат: { data: [{ b64_json }] }.
function openaiOutToDataUrl(out: unknown): string {
  const o = out as { data?: Array<{ b64_json?: string; url?: string }> };
  const b64 = o?.data?.[0]?.b64_json;
  if (b64) return 'data:image/png;base64,' + b64;
  const url = o?.data?.[0]?.url;
  if (url) return url;
  throw new Error('OpenAI не повернув зображення');
}

// Описати сюжет реф-зображення через gpt-4o-mini vision (локально, лише якщо є OPENAI_KEY).
// Повертає короткий опис об'єкта (~10-15 слів) або порожній рядок при помилці.
async function describeImageSubject(dataUrl: string): Promise<string> {
  if (!OPENAI_KEY) return '';
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + OPENAI_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: [
          { type: 'text', text: 'Describe only the main object or subject in this image in 10-15 words. Focus on what it IS and its general form/shape. No style, no colors, no background — just the subject itself.' },
          { type: 'image_url', image_url: { url: dataUrl, detail: 'low' } },
        ]}],
        max_tokens: 60,
      }),
    });
    if (!res.ok) return '';
    const d = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    return (d.choices?.[0]?.message?.content ?? '').trim();
  } catch { return ''; }
}

// Виклик text-to-image (завжди /generations — /edits якорить до реалізму вхідного фото).
async function openaiImage(prompt: string): Promise<string> {
  if (AI_PROXY) {
    const res = await fetch(AI_PROXY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, size: SIZE }),
    });
    if (!res.ok) throw new Error(`Проксі gpt-image: ${res.status} ${(await res.text()).slice(0, 200)}`);
    return openaiOutToDataUrl(await res.json());
  }

  if (!OPENAI_KEY) throw new Error('Немає VITE_FAL_PROXY (деплой) або VITE_OPENAI_KEY (локально)');

  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + OPENAI_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, prompt, size: SIZE, background: 'transparent', output_format: 'png', n: 1 }),
  });
  if (!res.ok) throw new Error(`OpenAI generations: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return openaiOutToDataUrl(await res.json());
}

export interface GenOptions {
  prompt: string;
  refDataUrl?: string | null; // опційний реф — використовується для автоопису сюжету, не як вхід для edits
  context?: 'char' | 'prop';  // char = рівне освітлення; prop = світло зверху-зліва
  removeBg?: boolean;         // лишено для сумісності; ігнорується
}

// Згенерувати ассет. Повертає прозорий PNG як dataURL.
export async function generateGameAsset(opts: GenOptions): Promise<string> {
  const userPrompt = (opts.prompt || '').trim();
  if (!userPrompt && !opts.refDataUrl) throw new Error('Потрібен промпт або реф-зображення');
  const stylePreprompt = opts.context === 'char' ? STYLE_CHAR : STYLE_PROP;

  let subject = userPrompt;

  if (opts.refDataUrl && !userPrompt) {
    // Юзер кинув реф без тексту — описуємо сюжет автоматично через vision.
    subject = await describeImageSubject(opts.refDataUrl) || 'folk horror environment prop';
  }

  const fullPrompt = subject ? `${subject}, ${stylePreprompt}` : stylePreprompt;
  return openaiImage(fullPrompt); // завжди text-to-image, реф у /edits не йде
}

// Чи є чим генерувати (проксі на деплої або ключ локально). Назву лишено для сумісності з editor.ts.
export const hasFalKey = (): boolean => !!(AI_PROXY || OPENAI_KEY);
