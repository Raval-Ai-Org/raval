// Per-route SEO helper — keeps titles/descriptions unique per page.
// The application domain is now configurable via APP_URL environment variable
// to support both local development and production deployments.

export const BASE_URL =
  typeof process.env.NEXT_PUBLIC_APP_URL === "string" && process.env.NEXT_PUBLIC_APP_URL
    ? process.env.NEXT_PUBLIC_APP_URL
    : typeof window !== "undefined"
      ? window.location.origin
      : "https://raval.ai";

export const BRAND_NAME = "Raval AI";
// Logo is served from the same domain as the application
export const BRAND_LOGO = `${BASE_URL}/favicon.svg`;
export const BRAND_SOCIAL_IMAGE =
  "https://storage.googleapis.com/gpt-engineer-file-uploads/XZzWHMlbweRejWDVyKWThlteKfK2/social-images/social-1780771486300-Untitled_design_(12).webp";

type JsonLd = Record<string, unknown> | Record<string, unknown>[];

export function pageHead(opts: {
  title: string;
  description: string;
  path: string;
  noindex?: boolean;
  jsonLd?: JsonLd;
}) {
  const url = `${BASE_URL}${opts.path}`;
  const scripts = opts.jsonLd
    ? [
        {
          type: "application/ld+json",
          children: JSON.stringify(opts.jsonLd),
        },
      ]
    : undefined;
  return {
    meta: [
      { title: opts.title },
      { name: "description", content: opts.description },
      { property: "og:title", content: opts.title },
      { property: "og:description", content: opts.description },
      { property: "og:url", content: url },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: opts.title },
      { name: "twitter:description", content: opts.description },
      ...(opts.noindex ? [{ name: "robots", content: "noindex,nofollow" }] : []),
    ],
    links: [{ rel: "canonical", href: url }],
    ...(scripts ? { scripts } : {}),
  };
}

/** Breadcrumb JSON-LD builder. Pass ordered [{name, path}] from root to leaf. */
export function breadcrumbLd(items: Array<{ name: string; path: string }>) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: it.name,
      item: `${BASE_URL}${it.path}`,
    })),
  };
}

/** WebPage JSON-LD for informational routes. */
export function webPageLd(opts: { title: string; description: string; path: string }) {
  return {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: opts.title,
    description: opts.description,
    url: `${BASE_URL}${opts.path}`,
    isPartOf: { "@type": "WebSite", name: BRAND_NAME, url: BASE_URL },
    publisher: { "@type": "Organization", name: BRAND_NAME, url: BASE_URL, logo: BRAND_LOGO },
  };
}

/**
 * Next `Metadata` twin of `pageHead` — same title/description/canonical/robots
 * output, expressed the way the App Router expects it. JSON-LD is rendered as a
 * script tag by the page itself, since Metadata has no slot for it.
 */
export function pageMetadata(opts: {
  title: string;
  description: string;
  path: string;
  noindex?: boolean;
}): import("next").Metadata {
  const url = `${BASE_URL}${opts.path}`;
  return {
    title: opts.title,
    description: opts.description,
    alternates: { canonical: url },
    openGraph: {
      title: opts.title,
      description: opts.description,
      url,
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: opts.title,
      description: opts.description,
    },
    ...(opts.noindex ? { robots: "noindex,nofollow" } : {}),
  };
}
