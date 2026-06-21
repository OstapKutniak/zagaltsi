// Cloudflare Worker — проксі до Fal для AI-генерації ассетів.
// Ключ Fal лишається ТУТ, на сервері (env.FAL_KEY), і НЕ потрапляє в публічний бандл гри.
// Студія шле POST { model, body }, воркер додає Authorization і пересилає на fal.run.
//
// ── Як підняти (через вебінтерфейс Cloudflare, без CLI) ──────────────────────
// 1. Зареєструйся/увійди на https://dash.cloudflare.com → зліва «Workers & Pages» → «Create» →
//    «Create Worker» → дай ім'я (напр. zagaltsi-fal) → «Deploy».
// 2. «Edit code» → видали шаблон, встав УВЕСЬ цей файл → «Deploy».
// 3. Назад на сторінку воркера → «Settings» → «Variables and Secrets» → «Add»:
//      type=Secret, name=FAL_KEY, value=<твій Fal-ключ із .env> → Save (і ще раз Deploy, якщо просить).
// 4. Скопіюй URL воркера (типу https://zagaltsi-fal.<твій>.workers.dev).
// 5. Постав ЛІМІТ ВИТРАТ у Fal (на випадок зловживання URL).
// 6. У GitHub репо: Settings → Secrets and variables → Actions → вкладка «Variables» → «New variable»:
//      name=VITE_FAL_PROXY, value=<URL воркера>. (Це VARIABLE, не secret — URL публічний, це ок.)
// 7. Будь-який push у main перезбере студію з цим URL → генерація працює на github.io
//    з усіх пристроїв (два компи + телефон). Локально (.env з VITE_FAL_KEY) теж працює як було.
//
// Безпека: URL відкритий, тож обмежуємо дозволені моделі й Origin. Це не куленепробивно
// (Origin підробний поза браузером), тому ЛІМІТ ВИТРАТ у Fal — обов'язковий запобіжник.

const ALLOWED_MODELS = new Set([
  'fal-ai/flux/dev',
  'fal-ai/flux/dev/image-to-image',
  'fal-ai/birefnet',
]);

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

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin);

    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (request.method !== 'POST') {
      return new Response('POST only', { status: 405, headers: cors });
    }
    if (!env.FAL_KEY) {
      return new Response('FAL_KEY не налаштований у воркері', { status: 500, headers: cors });
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      return new Response('bad json', { status: 400, headers: cors });
    }

    const { model, body } = payload || {};
    if (typeof model !== 'string' || !ALLOWED_MODELS.has(model)) {
      return new Response('model not allowed', { status: 403, headers: cors });
    }

    const upstream = await fetch('https://fal.run/' + model, {
      method: 'POST',
      headers: {
        'Authorization': 'Key ' + env.FAL_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body || {}),
    });

    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  },
};
