import { founderPath, type Founder } from "./about";
import { SITE_URL } from "./seo";

// Structured data for the founders. One stable @id per person, so the About page, the person's own page and the
// Organization all point at the same entity, and a search or AI engine can join the names, the role and the accounts.

/** Where a founder's entity lives: their own page when they have one, otherwise the About page. */
export function founderUrl(f: Founder): string {
  return `${SITE_URL}${f.profile ? founderPath(f.profile.slug) : "/about"}`;
}

export function founderId(f: Founder): string {
  return f.profile ? `${founderUrl(f)}#person` : `${SITE_URL}/about#${f.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

/** schema.org Person, built only from what the page shows. */
export function founderPersonLd(f: Founder) {
  const [givenName, ...rest] = f.name.split(" ");
  return {
    "@type": "Person",
    "@id": founderId(f),
    name: f.name,
    givenName,
    familyName: rest.at(-1),
    ...(f.profile
      ? {
          alternateName: f.profile.alsoKnownAs,
          ...(f.profile.country ? { nationality: { "@type": "Country", name: f.profile.country } } : {}),
          knowsAbout: f.profile.expertise,
        }
      : {}),
    jobTitle: f.role,
    description: f.profile?.summary ?? f.bio,
    url: founderUrl(f),
    image: `${SITE_URL}${f.photo}`,
    worksFor: { "@id": `${SITE_URL}/#organization` },
    sameAs: f.socials.map((s) => s.href),
    ...(f.recognition.length ? { award: f.recognition.map((r) => `${r.title} (${r.note})`) } : {}),
  };
}
