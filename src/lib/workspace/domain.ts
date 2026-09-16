// Website → canonical brand domain. One brand (domain) = one workspace per owner.
//
// Mirrors private.normalize_domain in
// supabase/migrations/20260920090000_canonical_workspaces.sql — the database
// is authoritative (it derives workspaces.domain on every write); this copy
// lets the UI show "you already have mellox.ai" before submitting.

export function normalizeDomain(url: string | null | undefined): string | null {
  if (url == null) return null;
  let host = url.trim().toLowerCase();
  host = host.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  host = host.replace(/[/?#].*$/, "");
  host = host.replace(/^[^@]*@/, "");
  host = host.replace(/:[0-9]*$/, "");
  host = host.replace(/\.+$/, "");
  host = host.replace(/^www\./, "");
  return host === "" ? null : host;
}

/** A user-typed site ("mellox.ai", "http://Mellox.ai/") as an https URL, or null. */
export function toWebsiteUrl(input: string | null | undefined): string | null {
  const raw = input?.trim();
  if (!raw) return null;
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(withScheme);
    if (!url.hostname.includes(".")) return null;
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

/** A readable default name for a brand from its domain: "mellox.ai" → "Mellox". */
export function nameFromDomain(domain: string | null): string {
  if (!domain) return "Workspace";
  const label = domain.split(".")[0] ?? domain;
  return label.charAt(0).toUpperCase() + label.slice(1);
}
