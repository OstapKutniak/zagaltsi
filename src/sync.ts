// Studio data sync — pulls library / level data from GitHub on startup,
// merges with local data by id (union — nothing is lost between computers).
// Push is handled by ghCommit in rig/main.ts and level/editor.ts.

const RAW = (f: string) =>
  `https://raw.githubusercontent.com/OstapKutniak/zagaltsi/main/public/studio-data/${f}?t=${Date.now()}`;

async function fetchJson<T>(filename: string): Promise<T | null> {
  try {
    const r = await fetch(RAW(filename));
    if (!r.ok) return null;
    return await r.json() as T;
  } catch { return null; }
}

// Merge remote array into local array by id — adds items missing locally, keeps local ones.
function mergeById<T extends { id: string }>(local: T[], remote: T[]): { merged: T[]; added: number } {
  const localIds = new Set(local.map(x => x.id));
  const newItems = remote.filter(x => !localIds.has(x.id));
  return { merged: [...local, ...newItems], added: newItems.length };
}

// ---- Character library ----

export async function pullCharLib(libKey: string): Promise<number> {
  const remote = await fetchJson<Array<{ id: string }>>('char-library.json');
  if (!remote || !Array.isArray(remote) || remote.length === 0) return 0;
  try {
    const local: Array<{ id: string }> = JSON.parse(localStorage.getItem(libKey) || '[]');
    const { merged, added } = mergeById(local, remote);
    if (added > 0) localStorage.setItem(libKey, JSON.stringify(merged));
    return added;
  } catch { return 0; }
}

export function charLibForPush(libKey: string): string {
  return localStorage.getItem(libKey) ?? '[]';
}

// ---- Level assets & layouts ----

export interface SyncAsset { id: string; cat: string; name: string; url: string }
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

export function mergeLevelAssets(local: SyncAsset[], remote: SyncAsset[]): { merged: SyncAsset[]; added: number } {
  return mergeById(local, remote);
}
