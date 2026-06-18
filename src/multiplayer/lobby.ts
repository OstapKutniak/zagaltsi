// Multiplayer lobby — Firebase Realtime Database
// Host creates a 4-char code; others join with that code.
// Once host hits Start, all clients transition to game.

import { db } from '../firebase';
import {
  ref, set, get, onValue, remove, onDisconnect,
  serverTimestamp, off, type Unsubscribe,
} from 'firebase/database';

export interface LobbyPlayer {
  id: string;
  name: string;
  ready: boolean;
  joinedAt: number;
}

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
  const player: LobbyPlayer = { id: playerId, name: getPlayerName(), ready: true, joinedAt: Date.now() };
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
  const player: LobbyPlayer = { id: playerId, name: getPlayerName(), ready: true, joinedAt: Date.now() };
  await set(ref(db, `lobbies/${upper}/players/${playerId}`), player);
  onDisconnect(ref(db, `lobbies/${upper}/players/${playerId}`)).remove();
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
  x: number; y: number;
  hp: number; maxHp: number;
  anim: string; facing: number;
  t: number; // timestamp
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
