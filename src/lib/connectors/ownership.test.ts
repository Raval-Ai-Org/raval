import { describe, expect, it } from "vitest";
import {
  canAttestOwnership,
  contentFingerprints,
  hostsInConfig,
  hostsMatch,
  matchFingerprints,
  normalizeHost,
  ownershipAllowsFixes,
  ownershipIsCurrent,
  scoreOwnership,
  type OwnershipEvidence,
} from "./ownership";

const ev = (
  signal: OwnershipEvidence["signal"],
  weight: number,
  polarity: OwnershipEvidence["polarity"] = "positive",
): OwnershipEvidence => ({ signal, weight, polarity, detail: signal });

describe("host normalisation", () => {
  it("strips scheme, www, port, trailing dot and case", () => {
    expect(normalizeHost("https://WWW.Example.com:8080/path")).toBe("example.com");
    expect(normalizeHost("example.com.")).toBe("example.com");
    expect(normalizeHost("localhost")).toBeNull();
    expect(normalizeHost("")).toBeNull();
    expect(hostsMatch("www.example.com", "https://example.com/")).toBe(true);
    expect(hostsMatch("example.com", "example.org")).toBe(false);
  });

  it("reads hosts from CNAME, package.json homepage and config URLs", () => {
    expect(hostsInConfig("CNAME", "docs.example.com\n")).toEqual(["docs.example.com"]);
    expect(
      hostsInConfig("package.json", JSON.stringify({ homepage: "https://example.com" })),
    ).toEqual(["example.com"]);
    expect(hostsInConfig("package.json", "{not json")).toEqual([]);
    expect(
      hostsInConfig("astro.config.mjs", "export default { site: 'https://www.example.com' }"),
    ).toEqual(["example.com"]);
  });
});

describe("content fingerprints", () => {
  const pages = [
    {
      url: "https://example.com/",
      title: "Acme Rockets — reusable launch vehicles",
      description: "Acme builds reusable rockets for small satellite operators.",
      h1: ["Reusable rockets for small satellites"],
      text: "Acme Rockets designs reusable launch vehicles for small satellite operators worldwide. We accept cookies to improve this site and you can read our privacy policy. Our first orbital flight happened in the spring of 2024 from Scotland.",
    },
    {
      url: "https://example.com/about",
      title: "About Acme Rockets",
      description: null,
      h1: ["About us"],
      text: "The company was founded by two propulsion engineers who met at university. Our first orbital flight happened in the spring of 2024 from Scotland.",
    },
  ];

  it("excludes boilerplate and text repeated on every page", () => {
    const fp = contentFingerprints(pages);
    expect(fp.sentences.some((s) => s.includes("cookies"))).toBe(false);
    expect(fp.sentences.some((s) => s.includes("first orbital flight"))).toBe(false);
    expect(fp.sentences.some((s) => s.includes("propulsion engineers"))).toBe(true);
    expect(fp.identity).toContain("acme rockets — reusable launch vehicles");
  });

  it("finds page text in JSX and HTML source", () => {
    const fp = contentFingerprints(pages);
    const match = matchFingerprints(fp, [
      {
        path: "app/page.tsx",
        text: `export default function Page(){return <main><h1>Reusable rockets for small satellites</h1><p>Acme Rockets designs reusable launch vehicles for small satellite operators worldwide.</p></main>}`,
      },
      {
        path: "app/about/page.tsx",
        text: "<p>The company was founded by two propulsion engineers who met at university.</p>",
      },
    ]);
    expect(match.identityMatched.length).toBeGreaterThan(0);
    expect(match.sentencesMatched).toBe(2);
    // Title + description in index.html alone (a client-rendered app) reaches 0.3.
    const shell = matchFingerprints(
      {
        identity: [
          "acme rockets — reusable launch vehicles",
          "acme builds reusable rockets for small satellite operators.",
        ],
        sentences: [],
      },
      [
        {
          path: "index.html",
          text: '<title>Acme Rockets — reusable launch vehicles</title><meta name="description" content="Acme builds reusable rockets for small satellite operators.">',
        },
      ],
    );
    expect(shell.score).toBeCloseTo(0.3, 3);
    expect(match.score).toBeCloseTo(0.45, 2);
    expect(match.paths).toContain("app/page.tsx");
  });

  it("scores zero for an unrelated repository", () => {
    const match = matchFingerprints(contentFingerprints(pages), [
      { path: "index.html", text: "<h1>Totally different product</h1>" },
    ]);
    expect(match.score).toBe(0);
  });
});

describe("ownership verdict", () => {
  it("verifies on GitHub's own hosting evidence, or a strong signal backed by content", () => {
    expect(scoreOwnership([ev("pages_site", 0.6)]).status).toBe("verified");
    expect(scoreOwnership([ev("deployment_url", 0.6)]).status).toBe("verified");
    // Owner-declared homepage alone is not proof; with matching page content it is.
    expect(scoreOwnership([ev("repo_homepage", 0.45)]).status).toBe("unverified");
    expect(scoreOwnership([ev("repo_homepage", 0.45), ev("content_fingerprint", 0.3)]).status).toBe(
      "verified",
    );
    expect(
      scoreOwnership([ev("repo_homepage", 0.45), ev("content_fingerprint", 0.15)]).status,
    ).toBe("likely");
    // A contradiction blocks the shortcut.
    expect(
      scoreOwnership([ev("pages_site", 0.6), ev("homepage_other_host", 0.4, "negative")]).status,
    ).not.toBe("verified");
    const r = scoreOwnership([ev("config_site_url", 0.3), ev("content_fingerprint", 0.45)]);
    expect(r.confidence).toBeCloseTo(0.615, 2);
    expect(r.status).toBe("likely");
    const r2 = scoreOwnership([
      ev("deployment_url", 0.6),
      ev("repo_homepage", 0.45),
      ev("content_fingerprint", 0.4),
    ]);
    expect(r2.status).toBe("verified");
    expect(r2.hints).toEqual([]);
  });

  it("verifies on content alone only when content evidence is strong", () => {
    const r = scoreOwnership([
      ev("content_fingerprint", 0.45),
      ev("config_site_url", 0.3),
      ev("host_literal", 0.2),
      ev("pages_cname", 0.5),
    ]);
    expect(r.status).toBe("verified");
    const weak = scoreOwnership([ev("config_site_url", 0.3), ev("host_literal", 0.2)]);
    expect(weak.status).toBe("unverified");
  });

  it("counts each signal once", () => {
    const r = scoreOwnership([
      ev("host_literal", 0.2),
      ev("host_literal", 0.2),
      ev("host_literal", 0.2),
    ]);
    expect(r.confidence).toBeCloseTo(0.2, 3);
  });

  it("reports a mismatch when the repository points elsewhere", () => {
    const r = scoreOwnership([ev("homepage_other_host", 0.4, "negative"), ev("host_literal", 0.2)]);
    expect(r.status).toBe("mismatch");
    expect(r.hints.join(" ")).toMatch(/different website/);
  });

  it("treats missing deployment permission as neutral with a hint", () => {
    const r = scoreOwnership([ev("deployments_unavailable", 0, "neutral")]);
    expect(r.status).toBe("unverified");
    expect(r.confidence).toBe(0);
    expect(r.hints.join(" ")).toMatch(/Deployments: read/);
  });

  it("gates fixes on a current verification for the same host", () => {
    expect(ownershipAllowsFixes("verified")).toBe(true);
    expect(ownershipAllowsFixes("likely")).toBe(false);
    const now = Date.parse("2026-09-15T00:00:00Z");
    const base = {
      status: "verified" as const,
      checkedHost: "example.com",
      siteHost: "www.example.com",
      now,
    };
    expect(ownershipIsCurrent({ ...base, checkedAt: "2026-09-14T00:00:00Z" })).toBe(true);
    expect(ownershipIsCurrent({ ...base, checkedAt: "2026-09-01T00:00:00Z" })).toBe(false);
    expect(
      ownershipIsCurrent({ ...base, siteHost: "other.com", checkedAt: "2026-09-14T00:00:00Z" }),
    ).toBe(false);
  });
});

describe("admin ownership confirmation", () => {
  const positive = {
    signal: "content_fingerprint" as const,
    weight: 0.3,
    polarity: "positive" as const,
    detail: "Live page text found in the source",
  };
  const base = {
    status: "unverified" as const,
    checkedHost: "threereach.lovable.app",
    siteHost: "www.threereach.lovable.app",
    evidence: [positive],
  };

  it("allows confirming a checked, unproven repository with some positive evidence", () => {
    expect(canAttestOwnership(base)).toEqual({ ok: true });
    expect(canAttestOwnership({ ...base, status: "likely" })).toEqual({ ok: true });
  });

  it("refuses without a check for this host, positive evidence, or with contrary evidence", () => {
    expect(canAttestOwnership({ ...base, checkedHost: null }).ok).toBe(false);
    expect(canAttestOwnership({ ...base, siteHost: "other.example" }).ok).toBe(false);
    expect(canAttestOwnership({ ...base, evidence: [] }).ok).toBe(false);
    expect(canAttestOwnership({ ...base, status: "mismatch" }).ok).toBe(false);
    expect(canAttestOwnership({ ...base, status: "verified" }).ok).toBe(false);
    expect(
      canAttestOwnership({
        ...base,
        evidence: [
          positive,
          {
            signal: "homepage_other_host",
            weight: 0.4,
            polarity: "negative",
            detail: "Homepage is another site",
          },
        ],
      }).ok,
    ).toBe(false);
  });

  it("counts a confirmation as allowing fixes until it expires", () => {
    expect(ownershipAllowsFixes("attested")).toBe(true);
    expect(
      ownershipIsCurrent({
        status: "attested",
        checkedHost: "threereach.lovable.app",
        checkedAt: new Date().toISOString(),
        siteHost: "threereach.lovable.app",
      }),
    ).toBe(true);
  });
});
