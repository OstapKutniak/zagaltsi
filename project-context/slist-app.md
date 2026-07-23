# SList (додаток «Покупки») — стан і хендоф

> Знімок стану на APP_VERSION **36** (сесія 2026-07). Код — джерело істини,
> цей файл може трохи відставати. Прайси окремо: `slist-price-chains.md`.

## Що це

PWA-список покупок для двох телефонів зі спільною базою. Живе в цьому ж репо:
- Код: `public/shopping/` (`index.html`, `app.js`, `style.css`, `sw.js`, `manifest.json`, `icons/`).
- Живе: https://ostapkutniak.github.io/zagaltsi/shopping/
- Простори: той самий код обслуговує `/shopping/` (нас) і `/shopping-parents/`
  (батьки) — визначається з `location.pathname`; копію index/sw для батьків
  робить `vite.config.ts → shoppingSpacesPlugin`.

## Стек / сховище

- Vanilla JS (ES-модуль), Canvas немає. Firebase Realtime DB для синку.
- **Одна Firebase-база `horugva-ff8bd` на три додатки** (shopping, finance/1мані,
  quests). Правила безпеки спільні на всю базу.
  ⚠️ Інцидент 2026-07-17: тестові правила протухли через 30 днів → обидва
  додатки «0 операцій». Лік: Console → Realtime Database → Rules →
  `{ "rules": { ".read": true, ".write": true } }`. Деталі: `public/finance/CONTEXT.md`.
- Шляхи в базі (SPACE = 'shopping' або 'shopping-parents'):
  `${SPACE}/categories`, `/products`, `/list`, `/archive`, `/stores`,
  `/recipes` (власні рецепти), `/meta/version` (автооновлення клієнтів), `/push`.

## Деплой

- `git push main` → GitHub Actions (`.github/workflows/deploy.yml`) → GitHub Pages (~1 хв).
- **Ціновий воркер** `workers/shopping-price/` деплоїться окремим workflow
  `deploy-shopping-price.yml` (секрет `CLOUDFLARE_API_TOKEN`) при зміні
  `workers/shopping-price/**`. Живий: `shopping-price.priko1isf.workers.dev`.
- **Правило:** при будь-якій зміні `public/shopping/*` бампати версію В ДВОХ
  місцях: `APP_VERSION` в `app.js` і `CACHE = ${SPACE}-vNN` в `sw.js` (інакше
  клієнти не підхоплять — механізм авто-reload через `meta/version`).
- Тестити локально не можна напряму (Firebase-CDN блокується в пісочниці) —
  є харнес: підміна Firebase-модуля через importmap на заглушку + Playwright
  (`/opt/pw-browsers/chromium`, `NODE_PATH=/opt/node22/lib/node_modules`).

## Вкладки

`list` (Список) · `add` (Додати) · `archive` (Архів) · `recipes` (Рецепти).
Свайп між вкладками — `initSwipeLayout` на `#screen-wrap` (translateX).

## Ціновий барабан (вкладка «Список»)

- `STORE_SETS` — магазини по категоріях товару (їжа/господарче/ліки/гігієна);
  `ALL_STORES` — усі разом (дефолт, коли нема фокуса). Затиск заголовка
  категорії в списку (`setPpCat`) звужує барабан до її магазинів + тінтить панель.
- Барабан — **справжнє нескінченне колесо** (не native-scroll): `ppOffset`,
  фіксовані слоти `.pp-item`, вміст по модулю, драг (Pointer Events) + інерція,
  прилипання до центру (центральний магазин = обраний `ppSel`, керує ≈ ціною).
- Ціни бере воркер. Що працює / що заглушка / як додати нову мережу (зонд, HAR) —
  **`slist-price-chains.md`**. Коротко: працюють продуктові (silpo/fora/novus/
  auchan) + aurora/epicentr/bonus/dobrogo/podorozhnyk/anc/eva/prostor; НЕ
  працюють watsons (Akamai ріже), bzh, algofarm.

## Рецепти (вкладка «Рецепти»)

- **Дані** — куровані, статичні в `app.js`: `const RECIPES` (36 страв). Кожна:
  `{ id, title, color, icon, cat, time, servings, ingredients[], steps[] }`;
  `ingredient {name,qty,icon}`, `step {short,text,t?}` (t — хв → крок із таймером).
- `DISH_CATS` — категорії страв для фільтра (Всі/М'ясні/Риба/Супи/Салати/Паста/
  Азійські/Сніданки/Випічка/Вегетаріанські/Десерти). Чипси згори (`renderRcpCats`),
  фільтрують колесо.
- **Колесо** — таке саме віртуальне нескінченне (`RCP_STRIDE`, `rcpOffset`,
  `layoutWheel`, драг+інерція `startInertia`). База — розмір рядка списку;
  ~5 центральних плавно більшають і стають жирними (`.rcp-row.big`).
  Кількість слотів адаптивна під висоту екрана.
  - Тап по страві → деталі; **затиск (~450 мс)** → редактор цієї страви; драг → крутить.
- **Деталі + приготування** — в одній шторці знизу (`#recipe-overlay`, два вигляди
  `#recipe-view`/`#cook-view`). Склад — сітка 4 колонки (як у «Додати»), тик по
  інгредієнту додає/прибирає зі списку, «Додати всі». «Приготувати» → «зміст»
  усіх кроків згори (короткі підписи + хв для таймерних, поточний підсвічений) +
  опис кроку + «Готово»/таймер. Таймер по завершенню: вібро+біп (`cookAlarm`) +
  локальне сповіщення (`localNotify`) + авто-перехід.
- **Іконки-страви** — лінійні в стилі додатка, додані в `ICONS` (spaghetti,
  ricebowl, ramenbowl, soup, pancakes, salad, burger, friedegg, pizza, taco,
  dip, steak, shrimp, cake, toast). Фото (опційно) кладуться в
  `public/shopping/recipes/<id>.jpg` — перекривають іконку (див. README там).

### Власні рецепти (редактор)

- Кнопка «+» у шапці вкладки → `openRecipeEdit()` (новий). Затиск страви →
  `openRecipeEdit(recipe)` (редагування, з кнопкою «Видалити»).
- Поля: назва, категорія, іконка (`DISH_ICONS`), час/порції, інгредієнти
  (назва+кількість, додавати/прибирати), кроки (коротка назва + опис + «+Таймер»
  з хвилинами).
- Зберігаються у Firebase `${SPACE}/recipes/<id>`. `allRecipes()` зливає
  вбудовані + власні: **власний запис за тим самим id перекриває вбудований**;
  `{ hidden:true }` ховає рецепт (так «видаляються» вбудовані — оригінал у
  `RECIPES` не чіпаємо). Власний id — `my_<ts>`.

## Механізм «нескінченного колеса» (обидва барабани)

Не native-scroll із копіями (був кістиль — впирався в край на фліку), а
віртуалізація: фіксований набір слотів, `offset` (px, необмежений), вміст
слота = список[(first+slot) mod N], позиція `translate(offset)`. Ввід — Pointer
Events (драг + власна інерція з EMA-швидкістю, `offset += vel` того ж напряму,
що драг). Горизонталь у колесі рецептів віддається свайпу вкладок (визначення осі).
Ключове: старт інерції НЕ обнуляє швидкість (лише скасовує rAF).

## TODO / хвости

- [ ] **Фото страв** у кружечках (Остап дає файли в `recipes/<id>.jpg`).
- [ ] **Ціни** для watsons/bzh/algofarm — потрібен HAR (див. `slist-price-chains.md`).
      Прибрати тимчасовий `/probe` з воркера, коли розвідку завершено.
- [ ] Ціна страви в деталях рецепту прибрана (рахувала пачку, а не потрібну
      кількість) — колись повернути з урахуванням кількості.
- [ ] Прибрати `/shopping-parents`-специфіку, якщо більше не треба (перевірити
      shoppingSpacesPlugin у vite.config.ts).

## Гілки/деплой цієї роботи

Розробка йшла в `main` (за згодою) + гілка `claude/slist-database-migration-dhx8n0`
тримається на тому ж коміті. Паралельно в `main` активна робота по грі/Літопису
з інших сесій — НЕ чіпати `src/**`, `public/finance/**`, `public/quests/**`;
наша зона — `public/shopping/**`, `workers/shopping-price/**`.
