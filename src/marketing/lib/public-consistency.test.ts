import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import PricingPlans from "@/marketing/components/pricing/PricingPlans";
import AboutPage from "@/app/(marketing)/about/page";
import FounderProfilePage, {
  generateStaticParams,
  generateMetadata,
} from "@/app/(marketing)/about/[slug]/page";
import { PLANS as CATALOG } from "@/lib/billing/catalog";
import { planPrice } from "@/lib/billing/present";
import { FOUNDERS, founderPath } from "./about";
import { buildLlmsFullTxt, buildLlmsTxt } from "./llms";
import { PLANS, PRICING_FAQS } from "./pricing";
import { MATRIX_COLUMNS } from "./pricing-matrix";
import { organizationJsonLd, SITE_NAME } from "./seo";
import sitemap from "@/marketing/sitemap";

vi.mock("@/marketing/lib/blog", () => ({ getPosts: async () => [] }));
vi.mock("next/navigation", () => ({
  permanentRedirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
  notFound: () => {
    throw new Error("notFound");
  },
}));

describe("public pricing and brand consistency", () => {
  it("opens on yearly pricing with three plans and Enterprise as Talk to us", () => {
    const html = renderToStaticMarkup(React.createElement(PricingPlans));
    expect(html).toContain('aria-pressed="true">Yearly');
    for (const price of ["$39", "$119", "$319"]) expect(html).toContain(price);
    expect(html).not.toContain(">Free<");
    const enterprise = html.slice(html.indexOf('class="pp-strip"'));
    expect(enterprise).toContain("Talk to us");
    expect(enterprise).not.toContain("$1,199");
  });

  it("keeps plan cards, comparison, FAQ and annual charges on the catalog's prices", () => {
    expect(PLANS.map((p) => p.id)).toEqual(["starter", "growth", "agency"]);
    for (const plan of PLANS) expect(plan.monthly).toBe(CATALOG[plan.id].priceMonthlyUsd);
    expect(MATRIX_COLUMNS.find((p) => p.name === "Growth")?.price).toBe("$119 /mo yearly");
    expect(MATRIX_COLUMNS.find((p) => p.name === CATALOG.scale.label)?.price).toBe("Talk to us");
    const free = PRICING_FAQS.find((f) => f.q === "Is there a free plan?")?.a;
    expect(free).toBeTruthy();
    expect(planPrice("starter", "year")).toMatchObject({ billed: 468, perMonth: 39 });
    expect(planPrice("agency", "year")).toMatchObject({ billed: 3828, perMonth: 319 });
  });

  it("uses Mellox AI as the public organization name and identifies its founders", () => {
    expect(SITE_NAME).toBe("Mellox AI");
    expect(organizationJsonLd.name).toBe("Mellox AI");
    expect(organizationJsonLd.founder.map((founder) => founder.name)).toEqual(
      FOUNDERS.map((founder) => founder.name),
    );
  });

  it("includes the founders and their profile links in AI-readable exports", () => {
    for (const text of [buildLlmsTxt([]), buildLlmsFullTxt([])]) {
      for (const founder of FOUNDERS) {
        expect(text).toContain(founder.name);
        if (founder.profile) expect(text).toContain(founderPath(founder.profile.slug));
      }
      expect(text).toContain("Mellox AI");
    }
  });

  it("includes founder biographies and official accounts in the full export", () => {
    const text = buildLlmsFullTxt([]);
    for (const founder of FOUNDERS) {
      expect(text).toContain(founder.profile?.summary ?? founder.bio);
      for (const social of founder.socials) expect(text).toContain(social.href);
    }
  });

  it("includes founder profile URLs in the sitemap", async () => {
    const entries = await sitemap();
    for (const founder of FOUNDERS) {
      if (founder.profile) {
        expect(
          entries.some(
            (entry) => new URL(entry.url).pathname === founderPath(founder.profile!.slug),
          ),
        ).toBe(true);
      }
    }
    expect(entries.some((entry) => new URL(entry.url).pathname === "/about")).toBe(true);
  });

  it("shows founder photos and profile links before the mission on About", () => {
    const html = renderToStaticMarkup(React.createElement(AboutPage));
    expect(html.indexOf('id="founders"')).toBeGreaterThan(0);
    expect(html.indexOf('id="founders"')).toBeLessThan(html.indexOf('id="mission"'));
    for (const founder of FOUNDERS) {
      expect(html).toContain(`alt="${founder.name}, ${founder.role} of Mellox"`);
      if (founder.profile) expect(html).toContain(`href="${founderPath(founder.profile.slug)}"`);
    }
  });

  it("renders every founder profile with its own metadata and rejects unknown profiles", async () => {
    const profiles = generateStaticParams();
    expect(profiles.length).toBeGreaterThan(0);
    for (const profile of profiles) {
      const founder = FOUNDERS.find((f) => f.profile?.slug === profile.slug)!;
      const html = renderToStaticMarkup(
        await FounderProfilePage({ params: Promise.resolve(profile) }),
      );
      expect(html).toContain(`<h1>${founder.name}</h1>`);
      expect(html).toContain('"@type":"ProfilePage"');
      expect(html).toContain(`alt="${founder.name}, ${founder.role} of ${SITE_NAME}"`);
      const metadata = await generateMetadata({ params: Promise.resolve(profile) });
      expect(metadata.alternates?.canonical).toBe(founderPath(profile.slug));
      expect(metadata.robots).toBeUndefined();
    }
    await expect(
      FounderProfilePage({ params: Promise.resolve({ slug: "unknown" }) }),
    ).rejects.toThrow("notFound");
  });
});
