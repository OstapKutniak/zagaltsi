// Multiplayer lobby — Firebase Realtime Database
// Host creates a 4-char code; others join with that code.
// Once host hits Start, all clients transition to game.

import { db } from '../firebase';
import {
  ref, set, get, onValue, remove, onDisconnect, push, onChildAdded,
  serverTimestamp, off, type Unsubscribe,
} from 'firebase/database';

export interface LobbyPlayer {
  id: string;
  name: string;
  ready: boolean;
  joinedAt: number;
  charId?: string; // обраний персонаж із бібліотеки (id LibItem)
}

// Обраний персонаж зберігається локально (на цьому браузері) між сесіями.
export function getChosenChar(): string | null { return localStorage.getItem('zag_chosen_char'); }
export function setChosenChar(id: string): void { localStorage.setItem('zag_chosen_char', id); }

export interface LobbyState {
  host: string;
  status: 'waiting' | 'playing';
  createdAt: number;
  players: Record<string, LobbyPlayer>;
}

// Unique player id — Telegram user id or random, persisted in localStorage
export function getPlayerId(): string {
  const tg = (window as unknown as { Telegram?: { WebApp?: { initDataUnsafe?: { user?: { id?: number } } } } }).Telegram?.WebApp;
  const tgId = tg?.initDataUnsafe?.user?.id;
  if (tgId) return String(tgId);
  let id = localStorage.getItem('zag_player_id');
  if (!id) { id = 'p' + Math.random().toString(36).slice(2, 10); localStorage.setItem('zag_player_id', id); }
  return id;
}

export function getPlayerName(): string {
  const tg = (window as unknown as { Telegram?: { WebApp?: { initDataUnsafe?: { user?: { first_name?: string } } } } }).Telegram?.WebApp;
  return tg?.initDataUnsafe?.user?.first_name ?? localStorage.getItem('zag_player_name') ?? 'Гравець';
}

function randomCode(): string {
  return Math.random().toString(36).slice(2, 6).toUpperCase();
}

// Create lobby — returns lobby code
export async function createLobby(): Promise<string> {
  const playerId = getPlayerId();
  const code = randomCode();
  const lobbyRef = ref(db, `lobbies/${code}`);
  const player: LobbyPlayer = { id: playerId, name: getPlayerName(), ready: true, joinedAt: Date.now(), charId: getChosenChar() ?? '' };
  const lobby: LobbyState = {
    host: playerId,
    status: 'waiting',
    createdAt: Date.now(),
    players: { [playerId]: player },
  };
  await set(lobbyRef, lobby);
  // Auto-cleanup when host disconnects
  onDisconnect(lobbyRef).remove();
  // Cleanup own player slot on disconnect
  onDisconnect(ref(db, `lobbies/${code}/players/${playerId}`)).remove();
  return code;
}

// Join existing lobby — throws if not found or full
export async function joinLobby(code: string): Promise<void> {
  const upper = code.toUpperCase();
  const lobbyRef = ref(db, `lobbies/${upper}`);
  const snap = await get(lobbyRef);
  if (!snap.exists()) throw new Error('Лобі не знайдено');
  const lobby = snap.val() as LobbyState;
  if (lobby.status === 'playing') throw new Error('Гра вже розпочалась');
  const count = Object.keys(lobby.players ?? {}).length;
  if (count >= 5) throw new Error('Лобі повне (макс. 5 гравців)');

  const playerId = getPlayerId();
  const player: LobbyPlayer = { id: playerId, name: getPlayerName(), ready: true, joinedAt: Date.now(), charId: getChosenChar() ?? '' };
  await set(ref(db, `lobbies/${upper}/players/${playerId}`), player);
  onDisconnect(ref(db, `lobbies/${upper}/players/${playerId}`)).remove();
}

// Оновити обраного персонажа у своєму слоті лобі (поки чекаємо в кімнаті).
export function setLobbyChar(code: string, charId: string): void {
  const playerId = getPlayerId();
  set(ref(db, `lobbies/${code.toUpperCase()}/players/${playerId}/charId`), charId).catch(() => {});
}

// Прочитати гравців лобі один раз (для порядку спавну й персонажів на старті гри).
export async function getLobbyPlayers(code: string): Promise<LobbyPlayer[]> {
  const snap = await get(ref(db, `lobbies/${code.toUpperCase()}/players`));
  if (!snap.exists()) return [];
  return Object.values(snap.val() as Record<string, LobbyPlayer>).sort((a, b) => a.joinedAt - b.joinedAt);
}

// Subscribe to lobby state changes
export function watchLobby(code: string, cb: (state: LobbyState | null) => void): Unsubscribe {
  const r = ref(db, `lobbies/${code.toUpperCase()}`);
  onValue(r, (snap) => cb(snap.exists() ? (snap.val() as LobbyState) : null));
  return () => off(r);
}

// Host starts the game
export async function startGame(code: string): Promise<void> {
  await set(ref(db, `lobbies/${code.toUpperCase()}/status`), 'playing');
}

// Leave lobby (remove own player slot)
export async function leaveLobby(code: string): Promise<void> {
  const playerId = getPlayerId();
  await remove(ref(db, `lobbies/${code.toUpperCase()}/players/${playerId}`));
}

// ---- In-game player state sync ----

export interface PlayerState {
  x: number; y: number; z: number; // z — висота підскоку (стрибок)
  hp: number; maxHp: number;
  anim: string; facing: number;
  charId: string; name: string;
  t: number; // timestamp
  equip?: { pants?: boolean; armor?: boolean; helmet?: boolean; weapon?: boolean }; // спорядження (кооп)
}

export function pushPlayerState(code: string, state: PlayerState): void {
  const playerId = getPlayerId();
  set(ref(db, `lobbies/${code.toUpperCase()}/state/${playerId}`), state).catch(() => {});
}

export function watchGameState(
  code: string,
  cb: (states: Record<string, PlayerState>) => void,
): Unsubscribe {
  const r = ref(db, `lobbies/${code.toUpperCase()}/state`);
  onValue(r, (snap) => cb(snap.exists() ? (snap.val() as Record<string, PlayerState>) : {}));
  return () => off(r);
}

// ---- Host-authoritative вороги (кооп) ----
// Проблема: кожен клієнт крутив СВОЮ симуляцію ворогів → позиції/кіли не збігались.
// Рішення: один клієнт-господар (детерм. обраний — найменший id серед присутніх)
// рахує ворогів і транслює їхній стан у lobbies/{code}/enemies; решта дзеркалять.
// Удари гравців→ворогам і ворогів→гравцям — події (onChildAdded + видалення після
// обробки), щоб маршрутизувати шкоду до правильного клієнта.

export interface EnemyNet { x: number; y: number; z: number; a: string; f: number; hp: number }
export interface EnemyHit { netId: number; dmg: number; fromX: number }
export interface DmgEvent { dmg: number; fromX: number }

// Хост пише повний знімок живих ворогів (netId → стан). Відсутній netId = загинув.
export function pushEnemies(code: string, enemies: Record<string, EnemyNet>): void {
  set(ref(db, `lobbies/${code.toUpperCase()}/enemies`), enemies).catch(() => {});
}
export function watchEnemies(code: string, cb: (e: Record<string, EnemyNet>) => void): Unsubscribe {
  const r = ref(db, `lobbies/${code.toUpperCase()}/enemies`);
  onValue(r, (snap) => cb(snap.exists() ? (snap.val() as Record<string, EnemyNet>) : {}));
  return () => off(r);
}

// Удар гравця по ворогу (не-хост → хост): хост застосовує подію і видаляє її.
export function pushEnemyHit(code: string, hit: EnemyHit): void {
  push(ref(db, `lobbies/${code.toUpperCase()}/ehits`), hit).catch(() => {});
}
export function watchEnemyHits(code: string, cb: (h: EnemyHit) => void): Unsubscribe {
  const r = ref(db, `lobbies/${code.toUpperCase()}/ehits`);
  const h = onChildAdded(r, (snap) => { const v = snap.val() as EnemyHit | null; if (v) cb(v); void remove(snap.ref); });
  return () => off(r, 'child_added', h);
}

// Удар ворога по гравцю (хост → жертва): подія в чергу конкретного гравця.
export function pushPlayerDamage(code: string, victimId: string, ev: DmgEvent): void {
  push(ref(db, `lobbies/${code.toUpperCase()}/pdmg/${victimId}`), ev).catch(() => {});
}
export function watchMyDamage(code: string, myId: string, cb: (ev: DmgEvent) => void): Unsubscribe {
  const r = ref(db, `lobbies/${code.toUpperCase()}/pdmg/${myId}`);
  const h = onChildAdded(r, (snap) => { const v = snap.val() as DmgEvent | null; if (v) cb(v); void remove(snap.ref); });
  return () => off(r, 'child_added', h);
}

// Діалог ворога (кооп): хост веде його й транслює поточну ноду; всі БАЧАТЬ кульку,
// але обирати відповіді може лише хост. null = діалог закрито.
export interface DialogSync { netId: number; nodeId: string }
export function pushDialog(code: string, state: DialogSync | null): void {
  set(ref(db, `lobbies/${code.toUpperCase()}/dialog`), state).catch(() => {});
}
export function watchDialog(code: string, cb: (s: DialogSync | null) => void): Unsubscribe {
  const r = ref(db, `lobbies/${code.toUpperCase()}/dialog`);
  onValue(r, (snap) => cb(snap.exists() ? (snap.val() as DialogSync) : null));
  return () => off(r);
}
