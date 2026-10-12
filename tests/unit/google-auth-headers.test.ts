import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";

describe("Google authentication security headers", () => {
  it("allows the GIS SDK, stylesheet, connections and frames while preserving popup communication", async () => {
    const routes = await nextConfig.headers!();
    const headers = routes.find((route) => route.source === "/:path*")!.headers;
    const csp = headers.find((header) => header.key === "Content-Security-Policy")!.value;
    const directives = Object.fromEntries(
      csp.split("; ").map((rule) => {
        const [name, ...sources] = rule.split(" ");
        return [name, sources];
      }),
    );
    expect(directives["script-src"]).toContain("https://accounts.google.com/gsi/client");
    expect(directives["style-src"]).toContain("https://accounts.google.com/gsi/style");
    expect(directives["connect-src"]).toContain("https://accounts.google.com/gsi/");
    expect(directives["frame-src"]).toContain("https://accounts.google.com");
    expect(directives["object-src"]).toEqual(["'none'"]);
    expect(directives["frame-ancestors"]).toEqual(["'none'"]);
    expect(headers).toContainEqual({
      key: "Cross-Origin-Opener-Policy",
      value: "same-origin-allow-popups",
    });
  });
});
