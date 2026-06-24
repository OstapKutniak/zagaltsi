// Studio data sync — pulls library / level / world / location data from GitHub on
// startup and merges with local data by id. Conflict policy: LAST-WRITE-WINS by
// `updatedAt` (мітка часу останньої правки). Так дані сходяться між компами:
// найсвіжіша правка кожного об'єкта перемагає, незалежно від машини.
// Push is handled by ghCommit in the editors.

const RAW = (f: string) =>
  `https://raw.githubusercontent.com/OstapKutniak/zagaltsi/main/public/studio-data/${f}?t=${Date.now()}`;

async function fetchJson<T>(filename: string): Promise<T | null> {
  try {
    const r = await fetch(RAW(filename));
    if (!r.ok) return null;
    return await r.json() as T;
  } catch { return null; }
}

export interface Stamped { id?: string; updatedAt?: number }

// Merge by id, last-write-wins on `updatedAt` (відсутня мітка = 0 = найстаріше).
// Нічию виграє REMOTE — тож при першому розкаті (усе ще без міток) свіжий
// опублікований стан підтягується на застарілу машину, не навпаки.
export function mergeByIdLWW<T extends Stamped>(local: T[], remote: T[]): { merged: T[]; changed: number } {
  const map = new Map<string, T>();
  for (const it of local) if (it && it.id != null) map.set(it.id, it);
  let changed = 0;
  for (const it of remote) {
    if (!it || it.id == null) continue;
    const cur = map.get(it.id);
    const rt = it.updatedAt ?? 0, lt = cur?.updatedAt ?? 0;
    if (!cur) { map.set(it.id, it); changed++; }      // нового нема локально — додаємо
    else if (rt > lt) { map.set(it.id, it); changed++; } // віддалене новіше — заміна
    else if (rt === lt) map.set(it.id, it);           // нічия → remote, але не рахуємо як зміну
  }
  return { merged: [...map.values()], changed };
}

// Загальний фетч масиву (необов'язково вкладеного під полем, напр. {worlds:[...]}).
export async function pullArray<T>(filename: string, field?: string): Promise<T[] | null> {
  const j = await fetchJson<unknown>(filename);
  if (!j) return null;
  const arr = field ? (j as Record<string, unknown>)[field] : j;
  return Array.isArray(arr) ? (arr as T[]) : null;
}

// ---- Character library ----
// Takes current in-memory lib, returns merged result (LWW by updatedAt).
export async function pullCharLib<T extends Stamped>(current: T[]): Promise<{ lib: T[]; added: number }> {
  const remote = await fetchJson<T[]>('char-library.json');
  if (!remote || !Array.isArray(remote) || remote.length === 0) return { lib: current, added: 0 };
  const { merged, changed } = mergeByIdLWW(current, remote);
  return { lib: merged, added: changed };
}

// ---- Level assets & layouts ----

export interface SyncAsset { id: string; cat: string; name: string; url: string; updatedAt?: number }
export interface SyncLevelStore { levels: unknown[]; cur: number }

export async function pullLevelData(): Promise<{ assets: SyncAsset[]; layouts: SyncLevelStore | null }> {
  const [remoteAssets, remoteLayouts] = await Promise.all([
    fetchJson<SyncAsset[]>('level-assets.json'),
    fetchJson<SyncLevelStore>('level-layouts.json'),
  ]);
  return {
    assets: Array.isArray(remoteAssets) ? remoteAssets : [],
    layouts: remoteLayouts,
  };
}

export function mergeLevelAssets<T extends Stamped>(local: T[], remote: T[]): { merged: T[]; added: number } {
  const { merged, changed } = mergeByIdLWW(local, remote);
  return { merged, added: changed };
}
