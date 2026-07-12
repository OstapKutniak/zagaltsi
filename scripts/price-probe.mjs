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

console.log('\nPROBE DONE round=' + round);
