// server/src/game/Deck.ts
import { Card, Suit, Rank } from './types';

const SUITS: Suit[] = ['H', 'D', 'C', 'S'];
const RANKS: Rank[] = ['7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

export class Deck {
  private cards: Card[] = [];

  constructor() {
    this.reset();
  }

  // Create a fresh 32-card deck
  reset() {
    this.cards = [];
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        this.cards.push({
          suit,
          rank,
          value: this.getCardValue(rank)
        });
      }
    }
    this.shuffle();
  }

  // Fisher-Yates Shuffle Algorithm
  shuffle() {
    for (let i = this.cards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.cards[i], this.cards[j]] = [this.cards[j], this.cards[i]];
    }
  }

  draw(): Card | undefined {
    return this.cards.pop();
  }

  get remaining(): number {
    return this.cards.length;
  }

  // Helper to get numeric value based on "Bar Rules"
  private getCardValue(rank: Rank): number {
    if (rank === 'A') return 11;
    if (['K', 'Q', 'J', '10'].includes(rank)) return 10;
    return parseInt(rank); // 7, 8, 9
  }
}
