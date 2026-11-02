import { describe, expect, it } from "vitest";
import { allowedTool, integrationApp } from "@/lib/integrations/catalog";
import {
  DESTINATION_LOOKUP,
  destinationAccountId,
  parseDestinationAccountId,
  readDestinations,
} from "./destinations";

describe("readDestinations", () => {
  it("reads the Instagram business account, wrapped or not", () => {
    const me = {
      id: "17841",
      username: "beanco",
      name: "BeanCo",
      profile_picture_url: "https://x/p.jpg",
    };
    expect(readDestinations("instagram", me)).toEqual([
      { id: "17841", username: "beanco", displayName: "BeanCo", avatarUrl: "https://x/p.jpg" },
    ]);
    expect(readDestinations("instagram", { data: me })[0].id).toBe("17841");
    expect(readDestinations("instagram", { data: {} })).toEqual([]);
  });

  it("lists every Facebook Page, from a Graph list in data.data", () => {
    const data = {
      data: {
        data: [
          { id: "p1", name: "BeanCo", picture: { data: { url: "https://x/1.jpg" } } },
          { id: "p2", name: "BeanCo Cafe" },
          { name: "no id" },
        ],
      },
    };
    expect(readDestinations("facebook", data)).toEqual([
      { id: "p1", username: null, displayName: "BeanCo", avatarUrl: "https://x/1.jpg" },
      { id: "p2", username: null, displayName: "BeanCo Cafe", avatarUrl: null },
    ]);
  });

  it("turns a LinkedIn id or OpenID sub into a person URN", () => {
    expect(
      readDestinations("linkedin", {
        data: { id: "abc", localizedFirstName: "Sam", localizedLastName: "Lee" },
      }),
    ).toEqual([
      { id: "urn:li:person:abc", username: null, displayName: "Sam Lee", avatarUrl: null },
    ]);
    expect(readDestinations("linkedin", { sub: "xyz", name: "Sam" })[0].id).toBe(
      "urn:li:person:xyz",
    );
    expect(readDestinations("linkedin", { id: "urn:li:person:q" })[0].id).toBe("urn:li:person:q");
  });

  it("lists Pinterest boards, at most ten, without repeats", () => {
    const items = Array.from({ length: 14 }, (_, i) => ({ id: String(i % 12), name: `B${i}` }));
    const out = readDestinations("pinterest", { data: { items } });
    expect(out).toHaveLength(10);
    expect(new Set(out.map((d) => d.id)).size).toBe(10);
  });

  it("drops non-https pictures", () => {
    expect(
      readDestinations("instagram", { id: "1", profile_picture_url: "http://x/p.jpg" })[0]
        .avatarUrl,
    ).toBeNull();
  });
});

describe("destination account ids", () => {
  it("round-trips, keeping colons in a LinkedIn URN", () => {
    const id = destinationAccountId("acc-1", "urn:li:person:abc");
    expect(parseDestinationAccountId(id)).toEqual({
      integrationAccountId: "acc-1",
      destination: "urn:li:person:abc",
    });
    expect(parseDestinationAccountId("nocolon")).toBeNull();
    expect(parseDestinationAccountId(":x")).toBeNull();
  });
});

describe("DESTINATION_LOOKUP", () => {
  it("only uses read tools on the app's allow-list", () => {
    for (const [platform, lookup] of Object.entries(DESTINATION_LOOKUP)) {
      const tool = allowedTool(integrationApp(platform)!, lookup.tool);
      expect(tool, lookup.tool).not.toBeNull();
      expect(tool!.write).toBe(false);
    }
  });
});
