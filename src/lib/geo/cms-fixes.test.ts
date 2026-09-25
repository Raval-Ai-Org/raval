import { describe, expect, it } from "vitest";
import { GEO_RULES } from "./rules";
import {
  CMS_MANUAL_RULES,
  cmsFieldsForRule,
  fieldSupport,
  rulesWithoutCmsEntry,
  type CmsField,
} from "./cms-fixes";

describe("CMS fix coverage", () => {
  it("maps every rule to CMS fields or an explicit manual entry", () => {
    expect(rulesWithoutCmsEntry()).toEqual([]);
  });

  it("never lists a rule as both field-mapped and manual", () => {
    for (const rule of GEO_RULES)
      if (cmsFieldsForRule(rule.id).length) expect(CMS_MANUAL_RULES.has(rule.id)).toBe(false);
  });

  it("maps AI crawler rules to robots.txt", () => {
    expect(cmsFieldsForRule("ai.bot.gptbot")).toEqual(["robots_txt"]);
  });

  it("keeps business facts and legal pages manual", () => {
    for (const id of ["trust.about", "trust.privacy", "content.substance", "trust.claims_sourced"])
      expect(cmsFieldsForRule(id)).toEqual([]);
  });
});

describe("fieldSupport", () => {
  const every: CmsField[] = [
    "seo_title",
    "meta_description",
    "canonical",
    "noindex",
    "og",
    "jsonld_page",
    "jsonld_site",
    "robots_txt",
    "llms_txt",
    "content_html",
    "image_alt",
  ];

  it("applies everything on a WordPress post with the Mellox plugin", () => {
    for (const f of every)
      expect(
        fieldSupport(f, { provider: "wordpress", wpSeo: "mellox", pageKind: "wp_object" }).mode,
      ).toBe("apply");
  });

  it("uses Jetpack SEO for title and description on WordPress.com, and assists the rest", () => {
    const ctx = {
      provider: "wordpress" as const,
      wpSeo: "jetpack" as const,
      pageKind: "wp_object" as const,
    };
    expect(fieldSupport("meta_description", ctx).mode).toBe("apply");
    expect(fieldSupport("seo_title", ctx).mode).toBe("apply");
    expect(fieldSupport("noindex", ctx).mode).toBe("apply");
    expect(fieldSupport("canonical", ctx).mode).toBe("assisted");
    expect(fieldSupport("jsonld_site", ctx).mode).toBe("assisted");
    expect(fieldSupport("content_html", ctx).mode).toBe("apply");
  });

  it("never writes per-page fields when the page isn't a single WordPress object", () => {
    expect(
      fieldSupport("meta_description", {
        provider: "wordpress",
        wpSeo: "mellox",
        pageKind: "wp_other",
      }).mode,
    ).toBe("assisted");
  });

  it("writes Webflow page SEO on static pages and rich text on CMS items only", () => {
    expect(fieldSupport("seo_title", { provider: "webflow", pageKind: "webflow_page" }).mode).toBe(
      "apply",
    );
    expect(fieldSupport("seo_title", { provider: "webflow", pageKind: "webflow_item" }).mode).toBe(
      "assisted",
    );
    expect(
      fieldSupport("content_html", { provider: "webflow", pageKind: "webflow_item" }).mode,
    ).toBe("apply");
    expect(
      fieldSupport("jsonld_site", { provider: "webflow", pageKind: "webflow_page" }).mode,
    ).toBe("assisted");
  });
});
