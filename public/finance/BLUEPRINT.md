# PWA-Blueprint: синхронізований додаток для iOS (для наступної сесії Claude)

Це **інженерний конспект** додатка «Фінанси» (клон 1money), написаного з нуля на
чистому JS + Firebase. Мета файлу — щоб у **новій сесії** (для **іншого додатка**)
можна було швидко передати весь підхід: **синхронізацію, вигляд інтерфейсу,
анімації, свайпи, шторки, встановлення на екран**. Тобто це не документація саме
фінансів, а **готовий каркас-рецепт**, який копіюється й наповнюється новою логікою.

> **Контекст нового додатка (те, заради чого цей файл):**
> Новий додаток буде **для двох різних айфонів — iPhone 13 і iPhone 14 — із
> синхронізацією між ними в реальному часі.** Тобто зміна на одному телефоні
> миттєво з'являється на іншому. Обидва телефони відкривають один і той самий
> PWA (додану на головний екран веб-сторінку), а спільний стан тримає Firebase
> Realtime Database. Жодних акаунтів/логінів — обидва пристрої пишуть в одну
> базу за фіксованими шляхами. Саме цей патерн (нижче розділ «Синхронізація»)
> і треба перенести.

---

## 0. TL;DR — з чого складається магія

| Що | Чим зроблено |
|----|--------------|
| **Мова/стек** | Чистий **vanilla JS (ES-модулі)**, без React/Vue, без збірки самого додатка |
| **Синхрон між телефонами** | **Firebase Realtime Database** (модульний SDK з CDN gstatic), realtime-підписки |
| **Хостинг** | **GitHub Pages** (безкоштовно), деплой = `git push` у `main` через GitHub Actions |
| **«Нативність»** | **PWA**: `manifest.json` + apple-meta + service worker → додається на екран, працює без адресного рядка |
| **UI** | Один екран-шелл: фіксована шапка + свайповані сторінки + таб-бар + шторки знизу |
| **Іконки** | Власні inline-SVG (мапа `ICONS`), **без емодзі** |
| **Анімації** | CSS `@keyframes` + FLIP-техніка на `getBoundingClientRect` |

Ключова ідея: **немає бекенду, який треба писати.** Firebase RTDB — це і є
«сервер». Клієнт підписується на дані, і будь-яка зміна з будь-якого пристрою
приходить усім іншим за ~200 мс.

---

## 1. Стек і філософія

- **Ніякого фреймворку.** Весь додаток — 3 файли: `index.html`, `style.css`,
  `app.js`. Плюс `manifest.json` + `sw.js` для PWA. Це навмисно: легко
  переносити, немає збірки, немає `node_modules` для самого додатка.
- **Рендер — рядками.** Немає віртуального DOM. Є функції `renderX()`, які
  будують HTML-рядок і кладуть у `el.innerHTML`, потім навішують обробники.
  Просто, передбачувано, швидко для такого масштабу.
- **Стан — один об'єкт** `state` + кілька глобальних мап даних. Будь-яка зміна →
  `scheduleRender()` (дебаунс) → `renderAll()`.
- **Firebase — джерело істини.** Локальний стан лише віддзеркалює базу.

---

## 2. Структура файлів

```
public/<app>/                 ← додаток лежить у public/, НЕ в корені (див. §9)
  index.html                  розмітка: шапка, екрани, таб-бар, FAB, шторки
  style.css                   світла тема, дизайн-система, анімації
  app.js                      уся логіка (ES-модуль, Firebase з CDN)
  sw.js                       service worker (offline-кеш, версія кешу)
  manifest.json               PWA-маніфест
  icons/
    icon-192.png              іконки додатка (можна плейсхолдери спочатку)
    icon-512.png
```

Для нового додатка: скопіювати цю теку, перейменувати, почистити логіку,
лишити каркас (шелл, свайп, шторки, синхрон, анімації).

---

## 3. СИНХРОНІЗАЦІЯ (найголовніше — це переносимо в новий додаток)

### 3.1. Підключення Firebase (модульний SDK з CDN, без npm)

На початку `app.js`:

```js
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js';
import {
  getDatabase, ref, get, push, set, update, remove, onValue,
  onChildAdded, onChildChanged, onChildRemoved
} from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-database.js';

const firebaseConfig = {
  apiKey: '…', authDomain: '…', databaseURL: 'https://…-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: '…', storageBucket: '…', messagingSenderId: '…', appId: '…',
};
const db = getDatabase(initializeApp(firebaseConfig));
```

> Конфіг Firebase **не секретний** — його безпечно класти прямо в код (захист —
> це Rules бази, а не приховування ключа). Можна взяти **той самий проєкт
> Firebase**, що й у нас (`horugva-ff8bd`), і просто писати в **інший корінь**
> шляхів (напр. `myapp/…` замість `finance/…`) — тоді додатки не бачать даних
> одне одного. Або завести новий безкоштовний проєкт за 2 хв на
> console.firebase.google.com → Realtime Database → Create.

### 3.2. Rules (щоб два телефони могли читати/писати)

У Firebase Console → Realtime Database → Rules. Для приватного інструмента на два
свої телефони найпростіше — відкритий доступ до свого кореня:

```json
{ "rules": { "myapp": { ".read": true, ".write": true } } }
```

(Якщо треба суворіше — додати авторизацію. Для двох особистих девайсів зазвичай
не варто ускладнювати.)

### 3.3. Форма даних

RTDB — це одне велике JSON-дерево. Проєктуй шляхи так:

- **Колекції записів** → `myapp/items/{pushId} = {…}`. `pushId` генерується
  `push()` — унікальний, хронологічно сортований ключ.
- **Списки/налаштування** → зберігай як масив або об'єкт під фіксованим ключем:
  `myapp/settings = {…}`.
- **Похідні дані НЕ зберігай** — рахуй на льоту з базових.

### 3.4. Realtime-підписки (це і є «онлайн між телефонами»)

```js
function subscribe() {
  const r = ref(db, 'myapp/items');
  // Для великих колекцій — по-дитинно (ефективніше, ніж перечитувати все):
  onChildAdded(r,   s => { itemMap[s.key] = { id: s.key, ...s.val() }; scheduleRender(); });
  onChildChanged(r, s => { itemMap[s.key] = { id: s.key, ...s.val() }; scheduleRender(); });
  onChildRemoved(r, s => { delete itemMap[s.key]; scheduleRender(); });

  // Для невеликих обʼєктів/списків — одним onValue:
  onValue(ref(db, 'myapp/settings'), s => { settings = s.val() || {}; scheduleRender(); });
}
```

Коли **один телефон** робить `set/update/push/remove`, Firebase шле подію
`onChild*`/`onValue` **усім підписаним клієнтам** (і тому, хто змінив, теж) —
UI на **другому телефоні** оновлюється сам. Це вся «магія синхрону».

### 3.5. Запис

```js
const add    = data     => set(push(ref(db, 'myapp/items')), data);   // новий запис
const edit   = (id, d)  => update(ref(db, `myapp/items/${id}`), d);   // часткове оновлення
const del    = id       => remove(ref(db, `myapp/items/${id}`));      // видалення
const oneGet = async () => (await get(ref(db, 'myapp/items'))).val(); // разове читання
```

**Масові зміни — одним multi-path `update`** (атомарно, швидко, одна подія):

```js
const upd = {};
Object.entries(itemMap).forEach(([id, t]) => {
  if (нужно) upd[`${id}/field`] = newValue;
});
await update(ref(db, 'myapp/items'), upd);   // всі зміни за один раунд-тріп
```

### 3.6. Дебаунс рендера (щоб пачка подій не смикала UI)

```js
let renderTimer = null;
function scheduleRender() { clearTimeout(renderTimer); renderTimer = setTimeout(renderAll, 80); }
```

### 3.7. Санітизація ключів Firebase

У ключах RTDB **заборонені** `. # $ [ ] /`. Якщо робиш ключ з довільного тексту
(назва тощо):

```js
const metaKey = s => (s || '').toLowerCase().replace(/['’ʼ`]/g, "'").trim()
                              .replace(/[.#$\[\]\/]/g, '_');
```

### 3.8. Офлайн

SDK кешує останній стан у пам'яті; при відновленні мережі — доганяє. Плюс
service worker (нижче) віддає оболонку офлайн. Для двох телефонів онлайн —
достатньо.

---

## 4. PWA: як воно стає «додатком на екрані»

### 4.1. `manifest.json`

```json
{
  "name": "Назва", "short_name": "Назва",
  "start_url": "/repo/app/", "scope": "/repo/app/",
  "display": "standalone",          ← без адресного рядка, як нативний
  "background_color": "#0f172a", "theme_color": "#0f172a",
  "orientation": "portrait",
  "icons": [
    { "src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any maskable" },
    { "src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable" }
  ]
}
```

### 4.2. Мета-теги в `<head>` (критично для iOS)

```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover, maximum-scale=1.0, user-scalable=no">
<meta name="apple-mobile-web-app-capable" content="yes">        <!-- standalone на iOS -->
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="Назва">
<meta name="theme-color" content="#f4f4f7">
<link rel="manifest" href="manifest.json">
<link rel="apple-touch-icon" href="icons/icon-192.png">      <!-- іконка на екрані iOS -->
```

### 4.3. Service worker (`sw.js`) — offline + оновлення

```js
const CACHE = 'app-v1';                          // ← БАМПАЙ версію при кожному деплої!
const BASE = '/repo/app';
const ASSETS = [BASE+'/', BASE+'/index.html', BASE+'/style.css', BASE+'/app.js', BASE+'/manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS).catch(() => {})));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', e => {                 // network-first, кеш як запасний
  if (e.request.method !== 'GET') return;
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});
```

Реєстрація в `app.js`:

```js
if ('serviceWorker' in navigator)
  navigator.serviceWorker.register('/repo/app/sw.js', { scope: '/repo/app/' }).catch(() => {});
```

> **⚠️ Головний практичний баг:** телефон тримає стару версію з кешу. Правило:
> **при кожному деплої піднімай `CACHE`** (`app-v1` → `app-v2`), і на телефоні
> **повністю закрий і відкрий** PWA (з менеджера задач), щоб підхопило нове.

### 4.4. Як додати на головний екран (iOS Safari) — інструкція для користувача

1. Відкрити URL додатка в **Safari** (не Chrome — «На екран» є лише в Safari).
2. Кнопка **Поділитись** (квадрат зі стрілкою вгору).
3. Прогорнути → **«На екран Home» / «Add to Home Screen»**.
4. З'явиться іконка як у нативного додатка; відкривається **без адресного рядка**
   (бо `display: standalone` + apple-meta).
5. Повторити на **обох** телефонах (iPhone 13 і iPhone 14). Оскільки дані спільні
   у Firebase — усе, що вводиш на одному, з'являється на другому автоматично.

### 4.5. Safe-area (щоб не залазило під «чубчик» і домашню смугу)

У CSS всюди використовуй inset-змінні:

```css
:root { --top: env(safe-area-inset-top, 0px); --bottom: env(safe-area-inset-bottom, 0px); }
.header { padding-top: calc(var(--top) + 10px); }
.tabbar { padding-bottom: calc(var(--bottom) + 6px); }
```

> iPhone 13 і 14 обидва мають safe-area зверху/знизу — ці змінні дають коректні
> відступи на обох без окремого коду.

---

## 5. Архітектура UI (шелл додатка)

Один HTML, кілька «екранів», що перемикаються свайпом і таб-баром.

```
#app  (flex column, height 100%)
├── .header            ← фіксована зверху (шапка + рядок періоду/навігації)
├── #screen-wrap       ← flex:1, overflow:hidden, position:relative
│   ├── .screen        ← кожен екран: position:absolute, translateX, свій скрол
│   ├── .screen
│   └── …
├── .tabbar            ← фіксований знизу (кнопки-таби з SVG)
├── .fab               ← плаваюча кнопка «+»
└── шторки/оверлеї      ← .sheet-overlay (знизу) та .sheet-full (на весь екран)
```

Патерн екрана — **фіксована шапка + внутрішня зона зі скролом**:

```css
#screen-wrap { flex: 1; overflow: hidden; position: relative; min-height: 0; }
.screen {
  position: absolute; inset: 0;
  overflow-y: auto; -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;                 /* не «протікає» скрол на body */
  transform: translateX(100%);
  transition: transform 0.38s cubic-bezier(0.25,0.46,0.45,0.94);
}
html, body { overflow: hidden; overscroll-behavior: none; }  /* прибирає «гумку» body */
```

Якщо всередині екрана треба **закріплена панель + скрол** (напр. графік зверху,
список знизу) — роби екран `display:flex; flex-direction:column`, панель
`flex-shrink:0`, а зону списку `flex:1; overflow-y:auto; overscroll-behavior:contain`.

---

## 6. СВАЙП між екранами (переносимо як є)

Екрани лежать у `#screen-wrap` у фіксованому порядку `SWIPE_TABS`. Позиція
кожного — `translateX((i - current) * 100%)`. Свайп рухає всі синхронно, при
відпусканні — «долистує» до сусіднього, якщо перетягнули за поріг.

```js
const SWIPE_TABS = ['a', 'b', 'c'];   // порядок екранів

function syncTabs() {                  // розставити екрани відносно активного
  const cur = SWIPE_TABS.indexOf(state.tab);
  SWIPE_TABS.forEach((t, i) => {
    const s = document.getElementById(t + '-screen');
    s.style.transition = '';
    s.style.transform = `translateX(${(i - cur) * 100}%)`;
    s.classList.toggle('active', t === state.tab);
  });
}

function initSwipeLayout() {
  const wrap = document.getElementById('screen-wrap');
  let swX = 0, swY = 0, swActive = false, swLocked = false;

  wrap.addEventListener('touchstart', e => {
    swX = e.touches[0].clientX; swY = e.touches[0].clientY;
    swActive = true; swLocked = false;
  }, { passive: true });

  wrap.addEventListener('touchmove', e => {
    if (!swActive) return;
    const dx = e.touches[0].clientX - swX, dy = e.touches[0].clientY - swY;
    if (!swLocked) {                               // визначаємо напрямок жесту
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
      if (Math.abs(dy) >= Math.abs(dx)) { swActive = false; return; }  // це вертикальний скрол — не свайп
      swLocked = true;
    }
    e.preventDefault();
    const cur = SWIPE_TABS.indexOf(state.tab), W = wrap.offsetWidth;
    SWIPE_TABS.forEach((t, i) => {
      const s = document.getElementById(t + '-screen');
      s.style.transition = 'none';
      s.style.transform = `translateX(${(i - cur) * W + dx}px)`;
    });
  }, { passive: false });

  wrap.addEventListener('touchend', e => {
    if (!swActive || !swLocked) { swActive = false; return; }
    swActive = false;
    const dx = e.changedTouches[0].clientX - swX;
    const threshold = wrap.offsetWidth * 0.28;     // поріг «долистування»
    const cur = SWIPE_TABS.indexOf(state.tab);
    let next = cur;
    if (dx < -threshold && cur < SWIPE_TABS.length - 1) next = cur + 1;
    else if (dx > threshold && cur > 0) next = cur - 1;
    if (next !== cur) { state.tab = SWIPE_TABS[next]; renderAll(); }
    syncTabs();
  }, { passive: true });
}
```

**Ключові прийоми:** блокування осі (горизонт vs вертикаль) на початку жесту;
`transition:none` під час перетягування, повернення transition на `touchend`
через `syncTabs()`; поріг 28% ширини.

Той самий підхід використано для **горизонтального свайпу по рядку періоду**
(гортання місяців) — окрема функція `initMonthSwipe` з анімацією `monthOut/In`.

---

## 7. АНІМАЦІЇ (каталог — копіюй потрібні)

Усі — легкі CSS `@keyframes`, вмикаються присвоєнням `el.style.animation`.

```css
/* «поп» появи елемента з обертанням і пружиною */
@keyframes popIn {
  0%   { transform: scale(0) rotate(-300deg); opacity: 0; }
  65%  { transform: scale(1.2) rotate(-15deg); opacity: 1; }
  100% { transform: scale(1) rotate(0deg); opacity: 1; }
}
@keyframes popOut {
  from { transform: scale(1) rotate(0deg); opacity: 1; }
  to   { transform: scale(0) rotate(300deg); opacity: 0; }
}
/* пульс-«клац» (напр. перемикання режиму) */
@keyframes pulse {
  0%{transform:scale(1)} 25%{transform:scale(1.06)} 40%{transform:scale(1)}
  60%{transform:scale(1.32)} 78%{transform:scale(.9)} 100%{transform:scale(1)}
}
/* горизонтальний зсув сторінки */
@keyframes outLeft  { from{transform:translateX(0);opacity:1} to{transform:translateX(-28px);opacity:0} }
@keyframes inLeft   { from{transform:translateX(28px);opacity:0} to{transform:translateX(0);opacity:1} }
```

Запуск + перезапуск анімації (треба force-reflow, інакше не програється двічі):

```js
el.style.animation = 'none';
el.offsetWidth;                       // force reflow
el.style.animation = 'popIn 0.24s ease-out both';
```

Пружна крива, яку любимо: `cubic-bezier(0.34, 1.56, 0.64, 1)` (легкий overshoot).

### 7.1. «Hold-to-charge» (плавна реакція на затиск)

Поки палець тримає — елемент плавно росте; на порозі — спрацьовує дія:

```js
let timer = null, fired = false;
const start = () => {
  fired = false;
  el.style.transition = 'transform 0.45s cubic-bezier(0.4,0,0.2,1)';
  el.style.transform = 'scale(1.13)';
  timer = setTimeout(() => { fired = true; doAction(); }, 450);
};
const end = () => {
  clearTimeout(timer);
  if (!fired) { el.style.transition = 'transform 0.28s ease'; el.style.transform = ''; }
};
el.addEventListener('touchstart', start, { passive: true });
el.addEventListener('touchend', end, { passive: true });
el.addEventListener('touchmove', end, { passive: true });
```

### 7.2. FLIP — плавна перестановка списку при зміні порядку

Коли список пересортовується (напр. з фіксованого порядку у «за спаданням»),
елементи мають **переповзти** на нові місця, а не стрибнути:

```js
function flip(container, sel, mutate) {
  const before = new Map();
  container.querySelectorAll(sel).forEach(el => before.set(el.dataset.key, el.getBoundingClientRect()));
  mutate();                                            // перерендер зі зміненим порядком
  container.querySelectorAll(sel).forEach(el => {
    const b = before.get(el.dataset.key); if (!b) return;
    const a = el.getBoundingClientRect();
    const dx = b.left - a.left, dy = b.top - a.top;
    if (!dx && !dy) return;
    el.style.transition = 'none';
    el.style.transform = `translate(${dx}px, ${dy}px)`;   // спочатку «повертаємо» на старе місце
    requestAnimationFrame(() => {
      el.style.transition = 'transform 0.5s cubic-bezier(0.22,1,0.36,1)';
      el.style.transform = '';                            // потім анімовано до нового
    });
  });
}
```

Вимога: у елементів має бути стабільний `data-key`, щоб зіставити «до» і «після».

---

## 8. ДИЗАЙН-СИСТЕМА (вигляд інтерфейсу)

### 8.1. CSS-змінні (світла тема в стилі iOS)

```css
:root {
  --bg:#fff; --header:#f4f4f7; --text:#1c1c1e; --text2:#8a8a90; --text3:#b4b4ba;
  --exp:#eb3b7e;        /* акцент «мінус»/червоний */
  --inc:#27ae60;        /* акцент «плюс»/зелений */
  --pill:#e8e8f4; --active:#ebe7fb; --active-ink:#6a5ae0;   /* фіолетовий акцент дій */
  --line:#ededf0;       /* розділювачі */
  --top: env(safe-area-inset-top,0px); --bottom: env(safe-area-inset-bottom,0px);
}
* { margin:0; padding:0; box-sizing:border-box;
    -webkit-tap-highlight-color:transparent; -webkit-user-select:none; user-select:none; }
input, textarea { -webkit-user-select:text; user-select:text; }
body { font-family:-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Inter', sans-serif; }
```

Радіуси: кнопки/картки `12–18px`, кружечки іконок `50%`, шторки `20px 20px 0 0`.
Шрифти: заголовки `17–22px/700`, тіло `15–16px`, підписи `11–13px/var(--text2)`.

### 8.2. Іконки — inline-SVG, БЕЗ емодзі (важлива конвенція проєкту)

Емодзі не використовуємо ніде (кнопки, порожні стани, налаштування). Замість —
мапа шляхів SVG і хелпер:

```js
const ICONS = {
  card:'<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 9h20"/>',
  chart:'<path d="M3 3v18h18"/><path d="M7 14l3-4 3 3 4-6"/>',
  // …viewBox завжди 0 0 24 24
};
const ic = k => `<svg viewBox="0 0 24 24">${ICONS[k] || ICONS.tag}</svg>`;
```

```css
.some-ic svg { width:24px; height:24px; fill:none; stroke:#fff;
               stroke-width:1.9; stroke-linecap:round; stroke-linejoin:round; }
.some-ic svg .fill { fill:#fff; stroke:none; }   /* для залитих деталей всередині */
```

Кольоровий кружечок під іконку: контейнер `background: var(--c)`, а `--c`
підставляємо інлайново (`style="--c:#2D9CDB"`).

---

## 9. Хостинг і деплой (GitHub Pages)

- Репо збирається **Vite**, Pages віддає теку `dist/`. Vite копіює `public/` у
  `dist/` **як є** → тому додаток лежить у **`public/<app>/`**, не в корені.
  (Якщо покласти в корінь — буде 404.)
- Базовий шлях у всіх посиланнях — `/<repo>/<app>/` (manifest `start_url`/`scope`,
  реєстрація SW, apple-touch-icon).
- **Деплой = `git push` у `main`** → GitHub Actions (`.github/workflows/deploy.yml`)
  збирає й публікує на Pages (~1–2 хв).
- Мінімальний workflow: `checkout → setup-node → npm ci → npm run build →
  upload-pages-artifact(dist) → deploy-pages`. Тригер `on: push: branches:[main]`.
- Жива адреса: `https://<user>.github.io/<repo>/<app>/`.
- Після деплою — **підняти `CACHE` у `sw.js`** і перезапустити PWA на телефоні.

> Якщо новий додаток — окремий репозиторій, а не підтека: тоді base = `/<repo>/`,
> і додаток можна класти в корінь `public/`. Логіка та сама.

---

## 10. Переносні компоненти (готові патерни UI)

Усі шторки — один патерн: напівпрозорий оверлей + панель, `.open` вмикає показ.

```css
.sheet-overlay { display:none; position:fixed; inset:0; background:rgba(0,0,0,.4);
                 z-index:200; align-items:flex-end; }
.sheet-overlay.open { display:flex; }
.sheet { background:#fff; border-radius:20px 20px 0 0; width:100%; max-height:76vh;
         display:flex; flex-direction:column; padding-bottom:var(--bottom); }
/* повноекранна шторка (форма) висувається знизу */
.sheet-full { position:fixed; inset:0; background:var(--bg); z-index:100;
              transform:translateY(100%); transition:transform .3s cubic-bezier(.32,.72,0,1);
              display:flex; flex-direction:column; }
.sheet-full.active { transform:translateY(0); }
```

Готові компоненти в коді (беруться як приклади):
- **Bottom-sheet picker** із пошуком і опцією «створити нове» (`openPicker` повертає Promise).
- **Календар** день/діапазон (`grid-column-start` для зсуву 1-го числа, без порожніх клітинок).
- **Палітра кольорів** (grid зі свотчів, `--c` інлайново, `.sel` — вибір).
- **Icon picker** (grid з усіх `ICONS`).
- **Toast** (фіксований, `.show` на 2.4с).
- **Toggle-перемикач** (чекбокс + `.tog-track` у стилі iOS).
- **Калькулятор-форма** вводу (клавіатура-grid, свій парсер виразів).

---

## 11. Патерн стану і рендеру

```js
let state = { tab: 'a', /* поточні режими/фільтри UI */ };
let itemMap = {};                 // дані з Firebase (id → obj)

function renderAll() {
  renderHeader();
  if (state.tab === 'a') renderA();
  else if (state.tab === 'b') renderB();
  // …
}
// будь-яка зовнішня зміна (подія Firebase) → scheduleRender() → renderAll()
```

Кожна `renderX()`: (1) порахувати похідні з `itemMap`, (2) зібрати HTML-рядок,
(3) `el.innerHTML = html`, (4) навісити обробники на свіжі елементи.

---

## 12. Бонус-патерн: зовнішній API + денний кеш

(У фінансах — курси НБУ; для іншого додатка може бути будь-який публічний API.)

```js
async function loadExternal() {
  try {
    const cached = JSON.parse(localStorage.getItem('key') || '{}');
    if (cached.ts && Date.now() - cached.ts < 86400000) return;   // раз на добу
    const data = await (await fetch(URL)).json();
    localStorage.setItem('key', JSON.stringify({ ts: Date.now(), data }));
    scheduleRender();
  } catch { /* лишаємось на кеші/дефолтах */ }
}
```

---

## 13. Чек-лист «підняти новий додаток за годину»

1. `cp -r public/finance public/<newapp>`; почистити `app.js` від фінансової логіки,
   лишити каркас: `subscribe/scheduleRender/renderAll`, свайп, шторки, анімації.
2. У `manifest.json`, `sw.js`, реєстрації SW — замінити шляхи на `/<repo>/<newapp>/`
   і назву; `CACHE = '<newapp>-v1'`.
3. Firebase: лишити той самий конфіг, змінити **корінь шляхів** на `<newapp>/…`
   (щоб не мішалось із іншими додатками); перевірити Rules.
4. Задизайнити `SWIPE_TABS` + екрани в `index.html`; наповнити `ICONS` потрібними SVG.
5. Написати `renderX()` під нову доменну модель; запис через `set/update/push/remove`.
6. `git push` у `main` → відкрити на обох айфонах у Safari → «На екран».
7. Далі кожна зміна: правка → підняти `CACHE` → push → перезапуск PWA на телефонах.

---

## 14. Граблі, на які вже наступали (щоб не повторювати)

- **404 після деплою** — додаток був у корені, а не в `public/`. Клади в `public/`.
- **«Зміни не підʼїхали»** — старий кеш SW. Бампай `CACHE` + повністю перезапускай PWA.
- **Свайп конфліктує з вертикальним скролом** — обов'язково блокуй вісь на початку
  жесту (`Math.abs(dy) >= Math.abs(dx)` → це скрол, не свайп).
- **Анімація не програється вдруге** — треба `el.offsetWidth` (force reflow) між
  зняттям і призначенням `animation`.
- **Firebase «permission denied»** — не налаштовані Rules на потрібний корінь.
- **Заборонені символи в ключах** — санітизуй через `metaKey()`.
- **Емодзі на кнопках** — не робимо; тільки inline-SVG (конвенція проєкту).
- **Білі «гумки» при оверскролі** — `overscroll-behavior: none` на `html,body` і
  `contain` на скрол-зонах.
- **Контент під таб-баром / FAB** — додавай нижній `padding` = `calc(var(--bottom) + ~90px)`.

---

*Файл — знімок стану на момент написання; джерело істини завжди код у
`public/finance/`. Для нового додатка бери цей каркас і наповнюй своєю логікою.*
