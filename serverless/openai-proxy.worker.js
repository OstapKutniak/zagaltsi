// Cloudflare Worker — проксі генерації ігрових ассетів.
// Пайплайн: {prompt, size} → dall-e-3 hd (OpenAI) → remove.bg (виріз фону) → прозорий PNG base64.
// Ключі OPENAI_KEY і REMOVEBG_KEY лишаються на сервері — у бандл гри НЕ потрапляють.
//
// ── Що оновити у Cloudflare після цього деплою ──────────────────────────────
// 1. dash.cloudflare.com → Workers & Pages → horugva → Edit code → встав цей файл → Deploy.
// 2. Settings → Variables and Secrets:
//    • OPENAI_KEY  — вже є (залиш)
//    • REMOVEBG_KEY — додати: Secret, name=REMOVEBG_KEY, value=<ключ з remove.bg/dashboard#api-key>
// 3. Постав ліміт витрат в OpenAI (platform.openai.com → Billing) і в remove.bg (dashboard).
//    URL воркера відкритий — ліміти = єдиний запобіжник.

const ALLOWED_ORIGINS = [
  'https://ostapkutniak.github.io',
  'http://localhost:5173',
  'http://localhost:4173',
];

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}

// ArrayBuffer → base64 (chunks щоб не ламати стек на великих PNG).
function bufToB64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function jsonResp(cors, status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin);

    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (request.method !== 'POST') return new Response('POST only', { status: 405, headers: cors });
    if (!env.OPENAI_KEY) return new Response('OPENAI_KEY не налаштований', { status: 500, headers: cors });

    let payload;
    try { payload = await request.json(); }
    catch { return new Response('bad json', { status: 400, headers: cors }); }

    const prompt = typeof payload?.prompt === 'string' ? payload.prompt.trim() : '';
    const size   = typeof payload?.size   === 'string' ? payload.size   : '1024x1024';
    if (!prompt) return new Response('need prompt', { status: 400, headers: cors });

    // ── 1. Генерація: dall-e-3 hd ──────────────────────────────────────────
    const genRes = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + env.OPENAI_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'dall-e-3', prompt, size, quality: 'hd', response_format: 'url', n: 1 }),
    });

    if (!genRes.ok) {
      const err = await genRes.text();
      return jsonResp(cors, genRes.status, { error: err.slice(0, 300) });
    }

    const genData = await genRes.json();
    const imageUrl = genData?.data?.[0]?.url;
    if (!imageUrl) return jsonResp(cors, 502, { error: 'OpenAI не повернув URL' });

    // ── 2. Виріз фону: remove.bg ────────────────────────────────────────────
    if (env.REMOVEBG_KEY) {
      const rmbgRes = await fetch('https://api.remove.bg/v1.0/removebg', {
        method: 'POST',
        headers: { 'X-Api-Key': env.REMOVEBG_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_url: imageUrl, size: 'regular' }),
      });

      if (rmbgRes.ok) {
        const pngBuf = await rmbgRes.arrayBuffer();
        return jsonResp(cors, 200, { data: [{ b64_json: bufToB64(pngBuf) }] });
      }
      // remove.bg впав — fallback: повертаємо оригінал (білий фон)
    }

    // ── Fallback: завантажити оригінал і повернути як b64 ──────────────────
    const imgRes = await fetch(imageUrl);
    const imgBuf = await imgRes.arrayBuffer();
    return jsonResp(cors, 200, { data: [{ b64_json: bufToB64(imgBuf) }] });
  },
};
