# SList: цінові мережі — стан і хвости (сесія 2026-07-12)

Задача: «підтягнути базу» аптек/завгоспу/гігієни для барабана цін SList.
Мережі в UI (`STORE_SETS` в public/shopping/app.js) були давно, але воркер
`workers/shopping-price` вмів лише продуктові (silpo/fora/zakaz-платформа).

## Інструмент розвідки (лишений у репо)

- `.github/workflows/price-probe.yml` + `scripts/price-probe.mjs` — «зонд»:
  workflow_dispatch з інпутом `round` (1..10). Раннер GitHub має відкритий
  інтернет; скрипт мацає сайти мереж і друкує знахідки в лог джоба.
  Клод запускає зонд через GitHub API і читає логи — жодних дій користувача.
- Воркер має ТИМЧАСОВИЙ `/probe?url=…[&find=…][&body=…]` (allowlist хостів) —
  фетч з IP Cloudflare для сайтів, що блокують раннери GitHub (add.ua — 403
  для раннера, 200 з CF). Прибрати, коли розвідка повністю закінчиться.

## ПРАЦЮЄ (реалізовано у воркері, ключі = ключі додатка, branch не потрібен)

| chain     | Мережа        | Як                                                        |
|-----------|---------------|-----------------------------------------------------------|
| aurora    | Аврора        | CS-Cart ajax: `avrora.ua/index.php?dispatch=products.search&…&is_ajax=1` → JSON{text: html}; назва з title картки, ціна — склеєні span.ty-price-num |
| epicentr  | Епіцентр      | SSR `epicentrk.ua/search/?q=`; сплiт по `data-product-price-main`, назва = останній title перед ціною (не «цена/ціна:»), ціна `<data value>`, стара `data-product-price-old` |
| bonus     | Бонус         | Prom-магазин `bonus-market.in.ua/site_search?search_term=`; картка `data-qaid="product_block"`, назва `product_name`, ціна `price-field`, стара line-through |
| dobrogo   | Доброго дня   | Magento SSR `www.add.ua/catalogsearch/result/?q=` (з CF — 200); `product-item-link` + `data-price-amount` |

Релевантність: `pickRelevant()` — каскад коренів (повне слово → 5 → 4 літери),
далі медіана (`represent`). Додаток НЕ потребував змін: ключі збіглися,
воркер дефолтить branch='city' для цих мереж.

## НЕ ДАЛИСЯ автономно (потрібен HAR від Остапа — по 1 файлу на сайт)

- **podorozhnyk** — next.js, пошук на `search.l.podorozhnyk.com`, шлях
  невідомий (усі очевидні GET/POST → 404 nginx; чанки не світять шлях).
- **anc** — Nuxt3, товари не в SSR; same-origin `/api/*` — 404; api-хости не існують.
- **bzh** (apteka.net.ua) — Drupal big_pipe, товари під'їжджають окремим
  запитом, який не знайшовся (є лише /basket-api, /search/list-сторінка).
- **eva** — DataDome/CF-челендж на всьому; api.eva.ua існує, але відповідає
  405 «Must be one of: OPTIONS» на все.
- **watsons** — hybris; `/search/results` існує (400 Missing param), але
  параметри не підібрались; mobileapi/api хости мертві або таймаут.
- **prostor** — Magento + Multisearch (store_id 12667, tracker mmi0ci8765wb);
  прямі виклики api.multisearch.io → «404» (невідомий формат), бандл
  автокомпліта не дістався.
- **algofarm** — онлайн-каталога, схоже, немає взагалі (сайт не знайдено).

Інструкція для HAR: відкрити сайт → F12 → Network → зробити пошук товару →
ПКМ у списку запитів → «Save all as HAR with content» → кинути файл у чат.

## Як продовжити з нової сесії

1. **Прочитай цей файл і воркер** `workers/shopping-price/src/index.js` —
   там 4 робочі скрейпери (avroraPrice/epicentrPrice/bonusPrice/adduaPrice),
   хелпери `pickRelevant` (каскад релевантності) і `represent` (медіана).
2. **Зонд**: додай у `scripts/price-probe.mjs` новий блок `if (round === 'N')`,
   пушни в main, запусти workflow «Price API probe» через GitHub API
   (`actions_run_trigger`, workflow_id `price-probe.yml`, inputs `{round:'N'}`),
   лог читай через `get_job_logs`. Воркер автодеплоїться на push у
   `workers/shopping-price/**` (~40 с).
3. **Отримав HAR від Остапа** → знайди в ньому запит пошуку (фільтруй по
   слову, яке він шукав): URL, метод, заголовки, тіло, форма відповіді.
   Реалізуй `<chain>Price(branch, q)` у воркері за зразком наявних:
   кандидати {title, price, oldPrice} → `represent(pickRelevant(cands, q))`,
   зареєструй у `CITY_CHAINS` під ключем ІЗ ДОДАТКА (STORE_SETS в
   public/shopping/app.js: podorozhnyk/anc/bzh/eva/watsons/prostor).
   Верифікуй раундом зонда: POST на воркер `/prices` з 2-3 запитами.
4. **Додаток міняти не треба** — ключі збігаються, branch дефолтиться.
   Якщо мережа так і лишиться без цін — можна прибрати її зі STORE_SETS.
5. Коли все добито: прибрати `/probe` з воркера і (за бажанням)
   price-probe.yml + scripts/price-probe.mjs.

## Тупики (не повторювати)

- tabletki.ua як агрегатор: сайт за жорстким антиботом (челендж навіть з CF);
  api.tabletki.ua/api2 відкриті, але це ПАРТНЕРСЬКЕ API резервування
  (reserve.tabletki.ua/api-docs), не пошук цін.
- `/images/edits`-стиль здогадок по multisearch: віджет вимагає невідомий
  формат/параметри — без бандла або HAR не вгадується.
