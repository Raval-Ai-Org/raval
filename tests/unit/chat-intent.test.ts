import { describe, expect, it } from "vitest";
import { detectCreateIntent } from "@/lib/chat-intent";

describe("detectCreateIntent", () => {
  it.each([
    ["Create a carousel with 5 cold brew tips", "carousel"],
    ["make an Instagram post about our summer menu", "social"],
    ["Please write a blog post on AI search for dentists", "article"],
    ["Can you generate an image of our new latte for Instagram?", "image"],
    ["I need a video script for a 30 second reel about onboarding", "script"],
    ["Hey, draft a LinkedIn post announcing our seed round", "social"],
    ["Design an ad for the Black Friday sale", "ad"],
  ])("starts Studio for %s", (text, type) => {
    expect(detectCreateIntent(text)?.type).toBe(type);
  });

  it.each([
    "What makes a good carousel?",
    "How often should I post on LinkedIn",
    "Analyze my competitors' Instagram posts",
    "Build a 30-day marketing plan for my business",
    "Our last blog post did badly, why?",
    "carousel",
    "Tell me about video ads",
  ])("keeps %s as a chat turn", (text) => {
    expect(detectCreateIntent(text)).toBeNull();
  });
});
