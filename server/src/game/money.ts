// All money is kept in euro cents (integers) so €0.50 steps never hit float rounding.
export function euro(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}€${abs % 100 === 0 ? abs / 100 : (abs / 100).toFixed(2)}`;
}
