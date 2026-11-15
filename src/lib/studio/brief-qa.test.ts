import { describe, expect, it } from "vitest";
import { briefIssues } from "./prompt-writer";

const good = [
  "Idea: The night shift crew at Bake House, shot as the first tray comes out at 4am.",
  "Headline: Baked while you sleep",
  "Supporting line: Fresh sourdough on the shelf by 7.",
  "Picture: A baker pulling a tray of loaves from the oven, steam in the warm light.",
  "Caption idea: A thank-you to the crew who start before the city wakes.",
].join("\n");

describe("briefIssues (the brief's free QA pass)", () => {
  it("passes a short, specific brief", () => {
    expect(briefIssues({ prompt: good, type: "image", known: "Bake House sourdough" })).toEqual([]);
  });

  it("names missing sections", () => {
    const issues = briefIssues({ prompt: "Idea: a post", type: "image", known: "" });
    expect(issues[0]).toMatch(/Missing sections: Headline/);
  });

  it("refuses clichés and long on-picture headlines", () => {
    const issues = briefIssues({
      prompt: good.replace(
        "Headline: Baked while you sleep",
        "Headline: Elevate your mornings with bread that truly changes everything today",
      ),
      type: "image",
      known: "",
    });
    expect(issues.join(" ")).toMatch(/elevate/);
    expect(issues.join(" ")).toMatch(/'headline'.*7 words/);
  });

  it("flags figures nobody gave, keeps the ones the brand said", () => {
    const made = good.replace("Fresh sourdough", "40% off sourdough");
    expect(briefIssues({ prompt: made, type: "image", known: "" }).join(" ")).toMatch(/40%/);
    expect(briefIssues({ prompt: made, type: "image", known: "This week: 40% off" })).toEqual([]);
  });
});
