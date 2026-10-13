import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import PricingPlans from "@/marketing/components/pricing/PricingPlans";
import RetiredFounderPage, {
  generateStaticParams,
  metadata,
} from "@/app/(marketing)/about/[slug]/page";
import { PLANS as CATALOG } from "@/lib/billing/catalog";
import { planPrice } from "@/lib/billing/present";
import { FOUNDERS } from "./about";
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

  it("uses Mellox AI as the public organization name without personal metadata", () => {
    expect(SITE_NAME).toBe("Mellox AI");
    expect(organizationJsonLd.name).toBe("Mellox AI");
    expect(organizationJsonLd).not.toHaveProperty("founder");
  });

  it("keeps founder biographies and personal links out of AI-readable exports", () => {
    for (const text of [buildLlmsTxt([]), buildLlmsFullTxt([])]) {
      for (const founder of FOUNDERS) {
        expect(text).not.toContain(founder.name);
        expect(text).not.toContain(founder.bio);
        for (const social of founder.socials) expect(text).not.toContain(social.href);
      }
      expect(text).toContain("Mellox AI");
    }
  });

  it("removes founder profile URLs from the sitemap", async () => {
    const entries = await sitemap();
    expect(entries.some((entry) => new URL(entry.url).pathname.startsWith("/about/"))).toBe(false);
    expect(entries.some((entry) => new URL(entry.url).pathname === "/about")).toBe(true);
  });

  it("redirects every retired profile to About and rejects unknown profiles", async () => {
    expect(metadata.robots).toEqual({ index: false, follow: true });
    const profiles = generateStaticParams();
    expect(profiles.length).toBeGreaterThan(0);
    for (const profile of profiles) {
      await expect(RetiredFounderPage({ params: Promise.resolve(profile) })).rejects.toThrow(
        "redirect:/about",
      );
    }
    await expect(
      RetiredFounderPage({ params: Promise.resolve({ slug: "unknown" }) }),
    ).rejects.toThrow("notFound");
  });
});
