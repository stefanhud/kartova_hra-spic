// server/src/game/GameState.ts
import { Card } from './types';

export interface Player {
  id: string;          // Socket ID
  name: string;
  seatIndex: number;   // 0-5 (Max 6 players)
  chips: number;
  hand: Card[];        // The cards in their hand
  isFolded: boolean;
  bet: number;         // Current round bet
  specialStatus?: string; // <--- NEW: Can be 'BICYKEL'
  isFaceUp?: boolean;
  score?: number;
  hasLooked?: boolean; // Banker only: peeked at their cards, forfeiting the blind talon privilege
}

export interface GameState {
  players: Player[];
  pot: number;
  deckRemaining: number;
  // Added DEALING_3 phase
  phase: 'WAITING' | 'BETTING_1' | 'DEALING_3' | 'BETTING_2' | 'TALON_SWAP' | 'SHOWDOWN' | 'DEALER_SPECIAL';
  turnIndex: number;
  dealerIndex: number;

  // --- NEW PROPERTIES ---
  currentBet: number;          // Track the high bet to call
  lastRaiserIndex: number | null; // Track who ended the betting round
  // ----------------------

  talon: Card[];
  log: string[];
  minScoreToBeat: number;      // The score the next player must exceed
  swappedPlayers: string[];    // List of player IDs who have acted this round
  gameWinner: string | null;   // ID of the winner
  potThreshold: number;        // Escalation rule: after a tie, the next winner must EXCEED this score
  turnNonce: number;           // Increments each decision turn (client restarts its countdown bar)
  turnDeadline: number;        // Server timestamp (ms) when the current turn auto-acts; 0 = no timer
}

export const INITIAL_STATE: GameState = {
  players: [],
  pot: 0,
  deckRemaining: 32,
  phase: 'WAITING',
  turnIndex: 0,
  dealerIndex: 0,

  // --- NEW INITIAL VALUES ---
  currentBet: 0,
  lastRaiserIndex: null,
  // --------------------------

  talon: [],
  log: ['Game room initialized. Waiting for players...'],
  minScoreToBeat: 0,
  swappedPlayers: [],
  gameWinner: null,
  potThreshold: 0,
  turnNonce: 0,
  turnDeadline: 0,
};
