// Крихітне сховище ключ-значення на IndexedDB. Використовуємо замість localStorage
// для всього, що тримає картинки (base64): localStorage має ліміт ~5 МБ на весь
// сайт і швидко переповнюється, а IndexedDB — сотні МБ–ГБ.
// Значення — будь-які structured-cloneable дані (обʼєкти, рядки, масиви).

const DB = 'zagaltsi';
const STORE = 'kv';

function openDb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

export async function idbGet<T>(key: string): Promise<T | null> {
  const d = await openDb();
  return new Promise((res, rej) => {
    const req = d.transaction(STORE, 'readonly').objectStore(STORE).get(key);
    req.onsuccess = () => res((req.result ?? null) as T | null);
    req.onerror = () => rej(req.error);
  });
}

// Перелік усіх ключів (потрібно, щоб зібрати всі zag_behavior_* графи для публікації).
export async function idbKeys(): Promise<string[]> {
  const d = await openDb();
  return new Promise((res, rej) => {
    const req = d.transaction(STORE, 'readonly').objectStore(STORE).getAllKeys();
    req.onsuccess = () => res((req.result as IDBValidKey[]).map(String));
    req.onerror = () => rej(req.error);
  });
}

export async function idbSet(key: string, val: unknown): Promise<void> {
  const d = await openDb();
  return new Promise((res, rej) => {
    const tx = d.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(val, key);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}
