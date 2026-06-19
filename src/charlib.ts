// Бібліотека персонажів — джерело для вибору персонажа в лобі та для рендера
// гравців у грі. Беремо синхронізовану бібліотеку з репо (public/studio-data/
// char-library.json) і доливаємо локальні (idb 'ostap_library') по id.
// ВАЖЛИВО: щоб іншого гравця було видно, його персонаж має бути в СИНХРОНІЗОВАНІЙ
// бібліотеці (тобто збережений і опублікований), бо лише вона спільна між пристроями.

import { idbGet } from './store';
import type { CharDoc } from './anim/CutoutCharacter';

export interface LibItem { id: string; name: string; cat: string; doc: CharDoc; thumb: string }

let cache: LibItem[] | null = null;

function mergeById(base: LibItem[], extra: LibItem[]): LibItem[] {
  const ids = new Set(base.map((x) => x.id));
  return [...base, ...extra.filter((x) => !ids.has(x.id))];
}

export async function loadCharLibrary(force = false): Promise<LibItem[]> {
  if (cache && !force) return cache;
  let remote: LibItem[] = [];
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}studio-data/char-library.json?t=${Date.now()}`);
    if (r.ok) { const j = await r.json(); if (Array.isArray(j)) remote = j as LibItem[]; }
  } catch { /* offline / нема файлу */ }
  let local: LibItem[] = [];
  try { const l = await idbGet<LibItem[]>('ostap_library'); if (Array.isArray(l)) local = l; } catch { /* ignore */ }
  cache = mergeById(remote, local);
  return cache;
}

// Знайти doc персонажа за id (з вже завантаженої бібліотеки).
export function docById(lib: LibItem[], id: string | null | undefined): CharDoc | null {
  if (!id) return null;
  return lib.find((x) => x.id === id)?.doc ?? null;
}
