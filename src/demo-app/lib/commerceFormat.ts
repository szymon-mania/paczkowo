export function formatMoney(locale: string, value: number, currency: string) {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(value);
}

export function formatCurrencyTotals<T>(
  rows: T[],
  locale: string,
  amount: (row: T) => number,
  currency: (row: T) => string,
  fallbackCurrency = "PLN",
) {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const code = currency(row);
    totals.set(code, (totals.get(code) ?? 0) + amount(row));
  }
  if (totals.size === 0) return formatMoney(locale, 0, fallbackCurrency);
  return [...totals.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([code, value]) => formatMoney(locale, value, code))
    .join(" · ");
}
