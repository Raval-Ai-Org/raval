import { describe, expect, it } from "vitest";
import {
  catalogFromJsonLd,
  catalogLinks,
  decideProduct,
  dedupeCandidates,
  foundLine,
  groundCatalog,
  linkForName,
  hasSellable,
  parseShopifyProducts,
  productFingerprint,
  productLinks,
  productsSummary,
  toCandidate,
} from "./catalog";
import { productBlock, productOffer } from "./block";

describe("productLinks", () => {
  it("keeps single product pages on the same site", () => {
    const links = productLinks(
      [
        "/products/blue-mug",
        "https://shop.example.com/products/blue-mug#reviews",
        "https://www.example.com/products/red-mug?variant=2",
        "https://example.com/collections/mugs",
        "https://other.com/products/x",
        "https://example.com/about",
      ],
      "https://example.com",
    );
    expect(links).toEqual([
      "https://example.com/products/blue-mug",
      "https://www.example.com/products/red-mug",
    ]);
  });
});

describe("catalogLinks", () => {
  it("knows product and service pages, including products inside a collection", () => {
    const links = catalogLinks(
      [
        "/collections/mugs/products/blue-mug",
        "/collections/mugs",
        "/product-page/linen-apron",
        "/services/web-design",
        "/services",
        "/product-category/kitchen",
        "/products/blue-mug.jpg",
      ],
      "https://example.com",
    );
    expect(links).toEqual([
      { url: "https://example.com/collections/mugs/products/blue-mug", kind: "product" },
      { url: "https://example.com/product-page/linen-apron", kind: "product" },
      { url: "https://example.com/services/web-design", kind: "service" },
    ]);
  });
});

describe("catalogFromJsonLd", () => {
  it("reads an ItemList of products and keeps links on the site", () => {
    const out = catalogFromJsonLd(
      [
        {
          "@type": "ItemList",
          itemListElement: [
            {
              "@type": "ListItem",
              item: {
                "@type": "Product",
                name: "Blue Mug",
                url: "/products/blue-mug",
                offers: { price: "18", priceCurrency: "USD" },
              },
            },
            {
              "@type": "ListItem",
              item: { "@type": "Product", name: "Elsewhere", url: "https://other.com/x" },
            },
          ],
        },
      ],
      "https://example.com/shop",
    );
    expect(out.map((c) => [c.name, c.url, c.price])).toEqual([
      ["Blue Mug", "https://example.com/products/blue-mug", "USD 18"],
      ["Elsewhere", null, ""],
    ]);
  });
});

describe("groundCatalog", () => {
  const text =
    "Bright Smiles. Our treatments: Teeth Whitening from £199. Invisalign clear aligners for adults.";

  it("keeps only what the site says", () => {
    const out = groundCatalog(
      [
        { name: "Teeth whitening", kind: "service", price: "£199", description: "", url: "" },
        {
          name: "Invisalign",
          kind: "service",
          price: "£2,500",
          description: "Clear aligners for adults",
          url: "https://other.com/x",
        },
        { name: "Veneers", kind: "service", price: "", description: "", url: "" },
      ],
      { text, origin: "https://brightsmiles.example" },
    );
    expect(out.map((c) => [c.name, c.price, c.url, c.description])).toEqual([
      ["Teeth whitening", "£199", null, ""],
      ["Invisalign", "", null, "Clear aligners for adults"],
    ]);
    expect(out.every((c) => c.kind === "service")).toBe(true);
  });

  it("drops a description written in other words", () => {
    const [c] = groundCatalog(
      [
        {
          name: "Invisalign",
          kind: "service",
          price: "",
          description: "Award-winning painless orthodontics",
          url: "",
        },
      ],
      { text, origin: "https://brightsmiles.example" },
    );
    expect(c.description).toBe("");
  });
});

describe("linkForName and foundLine", () => {
  it("matches a page by its address and counts kinds", () => {
    const pages = [{ url: "https://e.com/services/web-design/", kind: "service" as const }];
    expect(linkForName("Web Design", pages)?.url).toBe("https://e.com/services/web-design/");
    expect(linkForName("SEO", pages)).toBeNull();
    expect(foundLine([{ kind: "product" }, { kind: "service" }, {}])).toBe(
      "2 products and 1 service",
    );
  });
});

describe("parseShopifyProducts", () => {
  it("reads titles, prices and images from the feed", () => {
    const out = parseShopifyProducts(
      {
        products: [
          {
            title: "Blue Mug",
            handle: "blue-mug",
            body_html: "<p>A <b>good</b> mug.</p>",
            product_type: "Kitchen",
            variants: [{ price: "18.00" }],
            images: [{ src: "//cdn.shopify.com/a.jpg" }],
          },
          { title: "" },
        ],
      },
      "https://example.com",
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      name: "Blue Mug",
      description: "A good mug.",
      price: "18.00",
      category: "Kitchen",
      url: "https://example.com/products/blue-mug",
      source: "shopify",
    });
    expect(out[0].images[0]).toMatch(/^https:\/\/cdn\.shopify\.com\/a\.jpg/);
  });

  it("ignores anything that isn't a feed", () => {
    expect(parseShopifyProducts({ nope: 1 }, "https://example.com")).toEqual([]);
  });
});

describe("toCandidate", () => {
  const base = {
    url: "https://example.com/p/blue-mug",
    name: "Blue Mug",
    brand: "",
    description: "",
    price: "",
    category: "",
    images: [],
    text: "",
    structured: false,
  };

  it("needs product data, a price or an image", () => {
    expect(toCandidate(base)).toBeNull();
    expect(toCandidate({ ...base, price: "USD 18" })?.name).toBe("Blue Mug");
  });
});

describe("dedupeCandidates", () => {
  it("keeps the richest copy of each product", () => {
    const thin = {
      name: "Blue Mug",
      description: "",
      price: "",
      url: "https://example.com/products/blue-mug",
      category: "",
      images: [],
      source: "scan" as const,
      fingerprint: productFingerprint({
        url: "https://example.com/products/blue-mug",
        name: "Blue Mug",
      }),
    };
    const rich = {
      ...thin,
      images: ["https://cdn/x.jpg"],
      price: "18",
      source: "shopify" as const,
    };
    expect(dedupeCandidates([thin, rich])).toEqual([rich]);
  });
});

describe("decideProduct", () => {
  it("needs a name and fixes a bare link", () => {
    expect(decideProduct({ name: " " }).ok).toBe(false);
    const d = decideProduct({ name: "Coaching", kind: "service", url: "example.com/coaching" });
    expect(d.ok && d.input.url).toBe("https://example.com/coaching");
    expect(d.ok && d.input.kind).toBe("service");
  });
});

describe("summary and gate", () => {
  it("lists active products only", () => {
    expect(
      productsSummary([
        { name: "A", status: "active" },
        { name: "B", status: "archived" },
        { name: "C", status: "active" },
      ]),
    ).toBe("A, C");
    expect(hasSellable([{ status: "archived" }])).toBe(false);
  });
});

describe("productBlock", () => {
  it("keeps to stored facts and protects the real photo", () => {
    const block = productBlock(
      {
        kind: "product",
        name: "Blue Mug",
        description: "Stoneware, 350 ml",
        price: "$18",
        url: null,
        category: "",
        benefits: ["Keeps coffee hot"],
      },
      { hasPhoto: true },
    );
    expect(block).toContain("Blue Mug");
    expect(block).toContain("Never add a feature");
    expect(block).toContain("Never redraw");
    expect(productOffer({ name: "Blue Mug", price: "$18" })).toBe("Blue Mug — $18");
  });
});
