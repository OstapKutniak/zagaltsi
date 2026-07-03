// Telegram-бот «Хоругви» — Cloudflare Worker.
// Ролі:
//  1) /webhook ← Telegram:
//     - /start → вступ: КАРТИНКА (хатина) + тематичний текст + клавіатура-розділи;
//     - будь-яке інше повідомлення → клавіатура-розділи;
//     - завжди запам'ятовує username → chat_id у Firebase (для сповіщень на нік).
//  2) POST /notify ← гра: {nick, khorugvaId, from} → сповіщення про збір хоругви
//     з кнопкою «Приєднатись» (deep-link kh_<id>).
//
// ТЕКСТИ/КНОПКИ/КАРТИНКА — НЕ тут, а в репо: public/bot-config.json (деплоїться на
// Pages). Редагування бота = звичайний git push, воркер перевставляти НЕ треба.
// Перевставляти код воркера потрібно лише при зміні ЛОГІКИ.
//
// ДЕПЛОЙ (вручну): dash.cloudflare.com → Workers → horugva-bot → Edit code → Deploy.
// Variables: BOT_TOKEN (Secret), BOT_USERNAME, APP_SHORT, FIREBASE_URL,
//            CONFIG_URL (необов'язково; дефолт — bot-config.json з Pages).
// Вебхук:   https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<worker>/webhook

const DEFAULT_CONFIG_URL = 'https://ostapkutniak.github.io/zagaltsi/bot-config.json';
const FALLBACK = {
  intro: { photo: '', text: 'Хоругва кличе. Обирай, куди рушити:' },
  menuText: 'Хоругва кличе. Обирай, куди рушити:',
  sections: [
    ['Житло', 'zhytlo'], ['Мандри', 'mandry'], ['Хоругва', 'khorugva'],
    ['Завдання', 'zavdannya'], ['Досягнення', 'dosyagnennya'], ['Інвентар', 'inventar'],
  ],
  gatherText: '{from} розгортає хоругву — загін збирається у мандри. Стань під хоругву!',
  // Випадковий енкаунтер (cron щогодини: шанс на гравця) і нагадування про квести.
  encounter: { text: 'У вашій локації хтось є…', button: 'Перевірити', chance: 0.15 },
  remind: { text: 'Дошка нагадує: «{title}» досі чекає.', button: 'До завдань', hours: 5 },
};

async function loadConfig(env) {
  try {
    const r = await fetch((env.CONFIG_URL || DEFAULT_CONFIG_URL) + '?t=' + Date.now());
    if (r.ok) { const c = await r.json(); return { ...FALLBACK, ...c }; }
  } catch { /* Pages недоступний → вбудований запас */ }
  return FALLBACK;
}

function appLink(env, param) {
  return `https://t.me/${env.BOT_USERNAME}/${env.APP_SHORT}?startapp=${param}`;
}

// ПОСТІЙНА reply-клавіатура (під рядком вводу, не їде з повідомленнями).
// Кнопки web_app відкривають Mini App напряму; розділ передаємо через
// ?startapp=<param> у URL (гра читає його фолбеком у getStartParam).
function sectionsKeyboard(env, cfg) {
  const base = (env.GAME_URL || 'https://ostapkutniak.github.io/zagaltsi/').replace(/\/$/, '/');
  const rows = [];
  for (let i = 0; i < cfg.sections.length; i += 3) {
    rows.push(cfg.sections.slice(i, i + 3).map(([label, param]) => ({
      text: label, web_app: { url: `${base}?startapp=${param}` },
    })));
  }
  return { keyboard: rows, resize_keyboard: true, is_persistent: true };
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

// Надіслати одному гравцю енкаунтер «у вашій локації хтось є».
async function sendEncounter(env, cfg, chatId) {
  await tg(env, 'sendMessage', {
    chat_id: chatId,
    text: cfg.encounter.text,
    reply_markup: { inline_keyboard: [[{ text: cfg.encounter.button, url: appLink(env, 'enc') }]] },
  });
}

export default {
  // ── CRON (щогодини, wrangler.toml [triggers]) ────────────────────────────────
  // 1) Енкаунтери: кожному відомому гравцю з шансом cfg.encounter.chance.
  // 2) Нагадування: по player_quests/{playerId}/{questId}, якщо минуло remind.hours.
  //    У приваті chat_id == tg user id == playerId гри — тож шлемо напряму.
  async scheduled(_event, env, ctx) {
    ctx.waitUntil((async () => {
      const cfg = await loadConfig(env);
      const users = (await fbGet(env, 'tg_users')) || {};
      for (const rec of Object.values(users)) {
        if (rec?.chatId && Math.random() < (cfg.encounter?.chance ?? 0)) {
          try { await sendEncounter(env, cfg, rec.chatId); } catch { /* далі */ }
        }
      }
      const all = (await fbGet(env, 'player_quests')) || {};
      const now = Date.now();
      const gapMs = (cfg.remind?.hours ?? 5) * 3600 * 1000;
      for (const [playerId, quests] of Object.entries(all)) {
        if (!/^\d+$/.test(playerId)) continue; // лише телеграм-гравці (числовий id = chat_id)
        for (const [qid, q] of Object.entries(quests || {})) {
          if (!q || now - (q.lastRemind ?? q.takenAt ?? 0) < gapMs) continue;
          try {
            await tg(env, 'sendMessage', {
              chat_id: playerId,
              text: String(cfg.remind.text).replace('{title}', q.title || 'завдання'),
              reply_markup: { inline_keyboard: [[{ text: cfg.remind.button, url: appLink(env, 'zavdannya') }]] },
            });
            await fbPut(env, `player_quests/${playerId}/${qid}/lastRemind`, now);
          } catch { /* далі */ }
        }
      }
    })());
  },

  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    // ── Тест: миттєвий енкаунтер собі (GET /test-encounter?nick=<нік>) ─────────
    if (url.pathname === '/test-encounter') {
      const nick = (url.searchParams.get('nick') || '').replace(/^@/, '').toLowerCase();
      const rec = await fbGet(env, `tg_users/${nick}`);
      if (!rec?.chatId) return new Response(JSON.stringify({ ok: false, err: 'user unknown to bot' }), { status: 404, headers: CORS });
      const cfg = await loadConfig(env);
      await sendEncounter(env, cfg, rec.chatId);
      return new Response(JSON.stringify({ ok: true }), { headers: CORS });
    }

    // ── Telegram webhook ─────────────────────────────────────────────────────
    if (url.pathname === '/webhook' && request.method === 'POST') {
      const update = await request.json().catch(() => null);
      const msg = update?.message;
      if (msg?.chat?.id) {
        const cfg = await loadConfig(env);
        // Запам'ятати нік → chat_id (для сповіщень збору на нік)
        const uname = (msg.from?.username || '').toLowerCase();
        if (uname) await fbPut(env, `tg_users/${uname}`, { chatId: msg.chat.id, at: Date.now() });

        const kb = sectionsKeyboard(env, cfg);
        const isStart = typeof msg.text === 'string' && msg.text.startsWith('/start');
        if (isStart && cfg.intro?.photo) {
          // Вступ: картинка + текст + меню однією карткою
          await tg(env, 'sendPhoto', {
            chat_id: msg.chat.id,
            photo: cfg.intro.photo,
            caption: cfg.intro.text,
            reply_markup: kb,
          });
        } else {
          await tg(env, 'sendMessage', { chat_id: msg.chat.id, text: cfg.menuText, reply_markup: kb });
        }
      }
      return new Response('ok');
    }

    // ── Сповіщення про збір хоругви ──────────────────────────────────────────
    if (url.pathname === '/notify' && request.method === 'POST') {
      const { nick, khorugvaId, from } = await request.json().catch(() => ({}));
      if (!nick || !khorugvaId) return new Response(JSON.stringify({ ok: false, err: 'bad request' }), { status: 400, headers: CORS });
      const rec = await fbGet(env, `tg_users/${String(nick).toLowerCase()}`);
      if (!rec?.chatId) return new Response(JSON.stringify({ ok: false, err: 'user unknown to bot' }), { status: 404, headers: CORS });
      const cfg = await loadConfig(env);
      await tg(env, 'sendMessage', {
        chat_id: rec.chatId,
        text: String(cfg.gatherText).replace('{from}', from || 'Побратим'),
        reply_markup: { inline_keyboard: [[{ text: 'Приєднатись', url: appLink(env, 'kh_' + khorugvaId) }]] },
      });
      return new Response(JSON.stringify({ ok: true }), { headers: CORS });
    }

    return new Response('Хоругва bot worker', { status: 200 });
  },
};
