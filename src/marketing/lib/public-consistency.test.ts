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
  it("opens on monthly pricing and shows Scale's monthly price", () => {
    const html = renderToStaticMarkup(React.createElement(PricingPlans));
    expect(html).toContain('aria-pressed="true">Monthly');
    const scale = html.slice(html.indexOf('class="pp-strip"'));
    expect(scale).toContain("$1,199");
    expect(scale).toContain("billed monthly");
    expect(scale).not.toContain("$999");
  });

  it("keeps Scale's card data, comparison, FAQ and annual charge aligned", () => {
    expect(CATALOG.scale.priceMonthlyUsd).toBe(1199);
    expect(PLANS.find((p) => p.id === "scale")?.monthly).toBe(1199);
    expect(MATRIX_COLUMNS.find((p) => p.name === "Scale")?.price).toBe("$1,199 /mo");
    const answer = PRICING_FAQS.find((f) => f.q === "What does Scale include?")?.a;
    expect(answer).toContain("$1,199 a month");
    expect(answer).toContain("$11,990 a year");
    expect(planPrice("scale", "year")).toMatchObject({ billed: 11990, perMonth: 999.17 });
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
