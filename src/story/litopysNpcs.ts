// НПС зі світу «Літопису» (content/litopys/world/{nodeId}) — у ГРІ.
// Літопис (public/quests/) — текстовий редактор світу: локації зі спорудами,
// НПС із деревами діалогів (репліки з умовами показу й діями видати/здати/ціль),
// дошки. Тут: завантаження НПС вузла карти + програвач діалогу поверх сцени
// (стиль dialogPlay), який ЧЕСНО грає семантику Літопису через questState:
//   cond {questId,state} — репліка видна лише в цьому стані квеста;
//   give — взяти квест (видно лише поки не взято);
//   obj  — виконати конкретну ціль (видно лише поки активний і ціль не закрита);
//   turnin — здати (видно в активного; ЗАБЛОКОВАНО, поки всі цілі не виконані).

import { ref, get } from 'firebase/database';
import { db } from '../firebase';
import {
  questDefById, questStatus, acceptQuest, completeQuest,
  completeObjectiveById, objectiveComplete, allObjectivesComplete,
} from './questState';
import type { Quest } from './quests';

export interface LitReply {
  id: string; label: string; say: string;
  replies: LitReply[];
  action?: { type: 'give' | 'turnin' | 'obj'; questId: string; oid?: string };
  cond?: { questId: string; state: 'idle' | 'active' | 'done' };
}
export interface LitNpc { id: string; name: string; dlg: { text: string; replies: LitReply[] } }
export interface LitPlacedNpc { npc: LitNpc; place: string } // place = назва споруди ('' = надворі)

// Firebase губить порожні масиви — відновлюємо структуру вглиб (як у Літописі).
function normReplies(list: unknown): LitReply[] {
  return ((list as LitReply[]) || []).map((r) => ({
    id: r.id, label: r.label || '', say: r.say || '',
    replies: normReplies(r.replies),
    ...(r.action ? { action: r.action } : {}),
    ...(r.cond ? { cond: r.cond } : {}),
  }));
}
function normNpc(n: { id: string; name?: string; dlg?: { text?: string; replies?: unknown } }): LitNpc {
  return { id: n.id, name: n.name || '', dlg: { text: n.dlg?.text || '', replies: normReplies(n.dlg?.replies) } };
}

// НПС локації: свої (надворі) + мешканці споруд (place = назва споруди).
export async function loadLitopysNpcs(nodeId: string): Promise<LitPlacedNpc[]> {
  // Headless-тести: Firebase недоступний — світ підкладається через window-стаб.
  if (import.meta.env.DEV) {
    const stub = (window as unknown as { __litStub?: Record<string, LitPlacedNpc[]> }).__litStub;
    if (stub) return stub[nodeId] ?? [];
  }
  const snap = await get(ref(db, `content/litopys/world/${nodeId}`));
  const loc = snap.val() as {
    deleted?: boolean;
    npcs?: Array<{ id: string; name?: string; dlg?: { text?: string; replies?: unknown } }>;
    buildings?: Array<{ name?: string; npcs?: Array<{ id: string; name?: string; dlg?: { text?: string; replies?: unknown } }> }>;
  } | null;
  if (!loc || loc.deleted) return [];
  const out: LitPlacedNpc[] = [];
  for (const n of loc.npcs || []) out.push({ npc: normNpc(n), place: '' });
  for (const b of loc.buildings || []) for (const n of b.npcs || []) out.push({ npc: normNpc(n), place: b.name || '' });
  return out.filter((x) => x.npc.name);
}

// ── Видимість репліки (та сама логіка, що в Літописі, але над questState) ─────
type Vis = 'ok' | 'locked' | 'hidden';
function replyVisible(rep: LitReply): Vis {
  if (rep.cond) {
    const st = questStatus(rep.cond.questId); // null = не взято
    const want = rep.cond.state;
    const cur = st === 'active' ? 'active' : st === 'done' ? 'done' : 'idle';
    if (cur !== want) return 'hidden';
  }
  if (!rep.action) return 'ok';
  const st = questStatus(rep.action.questId);
  if (rep.action.type === 'give') return st == null ? 'ok' : 'hidden';
  if (st !== 'active') return 'hidden';
  if (rep.action.type === 'obj') {
    return rep.action.oid && !objectiveComplete(rep.action.questId, rep.action.oid) ? 'ok' : 'hidden';
  }
  return allObjectivesComplete(rep.action.questId) ? 'ok' : 'locked'; // turnin-гейт
}

// Дія репліки → questState. Повертає підказку-тост і завершений квест (як є).
function applyAction(rep: LitReply): { toast?: string; done?: Quest } {
  const a = rep.action; if (!a) return {};
  if (a.type === 'give') {
    const def = questDefById(a.questId);
    if (def) { acceptQuest(def); return { toast: `Нове завдання: «${def.title}»` }; }
    return {};
  }
  if (a.type === 'obj') {
    const completed = a.oid ? completeObjectiveById(a.questId, a.oid) : null;
    return completed ? { done: completed } : { toast: 'Виконано' };
  }
  const completed = completeQuest(a.questId);
  return completed ? { done: completed } : {};
}

// ── Програвач діалогу (DOM поверх канваса, стиль dialogPlay) ──────────────────
let active: HTMLElement | null = null;
export function closeLitopysDialog(): void { active?.remove(); active = null; }

export function playLitopysNpc(
  npc: LitNpc,
  opts?: { onToast?: (msg: string) => void; onQuestDone?: (q: Quest) => void; onClose?: () => void },
): void {
  closeLitopysDialog();
  const root = document.createElement('div');
  root.style.cssText = 'position:fixed;left:50%;bottom:16%;transform:translateX(-50%);z-index:60;' +
    'max-width:min(560px,86vw);display:flex;flex-direction:column;gap:10px;align-items:center;font-family:Georgia,serif';
  const bubble = document.createElement('div');
  bubble.style.cssText = 'position:relative;background:#f5efdd;color:#241b12;border:3px solid #1b1b1b;' +
    'border-radius:14px;padding:14px 40px 14px 18px;font-size:17px;line-height:1.45;box-shadow:0 8px 22px rgba(0,0,0,.5)';
  const who = document.createElement('div');
  who.textContent = npc.name;
  who.style.cssText = 'font-size:12px;letter-spacing:.08em;text-transform:uppercase;opacity:.65;margin-bottom:4px';
  const txt = document.createElement('span');
  const x = document.createElement('button');
  x.textContent = '✕';
  x.style.cssText = 'position:absolute;top:6px;right:8px;background:none;border:0;color:#241b12;font-size:15px;cursor:pointer';
  const ans = document.createElement('div');
  ans.style.cssText = 'display:flex;flex-direction:column;gap:6px;width:100%';
  bubble.appendChild(who); bubble.appendChild(txt); bubble.appendChild(x);
  root.appendChild(bubble); root.appendChild(ans);
  document.body.appendChild(root);
  active = root;

  const done = (): void => { closeLitopysDialog(); opts?.onClose?.(); };
  x.onclick = done;

  const mkChoice = (label: string, locked: boolean, on: () => void): HTMLButtonElement => {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = 'background:#2b1f16;color:#e5d8bc;border:2px solid #1b1b1b;border-radius:10px;' +
      'padding:9px 14px;font-size:15px;font-family:inherit;cursor:pointer;text-align:left' +
      (locked ? ';opacity:.55;border-style:dashed;cursor:default' : '');
    if (!locked) {
      b.onmouseenter = (): void => { b.style.background = '#4a3524'; };
      b.onmouseleave = (): void => { b.style.background = '#2b1f16'; };
      b.onclick = on;
    }
    return b;
  };

  // Показ вузла: текст НПС + видимі відповіді (перерахунок видимості щоразу —
  // дії міняють стан квестів, і гілки живо зникають/зʼявляються).
  // (DEV-експорт для headless-тестів — унизу файлу.)
  const show = (text: string, replies: LitReply[]): void => {
    txt.textContent = text || '…';
    ans.innerHTML = '';
    let any = false;
    for (const rep of replies) {
      const vis = replyVisible(rep);
      if (vis === 'hidden') continue;
      any = true;
      const locked = vis === 'locked';
      const label = locked ? rep.label + ' (ще не виконано)' : rep.label;
      ans.appendChild(mkChoice(label, locked, () => {
        const fx = applyAction(rep);
        if (fx.toast) opts?.onToast?.(fx.toast);
        if (fx.done) opts?.onQuestDone?.(fx.done);
        if (rep.say || rep.replies.length) show(rep.say, rep.replies);
        else done();
      }));
    }
    if (!any) ans.appendChild(mkChoice('Далі', false, done));
  };
  show(npc.dlg.text, npc.dlg.replies);
}

// Dev-only: прямий доступ для headless-верифікації (без Firebase/кліків по канвасу).
if (import.meta.env.DEV) {
  (window as unknown as { __litopys?: unknown }).__litopys = { playLitopysNpc, closeLitopysDialog, loadLitopysNpcs };
}
