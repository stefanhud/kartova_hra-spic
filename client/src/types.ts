// Mirrors server/src/game/GameState.ts (ClientView).
export type Suit = 'H' | 'D' | 'C' | 'S';

export interface Card {
  suit: Suit | 'X'; // 'X' = face down / hidden from this viewer
  rank: string;
  value: number;
}

export type Phase = 'WAITING' | 'DEALER_CHOICE' | 'BETTING_1' | 'BETTING_2' | 'DEALER_SPECIAL' | 'TALON_SWAP' | 'SHOWDOWN';

export interface Player {
  id: string;
  name: string;
  seatIndex: number;
  chips: number;     // euro cents (all money is in cents)
  hand: Card[];
  isFolded: boolean;
  bet: number;
  handBets: number;
  debt: number;      // owed to the carried-over pot before playing on
  benched?: boolean; // skipped dealing while owing: out until the pot is won
  specialStatus?: 'BICYKEL';
  isFaceUp?: boolean;
  score?: number;
  hasLooked?: boolean;
  hasActed?: boolean;
  sittingOut?: boolean;
  connected: boolean;
  lastAction?: string;
  handDesc?: string;
}

export interface LogEntry {
  id: number;
  text: string;
}

export interface RoundResult {
  winnerIds: string[];
  amount: number;
  headline: string;
  detail: string;
}

export interface SwapOption {
  h: number;
  t: number;
  score: number;
}

export interface GameView {
  players: Player[];
  pot: number;
  deckRemaining: number;
  phase: Phase;
  turnIndex: number;
  dealerIndex: number;
  currentBet: number;
  talon: Card[];
  log: LogEntry[];
  minScoreToBeat: number;
  swappedPlayers: string[];
  gameWinner: string | null;
  potThreshold: number;
  turnNonce: number;
  turnDeadline: number;
  turnDuration: number;
  raiserSeats: number[];
  raisesThisRound: number;
  lastRaiserId: string | null;
  spicTie: boolean;
  carryTotal: number;
  roundId: number;
  result: RoundResult | null;
  you: string | null;
  serverNow: number;
  swapOptions: SwapOption[];
  canRaise: boolean;
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

// A received view plus the client/server clock difference measured on arrival.
export interface Snapshot {
  view: GameView;
  clockOffset: number; // serverNow - local Date.now() when the state arrived
}

export const isBetting = (phase: Phase) => phase === 'BETTING_1' || phase === 'BETTING_2';
export const isHidden = (c: Card) => c.suit === 'X';
