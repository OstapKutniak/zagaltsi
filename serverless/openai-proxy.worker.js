// Cloudflare Worker — проксі до OpenAI Images (gpt-image-1) для AI-генерації ассетів.
// Ключ OpenAI лишається ТУТ, на сервері (env.OPENAI_KEY), і НЕ потрапляє в публічний бандл гри.
// Студія шле POST { prompt, size, image? }; воркер додає Authorization і викликає OpenAI:
//   image відсутній → /v1/images/generations (text-to-image)
//   image заданий (dataURL) → /v1/images/edits (image-to-image, multipart)
// Повертає сиру відповідь OpenAI { data: [{ b64_json }] } (студія сама збирає dataURL).
//
// ── Що зробити у Cloudflare (той самий воркер horugva, лише новий код+секрет) ──────
// 1. dash.cloudflare.com → Workers & Pages → horugva → «Edit code» → встав УВЕСЬ цей файл → Deploy.
// 2. horugva → Settings → Variables and Secrets → «Add»:
//      type=Secret, name=OPENAI_KEY, value=<OpenAI-ключ sk-proj-...> → Save (і Deploy, якщо просить).
//    (Старий секрет FAL_KEY можна лишити або видалити — він більше не використовується.)
// 3. repo variable VITE_FAL_PROXY уже = URL цього воркера, тож міняти його НЕ треба.
// 4. Постав ЛІМІТ ВИТРАТ в OpenAI (platform.openai.com → Billing → limits) — запобіжник проти
//    зловживання відкритим URL воркера.

const ALLOWED_ORIGINS = [
  'https://ostapkutniak.github.io',
  'http://localhost:5173',
  'http://localhost:4173',
];

const MODEL = 'gpt-image-1';

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}

function dataUrlToBlob(dataUrl) {
  const comma = dataUrl.indexOf(',');
  const meta = dataUrl.slice(0, comma);
  const b64 = dataUrl.slice(comma + 1);
  const mime = (meta.match(/data:([^;]+)/) || [])[1] || 'image/png';
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin);

    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (request.method !== 'POST') {
      return new Response('POST only', { status: 405, headers: cors });
    }
    if (!env.OPENAI_KEY) {
      return new Response('OPENAI_KEY не налаштований у воркері', { status: 500, headers: cors });
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      return new Response('bad json', { status: 400, headers: cors });
    }

    const prompt = typeof payload?.prompt === 'string' ? payload.prompt : '';
    const size = typeof payload?.size === 'string' ? payload.size : '1024x1024';
    const image = typeof payload?.image === 'string' ? payload.image : null;
    if (!prompt && !image) {
      return new Response('need prompt or image', { status: 400, headers: cors });
    }

    let upstream;
    if (image) {
      // image-to-image → /v1/images/edits (multipart/form-data)
      const fd = new FormData();
      fd.append('model', MODEL);
      fd.append('prompt', prompt);
      fd.append('size', size);
      fd.append('background', 'transparent');
      fd.append('output_format', 'png');
      fd.append('n', '1');
      fd.append('image', dataUrlToBlob(image), 'ref.png');
      upstream = await fetch('https://api.openai.com/v1/images/edits', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + env.OPENAI_KEY },
        body: fd,
      });
    } else {
      // text-to-image → /v1/images/generations (JSON)
      upstream = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + env.OPENAI_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: MODEL, prompt, size, quality: 'high',
          background: 'transparent', output_format: 'png', n: 1,
        }),
      });
    }

    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  },
};
