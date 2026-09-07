// Thin wrapper around the MyMemory Translation API for translating
// admin's chat replies into whatever language the recipient is
// browsing in. Server-only. No API key required — MyMemory is free
// for reasonable volume (~5,000 words/day per IP; ~50,000/day if you
// pass an email via MYMEMORY_EMAIL for a small trust bump).

const LOCALE_TO_MYMEMORY = {
  en: "en",
  es: "es",
  "es-MX": "es-MX",
  "pt-BR": "pt-BR",
  de: "de",
  ar: "ar",
  zh: "zh-CN",
  ru: "ru",
};

export async function translateText(text, targetLocale) {
  // English recipients need no translation — skip the API call entirely.
  if (!targetLocale || targetLocale === "en") return null;

  const target = LOCALE_TO_MYMEMORY[targetLocale];
  if (!target) return null;

  const email = process.env.MYMEMORY_EMAIL; // optional, raises the daily limit
  const langPair = `en|${target}`;
  const params = new URLSearchParams({
    q: text,
    langpair: langPair,
    ...(email ? { de: email } : {}),
  });

  try {
    const res = await fetch(`https://api.mymemory.translated.net/get?${params.toString()}`);

    if (!res.ok) {
      console.error("MyMemory request failed:", res.status, await res.text());
      return null;
    }

    const data = await res.json();
    const translated = data?.responseData?.translatedText;

    // MyMemory returns quota-exceeded messages as 200 OK with text
    // like "MYMEMORY WARNING: ..." instead of a real translation —
    // treat that as a failure rather than storing it as the translation.
    if (!translated || translated.toUpperCase().includes("MYMEMORY WARNING")) {
      console.error("MyMemory returned no usable translation:", data);
      return null;
    }

    return translated;
  } catch (err) {
    console.error("Translation failed:", err);
    return null; // fail gracefully — original English still gets sent/stored
  }
}