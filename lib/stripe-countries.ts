// Stripe requires identity.country before it will apply a merchant
// configuration, so onboarding needs one country up front. Everything else —
// business details, bank details, capabilities and requirements — is collected
// by Stripe's hosted onboarding.
//
// This list only powers the dashboard's suggestion list. Stripe remains the
// source of truth: an unsupported code is rejected by the hosted onboarding.
export const STRIPE_CONNECT_COUNTRIES = [
  "AE", "AT", "AU", "BE", "BG", "BR", "CA", "CH", "CY", "CZ", "DE", "DK", "EE", "ES", "FI", "FR",
  "GB", "GI", "GR", "HK", "HR", "HU", "ID", "IE", "IT", "JP", "LI", "LT", "LU", "LV", "MT", "MX",
  "MY", "NA", "NL", "NO", "NZ", "PL", "PT", "RO", "SE", "SG", "SI", "SK", "TH", "US",
] as const;

export const DEFAULT_CONNECT_COUNTRY = "US";

export function normalizeConnectCountry(value: string | null | undefined) {
  const normalized = value?.trim().toUpperCase() ?? "";
  return /^[A-Z]{2}$/.test(normalized) ? normalized : null;
}
