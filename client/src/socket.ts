import { io } from 'socket.io-client';

// Each browser tab keeps a secret session token so the server can give you your seat,
// chips and cards back after a reload or a dropped connection (phones do this a lot).
//  - sessionStorage: the token of this tab (survives reloads).
//  - localStorage: the token of the last tab that sat down, so reopening the game after
//    closing the tab still finds your seat. The server refuses it if that session is
//    still open in another tab, and then this tab simply starts a fresh session.
const SESSION_KEY = 'spic.session';
const LAST_SEAT_KEY = 'spic.lastSeat';

function read(storage: () => Storage, key: string): string | null {
  try {
    return storage().getItem(key);
  } catch {
    return null;
  }
}

function write(storage: () => Storage, key: string, value: string | null) {
  try {
    if (value === null) storage().removeItem(key);
    else storage().setItem(key, value);
  } catch {
    /* private mode: sessions just won't survive reloads */
  }
}

function randomToken() {
  // crypto.getRandomValues also works on plain-http LAN addresses (randomUUID doesn't).
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

let token = read(() => sessionStorage, SESSION_KEY);
let adopt = false;
if (!token) {
  const last = read(() => localStorage, LAST_SEAT_KEY);
  if (last) {
    token = last;
    adopt = true;
  } else {
    token = randomToken();
  }
  write(() => sessionStorage, SESSION_KEY, token);
}

// In dev the Vite server runs on 5173 and the game server on 3001.
const SERVER_URL = window.location.port === '5173'
  ? `${window.location.protocol}//${window.location.hostname}:3001`
  : undefined;

export const socket = io(SERVER_URL, {
  transports: ['websocket', 'polling'],
  auth: cb => cb({ token, adopt }),
});

let retryWithFreshToken = false;

socket.on('connect', () => {
  adopt = false;
});

// Our remembered session is open in another tab: start a separate one here.
socket.on('tokenInUse', () => {
  token = randomToken();
  adopt = false;
  write(() => sessionStorage, SESSION_KEY, token);
  retryWithFreshToken = true;
});

socket.on('disconnect', () => {
  if (retryWithFreshToken) {
    retryWithFreshToken = false;
    socket.connect();
  }
});

export function rememberSeat() {
  write(() => localStorage, LAST_SEAT_KEY, token);
}

export function forgetSeat() {
  if (read(() => localStorage, LAST_SEAT_KEY) === token) write(() => localStorage, LAST_SEAT_KEY, null);
}

const PREFS_KEY = 'spic.prefs';

export function loadPrefs(): { name: string; buyIn: number } {
  try {
    const p = JSON.parse(read(() => localStorage, PREFS_KEY) ?? '{}');
    return { name: typeof p.name === 'string' ? p.name : '', buyIn: Number(p.buyIn) || 50 };
  } catch {
    return { name: '', buyIn: 50 };
  }
}

export function savePrefs(prefs: { name: string; buyIn: number }) {
  write(() => localStorage, PREFS_KEY, JSON.stringify(prefs));
}
