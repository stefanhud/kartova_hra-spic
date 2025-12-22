// server/src/game/HandEvaluator.ts
import { Card, HandResult, HandType } from './types';

// Add isFlush to the interface
export interface ExtendedHandResult extends HandResult {
  isFlush?: boolean;
}

export class HandEvaluator {
  
  static evaluate(cards: Card[]): ExtendedHandResult {
    if (!cards || cards.length < 3) {
      return this.calculateBestSuitSum(cards);
    }

    // 1. CHECK FOR ZLATÝ ŠPIC (3 Aces)
    if (cards.every(c => c.rank === 'A')) {
      return { score: 33, type: HandType.ZLATY_SPIC, description: 'Zlatý špic (3 Aces)', isFlush: false };
    }

    // 2. CHECK FOR TROJICA (3 of a kind)
    const firstRank = cards[0].rank;
    if (cards.every(c => c.rank === firstRank)) {
      return { score: 30.5, type: HandType.TROJICA, description: `Trojica (${firstRank}s)`, isFlush: false };
    }

    // 3. CHECK FOR BICYKEL
    const suitCounts: Record<string, number> = { H: 0, D: 0, C: 0, S: 0 };
    const rankCounts: Record<string, number> = {};
    
    cards.forEach(card => {
      suitCounts[card.suit]++;
      rankCounts[card.rank] = (rankCounts[card.rank] || 0) + 1;
    });

    let suitsPresent = 0;
    let maxSuitCount = 0;
    Object.values(suitCounts).forEach(count => { 
        if (count > 0) suitsPresent++; 
        if (count > maxSuitCount) maxSuitCount = count;
    });
    
    let hasPair = false;
    Object.values(rankCounts).forEach(count => { if (count > 1) hasPair = true; });

    // Bicykel Logic
    if (suitsPresent === 3 && !hasPair) {
      return { score: 0, type: HandType.BICYKEL, description: 'Bicykel', isFlush: false };
    }

    // 4. CALCULATE NORMAL SCORE
    const suitSums: Record<string, number> = { H: 0, D: 0, C: 0, S: 0 };
    cards.forEach(card => suitSums[card.suit] += card.value);

    let maxScore = 0;
    Object.values(suitSums).forEach(score => {
      if (score > maxScore) maxScore = score;
    });

    // IS FLUSH? (Must have 3 cards of same suit)
    const isFlush = (maxSuitCount === 3);

    return {
      score: maxScore,
      type: maxScore === 31 ? HandType.SPIC : HandType.NORMAL,
      description: maxScore === 31 ? 'Špic!' : `Points: ${maxScore}`,
      isFlush: isFlush
    };
  }

  private static calculateBestSuitSum(cards: Card[]): ExtendedHandResult {
    if (cards.length === 0) return { score: 0, type: HandType.NORMAL, description: 'Empty' };
    const suitSums: Record<string, number> = { H: 0, D: 0, C: 0, S: 0 };
    cards.forEach(c => suitSums[c.suit] += c.value);
    const max = Math.max(...Object.values(suitSums));
    return { score: max, type: HandType.NORMAL, description: `Partial: ${max}` };
  }
  
  static getBestSubset(cards: Card[]): { indices: number[], result: ExtendedHandResult } | null {
    if (cards.length < 3) return null;

    let bestScore = -1;
    let bestIndices: number[] | null = null;
    let bestResult: ExtendedHandResult | null = null;

    const combos = [[0, 1, 2], [0, 1, 3], [0, 2, 3], [1, 2, 3]];

    for (const indices of combos) {
      const subHand = indices.map(i => cards[i]);
      const res = this.evaluate(subHand);

      // We track the best score, but later we will check 'res.isFlush' or 'res.type'
      if (res.score > bestScore) {
        bestScore = res.score;
        bestIndices = indices;
        bestResult = res;
      }
    }

    if (bestIndices && bestResult) {
      return { indices: bestIndices, result: bestResult };
    }
    return null;
  }
}