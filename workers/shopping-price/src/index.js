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
      if (url.pathname === '/suggest') return await handleSuggest(url);
      if (url.pathname === '/prices') return await handlePrices(req, ctx);
      if (url.pathname === '/probe') return await handleProbe(url);
      return json({ ok: true, service: 'shopping-price', chains: ['silpo', 'fora', ...ZAKAZ_CHAINS, ...Object.keys(CITY_CHAINS)] });
    } catch (e) {
      return json({ error: String(e && e.message || e) }, 500);
    }
  },
};

// ── ТИМЧАСОВЕ (розвідка API мереж): /probe?url=… ─────────────────────────
// Деякі сайти (EVA, add.ua, tabletki.ua) блокують IP раннерів GitHub —
// фетчимо їх з IP Cloudflare. Хости лише з allowlist. Прибрати після розвідки.
const PROBE_HOSTS = new Set([
  'eva.ua', 'www.eva.ua', 'api.eva.ua',
  'add.ua', 'www.add.ua',
  'tabletki.ua', 'www.tabletki.ua', 'api.tabletki.ua',
  'www.watsons.ua',
]);
async function handleProbe(url) {
  const target = url.searchParams.get('url') || '';
  let tu;
  try { tu = new URL(target); } catch { return json({ error: 'bad url' }, 400); }
  if (!PROBE_HOSTS.has(tu.hostname)) return json({ error: 'host not allowed' }, 403);
  const postBody = url.searchParams.get('body');
  const r = await fetch(tu.href, {
    method: postBody != null ? 'POST' : 'GET',
    headers: {
      'User-Agent': UA, 'Accept-Language': 'uk',
      Accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
      ...(postBody != null ? { 'Content-Type': 'application/json' } : {}),
    },
    body: postBody != null ? postBody : undefined,
  });
  const text = await r.text();
  // find=маркер → замість початку сторінки віддати контексти навколо збігів
  const find = url.searchParams.get('find');
  if (find) {
    const span = Math.min(+(url.searchParams.get('span') || 600), 1500);
    const ctxs = [];
    let i = -1;
    while (ctxs.length < 5 && (i = text.indexOf(find, i + 1)) >= 0)
      ctxs.push(text.slice(Math.max(0, i - span / 3), i + span).replace(/\s+/g, ' '));
    return json({ status: r.status, ct: r.headers.get('content-type') || '', matches: ctxs.length, ctxs });
  }
  return json({ status: r.status, ct: r.headers.get('content-type') || '', body: text.slice(0, 5000) });
}

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
  if (chain === 'fora') {
    // список філій Фори через API не дається (геокод-флоу); ціни онлайн єдині
    // по місту, тож віддаємо відому робочу київську філію
    return json([{ id: '148', name: 'Фора, Київ', city: 'Київ', address: '' }]);
  }
  return json({ error: 'unknown chain' }, 400);
}

// ── ПІДКАЗКИ ВАРІАНТІВ (реальні назви товарів для шторки «Яке саме») ─────
// Джерело — Сільпо (назви українською, багатий каталог).
async function handleSuggest(url) {
  const branch = url.searchParams.get('branch') || '';
  const q = url.searchParams.get('q') || '';
  if (!branch || !q) return json([]);
  const u = `https://sf-ecom-api.silpo.ua/v1/uk/branches/${branch}/products`
    + `?limit=20&offset=0&deliveryType=DeliveryHome&inStock=true&search=${encodeURIComponent(q)}`;
  const r = await fetch(u, { headers: { 'User-Agent': UA, Accept: 'application/json', 'Accept-Language': 'uk' } });
  if (!r.ok) return json([]);
  const d = await r.json();
  const w = q.toLowerCase().trim().split(/\s+/)[0].slice(0, 5);
  const names = (d.items || []).filter(i => (i.title || '').toLowerCase().includes(w)).map(i => i.title);
  return json([...new Set(names)].slice(0, 10));
}

// ── ЦІНИ ПО СПИСКУ ТОВАРІВ ДЛЯ ОДНОГО МАГАЗИНУ ──────────────────────────
// Мережі без вибору філії (ціни онлайн єдині по місту) — branch не потрібен
const CITY_CHAINS = {
  aurora: avroraPrice,     // завгосп «Аврора»: CS-Cart, ajax-пошук (ключ як у додатку)
  avrora: avroraPrice,     // аліас про всяк випадок
  epicentr: epicentrPrice, // завгосп: SSR пошукової видачі
  dobrogo: adduaPrice,     // аптека «Доброго дня»: Magento SSR (add.ua)
  bonus: bonusPrice,       // завгосп «Бонус»: Prom-магазин bonus-market.in.ua
  podorozhnyk: podorozhnykPrice, // аптека «Подорожник»: JSON autocomplete-API
  anc: ancPrice,           // аптека «АНЦ»: JSON POST-пошук (city=5 Київ)
  eva: evaPrice,           // гігієна EVA: Multisearch (search.eva.ua, id 10779)
  prostor: prostorPrice,   // гігієна «Простор»: Multisearch (id 12667)
  // watsons — Akamai блокує серверні/CF IP (403 Access Denied), як АТБ; функція
  // watsonsPrice лишена для довідки, але з воркера недосяжна.
};
async function handlePrices(req, ctx) {
  const body = await req.json().catch(() => ({}));
  const chain = String(body.chain || '').toLowerCase();
  const queries = Array.isArray(body.queries) ? body.queries.slice(0, MAX_QUERIES) : [];
  const branch = String(body.branch || (CITY_CHAINS[chain] ? 'city' : ''));
  if (!branch || !queries.length) return json({ error: 'need branch and queries' }, 400);

  const lookup = chain === 'silpo' ? silpoPrice
    : chain === 'fora' ? foraPrice
    : ZAKAZ_CHAINS.has(chain) ? zakazPrice
    : CITY_CHAINS[chain] || null;
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

// Фора (Fozzy, як Сільпо): POST-RPC EcomCatalogGlobal, назви українською,
// ціна в грн, залишок у storeQuantity, oldPrice для акцій. Фільтр за назвою +
// медіана. merchantId 4 / businessId 3 / deliveryType 2 (доставка) — з бандла.
async function foraPrice(branch, q) {
  const r = await fetch('https://api.catalog.ecom.fora.ua/api/2.0/exec/EcomCatalogGlobal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA, Origin: 'https://fora.ua', Referer: 'https://fora.ua/' },
    body: JSON.stringify({ method: 'GetSimpleCatalogItems', data: { merchantId: 4, deliveryType: 2, filialId: +branch, customFilter: q, From: 1, To: 30 } }),
  });
  if (!r.ok) return null;
  const d = await r.json();
  const w = q.toLowerCase().trim().split(/\s+/)[0].slice(0, 5);
  const cands = (d.items || [])
    .filter(i => (i.storeQuantity ?? 1) > 0 && (i.name || '').toLowerCase().includes(w))
    .map(i => ({ title: i.name, price: num(i.price), oldPrice: num(i.oldPrice) }));
  return represent(cands);
}

const num = v => (v == null || v === '' || isNaN(+v)) ? null : +v;

// ── БОНУС (bonus-market.in.ua, платформа Prom): SSR site_search ───────────
// Картка data-qaid="product_block": назва в data-qaid="product_name",
// ціна в data-qaid="price-field" (<span>119</span> ₴), стара — line-through.
async function bonusPrice(branch, q) {
  const r = await fetch(`https://bonus-market.in.ua/site_search?search_term=${encodeURIComponent(q)}`,
    { headers: { 'User-Agent': UA, 'Accept-Language': 'uk', Accept: 'text/html' } });
  if (!r.ok) return null;
  const html = await r.text();
  const cands = [];
  for (const seg of html.split('data-qaid="product_block"').slice(1, 40)) {
    const name = (seg.match(/data-qaid="product_name"[^>]*>([^<]{3,180})</) || [])[1];
    const priceTxt = ((seg.match(/data-qaid="price-field"[^>]*>\s*(?:<span[^>]*>)?([\d\s]+(?:[.,]\d+)?)/) || [])[1] || '').replace(/\s+/g, '').replace(',', '.');
    const price = num(priceTxt);
    const old = num(((seg.match(/line-through[^>]*>([\d\s]+(?:[.,]\d+)?)\s*₴/) || [])[1] || '').replace(/\s+/g, '').replace(',', '.'));
    if (name && price != null) cands.push({ title: unent(name), price, oldPrice: old });
  }
  return represent(pickRelevant(cands, q));
}
// Каскад релевантності: спершу точний перший корінь, далі 5 і 4 літери —
// строгіший збіг у пріоритеті, але українські закінчення («губки»→«Губка»,
// «лампочка»→«Лампа») не валять пошук у нуль.
function pickRelevant(cands, q) {
  const w = q.toLowerCase().trim().split(/\s+/)[0];
  for (const root of [...new Set([w, w.slice(0, 5), w.slice(0, 4)])]) {
    if (root.length < 3) break;
    const hit = cands.filter(c => (c.title || '').toLowerCase().includes(root));
    if (hit.length) return hit;
  }
  return [];
}
const unent = s => s.replace(/&amp;/g, '&').replace(/&#0?39;|&#x27;|&quot;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();

// ── АНЦ (аптека): JSON POST-пошук (з HAR) ─────────────────────────────────
// anc.ua/productbrowser/v3/ua/search/query, body {city:5(Київ),query,…} →
// products.items[]{name, price, promotion{discount}}. Українські назви.
async function ancPrice(branch, q) {
  const r = await fetch('https://anc.ua/productbrowser/v3/ua/search/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA, Origin: 'https://anc.ua', Referer: 'https://anc.ua/' },
    body: JSON.stringify({ city: 5, query: q, includeCategory: false, pharmacyPrice: true, source: 'webApp' }),
  });
  if (!r.ok) return null;
  const d = await r.json();
  const cands = ((d.products && d.products.items) || [])
    .map(i => ({ title: i.name, price: num(i.price), oldPrice: null }));
  return represent(pickRelevant(cands, q));
}

// ── MULTISEARCH (платформа EVA і Простору, з HAR) ─────────────────────────
// GET {host}/?id={id}&query=&lang=uk&autocomplete=true&group=true →
// results.items[] = групи {category, items[]}; товар {name, price, oldprice, is_presence}.
async function multisearchPrice(host, id, q) {
  const u = `https://${host}/?id=${id}&query=${encodeURIComponent(q)}&lang=uk&autocomplete=true&group=true&uid=00000000-0000-4000-8000-000000000000`;
  const r = await fetch(u, { headers: { 'User-Agent': UA, Accept: 'application/json', 'Accept-Language': 'uk' } });
  if (!r.ok) return null;
  const d = await r.json();
  const groups = (d.results && d.results.items) || [];
  const cands = groups.flatMap(g => g.items || [])
    .filter(i => i.is_presence !== false)
    .map(i => ({ title: i.name, price: num(i.price), oldPrice: num(i.oldprice) }));
  return represent(pickRelevant(cands, q));
}
// function-оголошення (не const): CITY_CHAINS вище посилається на них при
// ініціалізації модуля — const у бандлі стає var і був би ще undefined
async function evaPrice(branch, q) { return multisearchPrice('search.eva.ua', 10779, q); }
async function prostorPrice(branch, q) { return multisearchPrice('multisearch.prostor.ua', 12667, q); }

// ── WATSONS (hybris, з HAR): autocompleteSecure ────────────────────────────
// watsons.ua/solrimprovements/search/autocompleteSecure?term=&ln=uk →
// searchProducts (вкладені масиви) → {name, price:{value}}.
async function watsonsPrice(branch, q) {
  const r = await fetch(`https://www.watsons.ua/solrimprovements/search/autocompleteSecure?term=${encodeURIComponent(q)}&ln=uk`,
    { headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      Accept: 'application/json, text/plain, */*', 'Accept-Language': 'uk-UA,uk;q=0.9,en;q=0.8',
      Referer: 'https://www.watsons.ua/uk/search?text=' + encodeURIComponent(q),
      'X-Requested-With': 'XMLHttpRequest',
      'sec-ch-ua': '"Not/A)Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"',
      'sec-ch-ua-mobile': '?0', 'sec-ch-ua-platform': '"Windows"',
      'sec-fetch-dest': 'empty', 'sec-fetch-mode': 'cors', 'sec-fetch-site': 'same-origin',
    } });
  if (!r.ok) return null;
  const d = await r.json();
  let sp = d.searchProducts || [];
  while (Array.isArray(sp) && sp.length === 1 && Array.isArray(sp[0])) sp = sp[0];
  const cands = (Array.isArray(sp) ? sp : [])
    .filter(i => i && i.purchasable !== false)
    .map(i => ({ title: i.name, price: num(i.price && i.price.value), oldPrice: null }));
  return represent(pickRelevant(cands, q));
}

// ── ПОДОРОЖНИК (аптека): чистий JSON autocomplete-API ─────────────────────
// catalogue.l.podorozhnyk.com/api/v2/projections/autocomplete?query= →
// searchItems[]{name, price:{current,old}, status:{type:'available'}}. Українські назви.
async function podorozhnykPrice(branch, q) {
  const r = await fetch(`https://catalogue.l.podorozhnyk.com/api/v2/projections/autocomplete?query=${encodeURIComponent(q)}`,
    { headers: { 'User-Agent': UA, Accept: '*/*', 'Accept-Language': 'uk', Origin: 'https://podorozhnyk.ua', Referer: 'https://podorozhnyk.ua/' } });
  if (!r.ok) return null;
  const d = await r.json();
  const cands = (d.searchItems || [])
    .filter(i => !i.status || i.status.type === 'available')
    .map(i => ({ title: i.name, price: num(i.price && i.price.current), oldPrice: num(i.price && i.price.old) }));
  return represent(pickRelevant(cands, q));
}

// ── АВРОРА (CS-Cart, avrora.ua): ajax-пошук віддає {text:'<html>'} ────────
// Назва — в title/alt картинки картки; ціна — у span.ty-price-num (ціле й
// копійки можуть бути окремими span-ами, тому текст усіх ty-price-num
// у картці склеюється).
async function avroraPrice(branch, q) {
  const u = `https://avrora.ua/index.php?dispatch=products.search&search_performed=Y&q=${encodeURIComponent(q)}&is_ajax=1`;
  const r = await fetch(u, { headers: { 'User-Agent': UA, Accept: 'application/json', 'Accept-Language': 'uk', 'X-Requested-With': 'XMLHttpRequest' } });
  if (!r.ok) return null;
  const d = await r.json().catch(() => null);
  const html = (d && d.text) || '';
  const cands = [];
  for (const seg of html.split('ty-grid-list__item ').slice(1, 40)) {
    const name = (seg.match(/title="([^"]{3,140})"/) || [])[1];
    const priceTxt = [...seg.matchAll(/ty-price-num[^>]*>([\d\s.,]*)</g)].map(m => m[1]).join('').replace(/\s+/g, '').replace(',', '.');
    const price = num(priceTxt);
    if (name && price != null) cands.push({ title: unent(name), price, oldPrice: null });
  }
  return represent(pickRelevant(cands, q));
}

// ── ЕПІЦЕНТР (epicentrk.ua): SSR пошукової сторінки ──────────────────────
// Картка: …title="НАЗВА"… [data-product-price-old <data content="70.00">]
// <div title="ціна: 49 ₴" data-product-price-main …><data value="49.00">
// Сплітимо по маркеру ціни; назва = останній title перед ним, що не є
// підписом «цена/ціна: …».
async function epicentrPrice(branch, q) {
  const r = await fetch(`https://epicentrk.ua/search/?q=${encodeURIComponent(q)}`,
    { headers: { 'User-Agent': UA, 'Accept-Language': 'uk', Accept: 'text/html' } });
  if (!r.ok) return null;
  const html = await r.text();
  const cands = [];
  const parts = html.split('data-product-price-main');
  for (let i = 0; i < parts.length - 1 && cands.length < 40; i++) {
    const pre = parts[i];
    const titles = [...pre.matchAll(/title="([^"]{4,140})"/g)].map(m => m[1]).filter(t => !/^\s*(цена|ціна)/i.test(t));
    const name = titles[titles.length - 1];
    const price = num((parts[i + 1].match(/<data value="([\d.]+)"/) || [])[1]);
    const old = num((pre.slice(-1600).match(/data-product-price-old[^>]*>\s*<data content="([\d.]+)"/) || [])[1]);
    if (name && price != null) cands.push({ title: unent(name), price, oldPrice: old });
  }
  return represent(pickRelevant(cands, q));
}

// ── ДОБРОГО ДНЯ (add.ua): Magento, SSR видачі ─────────────────────────────
// Пари: <a class="product-item-link" href>НАЗВА</a> … data-price-amount="35.1"
// (раннери GitHub сайт блокує, але з IP Cloudflare — 200.)
async function adduaPrice(branch, q) {
  const r = await fetch(`https://www.add.ua/catalogsearch/result/?q=${encodeURIComponent(q)}`,
    { headers: { 'User-Agent': UA, 'Accept-Language': 'uk', Accept: 'text/html' } });
  if (!r.ok) return null;
  const html = await r.text();
  const cands = [];
  const parts = html.split('product-item-link');
  for (let i = 1; i < parts.length && cands.length < 40; i++) {
    const name = (parts[i].match(/^[^>]*>([^<]{4,160})</) || [])[1];
    const price = num((parts[i].match(/data-price-amount="([\d.]+)"/) || [])[1]);
    if (name && price != null) cands.push({ title: unent(name), price, oldPrice: null });
  }
  return represent(pickRelevant(cands, q));
}
