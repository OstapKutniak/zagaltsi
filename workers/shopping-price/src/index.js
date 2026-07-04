// shopping-price — проксі цін для додатка «Покупки» (SList).
//
// PWA не може ходити в каталоги мереж напряму (CORS + антибот), тому цей
// Worker виступає посередником: приймає назви товарів, питає каталог обраної
// мережі для конкретного магазину, повертає нормалізований результат із CORS.
//
// Механіка «приблизної ціни» без мапінгу SKU: питаємо магазин НАЗВОЮ товару
// («молоко») і беремо перший результат у наявності — це і є типова ціна.
// Нема жодного результату → позиція в цьому магазині відсутня (null).
//
// Ендпоінти:
//   GET  /stores?chain=silpo|novus|auchan|metro|megamarket
//        → [{ id, name, city, address }]
//   POST /prices   body: { chain, branch, queries:["молоко","хліб",...] }
//        → { results: { "молоко": { title, price, oldPrice } | null, ... } }
//   GET  /         → health
//
// Мережі:
//   silpo  — власний sf-ecom-api.silpo.ua (ціна + залишок по магазину + акція)
//   решта  — платформа zakaz.ua (Новус/Ашан/METRO/Мегамаркет; ціна в копійках)

const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15';
const CACHE_TTL = 6 * 3600;        // ціни змінюються повільно — тримаємо 6 год
const MAX_QUERIES = 60;            // стеля позицій за один запит
const CONCURRENCY = 6;             // не гатимо чужий сервер більш ніж 6 в паралель

// zakaz-мережі: усі ходять одним і тим самим API, різниться лише retail_chain
const ZAKAZ_CHAINS = new Set(['novus', 'auchan', 'metro', 'megamarket', 'varus', 'ultramarket', 'ekomarket']);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...CORS } });

export default {
  async fetch(req, env, ctx) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const url = new URL(req.url);
    try {
      if (url.pathname === '/stores') return await handleStores(url);
      if (url.pathname === '/prices') return await handlePrices(req, ctx);
      return json({ ok: true, service: 'shopping-price', chains: ['silpo', ...ZAKAZ_CHAINS] });
    } catch (e) {
      return json({ error: String(e && e.message || e) }, 500);
    }
  },
};

// ── СПИСОК МАГАЗИНІВ (для вибору «свого» магазину один раз) ──────────────
async function handleStores(url) {
  const chain = (url.searchParams.get('chain') || '').toLowerCase();
  if (chain === 'silpo') {
    const r = await fetch('https://sf-ecom-api.silpo.ua/v1/uk/branches?deliveryType=DeliveryHome',
      { headers: { 'User-Agent': UA, Accept: 'application/json', 'Accept-Language': 'uk' } });
    const d = await r.json();
    return json((d.items || []).map(b => ({
      id: b.branchId, name: b.cityFull ? `Сільпо, ${b.cityFull}` : 'Сільпо',
      city: b.cityFull, address: b.addressFull,
    })));
  }
  if (ZAKAZ_CHAINS.has(chain)) {
    const r = await fetch('https://stores-api.zakaz.ua/stores/',
      { headers: { 'User-Agent': UA, Accept: 'application/json', 'Accept-Language': 'uk' } });
    const d = await r.json();
    return json((Array.isArray(d) ? d : []).filter(s => s.retail_chain === chain && s.is_active).map(s => ({
      id: s.id, name: s.name, city: (s.address && s.address.city) || s.city,
      address: s.address ? `${s.address.street || ''} ${s.address.building || ''}`.trim() : '',
    })));
  }
  return json({ error: 'unknown chain' }, 400);
}

// ── ЦІНИ ПО СПИСКУ ТОВАРІВ ДЛЯ ОДНОГО МАГАЗИНУ ──────────────────────────
async function handlePrices(req, ctx) {
  const body = await req.json().catch(() => ({}));
  const chain = String(body.chain || '').toLowerCase();
  const branch = String(body.branch || '');
  const queries = Array.isArray(body.queries) ? body.queries.slice(0, MAX_QUERIES) : [];
  if (!branch || !queries.length) return json({ error: 'need branch and queries' }, 400);

  const lookup = chain === 'silpo' ? silpoPrice
    : ZAKAZ_CHAINS.has(chain) ? zakazPrice
    : null;
  if (!lookup) return json({ error: 'unknown chain' }, 400);

  const results = {};
  // прості черги по CONCURRENCY, щоб не відкривати 60 з'єднань одразу
  for (let i = 0; i < queries.length; i += CONCURRENCY) {
    const chunk = queries.slice(i, i + CONCURRENCY);
    await Promise.all(chunk.map(async q => {
      results[q] = await cachedLookup(chain, branch, q, lookup, ctx);
    }));
  }
  return json({ chain, branch, results });
}

// кеш на рівні (chain,branch,query): ціни живуть 6 год, чужий сервер не страждає
async function cachedLookup(chain, branch, q, lookup, ctx) {
  const key = new Request(`https://cache.local/p?c=${chain}&b=${branch}&q=${encodeURIComponent(q.toLowerCase())}`);
  const cache = caches.default;
  const hit = await cache.match(key);
  if (hit) return await hit.json();
  const val = await lookup(branch, q).catch(() => null);
  const resp = new Response(JSON.stringify(val), { headers: { 'Cache-Control': `max-age=${CACHE_TTL}` } });
  if (ctx && ctx.waitUntil) ctx.waitUntil(cache.put(key, resp.clone()));
  return val;
}

// Дефолтний пошук мереж дає крайнощі: Сільпо (сорт за популярністю) + вибір
// найдешевшого чіпляв дрібні міні-упаковки (молоко за 21 ₴), а zakaz першим
// віддає преміум/крафт (хліб за 119 ₴). Тому беремо МЕДІАНУ цін серед
// релевантних товарів у наявності — типову ціну, стійку до обох викидів.
// Точний товар обирається окремо через уточнення (variant) на боці додатка.
function median(nums) {
  const s = nums.filter(n => n != null).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
// cands: [{title, price(грн), oldPrice}] — релевантні й у наявності
function represent(cands) {
  const inb = cands.filter(c => c.price != null);
  const med = median(inb.map(c => c.price));
  if (med == null) return null;
  let rep = inb[0], best = Infinity;                       // представник — найближчий до медіани (для назви)
  for (const c of inb) { const d = Math.abs(c.price - med); if (d < best) { best = d; rep = c; } }
  const price = Math.round(med * 100) / 100;
  return { title: rep.title, price, oldPrice: rep.oldPrice && rep.oldPrice > price ? rep.oldPrice : null };
}

// Сільпо: ціна в гривнях, залишок у stock. Фільтруємо за назвою (пошук сортує
// за популярністю → лізе нерелевантне), беремо медіану наявних.
async function silpoPrice(branch, q) {
  const u = `https://sf-ecom-api.silpo.ua/v1/uk/branches/${branch}/products`
    + `?limit=30&offset=0&deliveryType=DeliveryHome&inStock=true&search=${encodeURIComponent(q)}`;
  const r = await fetch(u, { headers: { 'User-Agent': UA, Accept: 'application/json', 'Accept-Language': 'uk' } });
  if (!r.ok) return null;
  const d = await r.json();
  const w = q.toLowerCase().trim().split(/\s+/)[0].slice(0, 5); // корінь першого слова
  const cands = (d.items || [])
    .filter(i => (i.stock ?? 0) > 0 && (i.title || '').toLowerCase().includes(w))
    .map(i => ({ title: i.title, price: num(i.price), oldPrice: num(i.oldPrice) }));
  return represent(cands);
}

// zakaz (Новус та ін.): пошук уже релевантний (сортує сервер), назви англійські
// → фільтр за назвою не працює. Беремо медіану перших ~15 результатів (най-
// релевантніших). Ціни в копійках.
async function zakazPrice(branch, q) {
  const u = `https://stores-api.zakaz.ua/stores/${branch}/products/search/?q=${encodeURIComponent(q)}`;
  const r = await fetch(u, { headers: { 'User-Agent': UA, Accept: 'application/json', 'Accept-Language': 'uk' } });
  if (!r.ok) return null;
  const d = await r.json();
  const cands = (d.results || []).slice(0, 15).map(i => {
    const p = num(i.price);
    const disc = i.discount && i.discount.status ? num(i.discount.old_price) : null;
    return { title: i.title, price: p == null ? null : p / 100, oldPrice: disc == null ? null : disc / 100 };
  });
  return represent(cands);
}

const num = v => (v == null || v === '' || isNaN(+v)) ? null : +v;
