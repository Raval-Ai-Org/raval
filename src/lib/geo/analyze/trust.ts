// trust.ts — first-party trust, external sourcing and claim support. Ports of
// the GEO module's TrustSignalEngine, FirstPartyTransparencyEngine,
// ExternalSourceEngine, SourceQualityEngine and ClaimSupportEngine.
//
// Evidence, not conclusions: these report what the page shows (a byline, a
// privacy link, an unreferenced statistic). They never judge whether a claim
// is true or a business trustworthy. Deviations are marked "Mellox:".

import type { LinkRef, PageAnalysis, SchemaSummary } from "../types";
import { clip, collapse, hostOf, sentences, wordCount } from "./text";

type Trust = PageAnalysis["trust"];
type Sources = PageAnalysis["sources"];
type Claims = PageAnalysis["claims"];

const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b/g;
const PHONE_RE = /(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/g;
// Mellox: the original matched bare "St"/"Rd", which fires on "1st" or "3rd".
const ADDRESS_RE =
  /\b(?:\d{1,5}\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+(?:Street|Avenue|Boulevard|Road|Lane|Drive|Way|St\.|Ave\.|Blvd\.|Rd\.)|Suite\s+\d+|P\.?\s?O\.?\s+Box\s+\d+|Postal Code|Zip Code)\b/;
// Mellox: names are matched case-sensitively so "by the way" is not a byline.
const BYLINE_RE =
  /\b(?:[Bb]y|[Aa]uthored by|[Ww]ritten by|[Aa]uthor:)\s+((?:Dr\.?\s+|Prof\.?\s+)?[A-Z][a-zA-Z'-]+(?:\s+[A-Z][a-zA-Z.'-]+){1,3})\b/;
const CREDENTIALS_RE =
  /\b(Ph\.?D\.?|M\.D\.|Pharm\.?D\.?|MBA|CPA|Esq\.|MSc|BSc|RN|CFA|PMP)(?![a-z])/g;
const TITLES_RE =
  /\b(Dr\.|Doctor|Prof\.|Professor|Chief [A-Z][a-z]+ Officer|CEO|CTO|CFO|CMO|Founder|Co-founder|Director of [A-Z][a-z]+|Lead Researcher|Senior Scientist|Principal Engineer)\b/g;
const REVIEW_RE =
  /\b([Mm]edically reviewed by|[Rr]eviewed by|[Ff]act[- ]checked by|[Tt]echnically reviewed by|[Pp]eer[- ]reviewed by)\s+((?:Dr\.?\s+|Prof\.?\s+)?[A-Z][a-zA-Z'-]+(?:\s+[A-Z][a-zA-Z.'-]+){0,3})/;
const COPYRIGHT_RE =
  /(?:©|\(c\)|copyright)\s*(?:\d{4}(?:\s*[-–]\s*\d{4})?)?\s*[,.]?\s*([A-Za-z][A-Za-z0-9 .,&'-]{2,60}?)(?:\.\s|\s+all rights|\s*\||\s*$)/i;
const OWNERSHIP_RE =
  /\b(owned and operated by|a subsidiary of|parent company|wholly owned by|funded by|grant support)\b/i;
const DATE_RE =
  /\b(?:published|updated|last updated|modified|posted|last reviewed)(?:\s+on)?:?\s*((?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?\s+\d{1,2},?\s+\d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}\s+[A-Z][a-z]+\s+\d{4})/i;

const PLACEHOLDER_EMAIL =
  /example\.(com|org)|domain\.com|yoursite\.com|email\.com|sentry|wixpress/i;

function pathOf(href: string): string {
  try {
    return new URL(href).pathname.toLowerCase();
  } catch {
    return "";
  }
}

function firstLink(
  links: LinkRef[],
  test: (path: string, anchor: string) => boolean,
): string | null {
  for (const l of links) {
    if (test(pathOf(l.href), l.text.trim().toLowerCase())) return l.href;
  }
  return null;
}

export function analyzeTrust(input: {
  internal: LinkRef[];
  mailto: string[];
  tel: number;
  text: string;
  schema: SchemaSummary;
  og: Record<string, string>;
}): Trust {
  const { internal, mailto, tel, text, schema, og } = input;

  const aboutLink = firstLink(
    internal,
    (p, a) =>
      /(^|\/)(about|about-us|who-we-are|our-story|our-company|company|team)(\/|$|\.)/.test(p) ||
      ["about", "about us", "who we are", "our story", "our team", "company"].includes(a),
  );
  const contactLink = firstLink(
    internal,
    (p, a) =>
      /(^|\/)(contact|contact-us|get-in-touch|support|help)(\/|$|\.)/.test(p) ||
      ["contact", "contact us", "get in touch", "support", "customer support"].includes(a),
  );
  const privacyLink = firstLink(
    internal,
    (p, a) => /privacy|data-protection|gdpr/.test(p) || a.includes("privacy"),
  );
  const termsLink = firstLink(
    internal,
    (p, a) =>
      (/(^|\/)(terms|tos|terms-of-service|terms-and-conditions|conditions|legal|user-agreement)(\/|$|\.|-)/.test(
        p,
      ) &&
        !/privacy|cookie/.test(p)) ||
      /terms of (service|use)|terms (&|and) conditions|legal notice/.test(a),
  );
  const editorialLink = firstLink(
    internal,
    (p, a) =>
      /editorial|corrections|ethics|disclosure/.test(p) ||
      /editorial policy|corrections policy|affiliate disclosure/.test(a),
  );

  const emails = new Set<string>();
  for (const m of mailto) {
    const e = m
      .replace(/^mailto:/i, "")
      .split("?")[0]
      .trim()
      .toLowerCase();
    if (e && !PLACEHOLDER_EMAIL.test(e)) emails.add(e);
  }
  const sample = text.length > 80_000 ? `${text.slice(0, 40_000)} ${text.slice(-40_000)}` : text;
  for (const m of sample.matchAll(EMAIL_RE)) {
    const e = m[0].toLowerCase();
    if (!PLACEHOLDER_EMAIL.test(e) && !/\.(png|jpe?g|webp|svg|gif)$/.test(e)) emails.add(e);
    if (emails.size >= 5) break;
  }
  const phones = tel + Math.min(5, (sample.match(PHONE_RE) ?? []).length);

  const author = schema.authors[0];
  const bylineMatch = BYLINE_RE.exec(text.slice(0, 1500));
  const byline = author?.name ?? (bylineMatch ? collapse(bylineMatch[1]) : null);

  // Credentials only near the author, not anywhere in the copy ("MBA programs").
  const credentialZone = [
    author?.name ?? "",
    author?.jobTitle ?? "",
    bylineMatch ? text.slice(Math.max(0, bylineMatch.index - 40), bylineMatch.index + 240) : "",
  ].join(" ");
  const credentials = [
    ...new Set([
      ...(credentialZone.match(CREDENTIALS_RE) ?? []),
      ...(credentialZone.match(TITLES_RE) ?? []),
    ]),
  ].slice(0, 5);

  const review = REVIEW_RE.exec(text);
  const tail = text.slice(-2500);
  const copyright = COPYRIGHT_RE.exec(tail);
  const copyrightName = copyright ? collapse(copyright[1]).replace(/[.,]$/, "") : null;

  const dateMatch = DATE_RE.exec(text.slice(0, 4000));

  return {
    aboutLink,
    contactLink,
    privacyLink,
    termsLink,
    editorialLink,
    emails: [...emails].slice(0, 5),
    phones,
    hasAddress: schema.hasAddress || ADDRESS_RE.test(sample),
    byline: byline ? clip(byline, 80) : null,
    credentials,
    reviewer: review ? clip(collapse(review[2]), 80) : null,
    copyrightName: copyrightName && copyrightName.length > 2 ? clip(copyrightName, 80) : null,
    siteName:
      og["og:site_name"]?.trim() || schema.publisherName || schema.organizations[0]?.name || null,
    ownershipStatement: OWNERSHIP_RE.test(sample),
    datePublished: schema.datePublished ?? (dateMatch ? dateMatch[1] : null),
    dateModified: schema.dateModified,
  };
}

/* ───────────────────────── External sources ───────────────────────── */

const RESEARCH_DOMAINS = [
  "doi.org",
  "ncbi.nlm.nih.gov",
  "pubmed.ncbi.nlm.nih.gov",
  "nature.com",
  "sciencedirect.com",
  "cell.com",
  "thelancet.com",
  "jamanetwork.com",
  "nejm.org",
  "bmj.com",
  "ieee.org",
  "acm.org",
  "arxiv.org",
  "biorxiv.org",
  "medrxiv.org",
  "springer.com",
  "wiley.com",
  "cambridge.org",
  "nih.gov",
  "cdc.gov",
  "who.int",
  "fda.gov",
  "nist.gov",
  "nasa.gov",
  "worldbank.org",
  "imf.org",
  "oecd.org",
  "reuters.com",
  "bloomberg.com",
  "statista.com",
  "pewresearch.org",
  "gartner.com",
  "forrester.com",
  "mckinsey.com",
];
const STANDARDS_DOMAINS = ["iso.org", "w3.org", "ietf.org", "ansi.org", "iec.ch", "schema.org"];
const SOCIAL_DOMAINS = [
  "twitter.com",
  "x.com",
  "facebook.com",
  "instagram.com",
  "linkedin.com",
  "youtube.com",
  "tiktok.com",
  "pinterest.com",
  "reddit.com",
  "t.me",
  "whatsapp.com",
  "threads.net",
  "github.com",
];
const WEAK_ANCHORS = new Set([
  "click here",
  "here",
  "link",
  "this",
  "read more",
  "learn more",
  "website",
  "source",
  "view",
  "page",
  "details",
  "info",
  "article",
  "more",
  "check here",
]);
const AFFILIATE_RE = /[?&](?:tag|aff|affiliate|aff_id|subid)=/i;
const REFERENCE_SECTION_RE =
  /\b(references|sources|bibliography|works cited|citations|further reading|data sources)\b/i;
const CITATION_LABEL_RE =
  /\b(source:|reference:|data from|according to|study:|dataset:|doi:|pmid:)/i;
const CITATION_NOTATION_RE = /(\[\d{1,3}\]|\([A-Z][a-zA-Z]+(?:\s+et\s+al\.?)?,\s*(?:19|20)\d{2}\))/;

const matchesDomain = (host: string, list: string[]) =>
  list.some((d) => host === d || host.endsWith(`.${d}`));

export type SourceCandidate = { anchor: string; href: string };

export function analyzeSources(
  external: LinkRef[],
  headings: { text: string }[],
  text: string,
): { sources: Sources; candidates: SourceCandidate[] } {
  const referenceSection = headings.some((h) => REFERENCE_SECTION_RE.test(h.text));
  let citationCandidates = 0;
  let primary = 0;
  let weakAnchors = 0;
  let affiliate = 0;
  let social = 0;
  const candidates: SourceCandidate[] = [];

  for (const link of external) {
    const host = hostOf(link.href);
    if (!host) continue;
    const anchor = link.text.trim();
    const anchorLower = anchor.toLowerCase();
    if (matchesDomain(host, SOCIAL_DOMAINS)) {
      social++;
      continue;
    }
    const rel = link.rel ?? "";
    if (
      rel.includes("sponsored") ||
      AFFILIATE_RE.test(link.href) ||
      /buy on amazon|affiliate link|check price on/.test(anchorLower)
    ) {
      affiliate++;
      continue;
    }
    if (WEAK_ANCHORS.has(anchorLower)) weakAnchors++;

    const pos = anchor.length >= 3 ? text.indexOf(anchor) : -1;
    const context = pos >= 0 ? text.slice(Math.max(0, pos - 120), pos + anchor.length + 120) : "";
    const institutional = /\.(edu|gov|mil)$/.test(host) || /\.(gov|ac|edu)\.[a-z]{2}$/.test(host);
    const research = matchesDomain(host, RESEARCH_DOMAINS);
    const standards = matchesDomain(host, STANDARDS_DOMAINS);
    const isCitation =
      institutional ||
      research ||
      standards ||
      CITATION_LABEL_RE.test(anchorLower) ||
      CITATION_LABEL_RE.test(context) ||
      CITATION_NOTATION_RE.test(anchor) ||
      CITATION_NOTATION_RE.test(context) ||
      (referenceSection &&
        /study|trial|report|dataset|journal|proceedings|doi|paper|survey/.test(anchorLower)) ||
      /documentation|whitepaper|full article|research|report|survey|study/.test(anchorLower);

    if (isCitation) {
      citationCandidates++;
      if ((institutional || research || standards) && !WEAK_ANCHORS.has(anchorLower) && anchor) {
        primary++;
      }
      if (candidates.length < 60) candidates.push({ anchor, href: link.href });
    }
  }

  return {
    sources: {
      external: external.length,
      citationCandidates,
      primary,
      weakAnchors,
      affiliate,
      social,
      referenceSection,
    },
    candidates,
  };
}

/* ───────────────────────── Claims ───────────────────────── */

// Mellox: currency amounts are not counted as statistical claims — on pricing
// and product pages every price would otherwise read as an unsourced statistic.
const STATISTICAL_RE =
  /\b\d+(?:\.\d+)?\s?%|\b\d+(?:\.\d+)?x\s+(?:faster|more|better|higher|lower)|\b\d{1,3}(?:,\d{3}){2,}\b|\b\d+(?:\.\d+)?\s+(?:million|billion|percent)\b/i;
const COMPARATIVE_RE =
  /\b(?:outperform(?:s|ed)?|outpaces?|compared (?:to|with)|twice as (?:fast|likely)|significantly (?:higher|lower|better) than)\b/i;
const SUPERLATIVE_RE =
  /\b(?:the best|unrivaled|unrivalled|unmatched|world[- ]class|industry[- ]leading|#1|number one|revolutionary|guaranteed|flawless|unbeatable)\b/i;

export function analyzeClaims(text: string, candidates: SourceCandidate[]): Claims {
  let statistical = 0;
  let statisticalUnsupported = 0;
  let superlativeUnsupported = 0;
  let comparative = 0;
  const samples: string[] = [];
  const seen = new Set<string>();

  const sents = sentences(text.slice(0, 80_000));
  for (const sent of sents) {
    if (sent.length < 15 || seen.has(sent)) continue;
    seen.add(sent);
    const kind = STATISTICAL_RE.test(sent)
      ? "statistical"
      : COMPARATIVE_RE.test(sent)
        ? "comparative"
        : SUPERLATIVE_RE.test(sent)
          ? "superlative"
          : null;
    if (!kind) continue;

    const pos = text.indexOf(sent);
    const window = pos >= 0 ? text.slice(Math.max(0, pos - 150), pos + sent.length + 250) : sent;
    const supported =
      candidates.some((c) => c.anchor.length > 3 && window.includes(c.anchor)) ||
      (kind === "statistical" && candidates.length === 1) ||
      CITATION_NOTATION_RE.test(sent) ||
      /according to|source:|data from|study by|survey by|report by/i.test(sent);

    if (kind === "statistical") {
      statistical++;
      if (!supported) {
        statisticalUnsupported++;
        if (samples.length < 3 && wordCount(sent) <= 60) samples.push(clip(sent, 220));
      }
    } else if (kind === "comparative") {
      comparative++;
    } else if (!supported) {
      superlativeUnsupported++;
      if (samples.length < 3 && wordCount(sent) <= 60) samples.push(clip(sent, 220));
    }
  }

  return { statistical, statisticalUnsupported, superlativeUnsupported, comparative, samples };
}
