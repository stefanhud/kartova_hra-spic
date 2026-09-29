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
  bought: number;    // buy-in + top-ups; running score = chips - bought
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
  lastAction?: ActionTag;
  handDesc?: HandCode;
}

// Language-neutral messages: the client turns them into English or Slovak (see i18n.ts).
export interface HandCode {
  k: 'zlaty' | 'spic' | 'trojica' | 'flush' | 'none' | 'bicykel' | 'partial';
  v?: number | string;
}

export interface ActionTag {
  k: 'check' | 'call' | 'raise' | 'swap' | 'pass' | 'took' | 'fold' | 'bicykel';
  a?: number;
}

export interface Msg {
  key: string;
  p?: Record<string, unknown>;
}

export interface LogEntry extends Msg {
  id: number;
}

export interface RoundResult {
  winnerIds: string[];
  amount: number;
  headline: Msg;
  detail: Msg[];
}

export interface Settings {
  turnSeconds: number;
  ante: number;
  raiseSteps: number[];
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
  departed: { name: string; balance: number }[];
  hostId: string | null;
  roundId: number;
  result: RoundResult | null;
  you: string | null;
  serverNow: number;
  swapOptions: SwapOption[];
  canRaise: boolean;
  config: {
    ante: number;
    raiseSteps: number[];
    turnSeconds: number;
    options: { turnSeconds: number[]; ante: number[]; raiseSteps: number[][] };
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
