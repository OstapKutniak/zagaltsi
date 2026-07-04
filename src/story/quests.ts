// Квести — спільні дані для гри (QuestsScene: дошка з нотатками) і Редактора
// Історії (панель «Квести»). Сховище: IDB zag_quests (локальні правки) ↔
// опублікований studio-data/quests.json (LWW по updatedAt на весь список).

import { idbGet } from '../store';

// Як гравець ОТРИМУЄ квест. Кожен спосіб має свій конфіг (нижче в Quest).
export type QuestAcq =
  | 'auto'          // одразу відомий (сюжетний/стартовий) — без видачі
  | 'tg_encounter'  // TG-сповіщення + НПС-перехожий у ПОТОЧНІЙ локації (кнопка «Перевірити»)
  | 'location_npc'  // НПС у конкретній локації (заходиш у локацію → діалог)
  | 'travel'        // енкаунтер при переході між локаціями (на ребрі карти)
  | 'level'         // НПС або тригер під час бітемап-рівня
  | 'board'         // дошка оголошень/контрактів у локації (береш сам)
  | 'item'          // підбір предмета (лист/мапа) відкриває квест
  | 'chain';        // після завершення ІНШОГО квесту (ланцюжок)

// Ціль (крок) квесту — що зробити. Дошка «Завдання» показує список цих кроків.
export type ObjectiveKind = 'talk' | 'kill' | 'reach' | 'collect' | 'survive' | 'escort' | 'custom';
export interface QuestObjective {
  id: string;
  kind: ObjectiveKind;
  target?: string;   // charId / nodeId(локація) / itemId / levelId — залежно від kind
  count?: number;    // скільки (kill/collect/survive-сек)
  desc: string;      // опис кроку на дошці
}

export interface QuestReward { gold?: number; xp?: number; itemId?: string; note?: string }

export type QuestSuccess = 'objectives' | 'dialog_positive' | 'reach' | 'custom';
export type QuestFail = 'none' | 'dialog_negative' | 'player_death' | 'timeout' | 'abandon';

export interface Quest {
  id: string;
  title: string;        // заголовок на нотатці дошки
  text: string;         // повний текст (розгортається по кліку)
  cat: 'main' | 'side'; // головний / побічний
  giver?: string;       // charId НПС, що видає квест (діалог видачі)
  dialogId?: string;    // id діалогу цього НПС (кінцівка 'positive' = квест узято)

  // ── Отримання ──────────────────────────────────────────────────────────────
  acq?: QuestAcq;        // спосіб видачі (нема → сумісність: giver→енкаунтер, інакше auto)
  locationId?: string;   // location_npc / tg_encounter / board — у якій локації
  edgeFrom?: string;     // travel — вузол-початок ребра
  edgeTo?: string;       // travel — вузол-кінець ребра
  levelId?: string;      // level — у якому рівні
  triggerId?: string;    // level — іменований тригер у рівні (нема → просто НПС)
  itemId?: string;       // item — який предмет відкриває
  prevQuestId?: string;  // chain — після якого квесту

  // ── Виконання ────────────────────────────────────────────────────────────────
  objectives?: QuestObjective[];
  successOn?: QuestSuccess; // умова успіху
  failOn?: QuestFail;       // умова провалу
  timeoutSec?: number;      // для failOn='timeout'
  reward?: QuestReward;

  updatedAt?: number;
}
export interface QuestStore { quests: Quest[]; updatedAt?: number }

export const newQuestId = (): string => 'q' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
export const newObjectiveId = (): string => 'o' + Math.random().toString(36).slice(2, 8);

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
