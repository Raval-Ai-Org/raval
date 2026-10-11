import { describe, expect, it } from "vitest";
import { GOOGLE_DISCLOSURE, GOOGLE_DISCLOSURE_VERSION } from "./google-disclosure";
import { GOOGLE_REQUESTED_SCOPES } from "@/server/analytics/google/config.server";
import { buildAuthUrl } from "@/server/analytics/google/oauth.server";
import { PRIVACY } from "./privacy";
import { TERMS } from "./terms";
import { SUPPORT_FORM } from "./contact";
describe("Google consent disclosures and least privilege", () => {
  it("requests only implemented read scopes and account identification", () => {
    expect([...GOOGLE_REQUESTED_SCOPES]).toEqual([
      "openid",
      "email",
      "https://www.googleapis.com/auth/analytics.readonly",
      "https://www.googleapis.com/auth/webmasters.readonly",
    ]);
    const url = new URL(
      buildAuthUrl(
        {
          clientId: "client",
          clientSecret: "secret",
          redirectUri: "https://mellox.ai/api/integrations/google/callback",
        },
        "state",
        "challenge",
      ),
    );
    expect(url.searchParams.get("include_granted_scopes")).toBe("false");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });
  it("discloses AI processing, downstream sharing and deletion limitations at consent", () => {
    expect(GOOGLE_DISCLOSURE_VERSION).toBe("2026-10-11");
    for (const term of ["read-only", "OpenRouter", "AI", "Disconnect", "experiment", "saved chat"])
      expect(GOOGLE_DISCLOSURE).toContain(term);
  });
  it("includes Limited Use and explicit NCII prohibitions", () => {
    const privacy = JSON.stringify(PRIVACY);
    const terms = JSON.stringify(TERMS);
    expect(privacy).toContain("explicit prior user consent");
    for (const term of [
      "non-consensual intimate imagery",
      "sexual exploitation",
      "intellectual property",
      "Google APIs",
    ])
      expect(terms).toContain(term);
  });
  it("offers identifiable privacy and safety report topics through the public contact channel", () => {
    const topic = SUPPORT_FORM.fields.find((f) => f.name === "topic");
    expect(topic && "options" in topic ? topic.options : []).toContain("AI safety / NCII report");
  });
});
