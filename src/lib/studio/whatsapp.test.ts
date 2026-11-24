import { describe, expect, it } from "vitest";
import { whatsAppLine, whatsAppLink } from "./whatsapp";

describe("whatsAppLink", () => {
  it("reads the brand's own WhatsApp from its profile", () => {
    expect(
      whatsAppLink([
        { platform: "instagram", url: "https://instagram.com/x" },
        { platform: "whatsapp", url: "https://wa.me/923001234567" },
      ]),
    ).toBe("https://wa.me/923001234567");
    expect(
      whatsAppLink([
        { platform: "other", url: "https://api.whatsapp.com/send?phone=+44 7700 900123" },
      ]),
    ).toBe("https://wa.me/447700900123");
    expect(whatsAppLink([{ platform: "whatsapp", url: "+971 50 123 4567" }])).toBe(
      "https://wa.me/971501234567",
    );
  });
  it("adds nothing when the brand has no WhatsApp", () => {
    expect(whatsAppLink([{ platform: "facebook", url: "https://facebook.com/x" }])).toBeNull();
    expect(whatsAppLink(null)).toBeNull();
    expect(whatsAppLine(null, ["facebook"])).toBeNull();
  });
  it("never pastes an untappable link on Instagram or TikTok", () => {
    expect(whatsAppLine("https://wa.me/1234567", ["instagram"])).not.toContain("wa.me");
    expect(whatsAppLine("https://wa.me/1234567", ["facebook", "instagram"])).toContain(
      "https://wa.me/1234567",
    );
  });
});
