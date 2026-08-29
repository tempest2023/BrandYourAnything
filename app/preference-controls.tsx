"use client";

import { useI18n } from "@/app/i18n-provider";
import { LOCALES, type Locale } from "@/lib/i18n";
import { currencyDisplayName, type Currency } from "@/lib/money";

const CURRENCIES: Currency[] = ["USD", "EUR", "CNY"];

export function PreferenceControls({ className = "" }: { className?: string }) {
  const { currency, locale, setCurrency, setLocale, t } = useI18n();

  return (
    <div className={`preference-controls ${className}`.trim()}>
      <label className="language-switch">
        <span className="sr-only">{t("common.displayLanguage")}</span>
        <select
          aria-label={t("common.displayLanguage")}
          value={locale}
          onChange={(event) => setLocale(event.target.value as Locale)}
        >
          {LOCALES.map((option) => (
            <option key={option} value={option}>{t(`common.language.${option}`)}</option>
          ))}
        </select>
      </label>
      <div className="currency-switch" role="group" aria-label={t("common.displayCurrency")}>
        {CURRENCIES.map((option) => (
          <button
            key={option}
            type="button"
            className={currency === option ? "active" : ""}
            aria-label={currencyDisplayName(option)}
            aria-pressed={currency === option}
            onClick={() => setCurrency(option)}
          >
            {option === "USD" ? "$" : option === "EUR" ? "€" : "¥"}
          </button>
        ))}
      </div>
    </div>
  );
}
