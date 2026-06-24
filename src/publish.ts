// Спільна публікація студії — ОДИН коміт на всі редактори.
//
// Раніше кожен редактор (персонажі / рівні / карти / локації) робив окремий
// ghCommit. Кілька комітів підряд гонили гілку main самі проти себе → 422
// "Update is not a fast forward". Тепер кожен редактор лише РЕЄСТРУЄ збирач
// файлів, а будь-яка кнопка «Оновити гру» кличе publishAll() → збирає файли з
// усіх редакторів і пушить їх ОДНИМ ghCommit (один PATCH ref, гонки нема).

import { ghCommit } from './github';

export type FileCollector = () => Promise<Record<string, string>> | Record<string, string>;

const collectors: FileCollector[] = [];

// Кожен редактор реєструє свій збирач під час init. Реєстр пер-сторінковий:
// у studio.html реєструються всі, у standalone level.html — лише рівневий.
export function registerPublisher(c: FileCollector): void {
  collectors.push(c);
}

let inflight: Promise<void> | null = null;

// Зібрати файли з усіх редакторів і запушити одним комітом. Паралельні виклики
// (натиснули кнопку у двох редакторах) розділяють один і той самий проміс.
export function publishAll(): Promise<void> {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const files: Record<string, string> = {};
      for (const c of collectors) Object.assign(files, await c());
      await ghCommit(files, 'studio: publish to game');
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

// Підвʼязати кнопку «Оновити гру» до publishAll з уніфікованим фідбеком.
export function wirePublishButton(
  btn: HTMLButtonElement,
  setStatus: (s: string) => void,
  before?: () => void,
): void {
  btn.addEventListener('click', () => {
    before?.();
    btn.disabled = true;
    const orig = btn.textContent!;
    btn.textContent = 'Публікую...';
    publishAll()
      .then(() => { btn.textContent = 'Оновлено!'; setStatus('✔ Оновлено! Telegram підтягне за ~1 хв.'); })
      .catch((e: unknown) => { btn.textContent = 'Помилка'; setStatus('✗ ' + String(e).slice(0, 80)); })
      .finally(() => { setTimeout(() => { btn.disabled = false; btn.textContent = orig; }, 4000); });
  });
}
