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

// Дефолтний пошук мереж сортує за популярністю, тож нерелевантне лізе вгору
// («яйця» → молоко). Тому серед результатів беремо ті, у назві яких є корінь
// шуканого слова, і з них — найдешевший у наявності («мінімальний кошик» для
// чесного порівняння магазинів). Точний товар обирається окремо через
// уточнення (variant) на боці додатка.
function pick(items, q, getTitle, getPrice, inStock) {
  const w = q.toLowerCase().trim().split(/\s+/)[0].slice(0, 5); // корінь першого слова
  const avail = items.filter(inStock);
  const byName = avail.filter(i => getTitle(i).toLowerCase().includes(w));
  const pool = byName.length ? byName : avail;
  pool.sort((a, b) => getPrice(a) - getPrice(b));
  return pool[0] || null;
}

// Сільпо: ціна вже в гривнях, залишок у полі stock
async function silpoPrice(branch, q) {
  const u = `https://sf-ecom-api.silpo.ua/v1/uk/branches/${branch}/products`
    + `?limit=30&offset=0&deliveryType=DeliveryHome&inStock=true&search=${encodeURIComponent(q)}`;
  const r = await fetch(u, { headers: { 'User-Agent': UA, Accept: 'application/json', 'Accept-Language': 'uk' } });
  if (!r.ok) return null;
  const d = await r.json();
  const it = pick(d.items || [], q, i => i.title || '', i => num(i.price) ?? Infinity, i => (i.stock ?? 0) > 0);
  if (!it) return null;
  const price = num(it.price);
  const old = num(it.oldPrice);
  return price == null ? null : { title: it.title, price, oldPrice: old && old > price ? old : null };
}

// zakaz (Новус та ін.): пошук уже релевантний (сортує сам сервер), а назви
// приходять англійською — тому фільтр за назвою тут не працює і не потрібен:
// беремо перший результат. Ціни в копійках.
async function zakazPrice(branch, q) {
  const u = `https://stores-api.zakaz.ua/stores/${branch}/products/search/?q=${encodeURIComponent(q)}`;
  const r = await fetch(u, { headers: { 'User-Agent': UA, Accept: 'application/json', 'Accept-Language': 'uk' } });
  if (!r.ok) return null;
  const d = await r.json();
  const it = (d.results || [])[0];
  if (!it) return null;
  const price = num(it.price);
  if (price == null) return null;
  const disc = it.discount && it.discount.status ? num(it.discount.old_price) : null;
  return { title: it.title, price: price / 100, oldPrice: disc && disc > price ? disc / 100 : null };
}

const num = v => (v == null || v === '' || isNaN(+v)) ? null : +v;
