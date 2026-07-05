// shopping-push — «поштар» пуш-сповіщень для додатка «Покупки».
// Приймає POST {event:'added'|'bought', names:[...], from:'<deviceId>', space?},
// читає підписки з Firebase ({space}/push) і шле Web Push (RFC 8291/8292)
// на всі пристрої, КРІМ відправника. Мертві підписки прибирає з бази.
// space — простір (родина): 'shopping' (дефолт) або 'shopping-parents'.

const te = new TextEncoder();

const b64uToBytes = s => {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(b, c => c.charCodeAt(0));
};
const bytesToB64u = a => btoa(String.fromCharCode(...new Uint8Array(a)))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const concat = (...arrs) => {
  const out = new Uint8Array(arrs.reduce((n, a) => n + a.length, 0));
  let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
};

// ── VAPID (RFC 8292): JWT ES256 ────────────────────────────
async function vapidAuthHeader(audience, env) {
  // секрет міг приїхати з BOM/лапками/переносами (PowerShell при `wrangler secret put`
  // додає невидимий BOM) — вирізаємо чистий JSON від першої { до останньої }
  const raw = String(env.VAPID_PRIVATE_JWK);
  const jwk = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const header = bytesToB64u(te.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = bytesToB64u(te.encode(JSON.stringify({
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: env.VAPID_SUBJECT,
  })));
  const signingInput = `${header}.${claims}`;
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, te.encode(signingInput));
  return `vapid t=${signingInput}.${bytesToB64u(sig)}, k=${env.VAPID_PUBLIC}`;
}

// ── Шифрування payload (RFC 8291, aes128gcm) ───────────────
async function hkdf(salt, ikm, info, len) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info }, key, len * 8));
}

export async function encryptPayload(payloadStr, p256dhB64u, authB64u) {
  const uaPub = b64uToBytes(p256dhB64u);         // 65 байт, точка P-256
  const authSecret = b64uToBytes(authB64u);      // 16 байт
  // ефемерна пара відправника
  const asKeys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', asKeys.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, asKeys.privateKey, 256));
  // IKM = HKDF(auth, ecdh, "WebPush: info" || 0x00 || ua_pub || as_pub, 32)
  const ikm = await hkdf(authSecret, ecdh, concat(te.encode('WebPush: info\0'), uaPub, asPub), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, te.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, te.encode('Content-Encoding: nonce\0'), 12);
  // один запис: payload + розділювач 0x02 (останній запис)
  const record = concat(te.encode(payloadStr), new Uint8Array([2]));
  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, record));
  // заголовок aes128gcm: salt(16) | rs(4) | idlen(1) | keyid(as_pub 65)
  const rs = new Uint8Array([0, 0, 16, 0]); // 4096
  return concat(salt, rs, new Uint8Array([asPub.length]), asPub, ct);
}

export async function sendPush(sub, payloadStr, env) {
  const audience = new URL(sub.endpoint).origin;
  const [auth, body] = await Promise.all([
    vapidAuthHeader(audience, env),
    encryptPayload(payloadStr, sub.keys.p256dh, sub.keys.auth),
  ]);
  return fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      'TTL': '86400',
      'Urgency': 'normal',
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      'Authorization': auth,
    },
    body,
  });
}

// ── HTTP ───────────────────────────────────────────────────
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...CORS } });

function buildMessage(event, names) {
  const list = names.slice(0, 6).join(', ') + (names.length > 6 ? ` і ще ${names.length - 6}` : '');
  if (event === 'bought') return { title: 'Покупки', body: `Куплено: ${list}` };
  return { title: 'Покупки', body: `Додано до списку: ${list}` };
}

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (req.method !== 'POST') return json({ ok: true, service: 'shopping-push' });

    let data;
    try { data = JSON.parse(await req.text()); } catch { return json({ error: 'bad json' }, 400); }
    const { event, names, from } = data || {};
    if (!Array.isArray(names) || !names.length || !['added', 'bought', 'test'].includes(event))
      return json({ error: 'bad payload' }, 400);
    const space = ['shopping', 'shopping-parents'].includes(data.space) ? data.space : 'shopping';

    const subsRes = await fetch(`${env.DB_URL}/${space}/push.json`);
    const subs = (await subsRes.json()) || {};
    const msg = event === 'test'
      ? { title: 'Покупки', body: names.join(', ') }
      : buildMessage(event, names);
    const payload = JSON.stringify({ ...msg, url: `/zagaltsi/${space}/` });

    let sent = 0, dead = 0, errors = [];
    await Promise.all(Object.entries(subs).map(async ([deviceId, rec]) => {
      if (deviceId === from) return; // не шлемо самому собі
      let sub;
      try { sub = JSON.parse(rec.sub); } catch { return; }
      try {
        const res = await sendPush(sub, payload, env);
        if (res.status === 404 || res.status === 410) {
          dead++;
          await fetch(`${env.DB_URL}/${space}/push/${deviceId}.json`, { method: 'DELETE' });
        } else if (res.ok || res.status === 201) sent++;
        else errors.push(`${deviceId}: ${res.status} ${(await res.text()).slice(0, 120)}`);
      } catch (e) { errors.push(`${deviceId}: ${e.message}`); }
    }));
    return json({ sent, dead, errors });
  },
};
