/** Currencies covered by the ECB daily reference rates (Frankfurter API). */
export const CURRENCIES = [
  "USD", "EUR", "GBP", "AUD", "BRL", "CAD", "CHF", "CNY", "CZK",
  "DKK", "HKD", "HUF", "IDR", "ILS", "INR", "ISK", "JPY", "KRW", "MXN",
  "MYR", "NOK", "NZD", "PHP", "PLN", "RON", "SEK", "SGD", "THB", "TRY",
  "ZAR",
] as const;

export type Currency = (typeof CURRENCIES)[number];

export function isSupportedCurrency(code: string): code is Currency {
  return (CURRENCIES as readonly string[]).includes(code);
}
