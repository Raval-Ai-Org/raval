import { describe, expect, it } from "vitest";

import {
  disqualify,
  donorFacts,
  qualityBand,
  rankDonors,
  scoreDonor,
  WEIGHTS,
  type DonorSignals,
} from "./rank";
import { rankForBrand, relevanceScore } from "./rank";

function donor(overrides: Partial<DonorSignals> = {}): DonorSignals {
  return {
    id: 1,
    domain: "blog.com",
    ext: "com",
    page: "https://blog.com/an-article",
    priceUsd: 10,
    dr: 50,
    referringDomains: 5_000,
    backlinks: 20_000,
    dfsRank: 400,
    top100: 2_000,
    cat: "News",
    ...overrides,
  };
}

describe("weights", () => {
  it("sum to exactly 1, so the score really is out of 100", () => {
    const total = Object.values(WEIGHTS).reduce((sum, w) => sum + w, 0);
    expect(total).toBeCloseTo(1, 10);
  });
});

describe("scoreDonor", () => {
  it("stays within 0 and 100", () => {
    const cases = [
      donor(),
      donor({ dr: 0, referringDomains: 0, backlinks: 0, top100: 0, dfsRank: 0, cat: null }),
      donor({ dr: 100, referringDomains: 500_000, backlinks: 10_000_000, top100: 200_000 }),
    ];
    for (const d of cases) {
      const score = scoreDonor(d, 10);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    }
  });

  it("rates a stronger site above a weaker one", () => {
    const strong = scoreDonor(donor({ dr: 80, referringDomains: 50_000 }), 10);
    const weak = scoreDonor(donor({ dr: 15, referringDomains: 50 }), 10);
    expect(strong).toBeGreaterThan(weak);
  });

  it("falls back to the provider rank when there is no domain rating", () => {
    // An unrated site must not be scored as if it were rated zero.
    const unrated = scoreDonor(donor({ dr: null, dfsRank: 600 }), 10);
    const ratedZero = scoreDonor(donor({ dr: 0, dfsRank: 600 }), 10);
    expect(unrated).toBeGreaterThan(ratedZero);
  });

  it("penalises a site whose backlinks vastly outnumber its linking domains", () => {
    const sitewide = scoreDonor(donor({ referringDomains: 10, backlinks: 5_000_000 }), 10);
    const normal = scoreDonor(donor({ referringDomains: 10, backlinks: 2_000 }), 10);
    expect(sitewide).toBeLessThan(normal);
  });

  it("prefers the cheaper of two otherwise identical sites", () => {
    const cheap = scoreDonor(donor({ priceUsd: 10 }), 10);
    const dear = scoreDonor(donor({ priceUsd: 40 }), 10);
    expect(cheap).toBeGreaterThan(dear);
  });
});

describe("disqualify", () => {
  it("never offers the user their own site", () => {
    expect(disqualify(donor({ domain: "mysite.com" }), "mysite.com")).toBe("own_site");
    expect(disqualify(donor({ domain: "blog.mysite.com" }), "mysite.com")).toBe("own_site");
    expect(disqualify(donor({ domain: "www.mysite.com" }), "mysite.com")).toBe("own_site");
  });

  it("rejects throwaway extensions search engines distrust", () => {
    expect(disqualify(donor({ ext: "xyz" }))).toBe("blocked_tld");
    expect(disqualify(donor({ ext: "loan" }))).toBe("blocked_tld");
  });

  it("rejects file hosts, however impressive their numbers", () => {
    // These really are in the provider catalog, with a domain rating in the 90s.
    expect(
      disqualify(donor({ domain: "storage.googleapis.com", dr: 93, referringDomains: 351_692 })),
    ).toBe("non_editorial_host");
    expect(disqualify(donor({ domain: "usercontent.one" }))).toBe("non_editorial_host");
  });

  it("rejects a listing whose only sample page is an image or a PDF", () => {
    expect(disqualify(donor({ page: "https://blog.com/uploads/work41.jpg" }))).toBe("file_page");
    expect(disqualify(donor({ page: "https://blog.com/a/report.pdf" }))).toBe("file_page");
  });

  it("rejects a listing with no price", () => {
    expect(disqualify(donor({ priceUsd: 0 }))).toBe("no_price");
  });

  it("accepts an ordinary editorial site", () => {
    expect(disqualify(donor(), "mysite.com")).toBeNull();
  });
});

describe("rankDonors", () => {
  it("drops disqualified listings entirely", () => {
    const ranked = rankDonors(
      [
        donor({ id: 1 }),
        donor({ id: 2, domain: "storage.googleapis.com" }),
        donor({ id: 3, ext: "xyz", domain: "spam.xyz" }),
      ],
      { ownDomain: "mysite.com" },
    );

    expect(ranked.map((d) => d.id)).toEqual([1]);
  });

  it("offers each domain once, keeping its best listing", () => {
    const ranked = rankDonors([
      donor({ id: 1, domain: "blog.com", dr: 20 }),
      donor({ id: 2, domain: "blog.com", dr: 70 }),
    ]);

    expect(ranked).toHaveLength(1);
    expect(ranked[0].id).toBe(2);
  });

  it("returns highest score first", () => {
    const ranked = rankDonors([
      donor({ id: 1, domain: "weak.com", dr: 10, referringDomains: 20 }),
      donor({ id: 2, domain: "strong.com", dr: 85, referringDomains: 80_000 }),
      donor({ id: 3, domain: "mid.com", dr: 45, referringDomains: 3_000 }),
    ]);

    expect(ranked.map((d) => d.domain)).toEqual(["strong.com", "mid.com", "weak.com"]);
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
  });

  it("honours a limit", () => {
    const many = Array.from({ length: 30 }, (_, i) => donor({ id: i + 1, domain: `site${i}.com` }));
    expect(rankDonors(many, { limit: 5 })).toHaveLength(5);
  });

  it("is deterministic for identical input", () => {
    const input = [donor({ id: 1, domain: "a.com" }), donor({ id: 2, domain: "b.com" })];
    expect(rankDonors(input).map((d) => d.id)).toEqual(rankDonors(input).map((d) => d.id));
  });
});

describe("donorFacts", () => {
  it("reports an unknown figure as null rather than zero", () => {
    const facts = donorFacts(donor({ dr: null, referringDomains: null, top100: null, cat: null }));
    expect(facts).toEqual({
      authority: null,
      referringDomains: null,
      rankingKeywords: null,
      category: null,
    });
  });
});

describe("qualityBand", () => {
  it("bands scores without overlapping", () => {
    expect(qualityBand(90)).toBe("strong");
    expect(qualityBand(62)).toBe("strong");
    expect(qualityBand(61.99)).toBe("solid");
    expect(qualityBand(42)).toBe("solid");
    expect(qualityBand(41.99)).toBe("modest");
  });
});

describe("rankForBrand", () => {
  const site = (id: number, domain: string, extra: Partial<DonorSignals> = {}): DonorSignals => ({
    id,
    domain,
    ext: domain.split(".").pop() ?? null,
    page: `https://${domain}/`,
    priceUsd: 10,
    dr: 50,
    referringDomains: 1000,
    backlinks: 5000,
    dfsRank: 300,
    top100: 1000,
    cat: null,
    ...extra,
  });
  const catalog = [
    site(1, "dentalcareblog.com"),
    site(2, "petlovers.com"),
    site(3, "bigtechnews.com", { cat: "Technology" }),
    site(4, "fitnesstoday.com", { page: "https://fitnesstoday.com/healthy-teeth-guide" }),
    site(5, "zdorovie.ru", { cat: "Medicine" }),
  ];

  it("gives two brands in different fields different shortlists", () => {
    const dental = rankForBrand(catalog, {
      categories: ["Medicine", "Beauty & Health"],
      topics: ["dental", "teeth", "dentist"],
      tlds: ["uk"],
    });
    const software = rankForBrand(catalog, {
      categories: ["Technology", "Business"],
      topics: ["software", "tech", "startup"],
      tlds: ["uk"],
    });
    expect(dental[0].domain).toBe("dentalcareblog.com");
    expect(software[0].domain).toBe("bigtechnews.com");
  });

  it("counts topic words in the page address, and demotes foreign-language sites", () => {
    const profile = { categories: ["Medicine"], topics: ["teeth"], tlds: ["uk"] };
    const fitness = relevanceScore(catalog[3], profile);
    const pets = relevanceScore(catalog[1], profile);
    expect(fitness).toBeGreaterThan(pets);
    // Right category, wrong language: the .ru site still loses its lead.
    expect(relevanceScore(catalog[4], profile)).toBeLessThan(0.45);
  });
});
