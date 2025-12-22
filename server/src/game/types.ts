// server/src/game/types.ts

export type Suit = 'H' | 'D' | 'C' | 'S'; // Hearts, Diamonds, Clubs, Spades
export type Rank = '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A';

export interface Card {
  suit: Suit;
  rank: Rank;
  value: number; // The numeric game value (e.g., A=11, K=10, 7=7)
}

export enum HandType {
  ZLATY_SPIC = 'ZLATY_SPIC', // 3 Aces
  SPIC = 'SPIC',             // 31
  TROJICA = 'TROJICA',       // 30.5
  NORMAL = 'NORMAL',         // Standard flush points
  BICYKEL = 'BICYKEL'        // 3 different suits (Dead hand)
}

export interface HandResult {
  score: number;
  type: HandType;
  description: string; // e.g., "Trojica (Kings)"
}