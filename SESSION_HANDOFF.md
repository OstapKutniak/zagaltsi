# Хоругва / Загальці — Session Handoff

> Цей файл — швидкий старт для нової сесії Claude.  
> Кинь його в чат разом із посиланнями на тулзи, і Claude одразу в контексті.

---

## Посилання (живі)

| | |
|---|---|
| Гра | https://ostapkutniak.github.io/zagaltsi/ |
| Studio (редактор персонажів) | https://ostapkutniak.github.io/zagaltsi/studio.html |
| Редактор рівнів | https://ostapkutniak.github.io/zagaltsi/level.html |
| GitHub репо | https://github.com/OstapKutniak/zagaltsi |

---

## Що це за проєкт

**«Загальці»** — гумористичний 2D beat'em up (Telegram Mini App), стиль Golden Axe / Streets of Rage.  
Вид збоку, рух по 8 напрямках, хвилі ворогів, 5 персонажів.  
**Автор:** Остап (OstapKutniak) — досвідчений дизайнер/3D-аніматор, **не програміст**.  
**Правило:** Код пише Claude, Остап керує напрямком і дає ассети.

---

## Стек

- **Гра:** Phaser 3 + TypeScript + Vite, Arcade Physics
- **Редактори:** vanilla TS + Canvas2D (studio/rig), окрема сторінка (level)
- **Сховище:** IndexedDB (`src/shared/idb.ts`, idbGet/idbSet, БД `zagaltsi`, store `kv`) — НЕ localStorage для великих даних
- **Деплой:** git push main → GitHub Actions → GitHub Pages (~1 хв)
- **Середовище:** Windows, Node v24, npm 11, Git; PowerShell (не bash)

---

## Ключові файли

```
zagaltsi/
  studio.html           ← головна тулза (tab = Персонажі/Рівні/...)
  rig.html              ← redirect → studio.html
  level.html            ← редактор рівнів
  src/
    main.ts             ← Phaser entry (Scale.NONE + viewport.ts)
    viewport.ts         ← manual 20:9 letterbox (НЕ Phaser FIT)
    rig/main.ts         ← логіка редактора персонажів (Canvas2D)
    anim/CutoutCharacter.ts ← рендер персонажа у грі (Phaser)
    level/main.ts       ← редактор рівнів
    shared/idb.ts       ← IndexedDB wrapper
  public/
    character.json      ← fallback персонаж (якщо немає в IndexedDB)
    level.json          ← fallback рівень
  project-context/
    zagaltsi-game.md    ← повний контекст проєкту (архітектура, рішення, TODO)
  CLAUDE.md             ← автозавантаження Claude Code
```

---

## Архітектура ріг-тулзи (studio.html + src/rig/main.ts)

### Слоти (шари ззаду наперед)
`arm_back → leg_back → leg_front → torso → neck → head → eye_back → eye_front → brow_back → brow_front → mouth → arm_front`

### Ієрархія
`torso` = корінь; `neck/arm_*/leg_*` → torso; `head` → neck; `eye_*/brow_*/mouth` → head

### Інтерфейси
```typescript
interface Tf { rot, scale, dx, dy, flip, sx, sy, gscale }
interface Slot extends Tf { image, pivotX, pivotY, cut, bend, bendFlip }
interface KeyPose { rot, dx, dy, scale, flip, bend }
interface Keyframe { t, interp: 'linear'|'smooth', pose: Record<string, KeyPose> }
interface Clip { duration, keys: Keyframe[] }
```

### Ключові функції
- `worldOf(sel)` → `{x, y, rot, gs}` — рекурсивно компонує трансформи з ієрархії
- `rigForExport()` — статичні поля (image/pivot/flip/bendFlip) з живих `slots`, анімовані (rot/dx/dy/scale/bend) з `setup` (bind-поза)
- `exitClip()` — відновлює лише анімовані поля; статичні лишаються з живих slots
- `eff(t)` — семплює процедурні пози навіть в паузі
- `worldGs(sel)` — накопичений gscale по ієрархії

### Стан редактора
```typescript
state = {
  slots,      // живі слоти (поточний вигляд)
  setup,      // bind-поза (зберігається поки редагуємо кліп)
  anim,       // активний кліп або null
  clips,      // авторські анімації (Record<string, Clip>)
  framesInView, // zoom таймлайну (колесо над треком)
  facing,     // 1 (праворуч) / -1 (ліворуч) — дзеркалить арт
  animDir,    // 1 / -1 — напрям анімації кісток (не чіпає арт)
  prop: { overall, head, torso, arms, legs }
}
```

### UI (studio.html)
- **Ліва панель:** бібліотека Герої/Вороги — flex+`padding-top:100%` трюк для квадратних карток (НЕ CSS Grid)
- **Центр:** viewport (#stageWrap absolute) + N-панель (#partsList absolute overlay) + #faceList (підменю обличчя, ПКМ на "Голова")
- **Таймлайн знизу:** #anim select, #charSel, K/Delete key, #linkBtn, #bakeBtn, #copyAnimBtn (RMB = paste mode), Rename/Delete/Reset; #track (колесо = framesInView zoom); білий маркер на кадрі 24 (END_FRAME)
- **Права панель (480px):** #preview 20:9 iframe (LMB click = expand/collapse toggle, без ✕), іконки, #tools
- **Гарячі клавіші (ev.code):** G рух, R поворот, S розмір, G X/G Z вісь, S X/S Z не-uniform, Q pivot, D cut, B bend, F flip all, K key, Space play/pause, Ctrl+Z undo, M дзеркало, W show/hide ref

### Blender-стиль трансформів
- `G X` / `G Z` — axis constraint (wdx або wdy = 0)
- `S X` / `S Z` — sx або sy (локальний не-uniform scale)
- `S` (без осі) → gscale (hierarchical uniform scale)

---

## Гра (CutoutCharacter.ts)

### Критичний знак bend
```typescript
// ПРАВИЛЬНО (Phaser):
bendVal = (lp.bend + procBend) * (sl.bendFlip ? -1 : 1)
// БЕЗ *(flip<0?-1:1) — Phaser ротує поза mirror-scale (на відміну від Canvas2D де всередині)
```

### Масштабування (НЕ Phaser FIT)
`Scale.NONE` + ручний letterbox у `viewport.ts` — єдине надійне рішення.  
`window.__zagRefit` = `apply` — студія кличе після resize iframe.

### Персонаж у гру
1. Тулза: "Export у гру" → idbSet('zag_game_char', buildDoc())
2. Гра: читає 'zag_game_char' із IndexedDB, fallback → public/character.json

---

## Сховище (ключі IndexedDB)

| Ключ | Що |
|---|---|
| `zag_game_char` | Персонаж для гри (з тулзи) |
| `zag_level` | Рівень для гри (з редактора) |
| `zag_levels` | Всі рівні редактора |
| `zag_assets` | PNG-ассети редактора |
| `ostap_library` | Бібліотека персонажів тулзи |
| `ostap_char` | Автозбереження поточного персонажа |
| `zag_head_uy2` | Калібрування лінії маківки |

---

## Останній коміт (37d4ea4)

```
Studio: LMB-collapse preview, frame-zoom timeline, char select + copy anim,
        head submenu; fix bend in game
```

Що зроблено в останній пачці:
1. **Preview toggle** — LMB click = expand/collapse, без ✕
2. **Timeline zoom** — колесо над треком = framesInView; білий маркер END_FRAME=24; прибрано кнопку ▶ (Space only)
3. **#charSel** — вибір персонажа поряд з анімацією; копіювати/вставити анімацію між персонажами (RMB на #copyAnimBtn = paste mode)
4. **Підменю обличчя** — ПКМ на "Голова" відкриває #faceList збоку (очі/брови/рот); у головному списку їх прибрано
5. **Фікс знаку bend у грі** — прибрано `*(flip<0?-1:1)` з CutoutCharacter.ts

---

## TODO (пріоритети)

- [ ] **Колайдер обмежує рух** у грі (зараз лише візуальні квадрати)
- [ ] **Пастки дамажать**; інтерактивні об'єкти
- [ ] **Вороги з бібліотеки** в гру
- [ ] **gscale / sx / sy** у грі (поки не рендеряться)
- [ ] **Кілька розрізів** на кінцівку
- [ ] **Редактор рівнів UI** — Остап сказав "ще накидаю" (blocking від ескізу)
- [ ] Анімації — доробити (Остап паузнув таймлайн роботи)
- [ ] GitHub Actions Node20 deprecation (non-blocking, можна бампнути пізніше)

---

## Відомі рішення / "чому так"

| Проблема | Рішення |
|---|---|
| Phaser Scale.FIT нестабільний на resize | `Scale.NONE` + `viewport.ts` (canvas.style напряму) |
| CSS Grid + aspect-ratio — картки перекриваються | Flex + `padding-top:100%` трюк |
| GitHub Pages кешує HTML ~10 хв | no-cache meta у всіх HTML |
| bend знак неправильний для дзеркальних кінцівок | Canvas2D — множити на flip (всередині mirror ctx); Phaser — не множити |
| setup vs slots | статичні поля (pivot/flip/bendFlip/image) з live slots; анімовані (rot/dx/dy/scale/bend) з bind pose (setup) |
| SELECT елемент тримав фокус → Space відкривав dropdown | `.blur()` після change |
| IndexedDB замість localStorage | base64 не влазить у ~5МБ localStorage |

---

## Як запустити локально

```powershell
cd D:\Hobby\Claude\zagaltsi
npm run dev      # → http://localhost:5173
                 #   /studio.html, /level.html
npm run build
```

> PATH може не мати node у новому PowerShell:  
> `$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')`
