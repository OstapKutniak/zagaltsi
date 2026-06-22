---
name: ""
metadata: 
  node_type: memory
  originSessionId: a5f6e7ed-4cbd-4c4c-9d53-46cc317e32dd
---

**Що:** «Загальці» — гумористичний 2D **beat 'em up / бітемап** (Telegram Mini App), стиль Golden Axe / Battletoads / Streets of Rage — НЕ платформер. Вид збоку з глибиною: рух по "стрічці" підлоги у 8 напрямках (X + Y-глибина), сортування по глибині, стрибок = окремий підскок із тінню, бій із хвилями ворогів (камера-арена блокується, зачистив — далі). Сюжет: 5 хлопців із села Загальці пробиваються через село до магазину по пиво. 5 персонажів, у кожного свої скіли/пасивки; гравець обирає персонажа. Кооп 2-3 гравці — рідний формат жанру.

**Стек:** Phaser 3 + TypeScript + Vite, Arcade Physics (fixedStep). Збереження прогресу — Telegram CloudStorage (fallback localStorage). Без сервера/БД (мультиплеєра й монетизації немає).

**Архітектурне рішення:** будуємо одиночну гру, але код тримаємо "multiplayer-ready" (симуляція окремо від рендера, фіксований крок фізики, ввід оформлений як команди в [[core/input]]). Мультиплеєр — реальне "можливо": кооп реального часу на 2-3 гравці в одній локації одночасно. Коли дійдемо — окремий WebSocket-сервер (клієнт не ламається; сервер деплоїться окремо, тож хост статичного клієнта не обмежує вибір). Монетизації НЕ буде — не пропонувати.

**Стилістика:** як Don't Starve — рвана чорнильна лінія, високий контраст, приглушена палітра з акцентами, маріонеткова скелетна анімація. DS зроблено саме в Spine → наш вибір Spine підтверджено. Беремо техніку, НЕ камеру (DS — 3/4 згори, у нас сайд-скрол платформер). PSD-шари персонажа = слоти/аттачменти Spine.

**Арт-пайплайн:** користувач — досвідчений дизайнер/3D/анімація (НЕ програміст), розуміє движки. Кода пише Claude, користувач керує напрямком і дає ассети. Spine для героїв. ВАЖЛИВО: бінарні .psd я не парсю — користувач експортує шари в PNG, я даю схему рігу/кісток/атласів.

**Проєкт:** D:\Hobby\Claude\zagaltsi. Зібрано вертикальний зріз бітемапу з плейсхолдерами. `npm run dev` → localhost:5173.

**Деплой/хостинг:** GitHub репо https://github.com/OstapKutniak/zagaltsi (публічний, гілка main). Автодеплой через GitHub Actions (.github/workflows/deploy.yml) на GitHub Pages при кожному push у main. Жива гра: https://ostapkutniak.github.io/zagaltsi/ — ОНОВЛЕННЯ = git push (Claude комітить і пушить, ~1 хв і онлайн). GitHub username: OstapKutniak. gh CLI авторизований (scopes: repo, workflow, read:org, gist). Vite base:'./' — працює на підшляху /zagaltsi/.

**Ріг персонажів:** рішення — НЕ Spine, а власна легка веб-тулза. Жива: https://ostapkutniak.github.io/zagaltsi/rig.html (rig.html + src/rig/main.ts, vanilla TS + Canvas2D). 

ВАЖЛИВО — тулза переосмислена за вимогою користувача як **КОНСТРУКТОР ПЕРСОНАЖА** (character creator), НЕ редактор кісток із таймлайном:
- чорний МАНЕКЕН із пропорціями Остапа (профіль, обличчям праворуч);
- 6 СЛОТІВ під PNG (цілі кінцівки, без дроблення): head, torso, arm_back, arm_front, leg_back, leg_front;
- кожну частину: вибрати (чіп або клік), Поворот, Розмір, перетягнути, кнопка "Тицьнути півот" (клік ставить pivot на картинці); колесо — зум;
- бігунки ПРОПОРЦІЙ: Загальний/Голова/Торс/Руки/Ноги (рухають скелет/манекен);
- ☑ показувати півоти й манекен; чистий нейтральний UID (не райдуга).
- Вшито кеїнг фону (src/rig/keyer.ts) для PNG, що кидають із фоном.
- Export: ostap_character.json = {version:2, proportions, slots:{key:{image,pivotX,pivotY,rot,scale,dx,dy}}} — це BIND-ПОЗА.

**Принцип анімації (важливо):** у 2D нема Mixamo. Наш аналог — ОДИН стандартний скелет (6 слотів однакові на всіх 5 персонажів) + ПРОПОРЦІЇ на персонажа (бігунки). Анімація зберігається як ОБЕРТАННЯ кісток (+малі зсуви) у часі, тож вона ПРОПОРЦІЙНО-НЕЗАЛЕЖНА: більший/вищий персонаж = ті самі кути на довших кістках, хода ретаргетиться сама (як у 3D). Для радикально інших пропорцій — можна перекрити анімацію для конкретного персонажа.

**Тест-анімації в тулзі (готово):** процедурні idle/walk/run/jump (синусні гойдання кінцівок) — перемикач "Перевірка руху", грають на слотах, перевіряють ріг/півоти, працюють на будь-яких пропорціях. Це НЕ фінал — таймлайн із ключами додамо ПІЗНІШЕ поверх тих самих слотів (процедурка = старт). Старий src/rig/format.ts (RigDoc із clips) — застарілий, тулза не імпортує.

**Гарячі клавіші тулзи (ev.code, незалежно від розкладки):** G рух, R поворот, S розмір (Blender-стиль: натиснув→веде за мишею, клік=ок, Esc/ПКМ=скасувати), Q півот, M дзеркало по X (flip), Ctrl+Z undo. Орієнтир-силует (чіп "🎯 Орієнтир") — теж трансформовний G/R/S, завантажується юзером (Claude не відтворює силует пікселями).

**Пайплайн тулза→гра (готово):** тулза Export → самодостатній character.json {version:3, proportions, slots, images(base64)}. Гра: src/anim/CutoutCharacter.ts (Phaser Container) читає public/character.json, малює зібраного персонажа замість прямокутника, програє ту саму процедурну анімацію за рухом гравця (walk/idle/jump). GameScene.fetch BASE_URL+character.json; нема файлу або без images → лишається прямокутник. CHAR_SCALE=0.3 (одиниці тулзи→ігрові px), позицію/розмір підкрутимо після першого показу. Розріз/згин (cut/bend) у грі поки НЕ рендериться (цілі кінцівки).

**Зручності тулзи:** автозбереження поточної збірки в localStorage (ostap_char); релінк картинки без скидання трансформів (drag PNG, чия назва вже в слоті); панорама (затиск середньої кнопки); бібліотека персонажів у localStorage (ostap_library, ліва панель, Save Character + мініатюри + load/delete).

**СТАТУС:** Остап УЖЕ в грі — public/character.json (v3, 950КБ, з картинками) задеплоєно, CutoutCharacter малює його замість прямокутника. Оновлення = новий Export → замінити public/character.json → push.

**Тулза — facing toggle (готово):** кнопка «↔ Дивиться» дзеркалить усю сцену (scale -1 навколо origin.x) + ввід інвертується (mirrorX), тож згини анімації самі гнуться в інший бік. state.facing (поки НЕ експортується — гра і так фліпає за рухом).

**Зроблено пізніше:** розмір у грі нормалізується до TARGET_PX=410 (×overall); кадр — Phaser FIT 1280×576 (як на телефоні + чорні поля-леттербокс, main.ts; bg #000 у index.html; viewport.ts ротація+refresh). Анімації: walk/run/idle/jump(із присіданням)/attack(присів→замах→удар)/hurt(відхил+руки+ЧЕРВОНИЙ спалах tint). Player.isInAttack/isHurt керують вибором у GameScene. Бібліотека тулзи — ВКЛАДКИ «Персонажі»/«Вороги» (libCat, LibItem.cat); той самий редактор. Дві кнопки напряму: «Перевернути арт» (facing, дзеркалить+експортується) і «Хода в бік» (animDir, лише напрям анімації). character.json має поле facing; гра scaleX = рух * docFacing.

**Масштаб/керування (актуальне):** Scale.NONE + viewport.ts (нативне розширення = чітко; мобілка фулскрінитья+ротація). FIT-кадр НЕ робити — ламав мобілку (Phaser міряє CSS-rotated bounds) і давав апскейл-блюр. Керування: віртуальний ДЖОЙСТИК (#stick/#stickKnob у index.html; input.ts bindJoystick з ремапом осей під поворот сцени) замість 4 кнопок; Shift=біг (cmd.run, швидкість ×1.7, анім 'run'); кнопки удар/стрибок праворуч. "Телефонний кадр на ПК + чорні поля" — ВІДКЛАДЕНО (треба зум камери + окремий шар/сцена HUD, бо зум ламає scrollFactor-0 HUD).

**СХОВИЩЕ = IndexedDB (ВАЖЛИВО, не localStorage!):** base64-картинки не влазять у localStorage (~5МБ → «переповнення сховища»). Усе велике через src/shared/idb.ts (idbGet/idbSet, спільна БД 'zagaltsi' store 'kv', сотні МБ). Ключі: zag_game_char (персонаж у гру), zag_level (рівень у гру), zag_levels+zag_assets (рівні редактора), ostap_library (бібліотека персонажів). Гра й тулзи читають idb ПЕРШИМ, з фолбеком на старий localStorage та public/*.json. Є одноразова міграція старих localStorage-даних. НЕ повертати localStorage для картинок.

**Export у гру (готово):** тулза кнопкою «Export у гру» пише buildDoc() у IndexedDB 'zag_game_char' (той самий домен). GameScene читає 'zag_game_char' ПЕРШИМ, інакше fetch public/character.json. Дає користувачу оновлювати персонажа в грі без git/Claude (на тому ж браузері). Блок «Пропорції» в тулзі ПРИБРАНО (state.prop лишається в даних, але без UI — не скидати значення!). Додано лінію землі (y=-4+BASE.legs*legs) і центрування камери (divisor 470, origin.y 0.55).

**ІЄРАРХІЯ КІСТОК (ГОТОВО, ітерація 1):** і в тулзі (src/rig/main.ts), і в грі (CutoutCharacter). PARENT: torso=корінь; neck/arm_*/leg_*→torso; head→neck. conn(sel) = точки кріплення (=старі joints, тож bind-позиції збереглися: при rot=0 нічого не з'їхало). worldOf(sel) рекурсивно компонує трансформи; drawImageAt/curLocal/drag/applyMode враховують поворот батька. animRoot тепер лише на torso (розходиться на дітей). Додано слот 'neck' (BASE.neck=26, len:'neck'). Прибрано joints()/baseUnit/SLOT_DEFS.joint. composeThumb теж на ієрархію.

**НАСТУПНА ІТЕРАЦІЯ (2): ТАЙМЛАЙН-РЕДАКТОР анімацій у тулзі знизу: вибір кліпу, скрол кадру, поза+K=ключ (знімок поз слотів rot/dx/dy/scale/bend), Reset Animation, Replace Animation, мульти-вибір ключів (Shift)+«звʼязати» (заповнити проміжні) по linear/smooth; програвання АВТОРСЬКИХ ключів замість процедурних (процедурні лишити фолбеком); експорт цих кліпів у character.json + програвання в грі (CutoutCharacter інтерполює ключі). Користувач сам робитиме анімації.

**ТАЙМЛАЙН (ГОТОВО, ітерація 2):** у тулзі знизу (#timelineBar). state.clips: Record<clip,{duration,keys:[{t,interp:'linear'|'smooth',pose:Record<slot,{rot,dx,dy,scale,flip,bend}>}]}>. setup=bind-поза (поки редагуєш кліп). eff=tf (слоти=джерело пози; таймлайн пише семпл у слоти через loadFrame). K=ключ(знімок поз), Reset(очистити), «Запекти базову»(процедурна→8 ключів), Shift-клік ключів + Лінійно/Згладжено(interp), ▶ програвання. Експорт у character.json (version:4, +clips). Гра CutoutCharacter грає authored кліп якщо є keys (sampleClip), інакше процедурний. Фікс: bend дзеркальної кінцівки (flip<0) інвертується. ФІКС «анімація не обиралась/не грала»: у change-обробнику #anim треба читати v=select.value ДО play(false) — бо play()→refreshTimeline скидав select.value=state.anim(null)='' раніше, ніж код встигав прочитати, тож state.anim лишався null і ▶ був пустишкою.

**РЕДАКТОР РІВНІВ (ГОТОВО v1):** level.html + src/level/main.ts (3-я сторінка, vite input level). Зліва список рівнів(localStorage zag_levels)+налаштування; центр доріжка; праворуч бібліотека по категоріях (sky/bg/map/decor/collider/interactive/trap, LAYER порядок). Ассети(PNG dataURL) у localStorage zag_assets, drag-drop на канвас→Placed{cat,asset,x,y,rot,scale,flip}. G/R/S/M, J=снеп до краю сусіда, Del, пан/зум. Колайдер=булеві клітини-квадрати (paint/erase, grid). Export рівня JSON. setStatus (не status — конфлікт із window.status). ДОДАНО: Ctrl+Z (undoStack JSON-знімків state.levels, pushUndo перед мутаціями); унікальний id Placed через лічильник newPlacedId() (Date.now() сам дублювався при швидкому повторному кліку → «не можна поставити той самий тайл двічі»); маркери spawn/start/end ТЯГНУТЬСЯ (markerDrag: detect proximity у mousedown, оновлення в mousemove); img.draggable=false на ассет-мініатюрі (тягнемо контейнер).

**РІВЕНЬ→ГРА (ГОТОВО v1):** редактор: Export у гру (localStorage zag_level), маркери spawn/start/end (кнопки setSpawn/setStart/setEnd→клік ставить; малюються прапорець+лінії). buildLevelDoc {placed,collider,grid,spawn,start,end,assets(embedded)}. Гра: src/level/LevelView.ts buildLevelView малює ассети на шарах (LAYER sky..trap, depth<акторів); GameScene.applyLevel: levelMode=true, ховає плейсхолдер-поле, player.minX/maxX+spawnAt, camera.setBounds(start..end); читає zag_level або public/level.json. У levelMode демо-хвиля/ворота/ціль вимкнені. Player.minX додано.

**TODO далі:** колайдер ОБМЕЖУЄ рух у грі (зараз лише візуал-квадрати); пастки дамажать; інтерактив; вороги з бібліотеки в гру; рендер cut/bend у грі; кілька розрізів; дороблення анімацій (користувач паузнув таймлайн); (1) (стара нотатка) РЕДАКТОР РІВНІВ — окрема сторінка-тулза (бібліотека-блоки: модулі карти(великий тайл, замінює поле)/колайдери(камені,дерева)/інтерактивні(калюжі,сундуки)/пастки(дамажать)/ФОНОВІ АСЕТИ(за полем)/ДЕКОРАЦІЇ(на дорозі, не впливають)/НЕБО(на весь, останній шар); панель налаштувань ліворуч; та сама навігація пан+G/R/S/M/Q); накидати рівні як персонажів. (1b) кадр-на-ПК через зум+UI-шар. (2) Підтягувати ВОРОГІВ із бібліотеки в гру (як персонажа). (3) кілька розрізів на кінцівці; (4) слот ШИЇ з pivot до тулуба; (5) рендер розрізу/згину в ГРІ (зараз цілі кінцівки); (6) тюнінг розмірів/анімацій за фідбеком.

**Перший персонаж:** Остап — у стилі Don't Starve (DS-портрет-рамка). Джерело: Characters/Ostap/Rig_Parts/source/Sheet.png (1536x1024, рівний сірий фон 111,109,110) + Concept.png. Аркуш — це ВИДИ + пози (фас/профіль/потилиця голови; цілі руки в позах; ноги пари+окремі+фази кроку), а НЕ ізольовані сегменти кістки (нема окремо плече/передпліччя) — тож для згину ліктя/коліна або жорсткі цілі кінцівки, або домалювати сегменти.

**Вирізання фону (РОБОЧИЙ метод):** scripts/extract_parts.mjs (Node + sharp). Метод як у Blender-аддона BlenderAIReplace (архів лежав у корені репо) для FLAT-фону: колор-кей із "тестом плоского острова" — прибираємо зв'язні області кольору фону, де >=FLAT_FRAC(0.6) пікселів точний фон (TIGHT_TOL=8); так зникають і зовнішнє "море", і ЗАМКНЕНІ кишені (діра у волоссі, між ногами), а текстурована майже-сіра шкіра лишається (без дірок). + ерозія краю 2px проти ореолу + м'яке покриття 3x3. БЕЗ despill (псував тонке волосся). НЕ глобальний поріг (дірявить шкіру), НЕ flood-від-країв (лишає кишені). Аддон мав ще rembg (ML, isnet-general-use) — для складного фону, у браузер не вшити. Вивід: Rig_Parts/_auto/part_NNN.png + _overview.png; потім перейменовано в змістовні назви (head_*, torso_*, arm_1..9, leg_*, eye_*).

**TODO незначне:** workflow юзає actions на Node 20 (deprecation попередження, не блокує) — за бажанням бампнути версії пізніше.

**Середовище:** Windows. Node v24.16 LTS (поставлено через winget), npm 11.13, Git 2.54. PATH у нових PowerShell-сесіях може не містити node — за потреби: `$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')`.

---

## ОНОВЛЕННЯ (2026-06)

### Таймлайн: редагування ключів (src/rig/main.ts)

- **Drag ключів по часовій осі:** `makeDot()` приймає `Keyframe`; `beginKeyDrag(clientX, primary)` захоплює `{k, t0}` для всіх виділених ключів; глобальний `mousemove` зрушує час, `mouseup` ресортує `clip.keys` і ремапить `selKeys` за об'єктною ідентичністю.
- **Box-selection:** кліп на порожньому місці треку → малюється `boxEl` (fixed-div); `selectKeysInBox(x1,y1,x2,y2)` читає `dataset.ki` у `.keyDot` і виділяє ключі.
- **Clipboard (Ctrl+C/V):** `keyClipboard: Keyframe[]`; паст вставляє відносно `tlHoverFrame` (курсор над таймлайном); Ctrl+C/V спрацьовують лише якщо `tlHoverFrame !== null`.

### Конструктор (src/ui-constructor.ts) — різні схеми кодів

Редактор рівнів і редактор персонажів більше не перетинаються:
- **Рівні:** блок = літера (`A`, `B`, …), кнопка = літера+цифра (`A1`, `B3`).
- **Персонажі:** блок = цифра (`1`, `2`, …), кнопка = цифра+літера (`1A`, `2C`).
Детектується за видимістю `#lv-levelToolbar | #levelToolbar`.

### Редактор рівнів — зони спавна ворогів

**Toolbar C (bottom):** кнопки `enemySpawnBtn` / `enemyEraseBtn` (ids з prefix).
- Клік «Спавн ворогів» → `state.pathTool = 'enemy'` → `enemyAt(sx,sy)` записує зону у `Level.enemySpawns: string[]` як `"cx,cy"` (підлогова ізо-ґратка 3×3, кут = клітинка - 1).
- Клік «Прибрати спавн ворогів» → `pathTool = 'enemyErase'` → фільтрує зони під курсором.
- **Зона → гра:** `GameScene` читає `doc.enemySpawns`, для кожної зони спавнить `Enemy` у детерміновано-випадковій точці (синусний хеш `rnd(a,b)=frac(sin(a·127.1+b·311.7)·43758.5453)` — однакові результати у всіх кооп-клієнтів без синхронізації).
- **Формат:** `"cx,cy"` або `"cx,cy,enemyId"` (3-й сегмент — id ворога з бібліотеки персонажів). Порожня зона = крапка, зона з ворогом = тонована червона мініатюра.
- `clearCollider` тепер очищує також `enemySpawns`.
- Захист від виродженого канвасу: `if (!Number.isFinite(fcx) || !Number.isFinite(fcy)) return` у `enemyAt()`.

### Редактор рівнів — ізо-ґратка колайдерів (ВАЖЛИВО для консистентності)

Та сама формула у draw, paintAt (інверсія), GameScene (walkableAt), зонах ворогів:
- `k = gs * Math.SQRT1_2`
- Підлога: `P(cx,cy) = toScreen(cx*gs + cy*k, cy*k)` ; інверсія: `fcx = floor((wx-wy)/gs), fcy = floor(wy/k)`
- Стіна: `P(cx,cy) = toScreen(cx*k, cx*k + cy*gs)`
- **НЕ** міняти цю формулу — будь-яка зміна ламає сумісність між draw/editor/game.

### Редактор рівнів — права панель (src/level/editor.ts + studio.html + level.html)

Три **zgортувані секції** (клас `secToggle` / `secBody`, `wireSection(headId, bodyId)`):
1. **Рівні** (`secLevels` / `bodyLevels`) — розгорнуто при старті. Містить: `＋ Новий рівень`, grid карток рівнів, `Зберегти рівень`.
2. **Налаштування** (`secSettings` / `bodySettings`) — закрито. Містить: `Наповнення` (fillBtn), `Плановість` (planToggle → згортає/розгортає planPanel).
3. **Неігрові персонажі** (`secNpc` / `bodyNpc`) — закрито. Містить: дві кнопки-перемикачі `npcEnemyBtn` / `npcNeutralBtn` (Вороги / Нейтрали) + `npcList` (grid карток).

**«Наповнення» flyout** — список категорій у правій частині вьюпорта (fixed position): ширина як таб B5 («Редактор Історії»), верх врівень з `addLevel` (`＋ Новий рівень`). `positionFillMenu()` ставить `fixed; left = stage.right - w - 16; top = addLevel.getBoundingClientRect().top`.

**«Плановість»** — кнопка-заголовок `planToggle`; натиск згортає/розгортає `planPanel` (Фонова / Ігрова перемикачі). Ігрова плановість — два `<button disabled>` заглушки, контент визначить пізніше.

**Неігрові персонажі:**
- `npcEnemyBtn` / `npcNeutralBtn` — дві кнопки-тогл (замість select), клас `on` на активній. `setNpcCat(cat)` оновлює `npcCatVal: 'enemy'|'neutral'` і перемальовує список.
- `renderNpc()` — якщо `npcCatVal === 'neutral'` → «Нейтрали — поки заглушка»; якщо `enemy` → картки (`npcCard`) з бібліотеки персонажів (filter `cat === 'enemy'`), `draggable=true`.
- Drag ворога з бібліотеки → `dragstart` пише `text/enemy-id`; `canvas drop` знаходить зону під курсором, записує `"cx,cy,id"`, зберігає в IDB, перемальовує.
- **Тонована мініатюра** (`buildNpcTint`): `source-atop` compositing → `rgba(220,30,30,0.72)` поверх непрозорих пікселів → кеш у `npcTinted: Map<id, HTMLCanvasElement>`. Малюється у `draw()` на центрі зони.
- `loadCharLibrary()` — `src/charlib.ts` (merges remote `studio-data/char-library.json` + local IDB `ostap_library`). `LibItem { id, name, cat:'char'|'enemy', doc, thumb }`.

**Toolbar C (studio.html):** `lv-spawnInfo` span прибрано (зайвий лічильник спавнів). В level.html його ніколи не було.

---

### AI-генерація ігрових ассетів (src/ai.ts) — АРХІТЕКТУРА + ПРОМПТ

**Модель:** `gpt-image-1` (OpenAI) через `/v1/images/generations` (text-to-image). `/images/edits` ПРИБРАНО НАЗАВЖДИ — він намертво прив'язується до реалістичних пропорцій та деталізації вхідного фото (навіть при стилізувальному промпті виходить фото-реалістичне), що суперечить стилістиці гри.

**Ключ:** `VITE_OPENAI_KEY` у `.env` локально; на деплої — Cloudflare Worker-проксі (`VITE_FAL_PROXY`). Ключ у бандл не потрапляє. `hasFalKey()` перевіряє одне або інше.

**Пайплайн:**
1. Користувач вводить текстовий промпт (необов'язково) + може кинути реф-зображення (необов'язково).
2. Якщо є реф БЕЗ тексту → `describeImageSubject(dataUrl)` → `gpt-4o-mini` vision (`/v1/chat/completions`) описує ЛИШЕ СЮЖЕТ (10–15 слів: «що це і яка форма», без кольорів/стилю/фону). Реф у `/generations` НЕ потрапляє.
3. Якщо є реф І текст → використовується тільки текст (реф ігнорується, не йде в API).
4. `subject + STYLE_*` → `openaiImage(prompt)` → `/v1/images/generations` → прозорий PNG (base64).

**`describeImageSubject` промпт для gpt-4o-mini:**
```
Describe only the main object or subject in this image in 10-15 words.
Focus on what it IS and its general form/shape.
No style, no colors, no background — just the subject itself.
```
Увага: локально `gpt-4o-mini` доступний тільки якщо є `VITE_OPENAI_KEY`. На деплої (лише проксі без ключа) опис недоступний — тоді якщо реф без тексту → fallback `'folk horror environment prop'`.

**Базовий стиль (`STYLE_BASE`) — точний рядок промпту:**
```
video game 2D sprite, Ukrainian folk dark fantasy setting,
Darkest Dungeon 1 original art style: aggressive crosshatching and hatching,
thick uneven black ink outlines,
near-monochrome desaturated palette — charcoal black, ash grey, aged parchment yellow —
muted rust-red accents only,
NO bright colors, NO saturated greens, NO vivid blues or teals,
colors almost completely washed-out and aged,
dark oppressive grim atmosphere, high contrast with deep shadow regions and pale highlights,
isolated on plain flat solid neutral gray background, no parchment texture behind subject, no cast shadow on ground, no text, no watermark
```

**Персонажний (`STYLE_CHAR`)** = `STYLE_BASE` + `', full body character, front-facing or slight 3/4 view, even ambient lighting'` — рівне освітлення, бо спрайт перевертається по X.

**Пропний (`STYLE_PROP`)** = `STYLE_BASE` + `', environment prop or decoration, lit from upper-left, darker right and bottom edges of the object'` — фіксоване освітлення для узгодженості з'яви у сцені.

**Розмір:** `1024x1024`.

**Контекст генерації (`context` у `GenOptions`):** `'char'` → `STYLE_CHAR`; `'prop'` → `STYLE_PROP`. Редактор персонажів передає `'char'`, редактор рівнів — `'prop'`.

**Що не вийшло й чому:**
- Реалістична фотка церкви як реф + `/images/edits` → результат мав реалістичну архітектуру і надто деталізований рендер; промпт-тюнінг не допоміг (endpoint сам обмежений).
- Рішення: повністю відмовитись від `/images/edits`; тільки `/generations`; реф → лише джерело тематики для `gpt-4o-mini`, не вхід для дифузії.
- Стиль DD1 потребує явної заборони (`NO bright colors`, `NO saturated greens`...) — без заборон модель підмішує барвистість.
- `colors almost completely washed-out and aged` — ключова фраза для обезбарвлення.
- `isolated on transparent background` → **НЕ ВИКОРИСТОВУВАТИ** з `gpt-image-1` через API. Модель не генерує справжню RGBA-прозорість через raw API (ChatGPT-інтерфейс робить це через внутрішній пайплайн). При цій фразі модель малює пергаментний ореол навколо об'єкта (DD1-стиль сам по собі пергаментний), який `remove.bg` не може чисто зняти. Замінено на `isolated on plain flat solid neutral gray background` — рівно-сірий фон чисто знімається `remove.bg`.

**Cloudflare Worker (`serverless/openai-proxy.worker.js`):** воркер НЕ деплоїться автоматично через GitHub Actions — оновлюється вручну через dash.cloudflare.com → Workers & Pages → horugva → Edit code. `OPENAI_KEY` і `REMOVEBG_KEY` (Secret) мають бути в Settings → Variables and Secrets. Пайплайн воркера: `gpt-image-1` (quality:high) → `remove.bg` (`image_file_b64`, size:regular) → прозорий PNG base64. Якщо `REMOVEBG_KEY` відсутній або `remove.bg` впав → fallback: оригінал без вирізу.

**TODO стилістика:** стиль ассетів, що генеруються, ще не відповідає DD1. Промпт потребує тюнінгу — заплановано.

**Де кнопка Gen:**
- Редактор персонажів desktop: `#aiGenBtn` (textarea `#aiPrompt` + ref drop `#aiRefDrop`).
- Редактор персонажів mobile: `#mob-char-aiGenBtn` (text input `#mob-char-aiPrompt` + ref `#mob-char-aiRefDrop`); при натиску синхронізує значення у desktop-поля і тригерить desktop Gen.
- Редактор рівнів desktop: `#lv-aiGenBtn` (textarea `#lv-aiPrompt` + ref `#lv-aiRefDrop`).
- Редактор рівнів mobile: `#mob-aiGenBtn` (text input `#mob-aiPrompt` + ref `#mob-aiRefDrop`); аналогічно синхронізує у `#lv-*`.

---

### Touch-жести (мобільний UX) — rig + level canvas + fpModal

**Rig canvas (`src/rig/main.ts`):**
- 1 палець = вибір/тягнути кістку.
- 2 пальці = **пан** (тільки, без пінч-зуму).
- **Подвійний тап** (< 300мс, без перетягування між) → **ПЕРЕМКНУТИ режим зуму** (`_zoomMode`). Режим зуму персистентний: лишається після підняття пальця, аж до наступного подвійного тапу або 2-пальцевого дотику. У режимі зуму: тягнути вниз = зум ін, вгору = зум аут (`Math.pow(1.8, delta/150)`). 2 пальці завжди виходять із режиму зуму.
- `_lastTapWasDrag`: захист від хибного подвійного тапу після тягнення кістки.

**Level canvas (`src/level/editor.ts`):**
- Ідентична схема: `_lvZoomMode` (persistent double-tap toggle), `_lvLastTapTime`, `_lvLastTapWasDrag`.
- 2 пальці = **пан** (без пінч-зуму, `touchPanActive`).
- `state.zoom` (min 0.15, max 3).

**fpModal колайдер-редактор:**
- Та сама схема: `_fpZoomMode` persistent, `_fpLastTapWasPaint` захист від подвійного тапу після малювання.
- 1 палець = малювати. 2 пальці = пан. Подвійний тап = зум-тогл.

**Drag ассету з бібліотеки на level canvas:**
- Card `touchstart` → запам'ятати `_libDragId`, `_libDragSrc`, `_libDragStartX/Y`.
- `document.touchmove` (passive:**false**) → якщо `> 12px`: `_libDragActive = true`, `state.pendingAsset = _libDragId`, float ghost-img (position:fixed, 56×56, opacity 0.65). Якщо `_libDragActive`: `ev.preventDefault()` щоб зупинити скрол бібліотеки.
- `document.touchend` → якщо над canvas: place asset (pushUndo + `level().placed.push` + save); інакше скасувати.
- Card `touchend` (passive:false, `ev.preventDefault()`): якщо не drag → single/double-tap logic (pendingAsset або відкрити fpModal).

---

### Виправлення рівня (UI/UX)

**Desktop:**
- `#mob-char-parts-row { display: none; }` додано **поза** media query — елемент більше не видно на desktop (раніше показувався через `.mode-char #mob-char-parts-row { display: flex !important }` всередині `@media`, але сам елемент без медіа не мав `display:none` зовні).
- Fill menu: `positionFillMenu()` тепер **bottom-anchored** (відкривається вгору від тулбара): `position:fixed; bottom = (window.innerHeight - toolbarTop + 8)px; top:auto`. Раніше падав у `stage.top + 16` бо `$('preview')` = `$('lv-preview')` якого немає в studio.html.
- `#lv-levelToolbar`: `align-items: flex-start` → `align-items: stretch` — всі кнопки однієї висоти.

**Toolbar — мерж кнопок:**
- `lv-addSpawn` + `lv-delSpawn` → одна кнопка **`lv-spawnBtn`** (початковий текст "Додати стартову"). ПКМ → перемикає текст на "Прибрати стартову" і навпаки (`_spawnMode: 'add'|'del'`). ЛКМ → виконує поточний режим.
- `lv-enemySpawnBtn` + `lv-enemyEraseBtn` → одна кнопка **`lv-enemyBtn`** (початковий текст "Додати ворогів"). ПКМ → перемикає на "Прибрати ворогів" (`_enemyMode: 'add'|'erase'`). ЛКМ → активує `pathTool = 'enemy'` або `'enemyErase'`.
- "Очистити все" → "Очистити".
- `updatePathBtns()` оновлено під нові id. `pathBtnIds`/`pathBtnTools` очищено від старих.

**iOS viewport:** `meta[name=viewport]` додано `maximum-scale=1, user-scalable=no, viewport-fit=cover` — виправляє глюки масштабу при кількох зображеннях на iPhone 13 Pro.

### Відкладено / чекає вводу

- **Колайдери в грі** (ходьба): асиметрія ліво/право, мінора розбіжність editor↔game. Відкладено, вернутись після поточного списку.
- **Ігрова плановість** (зміст двох кнопок у `planGame`): формулювання прийдуть після колайдерів.
- **Рендер ворога по id у грі**: `enemySpawns` зберігає `enemyId`, але `GameScene` поки спавнить узагальненого `Enemy(red rect)`, не читаючи конкретного персонажа. Наступний великий шматок.

---

## КОНЦЕПТ ГРИ — повний опис (2026-06)

### Жанр і сеттинг

Альтернативна Україна 16–17 ст. — умовна географія, не точні назви. Гумористичний темний биємап + стратегічна мета-шар (карта, хаби, апгрейди). Бойова механіка — те що вже збирається (бітемап-рівні).

### Двошарова структура гри

**Шар навігації (мета-гра):**
- **Глобальна карта** — поділена на **регіони**; кожен регіон — вкладена менша карта.
- На картах розставлені **локації** (хаби) — статичні точки, як Hamlet у DD1 / міста у Heroes: тут можна апгрейдити, крафтити, кидати кості, торгувати тощо. Виглядають як статичні арени з активними будівлями.
- Між локаціями — **шляхи (лінії на карті)**, кожен шлях = конкретний бітемап-рівень за `id`.

**Шар екшену:**
- Обираєш напрямок на карті → анімація переходу → запускається **бітемап-рівень** (рівні будуть мати id типу `village1`, `forest1` і т.д.).
- Дійшов до кінця рівня → потрапляєш у наступну локацію.

### Хоругва (партійна система)

- Загін до 5 гравців — **Хоругва**.
- Гравці бачать одне одного і можуть об'єднатись **тільки знаходячись в одній локації**.
- Після об'єднання — разом ідуть в одному напрямку і **спільно пробігають бітемап-рівень**.
- Соло: особистий прогрес, рейтинг де зупинився. Кооп: спільний рейтинг загону.

### Що потрібно технічно (по фазах)

**Фаза 1 — соло без сервера (пріоритет):**
1. Дороблення бітемапу (колайдери, вороги по id).
2. **Редактор Карти** — малюємо фон (PNG або набір ассетів), ставимо вузли-локації з координатами, з'єднуємо лініями, кожна лінія → обирає рівень за id зі списку. Нові локації і нові шляхи можна додавати вільно в будь-який час.
3. **Редактор Локацій** — статична сцена (той самий движок що й Редактор Мандр), але замість колайдерів/спавнів — «активні зони» з будівлями (дії-заглушки: апгрейд/крафт/магазин/відпочинок).
4. **Зшивка навігації в грі:** карта → клік локації → рівень → наступна локація.
5. Соло-збереження «де зупинився» (IndexedDB).

**Фаза 2 — наповнення:**
- Зміст будівель у локаціях (апгрейд/крафт/магазин).
- Прогрес персонажа (стати, збереження).

**Фаза 3 — сервер (окремо, пізніше):**
- Акаунти, спільний лідерборд.
- Presence (хто де знаходиться).
- Реалтайм кооп через WebSocket (архітектура вже multiplayer-ready).

### Структура даних карти (WorldDoc)

```ts
// Карта = намальований фон + точки + лінії
interface WorldDoc {
  id: string;
  name: string;
  bg: string;           // dataURL фону (намальована карта, PNG)
  nodes: WorldNode[];
  edges: WorldEdge[];
}
interface WorldNode {
  id: string;           // 'village_zahalci', 'forest1' …
  label: string;
  x: number; y: number; // пікселі на карті
  type: 'location' | 'region'; // region = відкриває вкладену карту
  regionId?: string;    // якщо type=region — id дочірньої WorldDoc
}
interface WorldEdge {
  id: string;
  from: string; to: string; // node ids
  levelId: string;          // id бітемап-рівня (Level із Редактора Мандр)
  twoWay: boolean;
}
```

Сховище: IndexedDB `zag_worlds` (аналогічно `zag_levels`).

### Редактори в studio.html (актуальні вкладки)

| Вкладка | Режим | Статус |
|---|---|---|
| **Редактор Персонажів** | `mode-char` | Готово (ріг + таймлайн) |
| **Редактор Мандр** | `mode-level` | Готово v1 (бітемап-рівні) |
| **Редактор Карти** | `mode-world` | В розробці |
| **Редактор Локацій** | `mode-location` | Заплановано після карти |

Всі режими поділяють той самий движок drag/G/R/S/M/пан/зум — реюз коду.
