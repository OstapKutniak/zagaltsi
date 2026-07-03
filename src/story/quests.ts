// Квести — спільні дані для гри (QuestsScene: дошка з нотатками) і Редактора
// Історії (панель «Квести»). Сховище: IDB zag_quests (локальні правки) ↔
// опублікований studio-data/quests.json (LWW по updatedAt на весь список).

import { idbGet } from '../store';

export interface Quest {
  id: string;
  title: string;        // заголовок на нотатці дошки
  text: string;         // повний текст (розгортається по кліку)
  cat: 'main' | 'side'; // головний / побічний
  giver?: string;       // charId НПС, що видає квест (енкаунтер у локації)
  dialogId?: string;    // id діалогу цього НПС (кінцівка 'positive' = квест узято)
  updatedAt?: number;
}
export interface QuestStore { quests: Quest[]; updatedAt?: number }

export const newQuestId = (): string => 'q' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

export async function loadQuests(): Promise<QuestStore> {
  let remote: QuestStore | null = null;
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}studio-data/quests.json?t=${Date.now()}`);
    if (r.ok) remote = await r.json() as QuestStore;
  } catch { /* ignore */ }
  const local = await idbGet<QuestStore>('zag_quests').catch(() => null);
  const lw = local?.updatedAt ?? 0, rw = remote?.updatedAt ?? 0;
  return (local && lw >= rw) ? local : (remote ?? local ?? { quests: [] });
}
