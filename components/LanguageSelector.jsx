"use client";

import { useState, useTransition } from "react";
import { useLocale } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";

const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "es", label: "Español" },
  { code: "es-MX", label: "Español (México)" },
  { code: "pt-BR", label: "Português (Brasil)" },
  { code: "de", label: "Deutsch" },
  { code: "ar", label: "العربية" },
  { code: "zh", label: "中文" },
  { code: "ru", label: "Русский" },
];

export default function LanguageSelector() {
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [, startTransition] = useTransition();

  const current = LANGUAGES.find((l) => l.code === locale) || LANGUAGES[0];

  function handleSelect(code) {
    setOpen(false);
    startTransition(() => {
      router.replace(pathname, { locale: code });
    });
  }

  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        style={{
          background: "#fff",
          border: "1px solid #e2e2e2",
          borderRadius: "6px",
          padding: "6px 10px",
          fontSize: "13px",
          fontWeight: 600,
          color: "#111",
          cursor: "pointer",
        }}
      >
        {current.code.split("-")[0].toUpperCase()}
      </button>
      {open && (
        <ul
          role="listbox"
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            background: "#fff",
            border: "1px solid #e2e2e2",
            borderRadius: "8px",
            padding: "6px",
            minWidth: "180px",
            listStyle: "none",
            zIndex: 50,
            boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
          }}
        >
          {LANGUAGES.map((l) => (
            <li key={l.code}>
              <button
                type="button"
                onClick={() => handleSelect(l.code)}
                style={{
                  width: "100%",
                  textAlign: "left",
                  background: l.code === locale ? "#f2f2f2" : "transparent",
                  border: "none",
                  padding: "8px 10px",
                  borderRadius: "6px",
                  color: "#111",
                  fontSize: "13px",
                  cursor: "pointer",
                }}
              >
                {l.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}