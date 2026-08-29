"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import {
  LOCALE_COOKIE,
  localeTag,
  type Locale,
  type TranslationKey,
  translate,
} from "@/lib/i18n";
import {
  CURRENCY_COOKIE,
  type Currency,
} from "@/lib/money";

type TranslationValues = Record<string, string | number>;

type I18nContextValue = {
  locale: Locale;
  currency: Currency;
  setLocale: (locale: Locale) => void;
  setCurrency: (currency: Currency) => void;
  t: (key: TranslationKey, values?: TranslationValues) => string;
  formatDate: (value: string | Date) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

function persistPreference(name: string, value: string) {
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

export function I18nProvider({
  children,
  initialLocale,
  initialCurrency,
}: {
  children: React.ReactNode;
  initialLocale: Locale;
  initialCurrency: Currency;
}) {
  const [locale, updateLocale] = useState(initialLocale);
  const [currency, updateCurrency] = useState(initialCurrency);

  useEffect(() => {
    document.documentElement.lang = localeTag(locale);
  }, [locale]);

  const setLocale = useCallback((nextLocale: Locale) => {
    updateLocale(nextLocale);
    document.documentElement.lang = localeTag(nextLocale);
    persistPreference(LOCALE_COOKIE, nextLocale);
  }, []);

  const setCurrency = useCallback((nextCurrency: Currency) => {
    updateCurrency(nextCurrency);
    persistPreference(CURRENCY_COOKIE, nextCurrency);
  }, []);

  const t = useCallback(
    (key: TranslationKey, values?: TranslationValues) => translate(locale, key, values),
    [locale],
  );

  const formatDate = useCallback(
    (value: string | Date) => new Intl.DateTimeFormat(localeTag(locale), {
      dateStyle: "long",
      timeStyle: "short",
    }).format(new Date(value)),
    [locale],
  );

  const value = useMemo(() => ({
    locale,
    currency,
    setLocale,
    setCurrency,
    t,
    formatDate,
  }), [currency, formatDate, locale, setCurrency, setLocale, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) throw new Error("useI18n must be used inside I18nProvider");
  return context;
}
