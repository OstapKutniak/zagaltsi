// Виконання нодового графа СПОРУДИ (клік по будівлі в локації): діалогове меню,
// сувій реплік, нагороди/ефекти, дошка замовлень, лавка. Без Phaser — сцена дає
// UI-колбеки, тут лише обхід графа і застосування ефектів.

import { type NodeGraph, type GraphNode, menuOptions, dialogAnswers } from '../node-editor';
import { adjustStat, grantReward, loadProfile } from './profile';
import { loadQuests, type Quest } from './quests';
import { acceptQuest, completeQuest, failQuest, isTaken } from './questState';

export interface ShopItem { name: string; price: number }

export interface BuildingUi {
  // Сувій з описом і варіантами; повертає індекс вибору або null (закрито).
  showMenu(desc: string, options: string[]): Promise<number | null>;
  // Сувій реплік — показуються послідовно (клік — далі).
  showLines(lines: string[]): Promise<void>;
  toast(text: string): void;
  openBoard(): void;
  openShop(goods: ShopItem[]): Promise<void>;
}

const num = (n: GraphNode, key: string, dflt = 0): number => {
  const v = Number(n.config?.[key]); return Number.isFinite(v) ? v : dflt;
};
const str = (n: GraphNode, key: string): string => String(n.config?.[key] ?? '').trim();
const list = (n: GraphNode, key: string): string[] =>
  String(n.config?.[key] ?? '').split('|').map((s) => s.trim()).filter(Boolean);

// Квест за назвою або id (нода зберігає текст — шукаємо нежорстко).
async function findQuest(ref: string): Promise<Quest | null> {
  if (!ref) return null;
  const store = await loadQuests().catch(() => null);
  const qs = store?.quests ?? [];
  const low = ref.toLowerCase();
  return qs.find((q) => q.id === ref) ?? qs.find((q) => q.title.trim().toLowerCase() === low)
    ?? qs.find((q) => q.title.toLowerCase().includes(low)) ?? null;
}

// Зачіпки до квестів (мікропідказки в «Завданнях»).
const HINTS_LS = 'zag_quest_hints';
export function questHints(): Record<string, string[]> {
  try { return JSON.parse(localStorage.getItem(HINTS_LS) ?? '{}') as Record<string, string[]>; } catch { return {}; }
}
function addHint(questRef: string, hint: string): void {
  const all = questHints();
  const k = questRef || '_';
  (all[k] ??= []);
  if (!all[k].includes(hint)) all[k].push(hint);
  try { localStorage.setItem(HINTS_LS, JSON.stringify(all)); } catch { /* ignore */ }
}

export function parseGoods(n: GraphNode): ShopItem[] {
  // «Пиво:5|Хліб:2» → [{name:'Пиво', price:5}, …]
  return list(n, 'goods').map((s) => {
    const m = s.split(':');
    return { name: m[0]?.trim() || s, price: Math.max(0, Number(m[1]) || 0) };
  });
}

// Обхід графа від кореня. Виконує до 60 нод (захист від циклів).
export async function runBuildingGraph(graph: NodeGraph, ui: BuildingUi): Promise<void> {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const next = (fromId: string, fromPort: number): GraphNode | null => {
    const e = graph.edges.find((x) => x.fromId === fromId && x.fromPort === fromPort);
    return e ? byId.get(e.toId) ?? null : null;
  };
  const root = graph.nodes.find((n) => n.cat === 'root');
  let cur = root ? next(root.id, 0) : null;
  if (!cur) { ui.toast('Тут поки тихо…'); return; }

  for (let guard = 0; cur && guard < 60; guard++) {
    const n: GraphNode = cur;
    let port = 0; // яким виходом іти далі
    switch (n.type) {
      case 'dialog_menu': {
        const options = menuOptions(n);
        const pick = await ui.showMenu(str(n, 'desc'), options);
        if (pick == null) return; // закрив сувій — кінець взаємодії
        port = pick;
        break;
      }
      case 'dialog': {
        const answers = dialogAnswers(n);
        const pick = await ui.showMenu(str(n, 'text'), answers.length ? answers : ['Далі']);
        if (pick == null) return;
        port = pick;
        break;
      }
      case 'dialog_scroll':
        await ui.showLines(list(n, 'lines'));
        break;
      case 'quest_give': {
        const q = await findQuest(str(n, 'quest'));
        if (q && !isTaken(q.id)) { acceptQuest(q); ui.toast(`Нове завдання: ${q.title}`); }
        else if (q) ui.toast(`Завдання вже взято: ${q.title}`);
        else ui.toast('Завдання не знайдено (перевір назву в ноді)');
        break;
      }
      case 'quest_done': {
        const q = await findQuest(str(n, 'quest'));
        if (q) {
          const done = completeQuest(q.id);
          if (done) { grantReward(done.reward); ui.toast(`Квест виконано: ${done.title}`); }
        }
        break;
      }
      case 'quest_fail': {
        const q = await findQuest(str(n, 'quest'));
        if (q) { failQuest(q.id); ui.toast(`Завдання провалено: ${q.title}`); }
        break;
      }
      case 'quest_hint': {
        const hint = str(n, 'hint');
        if (hint) { addHint(str(n, 'quest'), hint); ui.toast(`Зачіпка: ${hint}`); }
        break;
      }
      case 'give_money': { const a = num(n, 'amount', 10); adjustStat('gold', a); ui.toast(`+${a} золота`); break; }
      case 'take_money': {
        const a = num(n, 'amount', 10);
        if (loadProfile().gold >= a) { adjustStat('gold', -a); ui.toast(`−${a} золота`); port = 0; }
        else { ui.toast('Не вистачає золота'); port = 1; }
        break;
      }
      case 'give_xp': { const a = num(n, 'amount', 25); adjustStat('xp', a); ui.toast(`+${a} досвіду`); break; }
      case 'heal': { const a = num(n, 'amount', 25); adjustStat('health', a); ui.toast(`+${a} здоровʼя`); break; }
      case 'give_item': { const it = str(n, 'item'); if (it) { grantReward({ itemId: it }); ui.toast(`Отримано: ${it}`); } break; }
      case 'back_pain_add': { const a = num(n, 'amount', 10); adjustStat('backPain', a); ui.toast(`Біль у спині +${a}`); break; }
      case 'back_pain_sub': { const a = num(n, 'amount', 10); adjustStat('backPain', -a); ui.toast(`Біль у спині −${a}`); break; }
      case 'anxiety_add': { const a = num(n, 'amount', 10); adjustStat('anxiety', a); ui.toast(`Тривожність +${a}`); break; }
      case 'anxiety_sub': { const a = num(n, 'amount', 10); adjustStat('anxiety', -a); ui.toast(`Тривожність −${a}`); break; }
      case 'open_board': ui.openBoard(); break;
      case 'open_shop': await ui.openShop(parseGoods(n)); break;
      // Умови, що мають сенс у локації: перевіряємо; решта — «Так» (port 0).
      case 'stat_check': {
        const p = loadProfile();
        const statKey = str(n, 'stat') || 'health';
        const v = statKey === 'back_pain' ? p.backPain : statKey === 'anxiety' ? p.anxiety : p.health;
        const t = num(n, 'percent', 50);
        const cmp = str(n, 'cmp') || 'lte';
        const ok = cmp === 'lte' ? v <= t : cmp === 'gte' ? v >= t : cmp === 'eq' ? v === t : cmp === 'lt' ? v < t : v > t;
        port = ok ? 0 : 1;
        break;
      }
      case 'time_of_day': port = 0; break; // поки завжди «День»
      case 'then_next': case 'wait': port = 0; break;
      default: port = 0; break;
    }
    cur = next(n.id, port);
  }
}
