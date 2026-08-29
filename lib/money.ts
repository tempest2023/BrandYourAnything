import type { Locale } from "@/lib/i18n";

export type Currency = "USD" | "EUR" | "CNY";

export const DEFAULT_CURRENCY: Currency = "USD";
export const CURRENCY_COOKIE = "brand-anything-currency";

// Display-only reference rates. Auction records always remain denominated in USD cents.
export const EUR_TO_USD = 1.17;
export const USD_TO_CNY = 7.2;

const LOCALE_TAGS: Record<Locale, string> = {
  en: "en-US",
  zh: "zh-CN",
  es: "es-ES",
};

export function normalizeCurrency(value: string | null | undefined): Currency {
  return value === "EUR" || value === "CNY" || value === "USD" ? value : DEFAULT_CURRENCY;
}

export function amountFromUsd(amountUsd: number, currency: Currency) {
  if (currency === "EUR") return amountUsd / EUR_TO_USD;
  if (currency === "CNY") return amountUsd * USD_TO_CNY;
  return amountUsd;
}

export function amountToUsd(amount: number, currency: Currency) {
  if (currency === "EUR") return amount * EUR_TO_USD;
  if (currency === "CNY") return amount / USD_TO_CNY;
  return amount;
}

export function amountToUsdCents(amount: number, currency: Currency) {
  return Math.round(amountToUsd(amount, currency) * 100);
}

export function minimumDisplayAmount(amountUsd: number, currency: Currency) {
  return Math.ceil(amountFromUsd(amountUsd, currency));
}

export function currencySymbol(currency: Currency) {
  if (currency === "EUR") return "€";
  if (currency === "CNY") return "¥";
  return "$";
}

export function currencyDisplayName(currency: Currency) {
  return currency === "CNY" ? "RMB" : currency;
}

export function formatMoney(amountUsd: number, currency: Currency, locale: Locale, maximumFractionDigits = 2) {
  return new Intl.NumberFormat(LOCALE_TAGS[locale], {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
    maximumFractionDigits,
  }).format(amountFromUsd(amountUsd, currency));
}
