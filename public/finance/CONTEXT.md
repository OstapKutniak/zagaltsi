# Фінанси PWA — контекст розробки

> Особистий фінансовий трекер для Остапа. Заміна Android-додатка **1money** після
> переходу на iOS. Збереження 6 років історії витрат + синхронізація між пристроями.
> Розроблено з Claude Code, червень 2026.

---

## 1. Проблема

- Остап ~6 років вів усі витрати в Android-додатку **1money** (by Provenir).
- Перейшов на **iOS** — там 1money немає.
- Потрібно: (а) перенести всю історію на айфон, (б) синхронізувати дані між двома
  телефонами (Android + iPhone), (в) продовжувати вести облік далі.

## 2. Рішення (чому саме PWA + Firebase)

Замість «знайти схожий iOS-додаток» або «портувати 1money нативно» — обрано
**власну PWA** (Progressive Web App):

- **Один додаток на обидва телефони** (Android + iPhone) через Safari/Chrome →
  «Додати на екран». Виглядає як нативний: окрема іконка, **без адресного рядка**
  браузера (`display: standalone`).
- **Не потрібен App Store** і Apple Developer ($99/рік).
- **Реальний синхрон наживо** через **Firebase Realtime Database**.
- **Не залежить від ОС** — переїзд на будь-яку платформу більше не проблема.
- Хмара також рятує від відомої вади iOS (Safari чистить локальні дані, якщо
  додаток довго не відкривати) — джерело істини у Firebase.

> ⚠️ **Спершу пробували Supabase**, але створення проєкту впиралось у
> «You need additional permissions to create a project» (глюк/ліміт org).
> Тому перейшли на **наявний Firebase проєкт гри** (`horugva-ff8bd`) — той самий,
> що використовує мультиплеєр (`src/firebase.ts`, шлях `lobbies/`). Принцип
> reuse-existing-work. Фінанси пишуть у **окремий шлях `finance/transactions`**,
> грі не заважають. Конфіг Firebase вшитий у `app.js` — користувачу нічого
> вводити не треба, синхрон працює одразу.

## 3. Що було з бекапом 1money

Файл бекапу `1Money_BACKUP_...` виявився **не CSV, а SQLite-базою**.

Структура (ключові таблиці):
- `tr` — транзакції. 195 889 рядків, але це **щоденні копії**: реально
  **8617 унікальних** (`_id`). Кожна копія = окрема «книга» (`_b_i`).
  **Найновіша книга — `_b_i = 4658`** (бери тільки її).
- `de` — категорії І рахунки разом (поле `_ty`):
  - `_ty = 0` → рахунок (джерело)
  - `_ty = 1` → категорія витрат
  - `_ty = 2` → джерело доходу / «вдома лежить»
  - `_ty = 4` → службове («Все счета»)
- `ba` — рахунки (метадані).

Модель — подвійний запис: у транзакції `_a_i` = звідки (source), `_d_i` = куди (dest).
Тип операції визначається парою `src._ty → dst._ty`:

| src → dst | Значення   | К-сть |
|-----------|------------|-------|
| 0 → 1     | Витрата    | 7305  |
| 0 → 0     | Переказ    | 1011  |
| 2 → 0     | Дохід      | 172   |
| 0 → 2     | Повернення | 83    |
| інше      | Інше       | 38    |

Інші поля: `_da` = дата (Unix ms), `_a_m` = сума (TEXT), `_co` = коментар.
Діапазон дат: **2020-01-16 … 2026-06-25**.

### Скрипт конвертації (SQLite → CSV)

```python
import sqlite3, csv
db = sqlite3.connect("1Money_BACKUP_...")
cur = db.cursor()
book = 4658  # найновіша книга

cur.execute(f"""
SELECT
  datetime(t._da/1000,'unixepoch') as date,
  CASE
    WHEN src._ty=0 AND dst._ty=1 THEN 'Витрата'
    WHEN src._ty=2 AND dst._ty=0 THEN 'Дохід'
    WHEN src._ty=0 AND dst._ty=0 THEN 'Переказ'
    WHEN src._ty=0 AND dst._ty=2 THEN 'Повернення'
    ELSE 'Інше' END as type,
  CASE WHEN src._ty=2 AND dst._ty=0 THEN dst._na ELSE src._na END as account,
  CASE WHEN src._ty=2 AND dst._ty=0 THEN src._na ELSE dst._na END as category,
  CAST(t._a_m AS REAL) as amount,
  t._co as note
FROM tr t
LEFT JOIN de src ON t._a_i = src._id AND src._b_i = {book}
LEFT JOIN de dst ON t._d_i = dst._id AND dst._b_i = {book}
WHERE t._b_i = {book}
ORDER BY t._da ASC
""")
rows = cur.fetchall()
with open('1money_export.csv','w',newline='',encoding='utf-8-sig') as f:
    w = csv.writer(f); w.writerow(['date','type','account','category','amount','note']); w.writerows(rows)
```

Результат: **`1money_export.csv`** — 8609 транзакцій, колонки:
`date, type, account, category, amount, note`.

## 4. Архітектура додатка

Чистий статичний фронтенд (HTML/CSS/JS), без збірки. Дані — у Firebase Realtime
Database (`finance/transactions`). Конфіг Firebase вшитий у `app.js`.

### Файли (`/finance/`)
- `index.html` — розмітка всіх екранів (список, форма, налаштування, імпорт, picker).
- `style.css` — темна тема, iOS-стиль, `env(safe-area-inset-*)` для нотча.
- `app.js` — вся логіка (ES-модуль, Firebase через CDN `gstatic.com/firebasejs/12.15.0`).
- `manifest.json` — PWA-маніфест (`display: standalone`, scope `/zagaltsi/finance/`).
- `sw.js` — service worker (offline-кеш оболонки).
- `icons/` — `icon-192.png`, `icon-512.png` (фіолетові плейсхолдери).

### Модель даних (Firebase RTDB)
Шлях `finance/transactions/{pushId}` → об'єкт:
`{ date (ISO), type, account, category, amount (number), note }`.
`type`: `expense | income | transfer | return | other`.
Для переказу `account` = звідки, `category` = куди (рахунок призначення).

> ⚠️ **Firebase rules:** гра пише в `lobbies/`, тож база відкрита на запис.
> Якщо імпорт/збереження раптом дасть permission denied — у Firebase Console →
> Realtime Database → Rules додати для шляху `finance`:
> `{ "rules": { "finance": { ".read": true, ".write": true } } }`
> (не чіпаючи наявні правила гри).

### Ключові деталі реалізації
- Усі транзакції тримаються в пам'яті (`txMap`), фільтр по місяцю — клієнтський
  (навігація по місяцях миттєва, без перезапитів).
- Синхрон через `onChildAdded/Changed/Removed` — початково тягне все один раз,
  далі тільки дельти (економія мобільного трафіку).
- Список згруповано по днях, з денним підсумком; вгорі — підсумки за місяць
  (витрати / доходи / баланс).
- Форма: тип (витрата/дохід/переказ), сума, категорія, рахунок (для переказу —
  «на рахунок»), дата, коментар. Підтримує і **додавання, і редагування**.
- Категорії/рахунки навчаються з усіх синхронізованих даних + `localStorage`
  (`fin_known`); picker з пошуком і додаванням нових на льоту.
- Емодзі категорій — евристика за назвою (`CATEGORY_EMOJI`).
- Імпорт CSV — батчами по 500 через `update()` з push-ключами, прогрес-бар.
- Тап по рядку → кнопки ✎ редагувати / ✕ видалити.

## 5. Деплой

Розміщено в **наявному репо `OstapKutniak/zagaltsi`**, підпапка `/finance/`
(окреме репо створити не вдалось — MCP 403 на створення репозиторіїв).

- Push у `main` → GitHub Actions → GitHub Pages.
- **Жива адреса: https://ostapkutniak.github.io/zagaltsi/finance/**
- Шляхи (`start_url`, `scope`, реєстрація `sw.js`) прив'язані до базового
  шляху `/zagaltsi/finance/`. ⚠️ Якщо переносити в окреме репо/корінь — поправити ці шляхи.

## 6. Інструкція користувачу (2 кроки)

Жодних реєстрацій — синхрон уже вшитий (Firebase гри).

1. **Відкрити:** на айфоні Safari → `https://ostapkutniak.github.io/zagaltsi/finance/`
   → Поділитись → **«На екран»** (стає додатком без адресного рядка).
   Те саме на андройді (Chrome → «Додати на головний екран»).
2. **Імпорт:** у додатку → Налаштування → Імпорт CSV → обрати `1money_export.csv`
   → всі операції завантажуються у Firebase і одразу видно на обох пристроях.

## 7. Статус і можливі наступні кроки

**Готово:** PWA задеплоєна, синхрон через Supabase, імпорт історії, темний iOS-UI.

**Не зроблено / ідеї на майбутнє:**
- Редагування існуючої транзакції (зараз форма редагування є в коді, але кнопка
  редагування зі списку не виведена — тільки видалення).
- Мультивалютність (у 1money були «$», «€», «PLN» рахунки — зараз усе як ₴).
- Баланси по рахунках, статистика/графіки за категоріями.
- Гарні справжні іконки (зараз однотонні плейсхолдери).
- Перенести в окреме репо, якщо не хочеться тримати разом із грою Загальці.

## 8. Технічні нотатки на майбутнє

- Великі файли (`app.js`, `style.css`) не вдалось пушити через `mcp__github__push_files`
  (JSON parse fail на розмірі) — пушились звичайним `git push` з гілки від `origin/main`.
- Робоча гілка фічі: `claude/1money-ios-sync-ae28g1`.
- Локальна копія також була в `/home/user/finance-pwa/` (без `/zagaltsi/` префіксів у шляхах).
