// Генерація ігрових ассетів. Пайплайн:
//   промпт (+ опц. реф як підказка) → dall-e-3 (hd) → remove.bg (виріз фону) → прозорий PNG.
// /images/edits НЕ використовується — "приклеюється" до реалізму вхідного фото.
// Реф → gpt-4o-mini описує сюжет словами → опис іде в text-to-image.
//
// Деплой: воркер-проксі (VITE_FAL_PROXY) робить обидва кроки (dall-e-3 + remove.bg), ключі на сервері.
// Локально: VITE_OPENAI_KEY — тільки генерація (білий фон), remove.bg через браузер не ходить (CORS).

const OPENAI_KEY = import.meta.env.VITE_OPENAI_KEY as string | undefined;
const AI_PROXY   = import.meta.env.VITE_FAL_PROXY  as string | undefined;

const STYLE_BASE =
  'video game 2D sprite, Ukrainian folk dark fantasy setting, ' +
  'Darkest Dungeon 1 original art style: aggressive crosshatching and hatching, thick uneven black ink outlines, ' +
  'near-monochrome desaturated palette — charcoal black, ash grey, aged parchment yellow — muted rust-red accents only, ' +
  'NO bright colors, NO saturated greens, NO vivid blues or teals, colors almost completely washed-out and aged, ' +
  'dark oppressive grim atmosphere, high contrast with deep shadow regions and pale highlights, ' +
  'isolated on plain flat solid neutral gray background, no parchment texture behind subject, no cast shadow on ground, no text, no watermark';

const STYLE_CHAR = STYLE_BASE + ', full body character, front-facing or slight 3/4 view, even ambient lighting';
const STYLE_PROP = STYLE_BASE + ', environment prop or decoration, lit from upper-left, darker right and bottom edges of the object';

const SIZE = '1024x1024';

function openaiOutToDataUrl(out: unknown): string {
  const o = out as { data?: Array<{ b64_json?: string; url?: string }> };
  const b64 = o?.data?.[0]?.b64_json;
  if (b64) return 'data:image/png;base64,' + b64;
  const url = o?.data?.[0]?.url;
  if (url) return url;
  throw new Error('OpenAI не повернув зображення');
}

// Описати сюжет реф-зображення через gpt-4o-mini vision (локально, лише якщо є OPENAI_KEY).
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

async function generateImage(prompt: string): Promise<string> {
  // Деплой: воркер робить dall-e-3 + remove.bg, повертає b64 прозорого PNG.
  if (AI_PROXY) {
    const res = await fetch(AI_PROXY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, size: SIZE }),
    });
    if (!res.ok) throw new Error(`Проксі: ${res.status} ${(await res.text()).slice(0, 200)}`);
    return openaiOutToDataUrl(await res.json());
  }

  // Локально: gpt-image-1 напряму, фон не вирізається (CORS блокує remove.bg з браузера).
  if (!OPENAI_KEY) throw new Error('Немає VITE_FAL_PROXY (деплой) або VITE_OPENAI_KEY (локально)');
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + OPENAI_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-image-1', prompt, size: SIZE, quality: 'high', n: 1 }),
  });
  if (!res.ok) throw new Error(`OpenAI: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return openaiOutToDataUrl(await res.json());
}

export interface GenOptions {
  prompt: string;
  refDataUrl?: string | null;
  context?: 'char' | 'prop';
  removeBg?: boolean; // лишено для сумісності; ігнорується
}

export async function generateGameAsset(opts: GenOptions): Promise<string> {
  const userPrompt = (opts.prompt || '').trim();
  if (!userPrompt && !opts.refDataUrl) throw new Error('Потрібен промпт або реф-зображення');
  const stylePreprompt = opts.context === 'char' ? STYLE_CHAR : STYLE_PROP;

  let subject = userPrompt;
  if (opts.refDataUrl && !userPrompt) {
    subject = await describeImageSubject(opts.refDataUrl) || 'folk horror environment prop';
  }

  const fullPrompt = subject ? `${subject}, ${stylePreprompt}` : stylePreprompt;
  return generateImage(fullPrompt);
}

export const hasFalKey = (): boolean => !!(AI_PROXY || OPENAI_KEY);
