// Розвідка API мереж для цінового воркера (запускається з GitHub Actions,
// де відкритий інтернет). Раунд 1: обмацати сайти — статуси, платформа,
// кандидатні JSON-ендпоінти, сліди embedded-JSON у пошуковій видачі.
// Вивід читає Claude через логи джоба.

const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const round = process.argv[2] || '1';

const H = { 'User-Agent': UA, 'Accept-Language': 'uk', Accept: '*/*' };

async function get(url, extra = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await fetch(url, { headers: { ...H, ...extra }, signal: ctl.signal, redirect: 'follow' });
    const text = await r.text();
    return { status: r.status, ct: r.headers.get('content-type') || '', text, finalUrl: r.url };
  } catch (e) {
    return { status: 0, ct: '', text: '', err: String(e && e.cause && e.cause.code || e.message || e) };
  } finally { clearTimeout(t); }
}

const squash = s => s.replace(/\s+/g, ' ').trim();
const snip = (s, n = 300) => squash(s).slice(0, n);

function htmlHints(html) {
  const hints = [];
  const checks = [
    ['__NEXT_DATA__', 'next.js'], ['__NUXT__', 'nuxt'], ['window.__INITIAL_STATE__', 'initial-state'],
    ['graphql', 'graphql'], ['horoshop', 'horoshop'], ['shop-express', 'shop-express'],
    ['data-insales', 'insales'], ['algolia', 'algolia'], ['multisearch', 'multisearch'],
    ['cdn.shopify', 'shopify'], ['occ/v2', 'hybris-occ'], ['hybris', 'hybris'],
  ];
  for (const [needle, name] of checks) if (html.toLowerCase().includes(needle.toLowerCase())) hints.push(name);
  // явні api-шляхи в inline-коді
  const apis = [...new Set((html.match(/https?:\/\/[a-z0-9.-]*(?:api|search|catalog)[a-z0-9./_-]*/gi) || []).slice(0, 12))];
  return { hints, apis };
}

async function probeSite(name, base, searchUrls, apiCandidates) {
  console.log(`\n########## ${name} (${base}) ##########`);
  const home = await get(base);
  console.log(`HOME ${home.status} ${home.ct.split(';')[0]} ${home.err || ''} final=${home.finalUrl || ''}`);
  if (home.text) {
    const { hints, apis } = htmlHints(home.text);
    console.log(`  hints: ${hints.join(', ') || '-'}`);
    apis.forEach(a => console.log(`  api-in-html: ${a}`));
  }
  for (const su of searchUrls) {
    const r = await get(su);
    console.log(`SEARCH ${r.status} ${r.ct.split(';')[0]} ${su} ${r.err || ''}`);
    if (r.text && r.ct.includes('json')) console.log(`  json: ${snip(r.text, 500)}`);
    else if (r.text) {
      const { hints, apis } = htmlHints(r.text);
      console.log(`  hints: ${hints.join(', ') || '-'}`);
      apis.forEach(a => console.log(`  api-in-html: ${a}`));
      // сліди цін у HTML — чи можна скрейпити видачу напряму
      const price = r.text.match(/(\d{2,5}[.,]\d{2})\s*(?:грн|₴)/);
      if (price) console.log(`  price-in-html: ${price[1]} грн (HTML-скрейп можливий)`);
    }
  }
  for (const c of apiCandidates) {
    const r = c.post
      ? await (async () => {
          const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 15000);
          try {
            const resp = await fetch(c.url, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json', ...(c.headers || {}) }, body: JSON.stringify(c.body || {}), signal: ctl.signal });
            return { status: resp.status, ct: resp.headers.get('content-type') || '', text: await resp.text() };
          } catch (e) { return { status: 0, ct: '', text: '', err: String(e.message || e) }; } finally { clearTimeout(t); }
        })()
      : await get(c.url, c.headers || {});
    console.log(`API ${r.status} ${r.ct.split(';')[0]} ${c.url} ${r.err || ''}`);
    if (r.text && (r.ct.includes('json') || r.text.trim().startsWith('{') || r.text.trim().startsWith('['))) {
      console.log(`  body: ${snip(r.text, 600)}`);
    }
  }
}

const Q = encodeURIComponent('парацетамол');
const QH = encodeURIComponent('губки');
const QG = encodeURIComponent('шампунь');

if (round === '1') {
  // ── завгосп ──
  await probeSite('Епіцентр', 'https://epicentrk.ua/', [
    `https://epicentrk.ua/search/?q=${QH}`,
    `https://epicentrk.ua/api/v2/search?q=${QH}`,
  ], [
    { url: `https://epicentrk.ua/graphql?query={search(query:"губки"){products{name}}}` },
  ]);
  await probeSite('Аврора', 'https://avrora.ua/', [
    `https://avrora.ua/search/?query=${QH}`,
    `https://avrora.ua/index.php?route=product/search&search=${QH}`,
  ], []);
  await probeSite('Бонус (bonusmarket)', 'https://bonusmarket.com.ua/', [
    `https://bonusmarket.com.ua/search/?q=${QH}`,
  ], []);

  // ── гігієна ──
  await probeSite('EVA', 'https://eva.ua/', [
    `https://eva.ua/catalogsearch/result/?q=${QG}`,
  ], [
    { url: `https://eva.ua/api/catalog/vue_storefront_catalog_2/product/_search?q=${QG}` },
  ]);
  await probeSite('Watsons', 'https://www.watsons.ua/', [
    `https://www.watsons.ua/search?text=${QG}`,
  ], [
    { url: `https://api.watsons.ua/api/v2/wtcua/products/search?query=${QG}&lang=uk&curr=UAH` },
    { url: `https://www.watsons.ua/api/v2/wtcua/products/search?query=${QG}&lang=uk&curr=UAH` },
  ]);
  await probeSite('Простор', 'https://prostor.ua/', [
    `https://prostor.ua/search/?q=${QG}`,
  ], []);

  // ── аптеки ──
  await probeSite('Подорожник', 'https://podorozhnyk.ua/', [
    `https://podorozhnyk.ua/search?q=${Q}`,
  ], []);
  await probeSite('АНЦ', 'https://anc.ua/', [
    `https://anc.ua/search?q=${Q}`,
  ], []);
  await probeSite('Доброго дня (add.ua)', 'https://add.ua/', [
    `https://add.ua/uk/search/?q=${Q}`,
  ], []);
  await probeSite('Бажаємо здоровʼя', 'https://apteka.net.ua/', [
    `https://apteka.net.ua/search?q=${Q}`,
  ], []);
  await probeSite('Tabletki.ua (агрегатор аптек)', 'https://tabletki.ua/', [
    `https://tabletki.ua/uk/search/${Q}/`,
  ], []);
}

// ── РАУНД 2: цілеспрямовано по знахідках раунду 1 ───────────────────────────
function around(text, needle, span = 500) {
  const i = text.toLowerCase().indexOf(needle.toLowerCase());
  if (i < 0) return null;
  return squash(text.slice(Math.max(0, i - span / 2), i + span));
}
function printMatches(label, text, re, max = 10) {
  const m = [...new Set((text.match(re) || []).map(squash))].slice(0, max);
  m.forEach(x => console.log(`  ${label}: ${x}`));
  return m;
}

if (round === '2') {
  const dump = async (name, url, needles, extra = {}) => {
    const r = await get(url, extra);
    console.log(`\n=== ${name} → ${r.status} ${r.ct.split(';')[0]} ${url} ${r.err || ''}`);
    if (!r.text) return r;
    if (r.ct.includes('json') || r.text.trim().startsWith('{') || r.text.trim().startsWith('[')) {
      console.log(`  json: ${snip(r.text, 900)}`);
      return r;
    }
    for (const n of needles) {
      const a = around(r.text, n, 600);
      if (a) console.log(`  around("${n}"): ${a.slice(0, 700)}`);
    }
    return r;
  };

  // 1) MULTISEARCH: дістати id із сайтів Аврори/Простору/Епіцентра і спитати api.multisearch.io
  for (const [nm, u] of [['Аврора', 'https://avrora.ua/'], ['Простор', 'https://prostor.ua/'], ['Епіцентр(404стор)', 'https://epicentrk.ua/api/nonexistent']]) {
    const r = await get(u);
    console.log(`\n=== multisearch-id @ ${nm} → ${r.status}`);
    printMatches('ms', r.text || '', /multisearch[^"'\s)]{0,100}/gi, 8);
    printMatches('ms-id', r.text || '', /[?&"'](?:id|uid|ms_id|msid)["']?\s*[:=]\s*["']?\d{3,}/gi, 8);
  }
  // спроба класичного виклику multisearch без id і з підозрілими id — щоб бачити формат помилки
  await dump('multisearch-noid', `https://api.multisearch.io/?query=${QH}&lang=uk`, []);

  // 2) ЕПІЦЕНТР: suggest + пошукова сторінка зсередини
  await dump('Епіцентр suggest', `https://api.epicentrk.ua/api/v1/suggest?q=${QH}`, []);
  await dump('Епіцентр suggest2', `https://api.epicentrk.ua/api/v1/suggest?query=${QH}&lang=ua`, []);
  const ep = await get(`https://epicentrk.ua/search/?q=${QH}`);
  console.log(`\n=== Епіцентр search HTML → ${ep.status}`);
  if (ep.text) {
    const a = around(ep.text, '"price"', 700) || around(ep.text, 'price', 700);
    if (a) console.log(`  price-ctx: ${a.slice(0, 800)}`);
    printMatches('nuxt-api', ep.text, /https?:\/\/api\.epicentrk\.ua[a-z0-9./_?=&-]{0,80}/gi, 10);
  }

  // 3) ПОДОРОЖНИК: __NEXT_DATA__ і search-домен
  const pd = await get(`https://podorozhnyk.ua/search?q=${Q}`);
  console.log(`\n=== Подорожник search HTML → ${pd.status}`);
  if (pd.text) {
    const nd = pd.text.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (nd) {
      const j = nd[1];
      console.log(`  next-data size=${j.length}`);
      const a = around(j, 'price', 700); if (a) console.log(`  price-ctx: ${a.slice(0, 800)}`);
      const b = around(j, 'search.l', 400); if (b) console.log(`  searchdom-ctx: ${b.slice(0, 500)}`);
      const c = around(j, 'buildId', 200); if (c) console.log(`  buildId-ctx: ${c.slice(0, 250)}`);
    }
  }
  await dump('Подорожник search-api v1', `https://search.l.podorozhnyk.com/search?query=${Q}`, []);
  await dump('Подорожник search-api v2', `https://search.l.podorozhnyk.com/api/search?query=${Q}`, []);
  await dump('Подорожник search-api v3', `https://search.l.podorozhnyk.com/v1/search?q=${Q}`, []);

  // 4) АНЦ: __NUXT__ / api-кандидати
  const anc = await get(`https://anc.ua/search?q=${Q}`);
  console.log(`\n=== АНЦ search HTML → ${anc.status} size=${(anc.text || '').length}`);
  if (anc.text) {
    const a = around(anc.text, '"price"', 700) || around(anc.text, 'price', 700);
    if (a) console.log(`  price-ctx: ${a.slice(0, 800)}`);
    printMatches('api', anc.text, /https?:\/\/[a-z0-9.-]*anc[a-z0-9.-]*\/[a-z0-9./_?=&-]{0,60}/gi, 10);
    printMatches('fetchpath', anc.text, /["'](\/(?:api|graphql)[a-z0-9./_-]{0,60})["']/gi, 10);
  }
  await dump('АНЦ api search', `https://anc.ua/api/v1/search?q=${Q}`, []);
  await dump('АНЦ graphql?', `https://anc.ua/graphql`, []);

  // 5) WATSONS: знайти OCC-базу
  const wt = await get(`https://www.watsons.ua/search?text=${QG}`);
  console.log(`\n=== Watsons search HTML → ${wt.status} size=${(wt.text || '').length}`);
  if (wt.text) {
    printMatches('occ', wt.text, /[a-z0-9.:/-]*occ[a-z0-9./_-]{0,60}/gi, 10);
    printMatches('api2', wt.text, /["'][^"']*api\/v2[^"']{0,60}["']/gi, 10);
    printMatches('wtcua', wt.text, /[^"'\s]{0,60}wtcua[^"'\s]{0,40}/gi, 10);
    const price = around(wt.text, '₴', 300) || around(wt.text, 'грн', 300);
    if (price) console.log(`  price-ctx: ${price.slice(0, 400)}`);
  }
  await dump('Watsons OCC v2 watsonsua', `https://www.watsons.ua/api/v2/watsonsua/products/search?query=${QG}&lang=uk&curr=UAH`, []);
  await dump('Watsons occ path', `https://www.watsons.ua/occ/v2/wtcua/products/search?query=${QG}&lang=uk&curr=UAH`, []);
  await dump('Watsons rest v2', `https://www.watsons.ua/rest/v2/wtcua/products/search?query=${QG}&lang=uk&curr=UAH`, []);

  // 6) БАЖАЄМО ЗДОРОВ'Я: справжній шлях пошуку з форми
  const bz = await get('https://apteka.net.ua/');
  console.log(`\n=== apteka.net.ua HTML → ${bz.status}`);
  if (bz.text) {
    printMatches('form', bz.text, /<form[^>]{0,200}/gi, 6);
    printMatches('api', bz.text, /["'](\/[a-z0-9./_-]*(?:search|api)[a-z0-9./_-]{0,50})["']/gi, 10);
  }
  await dump('БЖ search?text', `https://apteka.net.ua/search?text=${Q}`, []);
  await dump('БЖ uk/search', `https://apteka.net.ua/uk/search?q=${Q}`, []);

  // 7) БОНУС: пошук правильного домену
  for (const d of ['bonus.ua', 'bonus-market.com.ua', 'bonusmarket.ua', 'tovary-bonus.com.ua', 'bonus.kiev.ua']) {
    const r = await get(`https://${d}/`);
    console.log(`bonus? ${d} → ${r.status} ${r.err || ''} ${r.finalUrl || ''}`);
  }

  // 8) EVA/add.ua/tabletki з іншими заголовками (раптом пускає без бот-виклику)
  await dump('EVA desktop-UA', 'https://eva.ua/', [], { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36', Accept: 'text/html,application/xhtml+xml' });
  await dump('add.ua desktop-UA', 'https://add.ua/', [], { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36', Accept: 'text/html,application/xhtml+xml' });
}

// ── РАУНД 3: multisearch наживо, SSR-скрейпи, Next-дані, воркер-проксі ──────
if (round === '3') {
  const j = async (name, url, extra = {}) => {
    const r = await get(url, extra);
    console.log(`\n=== ${name} → ${r.status} ${r.ct.split(';')[0]} ${r.err || ''}`);
    if (r.text) console.log(`  body: ${snip(r.text, 1200)}`);
    return r;
  };

  // 1) MULTISEARCH наживо: Простор (id відомий) і Епіцентр (id=10468)
  await j('multisearch Простор', `https://api.multisearch.io/?id=750361578745447&query=${QG}&lang=uk&uid=probe1`);
  await j('multisearch Епіцентр', `https://api.multisearch.io/?id=10468&query=${QH}&lang=uk&uid=probe1`);

  // 2) АВРОРА: шукаємо ms-id ширше (пошукова сторінка + бандли)
  const av = await get(`https://avrora.ua/index.php?route=product/search&search=${QH}`);
  console.log(`\n=== Аврора search SSR → ${av.status} size=${(av.text || '').length}`);
  if (av.text) {
    const p = around(av.text, 'product-thumb', 600) || around(av.text, 'price', 600);
    if (p) console.log(`  card-ctx: ${p.slice(0, 700)}`);
    printMatches('ms-widget', av.text, /multisearch[^"'\s]{0,120}/gi, 8);
    printMatches('ms-num', av.text, /id["']?\s*[:=]\s*["']?\d{6,}/gi, 8);
    // скрипти — пошук id у бандлі
    const srcs = [...av.text.matchAll(/<script[^>]+src="([^"]+)"/g)].map(m => m[1]).filter(s => /multi|search|main|theme/i.test(s)).slice(0, 4);
    for (const s of srcs) {
      const u = s.startsWith('http') ? s : `https://avrora.ua${s.startsWith('/') ? '' : '/'}${s}`;
      const b = await get(u);
      const hit = (b.text || '').match(/multisearch[^"'\s]{0,120}|[?&]id=\d{6,}/gi);
      console.log(`  bundle ${u} → ${b.status} ms-hits: ${(hit || []).slice(0, 5).join(' | ')}`);
    }
  }

  // 3) ЕПІЦЕНТР: приклад картки з SSR (назва+ціна поруч) для регекспа
  const ep = await get(`https://epicentrk.ua/search/?q=${QH}`);
  console.log(`\n=== Епіцентр SSR карти → ${ep.status}`);
  if (ep.text) {
    const names = [...ep.text.matchAll(/itemprop="name"[^>]*>([^<]{5,90})</g)].map(m => squash(m[1])).slice(0, 6);
    names.forEach(n => console.log(`  name: ${n}`));
    const a = around(ep.text, 'itemprop="name"', 900);
    if (a) console.log(`  card-ctx: ${a.slice(0, 1000)}`);
  }

  // 4) ПОДОРОЖНИК: живий buildId → Next-дані; батарея шляхів search-сервісу
  const pd = await get(`https://podorozhnyk.ua/search?q=${Q}`);
  const bid = pd.text && (pd.text.match(/"buildId":"([^"]+)"/) || [])[1];
  console.log(`\n=== Подорожник buildId=${bid || '?'}`);
  if (bid) await j('Подорожник next-data', `https://podorozhnyk.ua/_next/data/${bid}/Search.json?q=${Q}`);
  for (const p of [`/api/v1/search?query=${Q}`, `/v2/search?query=${Q}`, `/search/v1?query=${Q}`, `/products/search?query=${Q}`, `/?query=${Q}`])
    await j(`Подорожник search.l ${p.split('?')[0]}`, `https://search.l.podorozhnyk.com${p}`);

  // 5) АНЦ: nuxt-payload і бандли
  await j('АНЦ payload', `https://anc.ua/search/_payload.json?q=${Q}`);
  const anc = await get(`https://anc.ua/search?q=${Q}`);
  if (anc.text) {
    const a = around(anc.text, '__NUXT__', 500); if (a) console.log(`  nuxt-ctx: ${a.slice(0, 600)}`);
    printMatches('api-host', anc.text, /https?:\/\/[a-z0-9.-]+\.(?:anc|storage)[a-z0-9.-]*\/[^"'\s]{0,50}/gi, 8);
    const srcs = [...anc.text.matchAll(/<script[^>]+src="(\/_nuxt\/[^"]+\.js)"/g)].map(m => m[1]).slice(0, 2);
    for (const s of srcs) {
      const b = await get(`https://anc.ua${s}`);
      printMatches(`bundle-api ${s.slice(0, 30)}`, b.text || '', /https?:\/\/[a-z0-9.-]*(?:api|backend|catalog)[a-z0-9.-]*\.[a-z]{2,6}\/[a-z0-9./_-]{0,40}/gi, 8);
      printMatches(`bundle-path ${s.slice(0, 30)}`, b.text || '', /["']\/api\/[a-z0-9./_-]{3,50}["']/gi, 8);
    }
  }

  // 6) WATSONS: чи SSR видача; ajax-кандидати
  const wt = await get(`https://www.watsons.ua/search?text=${QG}`);
  console.log(`\n=== Watsons SSR? → ${wt.status}`);
  if (wt.text) {
    const cnt = (wt.text.match(/₴/g) || []).length;
    console.log(`  ₴ у HTML: ${cnt}`);
    const a = around(wt.text, 'data-price', 500) || around(wt.text, 'product__', 500) || around(wt.text, 'productName', 500);
    if (a) console.log(`  card-ctx: ${a.slice(0, 700)}`);
    printMatches('ajax', wt.text, /["'][^"']*(?:ajax|json|api)[^"']{0,60}["']/gi, 12);
  }

  // 7) БЖ: форма /search/result + /search/list
  const bzh = await get('https://apteka.net.ua/');
  const inputName = bzh.text && (bzh.text.match(/search__form[\s\S]{0,400}?name="([^"]+)"/) || [])[1];
  console.log(`\n=== БЖ input name=${inputName || '?'}`);
  await j('БЖ result', `https://apteka.net.ua/search/result?${inputName || 'q'}=${Q}`);
  await j('БЖ list', `https://apteka.net.ua/search/list?${inputName || 'q'}=${Q}`);

  // 8) EVA / add.ua / tabletki через Cloudflare-воркер
  const W = 'https://shopping-price.priko1isf.workers.dev/probe?url=';
  await j('EVA via CF', `${W}${encodeURIComponent('https://eva.ua/')}`);
  await j('add.ua via CF', `${W}${encodeURIComponent('https://add.ua/')}`);
  await j('tabletki via CF', `${W}${encodeURIComponent('https://tabletki.ua/uk/search/' + Q + '/')}`);
}

// ── РАУНД 4: точкове добивання по кожній мережі ─────────────────────────────
if (round === '4') {
  const j4 = async (name, url, extra = {}) => {
    const r = await get(url, extra);
    console.log(`\n=== ${name} → ${r.status} ${r.ct.split(';')[0]} ${r.err || ''}`);
    if (r.text) console.log(`  body: ${snip(r.text, 1100)}`);
    return r;
  };
  const W = 'https://shopping-price.priko1isf.workers.dev/probe?url=';

  // 1) ПРОСТОР: сам віджет multisearch — звідки він бере API
  const pr = await get(`https://prostor.ua/`);
  if (pr.text) {
    const srcs = [...pr.text.matchAll(/<script[^>]+src="([^"]*[Mm]ultisearch[^"]*)"/g)].map(m => m[1]).slice(0, 3);
    console.log(`\n=== Простор ms-скрипти: ${srcs.join(' | ') || 'нема'}`);
    printMatches('ms-cfg', pr.text, /multisearch[_a-z]*(?:_id|Id|-id)["']?\s*[:=]\s*["']?[\w-]+/gi, 6);
    const inline = around(pr.text, 'multisearch_store_id', 500);
    if (inline) console.log(`  cfg-ctx: ${inline.slice(0, 600)}`);
    for (const s of srcs) {
      const u = s.startsWith('http') ? s : (s.startsWith('//') ? 'https:' + s : `https://prostor.ua${s}`);
      const b = await get(u);
      console.log(`  widget ${u} → ${b.status}`);
      printMatches('  api-url', b.text || '', /https?:\/\/[a-z0-9.-]*multisearch[a-z0-9./?=&{}_-]{0,80}/gi, 8);
    }
  }

  // 2) АВРОРА: CS-Cart ajax + карточка з SSR
  await j4('Аврора ajax search', `https://avrora.ua/index.php?dispatch=products.search&subcats=Y&pcode_from_q=Y&pshort=Y&pfull=Y&pname=Y&pkeywords=Y&search_performed=Y&q=${QH}&is_ajax=1`, { 'X-Requested-With': 'XMLHttpRequest' });
  const av = await get(`https://avrora.ua/index.php?route=product/search&search=${QH}`);
  if (av.text) {
    const a = around(av.text, 'ty-grid-list__item', 900) || around(av.text, 'product-title', 900);
    console.log(`\n=== Аврора SSR карточка: ${a ? a.slice(0, 1000) : 'не знайдено'}`);
    const cnt = (av.text.match(/ty-grid-list__item/g) || []).length;
    console.log(`  карток: ${cnt}`);
  }

  // 3) ЕПІЦЕНТР: структура картки (назва біля ціни)
  const ep = await get(`https://epicentrk.ua/search/?q=${QH}`);
  if (ep.text) {
    const i = ep.text.indexOf('data-product-price-main');
    console.log(`\n=== Епіцентр контекст ДО ціни (шукаємо назву):`);
    if (i > 0) console.log('  pre: ' + squash(ep.text.slice(Math.max(0, i - 2200), i)).slice(-1400));
    printMatches('testid', ep.text, /data-testid="[a-z-]+"/g, 20);
  }

  // 4) ПОДОРОЖНИК: чанки Next → шлях search.l
  const pd = await get(`https://podorozhnyk.ua/search?q=${Q}`);
  if (pd.text) {
    const chunks = [...new Set([...pd.text.matchAll(/src="(https:\/\/cdn\.podorozhnyk\.com\/_next\/static\/chunks\/[^"]+\.js)"/g)].map(m => m[1]))].slice(0, 10);
    console.log(`\n=== Подорожник чанків: ${chunks.length}`);
    for (const c of chunks) {
      const b = await get(c);
      if ((b.text || '').includes('search.l')) {
        console.log(`  ЧАНК ІЗ search.l: ${c}`);
        const a = around(b.text, 'search.l', 800);
        console.log(`  ctx: ${a.slice(0, 900)}`);
        printMatches('  path', b.text, /["'`]\/[a-z0-9/_-]*search[a-z0-9/_-]*["'`]/gi, 10);
        break;
      }
    }
  }

  // 5) АНЦ: чи є товари в SSR; api-хости
  const anc = await get(`https://anc.ua/search?q=${Q}`);
  if (anc.text) {
    const hits = (anc.text.match(/арацетамол/g) || []).length;
    console.log(`\n=== АНЦ: "парацетамол" у HTML: ${hits}`);
    if (hits > 2) { const a = around(anc.text, 'арацетамол', 900); console.log(`  ctx: ${a.slice(0, 1000)}`); }
  }
  await j4('АНЦ api host', 'https://api.anc.ua/');
  await j4('АНЦ backend host', 'https://backend.anc.ua/');

  // 6) WATSONS: hybris accelerator JSON
  await j4('Watsons results json', `https://www.watsons.ua/search/results?text=${QG}&format=json`);
  await j4('Watsons autocomplete', `https://www.watsons.ua/search/autocomplete/SearchBox?term=${QG}`);

  // 7) БЖ: SSR видача
  const bzr = await get(`https://apteka.net.ua/search/result?search=${Q}`);
  if (bzr.text) {
    const cnt = (bzr.text.match(/грн/g) || []).length;
    console.log(`\n=== БЖ "грн" у видачі: ${cnt}`);
    const a = around(bzr.text, 'product', 900);
    if (a) console.log(`  card-ctx: ${a.slice(0, 1000)}`);
    const b = around(bzr.text, 'грн', 700);
    if (b) console.log(`  price-ctx: ${b.slice(0, 800)}`);
  }

  // 8) ADD.UA через CF: Magento — catalogsearch SSR + відкритий GraphQL
  await j4('add.ua catalogsearch', `${W}${encodeURIComponent('https://www.add.ua/catalogsearch/result/?q=' + Q)}`);
  const gq = encodeURIComponent(`{products(search:"парацетамол",pageSize:10){items{name price_range{minimum_price{final_price{value}}}}}}`);
  await j4('add.ua graphql', `${W}${encodeURIComponent('https://www.add.ua/graphql?query=' + gq)}`);

  // 9) EVA: api-хост через CF
  await j4('EVA api host', `${W}${encodeURIComponent('https://api.eva.ua/')}`);
}

// ── РАУНД 5 ────────────────────────────────────────────────────────────────
if (round === '5') {
  const j5 = async (name, url, extra = {}) => {
    const r = await get(url, extra);
    console.log(`\n=== ${name} → ${r.status} ${r.ct.split(';')[0]} ${r.err || ''}`);
    if (r.text) console.log(`  body: ${snip(r.text, 1200)}`);
    return r;
  };
  const W = 'https://shopping-price.priko1isf.workers.dev/probe?';

  // 1) ПРОСТОР: multisearch id=12667 наживо + модуль автокомпліта
  await j5('multisearch id=12667', `https://api.multisearch.io/?id=12667&query=${QG}&lang=uk&uid=aaa1`);
  const pr = await get('https://prostor.ua/');
  const base = pr.text && (pr.text.match(/https:\/\/prostor\.ua\/static\/version\d+\/frontend\/[^/]+\/[^/]+\/uk_UA/) || [])[0];
  console.log(`\n=== Простор static base: ${base || '?'}`);
  if (base) {
    const b = await get(`${base}/Prostor_Multisearch/js/view/autocomplete.js`);
    console.log(`  autocomplete.js → ${b.status}`);
    printMatches('  ms-url', b.text || '', /https?:\/\/[a-z0-9.-]*multisearch[a-z0-9./?=&${}_'"+-]{0,100}/gi, 8);
    const a = around(b.text || '', 'multisearch', 700);
    if (a) console.log(`  ctx: ${a.slice(0, 800)}`);
  }

  // 2) АВРОРА: повна картка з ajax-видачі (назва+ціна)
  const avr = await get(`https://avrora.ua/index.php?dispatch=products.search&search_performed=Y&q=${QH}&is_ajax=1`, { 'X-Requested-With': 'XMLHttpRequest' });
  if (avr.text) {
    try {
      const html = JSON.parse(avr.text).text || '';
      const i = html.indexOf('ty-grid-list__item');
      const card = html.slice(Math.max(0, i - 100), i + 2600).replace(/\s+/g, ' ');
      console.log(`\n=== Аврора картка цілком:\n  ${card.slice(0, 2400)}`);
    } catch (e) { console.log('аврора parse fail', e.message); }
  }

  // 3) ЕПІЦЕНТР: JSON-LD або назва в широкому контексті перед ціною
  const ep = await get(`https://epicentrk.ua/search/?q=${QH}`);
  if (ep.text) {
    const ld = [...ep.text.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => m[1]);
    console.log(`\n=== Епіцентр JSON-LD блоків: ${ld.length}`);
    ld.forEach(x => console.log(`  ld: ${snip(x, 700)}`));
    const i = ep.text.indexOf('data-product-price-main');
    if (i > 0) {
      const pre = ep.text.slice(Math.max(0, i - 4500), i);
      const titles = [...pre.matchAll(/title="([^"]{6,90})"/g)].map(m => m[1]).slice(-4);
      console.log(`  titles перед ціною: ${titles.join(' || ')}`);
    }
  }

  // 4) ПОДОРОЖНИК: усі скрипти сторінки, шукаємо хост пошуку
  const pd = await get(`https://podorozhnyk.ua/search?q=${Q}`);
  if (pd.text) {
    const srcs = [...new Set([...pd.text.matchAll(/src="([^"]*_next\/static[^"]+\.js)"/g)].map(m => m[1]))];
    console.log(`\n=== Подорожник скриптів усього: ${srcs.length}`);
    for (const s of srcs) {
      const u = s.startsWith('http') ? s : `https://podorozhnyk.ua${s}`;
      const b = await get(u);
      if ((b.text || '').includes('search.l') || (b.text || '').includes('getSearchServiceHost')) {
        console.log(`  ЧАНК: ${u}`);
        const a = around(b.text, 'search.l', 800) || around(b.text, 'getSearchServiceHost', 800);
        console.log(`  ctx: ${a.slice(0, 900)}`);
        printMatches('  path', b.text, /["'`][a-z0-9/_.-]*search[a-z0-9/_.?=&{}$-]*["'`]/gi, 12);
        break;
      }
    }
  }

  // 5) АНЦ: всі hosts зі сторінки + entry-чанк
  const anc = await get(`https://anc.ua/search?q=${Q}`);
  if (anc.text) {
    printMatches('АНЦ host', anc.text, /https?:\/\/[a-z0-9.-]+\.[a-z]{2,10}/gi, 25);
    const entry = [...anc.text.matchAll(/src="(\/_nuxt\/[^"]+\.js)"/g)].map(m => m[1]);
    console.log(`  nuxt-чанків: ${entry.length}`);
    for (const s of entry.slice(0, 6)) {
      const b = await get(`https://anc.ua${s}`);
      const hit = (b.text || '').match(/["']\/api\/[a-z0-9./_-]{2,60}["']|https?:\/\/[a-z0-9.-]*anc[a-z0-9.-]*\/[a-z0-9./_-]{1,50}/gi);
      if (hit && hit.length) { console.log(`  чанк ${s}: ${[...new Set(hit)].slice(0, 10).join(' | ')}`); }
    }
  }

  // 6) WATSONS: правильні параметри results json
  await j5('Watsons q relevance', `https://www.watsons.ua/search/results?q=${QG}%3Arelevance&page=0&format=json`);
  await j5('Watsons q простий', `https://www.watsons.ua/search/results?q=${QG}&format=json`);

  // 7) БЖ: маркери у видачі
  const bzr = await get(`https://apteka.net.ua/search/result?search=${Q}`);
  if (bzr.text) {
    console.log(`\n=== БЖ маркери: ₴=${(bzr.text.match(/₴/g) || []).length} uah=${(bzr.text.match(/uah/gi) || []).length} price=${(bzr.text.match(/price/gi) || []).length} views\\/ajax=${(bzr.text.match(/views\/ajax/g) || []).length}`);
    const a = around(bzr.text, 'product-teaser', 700) || around(bzr.text, 'card-product', 700) || around(bzr.text, '₴', 700);
    if (a) console.log(`  ctx: ${a.slice(0, 800)}`);
    printMatches('  drupal-view', bzr.text, /view[-_][a-z-]{3,30}/gi, 10);
  }

  // 8) ADD.UA: SSR-ціни через find-контексти
  await j5('add.ua price-amount', `${W}find=data-price-amount&span=700&url=${encodeURIComponent('https://www.add.ua/catalogsearch/result/?q=' + Q)}`);
  await j5('add.ua item-link', `${W}find=product-item-link&span=500&url=${encodeURIComponent('https://www.add.ua/catalogsearch/result/?q=' + Q)}`);

  // 9) EVA: пара здогадок по api-хосту
  await j5('EVA api v2', `${W}url=${encodeURIComponent('https://api.eva.ua/api/v2/')}`);
  await j5('EVA api search', `${W}url=${encodeURIComponent('https://api.eva.ua/api/v2/products/search?q=' + QG)}`);

  // 10) БОНУС: bonus-market.in.ua (схоже на Prom-платформу, SSR)
  const bn = await get('https://bonus-market.in.ua/');
  console.log(`\n=== Бонус home → ${bn.status} ${bn.err || ''}`);
  if (bn.text) {
    const { hints, apis } = htmlHints(bn.text);
    console.log(`  hints: ${hints.join(', ') || '-'}`);
    apis.forEach(a => console.log(`  api-in-html: ${a}`));
    printMatches('  form', bn.text, /<form[^>]{0,180}/gi, 4);
  }
  for (const su of [
    `https://bonus-market.in.ua/product_list?search_term=${QH}`,
    `https://bonus-market.in.ua/search?search_term=${QH}`,
  ]) {
    const r = await get(su);
    console.log(`Бонус SEARCH ${r.status} ${su} ${r.err || ''}`);
    if (r.text) {
      const cnt = (r.text.match(/грн/g) || []).length;
      console.log(`  "грн": ${cnt}`);
      const a = around(r.text, 'data-qaid="product_block"', 800) || around(r.text, 'грн', 800);
      if (a) console.log(`  card-ctx: ${a.slice(0, 900)}`);
    }
  }
}

// ── РАУНД 6: верифікація готових мереж через воркер + добивання решти ──────
if (round === '6') {
  const WORKER = 'https://shopping-price.priko1isf.workers.dev';
  const post = async (name, url, body, extra = {}) => {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 20000);
    try {
      const r = await fetch(url, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json', ...extra }, body: JSON.stringify(body), signal: ctl.signal });
      const text = await r.text();
      console.log(`\n=== ${name} → ${r.status}`);
      console.log(`  body: ${snip(text, 1000)}`);
      return { status: r.status, text };
    } catch (e) { console.log(`\n=== ${name} → ERR ${e.message}`); return {}; } finally { clearTimeout(t); }
  };
  const j6 = async (name, url, extra = {}) => {
    const r = await get(url, extra);
    console.log(`\n=== ${name} → ${r.status} ${r.ct.split(';')[0]} ${r.err || ''}`);
    if (r.text) console.log(`  body: ${snip(r.text, 1000)}`);
    return r;
  };

  // 1) ВЕРИФІКАЦІЯ нових мереж через воркер
  await post('worker avrora', `${WORKER}/prices`, { chain: 'avrora', queries: ['губки', 'пакети для сміття', 'лампочка'] });
  await post('worker epicentr', `${WORKER}/prices`, { chain: 'epicentr', queries: ['губки', 'лампочка', 'батарейки'] });
  await post('worker dobrogo', `${WORKER}/prices`, { chain: 'dobrogo', queries: ['парацетамол', 'вітаміни', 'пластир'] });

  // 2) ПРОСТОР: Magento — та сама SSR-видача, що в add.ua?
  const ps = await get(`https://prostor.ua/catalogsearch/result/?q=${QG}`);
  console.log(`\n=== Простор catalogsearch → ${ps.status} size=${(ps.text || '').length}`);
  if (ps.text) {
    console.log(`  price-amount: ${(ps.text.match(/data-price-amount/g) || []).length} | item-link: ${(ps.text.match(/product-item-link/g) || []).length}`);
    const a = around(ps.text, 'product-item-link', 500);
    if (a) console.log(`  ctx: ${a.slice(0, 600)}`);
    const b = around(ps.text, 'data-price-amount', 400);
    if (b) console.log(`  price-ctx: ${b.slice(0, 500)}`);
  }

  // 3) БОНУС: site_search і ціни Prom
  const bn = await get(`https://bonus-market.in.ua/site_search?search_term=${QH}`);
  console.log(`\n=== Бонус site_search → ${bn.status} size=${(bn.text || '').length}`);
  if (bn.text) {
    console.log(`  ₴: ${(bn.text.match(/₴/g) || []).length} | product_price: ${(bn.text.match(/product_price/g) || []).length} | product_block: ${(bn.text.match(/data-qaid="product_block"/g) || []).length}`);
    const a = around(bn.text, 'product_price', 600);
    if (a) console.log(`  price-ctx: ${a.slice(0, 700)}`);
    const nm = around(bn.text, 'product_name', 500) || around(bn.text, 'product_link', 500);
    if (nm) console.log(`  name-ctx: ${nm.slice(0, 600)}`);
  }

  // 4) АНЦ: чанки через modulepreload href
  const anc = await get(`https://anc.ua/search?q=${Q}`);
  if (anc.text) {
    const links = [...new Set([...anc.text.matchAll(/href="(\/_nuxt\/[^"]+\.js)"/g)].map(m => m[1]))];
    console.log(`\n=== АНЦ modulepreload-чанків: ${links.length}`);
    let found = 0;
    for (const s of links.slice(0, 20)) {
      const b = await get(`https://anc.ua${s}`);
      const hit = [...new Set((b.text || '').match(/["'`]\/api\/[a-z0-9./_${}-]{2,60}["'`]|https?:\/\/[a-z0-9.-]*anc[a-z0-9.-]*\.[a-z]{2,6}[a-z0-9./_-]{0,50}/gi) || [])].filter(x => !x.includes('static.anc'));
      if (hit.length) { console.log(`  ${s}: ${hit.slice(0, 12).join(' | ')}`); if (++found >= 4) break; }
    }
  }

  // 5) WATSONS: mobileapi (стандарт A.S. Watson OCC)
  await j6('Watsons mobileapi', `https://mobileapi.watsons.ua/api/v2/wtcua/products/search?query=${QG}&lang=uk&curr=UAH`);
  await j6('Watsons api host', `https://api.watsons.ua/`);

  // 6) БЖ: drupal-settings (де їхній ajax) + сторінка категорії SSR?
  const bz = await get(`https://apteka.net.ua/search/result?search=${Q}`);
  if (bz.text) {
    const a = around(bz.text, 'drupal-settings-json', 1200);
    console.log(`\n=== БЖ drupal-settings: ${a ? a.slice(0, 1200) : 'нема'}`);
  }
  const bzc = await get('https://apteka.net.ua/medykamenty/znebolyuyuchi-ta-protyzapalni');
  console.log(`=== БЖ категорія SSR: ₴=${((bzc.text || '').match(/₴/g) || []).length} грн=${((bzc.text || '').match(/грн/g) || []).length} status=${bzc.status}`);

  // 7) ПОДОРОЖНИК: POST-батарея на search.l
  for (const [p, b] of [
    ['/api/v1/search', { query: 'парацетамол' }],
    ['/search', { query: 'парацетамол' }],
    ['/api/search', { query: 'парацетамол', page: 1 }],
    ['/v1/search', { text: 'парацетамол' }],
  ]) await post(`Подорожник POST ${p}`, `https://search.l.podorozhnyk.com${p}`, b, { Origin: 'https://podorozhnyk.ua', Referer: 'https://podorozhnyk.ua/' });

  // 8) EVA: POST graphql через CF-проксі
  await j6('EVA graphql intro', `https://shopping-price.priko1isf.workers.dev/probe?url=${encodeURIComponent('https://api.eva.ua/graphql')}&body=${encodeURIComponent('{"query":"{__typename}"}')}`);
  await j6('EVA api v2 POST', `https://shopping-price.priko1isf.workers.dev/probe?url=${encodeURIComponent('https://api.eva.ua/api/v2/')}&body=${encodeURIComponent('{}')}`);
}

// ── РАУНД 7: ре-верифікація + Простор/Бонус/АНЦ/Watsons/БЖ ─────────────────
if (round === '7') {
  const WORKER = 'https://shopping-price.priko1isf.workers.dev';
  const post7 = async (name, url, body, extra = {}) => {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 25000);
    try {
      const r = await fetch(url, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json', ...extra }, body: JSON.stringify(body), signal: ctl.signal });
      console.log(`\n=== ${name} → ${r.status}`);
      console.log(`  body: ${snip(await r.text(), 900)}`);
    } catch (e) { console.log(`\n=== ${name} → ERR ${e.message}`); } finally { clearTimeout(t); }
  };

  // 1) ре-верифікація з м'яким коренем (губки → Губка) і ключем aurora
  await post7('worker aurora', `${WORKER}/prices`, { chain: 'aurora', queries: ['губки', 'серветки вологі'] });
  await post7('worker epicentr', `${WORKER}/prices`, { chain: 'epicentr', queries: ['губки', 'лампочка'] });

  // 2) ПРОСТОР: дістати бандл автокомпліта і з нього — endpoint multisearch
  const pr = await get('https://prostor.ua/');
  if (pr.text) {
    const base = (pr.text.match(/\/static\/version\d+\/frontend\/[^"']+?\/uk_UA/) || [])[0];
    console.log(`\n=== Простор base: ${base || '?'}`);
    if (base) {
      for (const p of ['/Prostor_Multisearch/js/view/autocomplete.js', '/Prostor_Multisearch/js/view/autocomplete.min.js']) {
        const b = await get(`https://prostor.ua${base}${p}`);
        console.log(`  ${p} → ${b.status}`);
        if (b.status === 200 && b.text) {
          printMatches('  url', b.text, /https?:\/\/[a-z0-9.-]*multisearch[^"'`\s]{0,100}/gi, 8);
          const a = around(b.text, 'api', 600); if (a) console.log(`  ctx: ${a.slice(0, 700)}`);
          break;
        }
      }
    }
  }

  // 3) БОНУС: де саме ціна в картці (контексти навколо ₴)
  const bn = await get(`https://bonus-market.in.ua/site_search?search_term=${QH}`);
  if (bn.text) {
    console.log(`\n=== Бонус ₴-контексти:`);
    let i = -1, n = 0;
    while (n < 3 && (i = bn.text.indexOf('₴', i + 1)) >= 0) {
      console.log(`  [${n}]: ${squash(bn.text.slice(Math.max(0, i - 450), i + 60)).slice(0, 520)}`);
      n++;
    }
  }

  // 4) АНЦ: батарея same-origin api-шляхів
  for (const p of [`/api/search?q=${Q}`, `/api/v1/products/search?q=${Q}`, `/api/catalog/search?q=${Q}`, `/api/products?search=${Q}`, `/api/v2/search?q=${Q}`])
    await (async () => { const r = await get(`https://anc.ua${p}`); console.log(`АНЦ ${p} → ${r.status} ${r.ct.split(';')[0]} ${r.ct.includes('json') ? snip(r.text, 250) : ''}`); })();

  // 5) WATSONS: конфіг сервісів у пошуковій сторінці
  const wt = await get(`https://www.watsons.ua/search?text=${QG}`);
  if (wt.text) {
    console.log(`\n=== Watsons WUA-конфіг:`);
    for (const n of ['services', 'endpoint', 'searchUrl', 'productSearch', 'ajaxUrl']) {
      const a = around(wt.text, n, 500);
      if (a) console.log(`  around(${n}): ${a.slice(0, 550)}`);
    }
    printMatches('  urlpath', wt.text, /["']\/[a-z][a-z0-9/_-]{2,40}\.json["']|url\s*:\s*["'][^"']{3,60}["']/gi, 15);
  }

  // 6) БЖ: продукти під'їжджають окремим запитом — глянемо, чи є js-api в сторінці
  const bz = await get(`https://apteka.net.ua/search/result?search=${Q}`);
  if (bz.text) {
    printMatches('БЖ data-url', bz.text, /data-[a-z-]*url="[^"]{3,80}"/gi, 12);
    printMatches('БЖ fetch-path', bz.text, /["']\/[a-z0-9/_-]*(?:ajax|api|json|search)[a-z0-9/_-]{0,40}["']/gi, 12);
  }
}

// ── РАУНД 8: tabletki.ua — мобільний API (одне джерело для всіх аптек) ─────
if (round === '8') {
  const W8 = 'https://shopping-price.priko1isf.workers.dev/probe?';
  const j8 = async (name, url, extra = {}) => {
    const r = await get(url, extra);
    console.log(`\n=== ${name} → ${r.status} ${r.ct.split(';')[0]} ${r.err || ''}`);
    if (r.text) console.log(`  body: ${snip(r.text, 800)}`);
    return r;
  };
  // прямо з раннера
  await j8('api.tabletki.ua root', 'https://api.tabletki.ua/');
  await j8('api.tabletki.ua search v1', `https://api.tabletki.ua/api/v1/search?text=${Q}`);
  await j8('api.tabletki.ua Search', `https://api.tabletki.ua/Search?text=${Q}`);
  // через CF-воркер
  for (const u of [
    'https://api.tabletki.ua/',
    `https://api.tabletki.ua/api/v1/search?text=${Q}`,
    `https://api.tabletki.ua/api/search?query=${Q}`,
  ]) await j8(`via CF: ${u.slice(24, 70)}`, `${W8}url=${encodeURIComponent(u)}`);
  // мобільна версія сайту
  await j8('m.tabletki.ua', `https://m.tabletki.ua/uk/search/${Q}/`);
  // застосунок tabletki: типові хости
  for (const h of ['app.tabletki.ua', 'mobile.tabletki.ua', 'api2.tabletki.ua']) {
    const r = await get(`https://${h}/`);
    console.log(`host ${h} → ${r.status} ${r.err || ''}`);
  }
}

console.log('\nPROBE DONE round=' + round);
