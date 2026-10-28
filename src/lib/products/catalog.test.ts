import { describe, expect, it } from "vitest";
import {
  candidateFromPage,
  isProductPath,
  mentionScore,
  parseShopifyProducts,
  pickProduct,
  productFidelity,
  productPageCandidates,
  productSitemaps,
} from "./catalog";

describe("isProductPath", () => {
  it("accepts the common shop product URLs", () => {
    for (const path of [
      "/products/cold-brew-kit",
      "/collections/coffee/products/cold-brew-kit",
      "/en-gb/products/cold-brew-kit",
      "/product/linen-shirt/",
      "/shop/p/ceramic-mug",
      "/shop/mugs/ceramic-mug",
      "/blue-sneaker-p-12345.html",
    ])
      expect(isProductPath(path), path).toBe(true);
  });

  it("refuses listings, carts, accounts and files", () => {
    for (const path of [
      "/",
      "/products",
      "/collections/coffee",
      "/cart",
      "/account/login",
      "/blogs/news/launch",
      "/products/kit.json",
      "/about",
    ])
      expect(isProductPath(path), path).toBe(false);
  });
});

describe("productPageCandidates", () => {
  const home = "https://shop.example.com/";
  it("keeps same-site product pages once, links first then sitemap", () => {
    const out = productPageCandidates(
      home,
      [
        "https://shop.example.com/products/a?variant=1",
        "https://www.shop.example.com/collections/x/products/a",
        "https://other.com/products/b",
        "/products/c#reviews",
        "/about",
      ],
      ["https://shop.example.com/products/d"],
    );
    expect(out).toEqual([
      "https://shop.example.com/products/a",
      "https://shop.example.com/products/c",
      "https://shop.example.com/products/d",
    ]);
  });

  it("stops at the limit", () => {
    const links = Array.from({ length: 30 }, (_, i) => `/products/p${i}`);
    expect(productPageCandidates(home, links, [], 5)).toHaveLength(5);
  });
});

describe("productSitemaps", () => {
  it("finds product sitemaps in an index", () => {
    const xml = `<sitemapindex>
      <sitemap><loc>https://x.com/sitemap_pages_1.xml</loc></sitemap>
      <sitemap><loc>https://x.com/sitemap_products_1.xml?from=1</loc></sitemap>
      <sitemap><loc>https://x.com/product-sitemap.xml</loc></sitemap>
    </sitemapindex>`;
    expect(productSitemaps(xml)).toEqual([
      "https://x.com/sitemap_products_1.xml?from=1",
      "https://x.com/product-sitemap.xml",
    ]);
  });
});

describe("parseShopifyProducts", () => {
  it("reads the public feed and drops products without a photo", () => {
    const out = parseShopifyProducts(
      {
        products: [
          {
            title: "Cold Brew Kit",
            handle: "cold-brew-kit",
            body_html: "<p>Makes <b>1 litre</b> &amp; more.</p>",
            product_type: "Coffee",
            images: [{ src: "https://cdn.shopify.com/a.jpg" }, { src: "http://insecure/b.jpg" }],
            variants: [{ price: "29.00" }],
          },
          { title: "No photo", handle: "no-photo", images: [] },
          { title: "", handle: "x", images: [{ src: "https://cdn.shopify.com/c.jpg" }] },
        ],
      },
      "https://shop.example.com",
    );
    expect(out).toEqual([
      {
        name: "Cold Brew Kit",
        url: "https://shop.example.com/products/cold-brew-kit",
        price: "29.00",
        description: "Makes 1 litre & more.",
        category: "Coffee",
        images: ["https://cdn.shopify.com/a.jpg"],
      },
    ]);
  });

  it("returns nothing for anything that isn't the feed", () => {
    expect(parseShopifyProducts(null, "https://x.com")).toEqual([]);
    expect(parseShopifyProducts({ products: "no" }, "https://x.com")).toEqual([]);
  });
});

describe("candidateFromPage", () => {
  const base = {
    url: "https://x.com/products/a",
    name: "Mug",
    brand: "X",
    description: "A mug",
    price: "",
    category: "",
    images: [{ url: "https://x.com/mug.jpg", alt: "Mug" }],
    text: "",
    structured: false,
  };
  it("needs product data or a price, and a photo", () => {
    expect(candidateFromPage(base)).toBeNull();
    expect(candidateFromPage({ ...base, price: "USD 12" })?.name).toBe("Mug");
    expect(candidateFromPage({ ...base, structured: true })?.images).toEqual([
      "https://x.com/mug.jpg",
    ]);
    expect(candidateFromPage({ ...base, structured: true, images: [] })).toBeNull();
  });
});

describe("pickProduct", () => {
  const products = [
    { id: "a", name: "Ceramic Pour-Over Dripper", isPrimary: false },
    { id: "b", name: "Cold Brew Kit", isPrimary: true },
  ];
  it("follows the person's choice, including none", () => {
    expect(pickProduct(products, { chosen: "a", brief: "", type: "social" })?.id).toBe("a");
    expect(
      pickProduct(products, { chosen: "none", brief: "Cold brew kit", type: "ad" }),
    ).toBeNull();
    expect(pickProduct(products, { chosen: "gone", brief: "", type: "ad" })).toBeNull();
  });

  it("uses a product the brief names", () => {
    expect(
      pickProduct(products, { brief: "Summer post about our cold brew kit", type: "social" })?.id,
    ).toBe("b");
    expect(
      pickProduct(products, { brief: "Why a ceramic dripper beats plastic", type: "image" })?.id,
    ).toBe("a");
  });

  it("gives an ad the main product, and other formats nothing", () => {
    expect(pickProduct(products, { brief: "Spring sale", type: "ad" })?.id).toBe("b");
    expect(pickProduct(products, { brief: "Spring sale", type: "social" })).toBeNull();
    expect(pickProduct([], { brief: "Spring sale", type: "ad" })).toBeNull();
  });
});

describe("mentionScore", () => {
  it("ignores generic words", () => {
    expect(mentionScore("our new pro kit", "Pro Kit")).toBe(0);
    expect(mentionScore("the cold brew is back", "Cold Brew Kit")).toBe(1);
  });
});

describe("productFidelity", () => {
  it("names the product and where it is attached", () => {
    expect(productFidelity("Cold Brew Kit")).toContain("The first attached image");
    expect(productFidelity("Cold Brew Kit", 2)).toContain("Attached image 2");
    expect(productFidelity("Cold Brew Kit")).toContain('"Cold Brew Kit"');
  });
});
