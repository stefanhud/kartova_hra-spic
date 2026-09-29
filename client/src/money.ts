// Money arrives from the server in euro cents (formatting per language lives in i18n.ts).

// Compact step label for raise buttons: 50 -> "0.50" ("0,50" in Slovak), 200 -> "2".
export function stepLabel(cents: number, lang: 'en' | 'sk' = 'en'): string {
  const text = cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
  return lang === 'sk' ? text.replace('.', ',') : text;
}

export interface Payment {
  from: string;
  to: string;
  amount: number;
}

// Turn balances into as few payments as possible: the biggest loser pays the biggest
// winner first, and so on (never more than players - 1 payments).
export function settle(balances: { name: string; balance: number }[]): Payment[] {
  const losers = balances.filter(b => b.balance < 0).map(b => ({ ...b })).sort((a, b) => a.balance - b.balance);
  const winners = balances.filter(b => b.balance > 0).map(b => ({ ...b })).sort((a, b) => b.balance - a.balance);
  const payments: Payment[] = [];
  let i = 0;
  let j = 0;
  while (i < losers.length && j < winners.length) {
    const amount = Math.min(-losers[i].balance, winners[j].balance);
    if (amount > 0) payments.push({ from: losers[i].name, to: winners[j].name, amount });
    losers[i].balance += amount;
    winners[j].balance -= amount;
    if (losers[i].balance === 0) i++;
    if (winners[j].balance === 0) j++;
  }
  return payments;
}
