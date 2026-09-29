// server/src/game/HandEvaluator.ts
import { Card, HandResult, HandType } from './types';

// Add isFlush to the interface
export interface ExtendedHandResult extends HandResult {
  isFlush?: boolean;
  tieBreak?: number; // Secondary comparison: rank of the Trojica (KKK > QQQ)
}

// Rank order for Trojica tie-breaks (7 lowest, A highest)
const RANK_ORDER: Record<string, number> = { '7': 1, '8': 2, '9': 3, '10': 4, 'J': 5, 'Q': 6, 'K': 7, 'A': 8 };

export class HandEvaluator {
  // Compare two hands the way the showdown does: score first, then the Trojica rank
  // (888 beats 777 although both score 30.5). 0 = a real tie.
  static compare(a: { score: number; tieBreak?: number }, b: { score: number; tieBreak?: number }): number {
    return a.score - b.score || (a.tieBreak ?? 0) - (b.tieBreak ?? 0);
  }


  static evaluate(cards: Card[]): ExtendedHandResult {
    if (!cards || cards.length < 3) {
      return this.calculateBestSuitSum(cards);
    }

    // 1. CHECK FOR ZLATÝ ŠPIC (3 Aces)
    if (cards.every(c => c.rank === 'A')) {
      return { score: 33, type: HandType.ZLATY_SPIC, description: 'Zlatý špic', code: { k: 'zlaty' }, isFlush: false };
    }

    // 2. CHECK FOR TROJICA (3 of a kind)
    const firstRank = cards[0].rank;
    if (cards.every(c => c.rank === firstRank)) {
      return { score: 30.5, type: HandType.TROJICA, description: `Trojica ${firstRank}`, code: { k: 'trojica', v: firstRank }, isFlush: false, tieBreak: RANK_ORDER[firstRank] };
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

    const hasPair = Object.values(rankCounts).some(count => count >= 2);

    // BICYKEL (Dead Hand): 3 cards of three different suits AND no pair.
    // - No pair + all different suits => can never reach a flush (one swap gets you at
    //   most two of a suit) and can never reach a Trojica => truly dead.
    // - A pair is NOT dead: swapping the odd card for a matching rank from the table
    //   makes a Trojica (30.5), e.g. K♥ K♦ 9♠ + a King => KKK.
    if (suitsPresent === 3 && !hasPair) {
      return { score: 0, type: HandType.BICYKEL, description: 'Bicykel', code: { k: 'bicykel' }, isFlush: false };
    }

    // 4. CALCULATE SCORE
    const suitSums: Record<string, number> = { H: 0, D: 0, C: 0, S: 0 };
    cards.forEach(card => suitSums[card.suit] += card.value);

    let maxScore = 0;
    Object.values(suitSums).forEach(score => {
      if (score > maxScore) maxScore = score;
    });

    // IS FLUSH? (Must have 3 cards of same suit)
    const isFlush = (maxSuitCount === 3);

    // 👇👇👇 CRITICAL RULE CHANGE 👇👇👇
    // If it is NOT a flush (3 cards) and NOT a triple (handled above),
    // the score is INVALID (0). Partial hands count for nothing.
    if (!isFlush) {
        maxScore = 0;
    }
    // 👆👆👆 END OF CHANGE 👆👆👆

    return {
      score: maxScore,
      type: maxScore === 31 ? HandType.SPIC : HandType.NORMAL,
      description: maxScore === 31 ? 'Špic' : (maxScore > 0 ? `Flush ${maxScore}` : 'No flush'),
      code: maxScore === 31 ? { k: 'spic' } : maxScore > 0 ? { k: 'flush', v: maxScore } : { k: 'none' },
      isFlush: isFlush
    };
  }

  private static calculateBestSuitSum(cards: Card[]): ExtendedHandResult {
    if (cards.length === 0) return { score: 0, type: HandType.NORMAL, description: 'Empty', code: { k: 'none' } };
    const suitSums: Record<string, number> = { H: 0, D: 0, C: 0, S: 0 };
    cards.forEach(c => suitSums[c.suit] += c.value);
    const max = Math.max(...Object.values(suitSums));
    return { score: max, type: HandType.NORMAL, description: `${max} so far`, code: { k: 'partial', v: max } };
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
