// Money arrives from the server in euro cents.
export function euro(cents: number): string {
  const abs = Math.abs(cents);
  const text = abs % 100 === 0 ? String(abs / 100) : (abs / 100).toFixed(2);
  return `${cents < 0 ? '-' : ''}€${text}`;
}

// Compact step label for raise buttons: 50 -> "0.50", 200 -> "2".
export function stepLabel(cents: number): string {
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
}
