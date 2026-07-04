import { ref, set, get, onValue, type Unsubscribe } from 'firebase/database';
import { db } from './firebase';
import { getPlayerId, getPlayerName, getChosenChar } from './multiplayer/lobby';
import { publishMyChar } from './multiplayer/sharedChars';

// Хоругва — загін до 5 гравців. Живе у Firebase: khorugvas/{id}.
// Створюється лідером; інші приєднуються за deep-link (?startapp=kh_<id>)
// зі сповіщення бота. Активна хоругва гравця — localStorage zag_khorugva.

export interface KhMember { id: string; name: string; charId?: string; joinedAt: number }
export interface Khorugva { id: string; leader: string; createdAt: number; members: Record<string, KhMember> }

const LS_KEY = 'zag_khorugva';

// Firebase-проміси при відсутньому з'єднанні НЕ падають, а чекають вічно —
// тож усі виклики зі сторінок обгортаємо таймаутом, щоб UI не зависав.
export function withTimeout<T>(p: Promise<T>, ms = 8000): Promise<T> {
  return Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error('немає з’єднання')), ms))]);
}

export function myKhorugvaId(): string | null { return localStorage.getItem(LS_KEY); }
export function setMyKhorugva(id: string | null): void {
  if (id) localStorage.setItem(LS_KEY, id); else localStorage.removeItem(LS_KEY);
}

function me(): KhMember {
  return { id: getPlayerId(), name: getPlayerName(), charId: getChosenChar() ?? '', joinedAt: Date.now() };
}

export async function createKhorugva(): Promise<string> {
  const m = me();
  const id = 'kh' + Math.random().toString(36).slice(2, 8);
  const kh: Khorugva = { id, leader: m.id, createdAt: Date.now(), members: { [m.id]: m } };
  await withTimeout(set(ref(db, `khorugvas/${id}`), kh));
  setMyKhorugva(id);
  void publishMyChar(); // щоб побратими побачили мій справжній вигляд біля вогнища
  return id;
}

export async function joinKhorugva(id: string): Promise<Khorugva | null> {
  const snap = await withTimeout(get(ref(db, `khorugvas/${id}`)));
  const kh = snap.val() as Khorugva | null;
  if (!kh) return null;
  const m = me();
  if (!kh.members[m.id] && Object.keys(kh.members).length >= 5) throw new Error('Хоругва вже повна (5)');
  await withTimeout(set(ref(db, `khorugvas/${id}/members/${m.id}`), m));
  setMyKhorugva(id);
  void publishMyChar(); // щоб побратими побачили мій справжній вигляд біля вогнища
  kh.members[m.id] = m;
  return kh;
}

// Дані бота для прямих запрошень (мають збігатися з wrangler.toml воркера).
export const BOT_USERNAME = 'Zagaltsi_Bot';
export const APP_SHORT = 'Horugva';

export async function leaveKhorugva(id: string): Promise<void> {
  const myId = getPlayerId();
  setMyKhorugva(null);
  await withTimeout(set(ref(db, `khorugvas/${id}/members/${myId}`), null));
}

export function watchKhorugva(id: string, cb: (kh: Khorugva | null) => void): Unsubscribe {
  return onValue(ref(db, `khorugvas/${id}`), (snap) => cb(snap.val() as Khorugva | null));
}

export async function getKhorugva(id: string): Promise<Khorugva | null> {
  const snap = await withTimeout(get(ref(db, `khorugvas/${id}`)));
  return snap.val() as Khorugva | null;
}

// Учасники в стабільному порядку (лідер перший, далі за часом приєднання).
export function memberList(kh: Khorugva | null): KhMember[] {
  if (!kh) return [];
  return Object.values(kh.members).sort((a, b) =>
    (a.id === kh.leader ? -1 : b.id === kh.leader ? 1 : a.joinedAt - b.joinedAt));
}

// Локальний кеш паті — щоб портрети хоругви показувались МИТТЄВО на будь-якому
// екрані (Мандри/Локація), не чекаючи відповіді Firebase (яка інколи повільна
// й тоді портрети «зникали»). Оновлюється щоразу, коли ми бачимо свіжий стан.
const MEMBERS_CACHE = 'zag_kh_members';
const LEADER_CACHE = 'zag_kh_leader';
export function cacheMembers(list: KhMember[]): void {
  try { localStorage.setItem(MEMBERS_CACHE, JSON.stringify(list)); } catch { /* ignore */ }
}
export function cachedMembers(): KhMember[] {
  if (!myKhorugvaId()) return []; // немає активної хоругви → нема паті
  try { const s = localStorage.getItem(MEMBERS_CACHE); if (s) return JSON.parse(s) as KhMember[]; } catch { /* ignore */ }
  return [];
}
// Хто веде: id лідера кешуємо, щоб СИНХРОННО знати, я головний чи ведений.
export function cacheLeader(leaderId: string | null): void {
  try { if (leaderId) localStorage.setItem(LEADER_CACHE, leaderId); else localStorage.removeItem(LEADER_CACHE); } catch { /* ignore */ }
}
export function iAmLeaderCached(): boolean {
  if (!myKhorugvaId()) return false;
  try { return localStorage.getItem(LEADER_CACHE) === getPlayerId(); } catch { return false; }
}
// Чи я в хоругві з КИМОСЬ (2+) — тоді діють правила «ведений/головний».
export function inPartyCached(): boolean { return !!myKhorugvaId() && cachedMembers().length >= 2; }

// Свіжий список паті: спершу кеш (миттєво), тоді оновлення з Firebase (кешуємо).
export async function refreshMembers(): Promise<KhMember[]> {
  const id = myKhorugvaId();
  if (!id) { cacheMembers([]); cacheLeader(null); return []; }
  try {
    const kh = await getKhorugva(id);
    cacheLeader(kh?.leader ?? null);
    const list = memberList(kh);
    cacheMembers(list);
    return list;
  } catch { return cachedMembers(); }
}

// «Оголосити збір»: пише виклик у Firebase (calls/{nick}) і, якщо задеплоєний
// бот-воркер (VITE_BOT_PROXY), шле сповіщення гравцю в Telegram.
export async function callToGather(nick: string, khId: string): Promise<{ botSent: boolean }> {
  const clean = nick.replace(/^@/, '').trim().toLowerCase();
  if (!clean) throw new Error('Порожній нік');
  await withTimeout(set(ref(db, `calls/${clean}`), { khorugvaId: khId, from: getPlayerName(), at: Date.now() }));
  const proxy = import.meta.env.VITE_BOT_PROXY as string | undefined;
  if (!proxy) return { botSent: false };
  try {
    const r = await fetch(proxy.replace(/\/$/, '') + '/notify', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nick: clean, khorugvaId: khId, from: getPlayerName() }),
    });
    return { botSent: r.ok };
  } catch { return { botSent: false }; }
}
