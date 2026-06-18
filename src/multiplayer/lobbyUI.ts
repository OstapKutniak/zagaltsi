// Lobby UI controller — manages screens: menu → join/create → waiting room → game
import {
  createLobby, joinLobby, leaveLobby, startGame, watchLobby,
  getPlayerId, type LobbyState,
} from './lobby';

const $ = (id: string) => document.getElementById(id)!;

let currentCode = '';
let unwatch: (() => void) | null = null;

function showScreen(name: 'menu' | 'join' | 'room'): void {
  ($('lb-menu')).style.display = name === 'menu' ? 'flex' : 'none';
  ($('lb-join')).style.display = name === 'join' ? 'flex' : 'none';
  ($('lb-room')).style.display = name === 'room' ? 'flex' : 'none';
  ($('lb-menu')).style.flexDirection = 'column';
  ($('lb-menu')).style.alignItems = 'center';
  ($('lb-menu')).style.gap = '16px';
}

function renderPlayers(state: LobbyState): void {
  const box = $('lb-players');
  box.innerHTML = '';
  const playerId = getPlayerId();
  const isHost = state.host === playerId;
  for (const p of Object.values(state.players ?? {})) {
    const row = document.createElement('div');
    row.className = 'player-row';
    const dot = document.createElement('div'); dot.className = 'dot';
    const name = document.createElement('span');
    name.textContent = p.name + (state.host === p.id ? ' 👑' : '');
    row.appendChild(dot); row.appendChild(name);
    box.appendChild(row);
  }
  const startBtn = $('lb-start') as HTMLButtonElement;
  const count = Object.keys(state.players ?? {}).length;
  startBtn.style.display = isHost ? 'block' : 'none';
  startBtn.disabled = count < 1;
  startBtn.textContent = count < 2 ? 'Почати (очікування друзів...)' : `Почати гру (${count}/5)`;
  if (count >= 2) startBtn.disabled = false;
}

function stopWatching(): void {
  if (unwatch) { unwatch(); unwatch = null; }
}

function enterRoom(code: string): void {
  currentCode = code;
  ($('lb-room-code')).textContent = code;
  ($('lb-room-err')).textContent = '';
  showScreen('room');
  stopWatching();
  unwatch = watchLobby(code, (state) => {
    if (!state) {
      // Lobby dissolved
      ($('lb-room-err')).textContent = 'Лобі закрито хостом';
      setTimeout(() => showScreen('menu'), 2000);
      stopWatching();
      return;
    }
    renderPlayers(state);
    if (state.status === 'playing') {
      // Game started — hide lobby, pass code to game
      stopWatching();
      hideLobby(code);
    }
  });
}

export function showLobby(): void {
  $('lobby').classList.remove('hidden');
  showScreen('menu');
}

export function hideLobby(lobbyCode?: string): void {
  $('lobby').classList.add('hidden');
  // Notify game scene via custom event
  window.dispatchEvent(new CustomEvent('lobbyStart', { detail: { code: lobbyCode ?? '' } }));
}

export function initLobbyUI(): void {
  showLobby();

  // Solo — skip lobby
  $('lb-solo').addEventListener('click', () => hideLobby(undefined));

  // Create lobby
  $('lb-create').addEventListener('click', async () => {
    ($('lb-create') as HTMLButtonElement).disabled = true;
    try {
      const code = await createLobby();
      enterRoom(code);
    } catch (e) {
      alert('Помилка: ' + String(e));
    } finally {
      ($('lb-create') as HTMLButtonElement).disabled = false;
    }
  });

  // Show join screen
  $('lb-join-btn').addEventListener('click', () => {
    ($('lb-code-input') as HTMLInputElement).value = '';
    ($('lb-join-err')).textContent = '';
    showScreen('join');
  });

  $('lb-join-back').addEventListener('click', () => showScreen('menu'));

  // Join confirm
  $('lb-join-confirm').addEventListener('click', async () => {
    const code = ($('lb-code-input') as HTMLInputElement).value.trim().toUpperCase();
    if (code.length !== 4) { ($('lb-join-err')).textContent = 'Код — 4 символи'; return; }
    ($('lb-join-confirm') as HTMLButtonElement).disabled = true;
    ($('lb-join-err')).textContent = '';
    try {
      await joinLobby(code);
      enterRoom(code);
    } catch (e) {
      ($('lb-join-err')).textContent = String(e);
    } finally {
      ($('lb-join-confirm') as HTMLButtonElement).disabled = false;
    }
  });

  // Input: auto-uppercase
  $('lb-code-input').addEventListener('input', (e) => {
    const el = e.target as HTMLInputElement;
    el.value = el.value.toUpperCase();
  });

  // Start game (host only)
  $('lb-start').addEventListener('click', async () => {
    ($('lb-start') as HTMLButtonElement).disabled = true;
    try { await startGame(currentCode); } catch { ($('lb-start') as HTMLButtonElement).disabled = false; }
  });

  // Leave lobby
  $('lb-leave').addEventListener('click', async () => {
    stopWatching();
    await leaveLobby(currentCode).catch(() => {});
    currentCode = '';
    showScreen('menu');
  });
}
