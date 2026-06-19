# Сесія: кооп-мультиплеєр + перейменування + фікси (2026-06-19, робочий комп)

Контекст для продовження на домашньому компі. **Спершу `git pull --rebase origin main`.**
Це доповнення до [[zagaltsi-game]] — тут лише те, що зроблено в цій сесії.

## Зроблено (вже на `main`, задеплоєно)

1. **Перейменування** гри → **Хоругва** (title у `index.html`, `package.json`, `README.md`; редактори: «Хоругва - Редактор персонажів / рівнів»). Назва села «Загальці» в лорі лишилась.
2. **Фікси рига** (рання частина сесії): `animDir` («Хода в бік») тепер зберігається в персонажі й застосовується в грі (`CutoutCharacter`, `o.drot * animDir`); фікс «анімація не обиралась/не грала» (читати `select.value` ДО `play(false)`); редактор рівнів + гра переведені на IndexedDB (`src/store.ts`) замість localStorage (переповнювався на 2 PNG).
3. **Кооп-мультиплеєр (НОВЕ, головне):**
   - Гра під'єднується до лобі через подію `lobbyStart` (`src/main.ts` → `lobbyUI`). Соло = порожній код.
   - `GameScene.beginPlay(code)`: вантажить обраного персонажа з бібліотеки, спавнить за слотом (порядок приєднання в лобі), і — якщо кооп — шле свій стан (~12/с) та малює інших гравців.
   - `pushPlayerState` / `watchGameState` (`src/multiplayer/lobby.ts`) — Firebase Realtime DB. `PlayerState` несе `{x, y, z, hp, anim, facing, charId, name}`. `z` = висота підскоку (стрибок видно в напарника).
   - Інші гравці = окремі `CutoutCharacter` з префіксом текстур `r_<id>_` (щоб різні персонажі не злипались), згладжування позиції лерпом, глибина за підлогою.
4. **Вибір персонажа в лобі**: `#lb-chars` в `index.html` + `lobbyUI.renderCharPicker()`. Список із `src/charlib.ts` (синхронізована бібліотека `public/studio-data/char-library.json` + локальна `ostap_library`, merge по id). Вибір зберігається в `localStorage.zag_chosen_char` і в слоті лобі (`charId`).
5. **5 точок спавна** в редакторі рівнів: кнопки **＋/－ Спавн** у нижній панелі (`#lv-levelToolbar` в `studio.html`, wiring у `src/level/editor.ts`); різнокольорові пронумеровані прапорці, тягнуться. `LevelDoc.spawns: {x,y}[]` (до 5); `spawn` лишається = `spawns[0]` для сумісності.

## Ключові файли
- `src/multiplayer/lobby.ts` — лобі (код із 4 символів) + `pushPlayerState`/`watchGameState` + `getLobbyPlayers` + `getChosenChar`/`setChosenChar`/`setLobbyChar`.
- `src/multiplayer/lobbyUI.ts` — екрани лобі + вибір персонажа.
- `src/charlib.ts` — завантаження бібліотеки персонажів (для лобі та гри).
- `src/scenes/GameScene.ts` — `beginPlay`, `pushMyState`, `syncRemotes`, мульти-спавн.
- `src/anim/CutoutCharacter.ts` — `load(scene, doc, keyPrefix)`.
- `src/level/editor.ts` + `studio.html` — спавн-кнопки, `LevelView.LevelDoc.spawns`.
- `src/firebase.ts` — конфіг RTDB (проєкт `horugva-ff8bd`).

## Як публікувати / як це доходить усюди
- **Код** → лише через `git push` (і `git pull` на іншому компі). Кнопка «Оновити гру» в студії код НЕ пушить.
- **Дані** (персонаж/рівень/бібліотека) → кнопка «Оновити гру» (`src/github.ts`, `ghCommit`) комітить ТІЛЬКИ `public/*` + `public/studio-data/*` через GitHub-токен (у `localStorage.gh_pat`, per-браузер). Працює з будь-якого компа з токеном.
- **Синхронізація бібліотеки**: `src/sync.ts` тягне `studio-data/*.json` і мерджить по id.

## ⚠️ Залежність для кооп-тесту
Firebase Realtime DB — правила мають дозволяти `/lobbies` read/write. Зараз стоять ВІДКРИТІ (тест):
```json
{ "rules": { "lobbies": { ".read": true, ".write": true } } }
```
Налаштовується в консолі Firebase (тільки артист). Кооп працює — підтверджено живим тестом удвох.

## Відомі обмеження / наступні кроки
- Firebase-правила відкриті — **звузити перед публічним релізом** (зараз будь-хто може писати в базу).
- Камера стежить лише за СВОЇМ гравцем; далекі спавни — гравці спершу не в кадрі.
- Іншого гравця видно, лише якщо його персонаж у СИНХРОНІЗОВАНІЙ бібліотеці (`char-library.json`), не лише локально.
- Можливий тюнінг плавності (лерп `dt*12` позиція, `dt*18` стрибок) за фідбеком.
- Не зроблено: PvP/бій між гравцями, вороги в кооп, пізні приєднання (joinLobby блокує після старту).
