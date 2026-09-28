// server/src/game/GameState.ts
import { Card } from './types';

export type Phase = 'WAITING' | 'DEALER_CHOICE' | 'BETTING_1' | 'BETTING_2' | 'DEALER_SPECIAL' | 'TALON_SWAP' | 'SHOWDOWN';

export interface Player {
  id: string;             // Public id (random). Never the socket id or the secret session token.
  name: string;
  seatIndex: number;      // 0-5 (max 6 players)
  chips: number;           // Euro cents
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
  lastAction?: string;    // Short label shown next to the seat ("Call €2", "Fold", "Swap"…)
  handDesc?: string;      // Only filled in client views, for hands the viewer may see
}

export interface LogEntry {
  id: number;
  text: string;
}

export interface RoundResult {
  winnerIds: string[];    // Empty when the pot stays on the table
  amount: number;         // Pot won, or pot carried over
  headline: string;
  detail: string;
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
    log: [{ id: 1, text: 'Table open. Waiting for players…' }],
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
    roundId: 0,
    result: null,
  };
}
