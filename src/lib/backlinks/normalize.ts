// Host comparison for link verification.
//
// The only question this file answers: does a link found on a published page
// point at the site we asked for? Everything else the module used to carry
// belonged to the backlink analysis feature and went with it.
import { normalizeDomain } from "@/lib/workspace/domain";

/** True when `host` is `domain`, a subdomain of it, or the www form. */
export function isSameSite(host: string, domain: string): boolean {
  const a = normalizeDomain(host);
  const b = normalizeDomain(domain);
  if (!a || !b) return false;
  return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}
