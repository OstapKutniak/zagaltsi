# Хоругва / Загальці — контекст проєкту для Claude

Це гра + дві веб-тулзи (редактор персонажів і редактор рівнів). Розробляється
разом із Claude Code. Користувач — Остап (OstapKutniak), досвідчений
дизайнер/3D/аніматор, **не програміст**: код пише Claude, користувач керує
напрямком і дає ассети.

## ⚠️ Якщо це нова машина / новий акаунт — спершу зчитай накопичений контекст

Уся історія рішень по проєкту (стек, архітектура, ріг персонажів, тулзи,
сховище, статус, TODO) лежить у теці [`project-context/`](project-context/):

- [`project-context/zagaltsi-game.md`](project-context/zagaltsi-game.md) — **головний** контекст: усе про гру, ріг-тулзу, редактор рівнів, пайплайни, сховище (IndexedDB), статус і плани.
- [`project-context/reuse-existing-work.md`](project-context/reuse-existing-work.md) — важливий принцип роботи: перевикористовувати наявні напрацювання користувача, не винаходити наново.

**Прочитай обидва файли перед роботою.** Якщо в тебе є власна файлова пам'ять
(`~/.claude/.../memory/`) і ці факти там відсутні — перенеси їх туди, щоб вони
підхоплювались у наступних сесіях.

## Швидкий старт

```bash
npm install
npm run dev      # → http://localhost:5173 (гра)
                 #   /rig.html  — редактор персонажів
                 #   /level.html — редактор рівнів
npm run build    # збірка в dist/
```

## Деплой

- Репо: https://github.com/OstapKutniak/zagaltsi (публічний, гілка `main`).
- Push у `main` → GitHub Actions ([.github/workflows/deploy.yml](.github/workflows/deploy.yml)) → автодеплой на GitHub Pages.
- Жива гра: https://ostapkutniak.github.io/zagaltsi/
- Ріг: https://ostapkutniak.github.io/zagaltsi/rig.html
- Рівні: https://ostapkutniak.github.io/zagaltsi/level.html
- **Оновлення = git push** (Claude комітить і пушить, ~1 хв і онлайн).

## Середовище

Windows. Node (через winget), npm, Git. У нових PowerShell-сесіях PATH може не
містити node — за потреби:
`$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')`

> Примітка: `project-context/*.md` — це знімок напрацьованого контексту, вкладений
> у репо, щоб переживати зміну машини/акаунта. Не плутати з кодом; код —
> джерело істини, контекст може трохи відставати.
