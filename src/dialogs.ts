// Діалоги НПС — окремо від нодової поведінки (винесено з графа). Автора у вкладеному
// редакторі (дерево-сценарій), зберігаємо ПЕР-ПЕРСОНАЖА в IDB `zag_dialogs_<charId>`
// як масив DialogDoc. У грі поведінка викликає діалог за кодом, а його «результати»
// (іменовані кінцівки) стають виходами ноди й ведуть далі в поведінку.

import { idbGet, idbKeys } from './store';

// Один вузол розмови. who='npc' — репліка НПС (children = варіанти гравця);
// who='player' — вибір гравця (children = 0/1 наступна репліка НПС, або кінець із outcome).
export interface DialogLine {
  id: string;
  who: 'npc' | 'player';
  text: string;
  outcome?: string;       // якщо задано на вибір/репліці — гілка ЗАВЕРШУЄТЬСЯ цим результатом
  children: DialogLine[];
}

export interface DialogDoc {
  id: string;             // код діалогу (напр. 'd1') — на нього посилається поведінка
  name: string;
  root: DialogLine;       // стартова репліка НПС
  updatedAt?: number;     // LWW-синхронізація між компами
}

const PREFIX = 'zag_dialogs_';
export const dialogsKey = (charId: string): string => PREFIX + charId;

export type DialogMap = Record<string, DialogDoc[]>; // charId → діалоги

// Унікальні імена результатів у діалозі (для портів ноди «Діалог»). Порядок — стабільний
// (обхід дерева зверху вниз), щоб порти не «стрибали».
export function dialogOutcomes(doc: DialogDoc): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const walk = (n: DialogLine): void => {
    if (n.outcome && !seen.has(n.outcome)) { seen.add(n.outcome); out.push(n.outcome); }
    for (const c of n.children) walk(c);
  };
  if (doc.root) walk(doc.root);
  return out;
}

// Зібрати всі діалоги з IDB для публікації: { charId: DialogDoc[] }.
export async function gatherDialogs(): Promise<DialogMap> {
  const out: DialogMap = {};
  const keys = (await idbKeys()).filter((k) => k.startsWith(PREFIX));
  for (const k of keys) {
    const arr = await idbGet<DialogDoc[]>(k);
    if (Array.isArray(arr) && arr.length) out[k.slice(PREFIX.length)] = arr;
  }
  return out;
}

// У грі/редакторі: опубліковані діалоги з репо (кеш проміса).
let published: Promise<DialogMap> | null = null;
export function loadPublishedDialogs(): Promise<DialogMap> {
  if (!published) {
    published = fetch(`${import.meta.env.BASE_URL}studio-data/dialogs.json?t=${Date.now()}`)
      .then((r) => (r.ok ? (r.json() as Promise<DialogMap>) : {}))
      .catch(() => ({}));
  }
  return published;
}

// Хелпери створення
let _uid = Date.now();
export const newLineId = (): string => 'l' + (++_uid).toString(36);
export const newNpcLine = (text = 'Гей, чужинцю!'): DialogLine => ({ id: newLineId(), who: 'npc', text, children: [] });
export const newChoice = (text = 'Відповідь'): DialogLine => ({ id: newLineId(), who: 'player', text, children: [] });
export const newDialog = (id: string, name = 'Розмова'): DialogDoc => ({ id, name, root: newNpcLine(), updatedAt: Date.now() });
