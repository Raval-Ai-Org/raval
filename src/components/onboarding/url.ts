export function normalizeUrl(raw: string) {
  const value = raw.trim();
  return value ? (/^https?:\/\//i.test(value) ? value : `https://${value}`) : "";
}

export function validUrl(raw: string) {
  try {
    const url = new URL(normalizeUrl(raw));
    return url.protocol === "https:" && url.hostname.includes(".");
  } catch {
    return false;
  }
}

/** `https://www.acme.com/path` → `acme.com`; returns the input when it is not a URL. */
export function hostOf(raw: string) {
  try {
    return new URL(normalizeUrl(raw)).hostname.replace(/^www\./, "");
  } catch {
    return raw;
  }
}
