// server/src/game/GameState.ts
import { Card, HandCode } from './types';

// Everything the table "says" is sent as a message key + parameters; the phone turns it
// into English or Slovak. Money parameters are euro cents.
export type MsgParam = string | number | boolean | string[] | HandCode | { name: string; amount: number }[] | undefined;
export interface Msg {
  key: string;
  p?: Record<string, MsgParam>;
}

// Short tag shown on a seat after acting ("Call €2", "Swap"…).
export interface ActionTag {
  k: 'check' | 'call' | 'raise' | 'swap' | 'pass' | 'took' | 'fold' | 'bicykel';
  a?: number;
}

export interface Settings {
  turnSeconds: number;
  ante: number;          // cents
  raiseSteps: number[];  // cents
}

export const SETTING_OPTIONS = {
  turnSeconds: [10, 15, 20, 30, 45, 60],
  ante: [20, 50, 100],
  raiseSteps: [[20, 50, 100], [50, 100, 200], [100, 200, 500]],
};

export const DEFAULT_SETTINGS: Settings = { turnSeconds: 15, ante: 50, raiseSteps: [50, 100, 200] };

export type Phase = 'WAITING' | 'DEALER_CHOICE' | 'BETTING_1' | 'BETTING_2' | 'DEALER_SPECIAL' | 'TALON_SWAP' | 'SHOWDOWN';

export interface Player {
  id: string;             // Public id (random). Never the socket id or the secret session token.
  name: string;
  seatIndex: number;      // 0-5 (max 6 players)
  chips: number;           // Euro cents
  bought: number;          // Everything taken from the wallet: buy-in + top-ups (cents); balance = chips - bought
  hand: Card[];
  isFolded: boolean;      // Also true while sitting out a round
  bet: number;            // Bet in the current betting round (cents)
  handBets: number;       // Everything bet this hand, excluding the ante and debt payments (cents)
  debt: number;           // Owed to the carried-over pot before playing on (cents)
  benched?: boolean;      // Skipped their turn to deal while owing: sits out until the pot is won
  specialStatus?: 'BICYKEL';
  isFaceUp?: boolean;
  score?: number;
  hasLooked?: boolean;    // Banker only: peeked at their cards, forfeiting the blind talon privilege
  hasActed?: boolean;     // Acted since the last raise in the current betting round
  sittingOut?: boolean;   // Not dealt into the current round (joined late, offline or out of chips)
  connected: boolean;
  lastAction?: ActionTag; // Short tag shown next to the seat
  handDesc?: HandCode;    // Only filled in client views, for hands the viewer may see
}

export interface LogEntry extends Msg {
  id: number;
}

export interface RoundResult {
  winnerIds: string[];    // Empty when the pot stays on the table
  amount: number;         // Pot won, or pot carried over
  headline: Msg;
  detail: Msg[];          // Shown joined with " · "
}

export interface SwapOption {
  h: number;              // Index in the player's hand
  t: number;              // Index in the talon
  score: number;          // Score after the swap (always beats the current bar)
}

export interface GameState {
  players: Player[];
  pot: number;
  deckRemaining: number;
  phase: Phase;
  turnIndex: number;      // Seat whose turn it is, -1 when nobody is on the clock
  dealerIndex: number;
  currentBet: number;     // The bet everyone has to match this betting round
  talon: Card[];
  log: LogEntry[];
  minScoreToBeat: number; // The score a talon swap has to exceed
  swappedPlayers: string[]; // Player ids who have swapped or passed this talon round
  gameWinner: string | null;
  potThreshold: number;   // Escalation rule: after a tie, the next winner must EXCEED this score
  turnNonce: number;      // Increments every turn (client restarts its countdown)
  turnDeadline: number;   // Server timestamp (ms) when the current turn auto-acts; 0 = no timer
  turnDuration: number;   // Length of the current turn timer in ms
  raiserSeats: number[];  // Seats allowed to raise this betting round (first and last player)
  raisesThisRound: number;
  lastRaiserId: string | null;
  spicTie: boolean;       // The carried pot was tied on Špic: the first Špic takes it
  carryTotal: number;     // Sum of what the finishers paid in every tied hand since the pot was last won
  departed: { name: string; balance: number }[]; // Balances of players who left, for settling up
  hostId: string | null;  // First player to sit down; may change the table settings
  settings: Settings;
  roundId: number;
  result: RoundResult | null;
}

// What each client receives: the shared state with hidden cards masked, plus viewer info.
export interface ClientView extends GameState {
  you: string | null;     // Viewer's player id, null for spectators
  serverNow: number;      // Lets the client correct its clock for the turn timer
  swapOptions: SwapOption[];
  canRaise: boolean;      // Viewer may raise right now
  config: {
    ante: number;
    raiseSteps: number[];
    turnSeconds: number;
    options: typeof SETTING_OPTIONS;
    maxRaises: number;
    minBuyIn: number;
    maxBuyIn: number;
    defaultBuyIn: number;
    seats: number;
  };
}

export function createInitialState(): GameState {
  return {
    players: [],
    pot: 0,
    deckRemaining: 32,
    phase: 'WAITING',
    turnIndex: -1,
    dealerIndex: 0,
    currentBet: 0,
    talon: [],
    log: [{ id: 1, key: 'tableOpen' }],
    minScoreToBeat: 0,
    swappedPlayers: [],
    gameWinner: null,
    potThreshold: 0,
    turnNonce: 0,
    turnDeadline: 0,
    turnDuration: 0,
    raiserSeats: [],
    raisesThisRound: 0,
    lastRaiserId: null,
    spicTie: false,
    carryTotal: 0,
    departed: [],
    hostId: null,
    settings: { ...DEFAULT_SETTINGS },
    roundId: 0,
    result: null,
  };
}
