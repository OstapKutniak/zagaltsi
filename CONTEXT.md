# Хоругва / Загальці — Project Context

## Огляд
2D beat'em up із козацькою тематикою. Telegram Mini App (20:9 landscape).  
Репозиторій: GitHub Pages deploy (Vite + TypeScript + Phaser 3).

---

## Стек
- **Phaser 3** + **TypeScript** + **Vite**
- `studio.html` — редактор персонажів/анімацій + редактор рівнів
- `src/level/editor.ts` — логіка редактора рівнів
- `src/level/LevelView.ts` — рендер рівня у грі
- `src/scenes/BootScene.ts` — завантаження текстур (preload)
- `src/scenes/GameScene.ts` — головна ігрова сцена, HUD
- `src/rig/main.ts` — редактор персонажів/риггінгу

---

## Редактор рівнів (editor.ts)

### Шари рендеру (LAYER)
```ts
{ sky: 0, bg: 1, map: 2, decor: 3, collider: 3, interactive: 3, trap: 3 }
```
- `map: 2` — завжди під усіма ігровими ассетами
- Решта категорій (`decor/collider/interactive/trap`) на шарі 3

### Pending asset (перед розміщенням)
- `pendingScale` — колесо миші масштабує
- `pendingRot` — R обертає
- `pendingFlip` — M дзеркалить (1 або -1)
- `pendingTransMode` — режим трансформації
- При кліку на бібліотечний ассет: скидається pathTool, pendingFlip = 1

### Вибір об'єктів
- `hitTest()` — альфа-aware: samples pixel alpha (> 10/255), не bounding box
- `_alphaCache: Map<HTMLImageElement, Uint8ClampedArray>` — кеш альфа-каналів

### Паралакс
- Зберігається в `level.parallax: Record<string, number>` (0..1), 5 шарів: sky/clouds/bg/frontbg/foreground
- 0 = рухається разом з картою, 1 = нерухоме (фони) / 2× швидше (передній план)
- Defaults: `{ sky:0.85, clouds:0.7, bg:0.5, frontbg:0.25, foreground:0.35 }`
- UI: **випадайка `#lv-parallaxLayer`** (5 шарів) + слайдер «Дальність» у `#lv-levelToolbar`
- В грі: `setScrollFactor(layerScrollFactor(cat,dist), 1)` (фони 1−dist, передній план 1+dist)
- **Анкер паралаксу = лінія «початок» рівня, НЕ світовий 0.** Phaser центрує паралакс на scrollX=0,
  тож на рівні зі `start≠0` фон зсувався б уже на старті. `LevelView` зсуває світову X шару на
  `start·(1−sf)` → при scrollX=start шар стоїть рівно там, де намальований у редакторі (плоско).
  Фініш-гайди в `editor.ts` рахуються від того ж анкера.

### Наповнення (fillBtn)
- ЛКМ → розкриває 7 inline-кнопок у `#lv-fillLayers` під кнопкою
- ПКМ → відкриває viewport меню (як раніше)

---

## LevelView.ts (гра)
```ts
const LAYER = { sky: -1200, bg: -1100, map: -1000, decor: -300, interactive: -250, trap: -250 };
const PARALLAX_FALLBACK = { bg: 0.5, sky: 0.8 };
// for bg/sky: im.setScrollFactor(Math.max(0, 1 - dist), 1)
```

---

## HUD (GameScene.ts)
- Іконки: `hud_heart` (HP.png), `hud_sun` (Pain.png), `hud_skull` (Tryvoga.png)
- Файли в `public/ui/` — білі іконки на прозорому фоні
- Розмір відображення: 46×46px
- Завантаження в `BootScene.preload()`
- **⚠️ Зум суперсемплінгу + scrollFactor(0):** камера має `setZoom(RENDER_SCALE)`, а Phaser масштабує
  й нерухомі (sf=0) об'єкти навколо центру камери → на рівні зі start≠0 HUD виїжджав за екран.
  Фікс: `uiOffX/uiOffY = logicalW/H·(RENDER_SCALE−1)/2` додаються до позицій усіх sf=0 UI
  (HUD/banner/ендгейм-тексти). **Новий sf=0 елемент → ОБОВ'ЯЗКОВО додай uiOffX/uiOffY.**

---

## Колайдери (ізоґратка)
- Підлога = ізо-ґратка клітинок з рівнями висоти
- Стіни = авто-грані між клітинками різної висоти
- Гравець впирається в стіни / застрибує на платформи
- Старий v-стіна механізм видалено
- Футпринт ассета авто-вирізає клітинки з прохідної підлоги (помаранчеві). Іноді скейлиться погано →
- **Зелений ручний колайдер прохідності** (`#lv-walkBtn`, хоткей **4**): малюй зелені клітинки поверх
  вирізу — формат у `collider` = `"cx,cy,g"`. У грі `greenCells` знімають блок (`blockedCells.delete`)
  і гарантують підлогу. Колесо = пензель; Erase (Y) стирає й зелені.

## Вікно колайдерів ассета (ПКМ по картці)
- Випадає **праворуч від бібліотеки** (`lib.right+8`), права грань під кнопкою «Редактор Інтерфейсу»
  (`#topTabs button[data-soon]`). `openFootprintEditor` в `editor.ts`.

---

## Спавн ворогів
- Зони спавна: `enemySpawns: string[]` — рядки `"cx,cy"` або `"cx,cy,enemyId"` (кут 3×3 клітинок)
- Кнопка «Прибрати спавн ворогів» у тулбарі
- `npcLib: LibItem[]` — завантажується з бібліотеки персонажів, фільтр `cat === 'enemy'`
- `npcTinted: Map<string, HTMLCanvasElement>` — кеш червоних тонованих мініатюр для оверлея зони
- `npcImages: Map<string, HTMLImageElement>` — кеш зображень для ghost при виставленні

### Режим виставлення ворога (pendingEnemy)
- `state.pendingEnemy: string | null` — id ворога що виставляється
- ЛКМ на картці NPC → `pendingEnemy = id`, картка обводиться помаранчевим (`.npcCard.pending`)
- Білий силует (80px * sc()) слідує за курсором
- При наведенні на зону спавна — яскравіша підсвітка (`rgba(255,40,40,0.55)`, рамка 3px)
- ЛКМ на зоні → записує `"cx,cy,enemyId"`, режим залишається (можна ставити далі)
- ЛКМ поза зоною або ESC → скасовує режим

---

## Кооп-спавн
- `spawns?: { x, y }[]` — до 5 точок
- `spawn` = `spawns[0]` для сумісності

---

## Що обговорювалось / майбутнє

### Анімація персонажів
Поточний стан: cutout-анімація (жорсткі PNG-частини на кістках).  
Референси для майбутнього стилю: Darkest Dungeon, Wulverblade, Don't Starve, Valiant Hearts.

**Два шляхи:**
1. **Покадрова анімація** (Darkest Dungeon / Wulverblade) — кожен кадр малюється окремо як спрайтшит. Найвища якість але зовсім інший піпелайн для художника.
2. **Покращений cutout** (Don't Starve / Valiant Hearts) — правильні перекриття, товсті контури, ланцюги кісток для органічних елементів (хвости, волосся тощо).

**Spring-кістки (наступна фіча для обговорення):**
- Кістка з `spring: { stiffness, damping }` — "відстає" від руху батька (інерція)
- Для хвостів, волосся, одягу що рухається органічно
- Не потребує меш-деформації чи вейтів
- Ланцюг 5-10 коротких кісток + spring-симуляція в режимі відтворення
- Don't Starve використовує саме такий підхід для хвостів/appendages

**Stretch-to-bone** — розтягування спрайта між двома кінцями кістки. Дає гумовий мультяшний вигляд (Rayman-стиль), не підходить для козацького стилю.

**Mesh деформація з вейтами** — потребує WebGL, радикальна переробка рендеру. Не плануємо.

---

## Deploy
GitHub Pages через Vite build.  
При пуші на `main` → автодеплой.

---

## AI генерація (працює локально)
- `.env` в корені проєкту (не в git): `VITE_FAL_KEY`, `VITE_LEONARDO_KEY`, `VITE_OPENAI_KEY`
- Доступ в коді: `import.meta.env.VITE_FAL_KEY` (інлайниться Vite на ЕТАПІ БІЛДУ)
- `src/ai.ts`: `generateGameAsset()` — промпт(+опц.реф) → FLUX (`flux/dev`) → виріз фону (BiRefNet) → dataURL.
  `STYLE_PREPROMPT` — ЧЕРНЕТКА під козацький стиль (фіналізувати).
- **Редактор рівнів** (`#lv-aiGenBtn`): wireAiGenerate() — клік → generateGameAsset → imgSrcToWebP →
  додає Asset у бібліотеку під ПОТОЧНОЮ категорією (`state.cat`) → refreshAssets+save. **Повністю робоче.**
- Drop zone: `.ai-drop-zone`, ПКМ очищає реф.
- **Деплой (github.io) — через ПРОКСІ** (щоб не світити ключ): `ai.ts` дивиться на `VITE_FAL_PROXY`
  (URL воркера). Заданий → виклики йдуть на воркер `{model, body}`, ключ Fal на сервері. Не заданий →
  прямий виклик із `VITE_FAL_KEY` (локальна розробка). Воркер: [`serverless/fal-proxy.worker.js`](serverless/fal-proxy.worker.js)
  (Cloudflare Worker, кроки в коментарях). `deploy.yml` інжектить `VITE_FAL_PROXY` із repo VARIABLE (не secret — це URL).
- ⚠️ **Лишилось для увімкнення на деплої:** (1) підняти воркер за інструкцією у файлі вище, додати repo
  variable `VITE_FAL_PROXY`, поставити ЛІМІТ витрат у Fal; (2) фіналізувати стиль-промпт (`STYLE_PREPROMPT`).

---

## Важливі домовленості
- Локальні видалення файлів у `zagaltsi/` — навмисні, не питати і не нагадувати
- `$('id')` в editor.ts = `document.getElementById('lv-' + id)`
- Анімації поточні — тимчасові, потім переходимо на більш плавні
