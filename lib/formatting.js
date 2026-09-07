"use client";

import { useFormatter, useLocale } from "next-intl";
import { useFxRates } from "@/contexts/FxRatesContext";

const CURRENCY_BY_LOCALE = {
  en: "USD",
  es: "EUR",
  "es-MX": "MXN",
  "pt-BR": "BRL",
  de: "EUR",
  ar: "USD",
  zh: "CNY",
  ru: "RUB",
};

export function useMoneyFormatter() {
  const format = useFormatter();
  const locale = useLocale();
  const { rates } = useFxRates();
  const currency = CURRENCY_BY_LOCALE[locale] || "USD";

  return (amountUsd) => {
    const usd = Number(amountUsd) || 0;
    const rate = currency === "USD" ? 1 : rates?.[currency];
    const converted = rate ? usd * rate : usd;
    const displayCurrency = rate ? currency : "USD";

    return format.number(converted, {
      style: "currency",
      currency: displayCurrency,
      currencyDisplay: "symbol",
    });
  };
}

export function useDateFormatter() {
  const format = useFormatter();
  return (date) => format.dateTime(new Date(date), { dateStyle: "medium" });
}