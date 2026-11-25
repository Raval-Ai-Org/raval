import { describe, expect, it } from "vitest";
import { matchKeywords } from "./keywords";
import {
  dmText,
  personalize,
  pickReply,
  pickRule,
  sendsByItself,
  tidyRule,
  RULE_TEMPLATES,
  type EngageRule,
} from "./rules";
import { answersBlock, examplesBlock, tidyAnswer, worthKeeping } from "./training";

function rule(over: Partial<EngageRule>): EngageRule {
  return {
    id: "r1",
    name: "R",
    status: "live",
    platforms: ["instagram", "facebook"],
    postScope: "any",
    postIds: [],
    match: "keywords",
    keywords: ["link"],
    wholeWord: true,
    replyMode: "fixed",
    replies: ["Sent!"],
    moxGuidance: null,
    dmEnabled: false,
    dmMessage: null,
    dmLink: null,
    sendMode: "auto",
    position: 0,
    liveSince: "2026-11-01T00:00:00Z",
    matchedCount: 0,
    sentCount: 0,
    dmCount: 0,
    lastMatchedAt: null,
    ...over,
  };
}

const comment = (body: string, over: Partial<Parameters<typeof pickRule>[0]> = {}) => ({
  id: "c1",
  platform: "instagram" as const,
  postId: "100",
  body,
  commentedAt: "2026-11-20T00:00:00Z",
  ...over,
});

describe("matchKeywords (ported from OpenReply)", () => {
  it("matches whole words in any case, ignoring emoji", () => {
    expect(matchKeywords("LINK please 🔥", ["link"]).matched).toBe(true);
    expect(matchKeywords("linking up", ["link"]).matched).toBe(false);
    expect(matchKeywords("linking up", ["link"], false).matched).toBe(true);
  });
  it("folds Latin accents both ways", () => {
    expect(matchKeywords("Qual o PREÇO?", ["preco"]).matched).toBe(true);
  });
  it("folds Arabic-script keyboard variants (Urdu/Persian)", () => {
    // Arabic yeh + kaf typed, Persian forms in the keyword.
    expect(matchKeywords("لينك", ["لینک"]).matched).toBe(true);
  });
  it("lets O stand for zero in numeric keywords", () => {
    expect(matchKeywords("O8", ["08"]).matched).toBe(true);
  });
});

describe("pickRule", () => {
  it("takes the first live rule in order", () => {
    const a = rule({ id: "a", position: 1, keywords: ["price"] });
    const b = rule({ id: "b", position: 0, keywords: ["price"] });
    expect(pickRule(comment("price?"), [a, b])?.rule.id).toBe("b");
  });
  it("skips paused rules, other platforms, other posts and older comments", () => {
    expect(pickRule(comment("link"), [rule({ status: "paused" })])).toBeNull();
    expect(pickRule(comment("link"), [rule({ platforms: ["facebook"] })])).toBeNull();
    expect(pickRule(comment("link"), [rule({ postScope: "posts", postIds: ["999"] })])).toBeNull();
    expect(pickRule(comment("link"), [rule({ liveSince: "2026-11-21T00:00:00Z" })])).toBeNull();
  });
  it("matches any comment when asked, and reports the keyword", () => {
    expect(pickRule(comment("nice"), [rule({ match: "any" })])?.keyword).toBeNull();
    expect(pickRule(comment("send the LINK"), [rule({})])?.keyword).toBe("link");
  });
});

describe("replies and messages", () => {
  it("rotates replies stably by comment", () => {
    const r = ["a", "b", "c"];
    expect(pickReply(r, "123")).toBe(pickReply(r, "123"));
    expect(pickReply([], "1")).toBeNull();
  });
  it("fills {name} with the first name or drops it", () => {
    expect(personalize("Thanks {name}!", "Sara Khan")).toBe("Thanks Sara!");
    expect(personalize("Thanks {name}!", null)).toBe("Thanks!");
    expect(personalize("{name}, check your DMs", null)).toBe("check your DMs");
  });
  it("adds the link on its own line", () => {
    expect(dmText({ dmMessage: "Here you go", dmLink: "https://mellox.ai/x" }, null)).toBe(
      "Here you go\n\nhttps://mellox.ai/x",
    );
  });
  it("never lets a Mox-written reply send by itself", () => {
    expect(sendsByItself({ sendMode: "auto", replyMode: "mox" })).toBe(false);
    expect(sendsByItself({ sendMode: "auto", replyMode: "fixed" })).toBe(true);
    expect(sendsByItself({ sendMode: "approve", replyMode: "fixed" })).toBe(false);
  });
});

describe("tidyRule", () => {
  it("accepts every template", () => {
    for (const t of RULE_TEMPLATES) {
      const out = tidyRule({ ...t.rule, postIds: t.rule.postScope === "posts" ? ["1"] : [] });
      expect(out.ok, t.id).toBe(true);
    }
  });
  it("refuses what can't work", () => {
    expect(tidyRule({ platforms: [] }).ok).toBe(false);
    expect(tidyRule({ platforms: ["instagram"], match: "keywords", keywords: [] }).ok).toBe(false);
    expect(
      tidyRule({ platforms: ["instagram"], keywords: ["x"], replyMode: "fixed", replies: [] }).ok,
    ).toBe(false);
    expect(
      tidyRule({
        platforms: ["instagram"],
        keywords: ["x"],
        replies: ["ok"],
        dmEnabled: true,
        dmMessage: "hi",
        dmLink: "http://insecure.example",
      }).ok,
    ).toBe(false);
    expect(
      tidyRule({ platforms: ["instagram"], match: "any", replies: ["hi"], sendMode: "auto" }).ok,
    ).toBe(false);
  });
});

describe("training", () => {
  it("checks answers and builds capped blocks", () => {
    expect(tidyAnswer("", "x").ok).toBe(false);
    const block = answersBlock([{ id: "1", question: "Ship?", answer: "Yes", updatedAt: "" }]);
    expect(block).toContain("Q: Ship?");
    const ex = examplesBlock(
      [
        { id: "1", platform: "facebook", comment: "fb", reply: "fb r", createdAt: "" },
        { id: "2", platform: "instagram", comment: "ig", reply: "ig r", createdAt: "" },
      ],
      "instagram",
    );
    expect(ex.indexOf("ig")).toBeLessThan(ex.indexOf("fb"));
    expect(worthKeeping("Thanks!")).toBe(false);
    expect(worthKeeping("Yes we ship to Lahore too")).toBe(true);
  });
});
