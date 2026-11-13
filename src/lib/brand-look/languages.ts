// The languages Mox can write a brand's content in (Mellox 2.0). Pure and
// browser-safe. The choice is stored as the English label on the brand's look
// (`dna.look.writing.language`), which every generator already reads through
// `lookTextFor` ("Language: Spanish"). The app's own words stay English.

export type ContentLanguage = {
  /** BCP 47 code, used only as the chip's mark and a stable key. */
  code: string;
  /** ISO country whose flag marks it (the flag grid; Holo style). */
  country: string;
  /** English name, the stored value. */
  label: string;
  /** The language's own name for itself. */
  native: string;
};

export const CONTENT_LANGUAGES: ContentLanguage[] = [
  { code: "en", country: "GB", label: "English", native: "English" },
  { code: "es", country: "ES", label: "Spanish", native: "Español" },
  { code: "pt", country: "BR", label: "Portuguese", native: "Português" },
  { code: "fr", country: "FR", label: "French", native: "Français" },
  { code: "de", country: "DE", label: "German", native: "Deutsch" },
  { code: "it", country: "IT", label: "Italian", native: "Italiano" },
  { code: "nl", country: "NL", label: "Dutch", native: "Nederlands" },
  { code: "sv", country: "SE", label: "Swedish", native: "Svenska" },
  { code: "no", country: "NO", label: "Norwegian", native: "Norsk" },
  { code: "da", country: "DK", label: "Danish", native: "Dansk" },
  { code: "fi", country: "FI", label: "Finnish", native: "Suomi" },
  { code: "pl", country: "PL", label: "Polish", native: "Polski" },
  { code: "cs", country: "CZ", label: "Czech", native: "Čeština" },
  { code: "ro", country: "RO", label: "Romanian", native: "Română" },
  { code: "hu", country: "HU", label: "Hungarian", native: "Magyar" },
  { code: "el", country: "GR", label: "Greek", native: "Ελληνικά" },
  { code: "uk", country: "UA", label: "Ukrainian", native: "Українська" },
  { code: "ru", country: "RU", label: "Russian", native: "Русский" },
  { code: "tr", country: "TR", label: "Turkish", native: "Türkçe" },
  { code: "ar", country: "SA", label: "Arabic", native: "العربية" },
  { code: "he", country: "IL", label: "Hebrew", native: "עברית" },
  { code: "fa", country: "IR", label: "Persian", native: "فارسی" },
  { code: "ur", country: "PK", label: "Urdu", native: "اردو" },
  { code: "ur-Latn", country: "PK", label: "Roman Urdu", native: "Roman Urdu" },
  { code: "hi", country: "IN", label: "Hindi", native: "हिन्दी" },
  { code: "bn", country: "BD", label: "Bengali", native: "বাংলা" },
  { code: "pa", country: "IN", label: "Punjabi", native: "ਪੰਜਾਬੀ" },
  { code: "ta", country: "LK", label: "Tamil", native: "தமிழ்" },
  { code: "te", country: "IN", label: "Telugu", native: "తెలుగు" },
  { code: "mr", country: "IN", label: "Marathi", native: "मराठी" },
  { code: "id", country: "ID", label: "Indonesian", native: "Bahasa Indonesia" },
  { code: "ms", country: "MY", label: "Malay", native: "Bahasa Melayu" },
  { code: "tl", country: "PH", label: "Filipino", native: "Filipino" },
  { code: "vi", country: "VN", label: "Vietnamese", native: "Tiếng Việt" },
  { code: "th", country: "TH", label: "Thai", native: "ไทย" },
  { code: "zh", country: "CN", label: "Chinese (Simplified)", native: "简体中文" },
  { code: "zh-TW", country: "TW", label: "Chinese (Traditional)", native: "繁體中文" },
  { code: "ja", country: "JP", label: "Japanese", native: "日本語" },
  { code: "ko", country: "KR", label: "Korean", native: "한국어" },
  { code: "sw", country: "KE", label: "Swahili", native: "Kiswahili" },
  { code: "af", country: "ZA", label: "Afrikaans", native: "Afrikaans" },
];

export const DEFAULT_CONTENT_LANGUAGE = "English";

/** The stored language for a look, or English when none was chosen. */
export function contentLanguageOf(look: unknown): string {
  const w = (look as { writing?: { language?: unknown } } | null | undefined)?.writing;
  return typeof w?.language === "string" && w.language.trim()
    ? w.language.trim()
    : DEFAULT_CONTENT_LANGUAGE;
}

/** Languages whose English or own name contains the search. */
export function searchLanguages(query: string, list = CONTENT_LANGUAGES): ContentLanguage[] {
  const q = query.trim().toLowerCase();
  if (!q) return list;
  return list.filter(
    (l) =>
      l.label.toLowerCase().includes(q) ||
      l.native.toLowerCase().includes(q) ||
      l.code.toLowerCase() === q,
  );
}

/** A look with the language set, leaving every other part as it was. */
export function withLanguage<T extends { writing?: Record<string, unknown> }>(
  look: T | null | undefined,
  language: string,
): T {
  const base = (look ?? {}) as T;
  return { ...base, writing: { ...(base.writing ?? {}), language } } as T;
}

/**
 * How to write a language that is more than its name (a script choice, a
 * mix): the line generators read after "Language:". Pure.
 */
const LANGUAGE_NOTES: Record<string, string> = {
  "Roman Urdu":
    'Roman Urdu: Urdu written in Latin letters the way people in Pakistan text and post ("Aaj ka offer dekha?", "Yeh try karo"), everyday English words kept in English as people say them, never Urdu script, spelling kept consistent within a piece.',
  Urdu: "Urdu in Urdu script (Nastaliq), natural spoken Urdu; brand and product names stay as the brand writes them.",
};

export function languageNote(label: string | null | undefined): string | null {
  const clean = (label ?? "").trim();
  if (!clean) return null;
  return LANGUAGE_NOTES[clean] ?? clean;
}
