// Telegram-бот «Хоругви» — Cloudflare Worker.
// Ролі:
//  1) /webhook  ← Telegram: на /start (і будь-яке повідомлення) шле клавіатуру-розділи
//     (Житло/Мандри/Хоругва/Завдання/Досягнення/Інвентар — deep-link у Mini App)
//     і запам'ятовує username → chat_id у Firebase (щоб уміти сповіщати на нік).
//  2) POST /notify ← гра: {nick, khorugvaId, from} → шле гравцю сповіщення про збір
//     хоругви з кнопкою «Приєднатись» (deep-link kh_<id>).
//
// ДЕПЛОЙ (вручну, як openai-proxy): dash.cloudflare.com → Workers & Pages → Create →
// вставити цей код → Deploy. Далі Settings → Variables and Secrets:
//   BOT_TOKEN     (Secret)  — токен бота з BotFather
//   BOT_USERNAME  (Var)     — нік бота без @ (напр. horugva_bot)
//   APP_SHORT     (Var)     — short name Mini App із BotFather (/newapp), напр. game
//   FIREBASE_URL  (Var)     — https://horugva-ff8bd-default-rtdb.europe-west1.firebasedatabase.app
// І прив'язати вебхук (раз, із термінала/браузера):
//   https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<worker>.workers.dev/webhook
// У гру (repo variable, як VITE_FAL_PROXY): VITE_BOT_PROXY = https://<worker>.workers.dev

const SECTIONS = [
  ['Житло', 'zhytlo'], ['Мандри', 'mandry'], ['Хоругва', 'khorugva'],
  ['Завдання', 'zavdannya'], ['Досягнення', 'dosyagnennya'], ['Інвентар', 'inventar'],
];

function appLink(env, param) {
  return `https://t.me/${env.BOT_USERNAME}/${env.APP_SHORT}?startapp=${param}`;
}

async function tg(env, method, body) {
  const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return r.json();
}

async function fbPut(env, path, value) {
  await fetch(`${env.FIREBASE_URL}/${path}.json`, { method: 'PUT', body: JSON.stringify(value) });
}
async function fbGet(env, path) {
  const r = await fetch(`${env.FIREBASE_URL}/${path}.json`);
  return r.ok ? r.json() : null;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    // ── Telegram webhook ─────────────────────────────────────────────────────
    if (url.pathname === '/webhook' && request.method === 'POST') {
      const update = await request.json().catch(() => null);
      const msg = update?.message;
      if (msg?.chat?.id) {
        // Запам'ятати нік → chat_id (для сповіщень збору на нік)
        const uname = (msg.from?.username || '').toLowerCase();
        if (uname) await fbPut(env, `tg_users/${uname}`, { chatId: msg.chat.id, at: Date.now() });
        // Клавіатура-розділи
        const rows = [];
        for (let i = 0; i < SECTIONS.length; i += 2) {
          rows.push(SECTIONS.slice(i, i + 2).map(([label, param]) => ({ text: label, url: appLink(env, param) })));
        }
        await tg(env, 'sendMessage', {
          chat_id: msg.chat.id,
          text: 'Хоругва кличе. Обирай, куди рушити:',
          reply_markup: { inline_keyboard: rows },
        });
      }
      return new Response('ok');
    }

    // ── Сповіщення про збір хоругви ──────────────────────────────────────────
    if (url.pathname === '/notify' && request.method === 'POST') {
      const { nick, khorugvaId, from } = await request.json().catch(() => ({}));
      if (!nick || !khorugvaId) return new Response(JSON.stringify({ ok: false, err: 'bad request' }), { status: 400, headers: CORS });
      const rec = await fbGet(env, `tg_users/${String(nick).toLowerCase()}`);
      if (!rec?.chatId) return new Response(JSON.stringify({ ok: false, err: 'user unknown to bot' }), { status: 404, headers: CORS });
      await tg(env, 'sendMessage', {
        chat_id: rec.chatId,
        text: `${from || 'Побратим'} розгортає хоругву — загін збирається у мандри крізь неспокійні землі. ` +
          `Мандрівка буде темна, дорога непевна, але гуртом і чорт не страшний. Стань під хоругву!`,
        reply_markup: { inline_keyboard: [[{ text: 'Приєднатись', url: appLink(env, 'kh_' + khorugvaId) }]] },
      });
      return new Response(JSON.stringify({ ok: true }), { headers: CORS });
    }

    return new Response('Хоругва bot worker', { status: 200 });
  },
};
