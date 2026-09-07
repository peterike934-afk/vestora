import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["en", "es", "es-MX", "pt-BR", "de", "ar", "zh", "ru"],
  defaultLocale: "en",
  localePrefix: "as-needed",
});