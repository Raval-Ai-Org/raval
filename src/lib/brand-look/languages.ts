// The languages Mox can write a brand's content in (Mellox 2.0). Pure and
// browser-safe. The choice is stored as the English label on the brand's look
// (`dna.look.writing.language`), which every generator already reads through
// `lookTextFor` ("Language: Spanish"). The app's own words stay English.

export type ContentLanguage = {
  /** BCP 47 code, used only as the chip's mark and a stable key. */
  code: string;
  /** English name, the stored value. */
  label: string;
  /** The language's own name for itself. */
  native: string;
};

export const CONTENT_LANGUAGES: ContentLanguage[] = [
  { code: "en", label: "English", native: "English" },
  { code: "es", label: "Spanish", native: "Español" },
  { code: "pt", label: "Portuguese", native: "Português" },
  { code: "fr", label: "French", native: "Français" },
  { code: "de", label: "German", native: "Deutsch" },
  { code: "it", label: "Italian", native: "Italiano" },
  { code: "nl", label: "Dutch", native: "Nederlands" },
  { code: "sv", label: "Swedish", native: "Svenska" },
  { code: "no", label: "Norwegian", native: "Norsk" },
  { code: "da", label: "Danish", native: "Dansk" },
  { code: "fi", label: "Finnish", native: "Suomi" },
  { code: "pl", label: "Polish", native: "Polski" },
  { code: "cs", label: "Czech", native: "Čeština" },
  { code: "ro", label: "Romanian", native: "Română" },
  { code: "hu", label: "Hungarian", native: "Magyar" },
  { code: "el", label: "Greek", native: "Ελληνικά" },
  { code: "uk", label: "Ukrainian", native: "Українська" },
  { code: "ru", label: "Russian", native: "Русский" },
  { code: "tr", label: "Turkish", native: "Türkçe" },
  { code: "ar", label: "Arabic", native: "العربية" },
  { code: "he", label: "Hebrew", native: "עברית" },
  { code: "fa", label: "Persian", native: "فارسی" },
  { code: "ur", label: "Urdu", native: "اردو" },
  { code: "hi", label: "Hindi", native: "हिन्दी" },
  { code: "bn", label: "Bengali", native: "বাংলা" },
  { code: "pa", label: "Punjabi", native: "ਪੰਜਾਬੀ" },
  { code: "ta", label: "Tamil", native: "தமிழ்" },
  { code: "te", label: "Telugu", native: "తెలుగు" },
  { code: "mr", label: "Marathi", native: "मराठी" },
  { code: "id", label: "Indonesian", native: "Bahasa Indonesia" },
  { code: "ms", label: "Malay", native: "Bahasa Melayu" },
  { code: "tl", label: "Filipino", native: "Filipino" },
  { code: "vi", label: "Vietnamese", native: "Tiếng Việt" },
  { code: "th", label: "Thai", native: "ไทย" },
  { code: "zh", label: "Chinese (Simplified)", native: "简体中文" },
  { code: "zh-TW", label: "Chinese (Traditional)", native: "繁體中文" },
  { code: "ja", label: "Japanese", native: "日本語" },
  { code: "ko", label: "Korean", native: "한국어" },
  { code: "sw", label: "Swahili", native: "Kiswahili" },
  { code: "af", label: "Afrikaans", native: "Afrikaans" },
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
