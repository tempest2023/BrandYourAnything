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
  // Inputs use two decimal display units. Convert integer cents using the
  // reference-rate ratio so binary floating-point cannot flip a half-cent tie.
  const displayCents = Math.round(amount * 100);
  if (currency === "EUR") return Math.round(displayCents * Math.round(EUR_TO_USD * 100) / 100);
  if (currency === "CNY") return Math.round(displayCents * 100 / Math.round(USD_TO_CNY * 100));
  return displayCents;
}

export function minimumDisplayAmount(amountUsd: number, currency: Currency) {
  if (!Number.isFinite(amountUsd) || amountUsd < 0) return NaN;
  const requiredCents = Math.round(amountUsd * 100);
  let displayCents = Math.ceil(amountFromUsd(amountUsd, currency) * 100);
  if (!Number.isSafeInteger(requiredCents) || !Number.isSafeInteger(displayCents)) return NaN;
  while (displayCents > 0 && amountToUsdCents((displayCents - 1) / 100, currency) >= requiredCents) displayCents--;
  while (amountToUsdCents(displayCents / 100, currency) < requiredCents) displayCents++;
  return displayCents / 100;
}

export function maximumDisplayAmount(amountUsd: number, currency: Currency) {
  if (!Number.isFinite(amountUsd) || amountUsd < 0) return NaN;
  const allowedCents = Math.round(amountUsd * 100);
  let displayCents = Math.floor(amountFromUsd(amountUsd, currency) * 100);
  if (!Number.isSafeInteger(allowedCents) || !Number.isSafeInteger(displayCents)) return NaN;
  while (amountToUsdCents((displayCents + 1) / 100, currency) <= allowedCents) displayCents++;
  while (amountToUsdCents(displayCents / 100, currency) > allowedCents) displayCents--;
  return displayCents / 100;
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
