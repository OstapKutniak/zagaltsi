// Поведінки НПС: зберігаються в IDB пер-персонажа (`zag_behavior_<charId>`), але
// працюють лише на машині, де авторили. Щоб поведінка діяла на інших пристроях і
// в коопі, при «Оновити гру» збираємо всі графи у `public/studio-data/behaviors.json`,
// а в грі вантажимо звідти (з фолбеком на IDB).

import { idbGet, idbKeys } from './store';
import type { NodeGraph } from './node-editor';

const PREFIX = 'zag_behavior_';
export type BehaviorMap = Record<string, NodeGraph>;

// Зібрати з IDB усі поведінки у мапу { charId: граф } для публікації.
export async function gatherBehaviors(): Promise<BehaviorMap> {
  const out: BehaviorMap = {};
  const keys = (await idbKeys()).filter((k) => k.startsWith(PREFIX));
  for (const k of keys) {
    const g = await idbGet<NodeGraph>(k);
    if (g && (g.nodes?.length || g.edges?.length)) out[k.slice(PREFIX.length)] = g;
  }
  return out;
}

// У грі: завантажити опубліковані поведінки з репо (один раз, кешуємо проміс).
let published: Promise<BehaviorMap> | null = null;
export function loadPublishedBehaviors(): Promise<BehaviorMap> {
  if (!published) {
    published = fetch(`${import.meta.env.BASE_URL}studio-data/behaviors.json?t=${Date.now()}`)
      .then((r) => (r.ok ? (r.json() as Promise<BehaviorMap>) : {}))
      .catch(() => ({}));
  }
  return published;
}
