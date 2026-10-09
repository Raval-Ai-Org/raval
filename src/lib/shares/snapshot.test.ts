import { describe, expect, it } from "vitest";
import { approvalVerdict, assetPathsFromMeta, contentSnapshot, mediaKind } from "./snapshot";

const WS = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const own = (name: string) => `workspace/${WS}/assets/${name}`;

describe("share snapshot", () => {
  it("keeps only stored media of the post's own workspace", () => {
    expect(assetPathsFromMeta({ asset_storage_path: own("a.jpg") }, WS)).toEqual([own("a.jpg")]);
    expect(
      assetPathsFromMeta(
        {
          asset_storage_paths: [own("1.jpg"), `workspace/${OTHER}/assets/x.jpg`, own("1.jpg"), 7],
          asset_storage_path: own("1.jpg"),
        },
        WS,
      ),
    ).toEqual([own("1.jpg")]);
    expect(assetPathsFromMeta({ asset_storage_path: `${own("a")}/../../x` }, WS)).toEqual([]);
    expect(assetPathsFromMeta(null, WS)).toEqual([]);
  });

  it("tells a video from a picture", () => {
    expect(mediaKind(own("clip.mp4"))).toBe("video");
    expect(mediaKind(own("slide.jpg"))).toBe("image");
  });

  it("builds the snapshot from the row, not from the browser", () => {
    const snap = contentSnapshot(
      {
        id: "x",
        body: "Hello",
        channel: "instagram",
        kind: "post",
        scheduled_at: null,
        hashtags: ["a"],
        media_url: "javascript:alert(1)",
        meta: { asset_storage_path: own("a.jpg") },
      },
      WS,
    );
    expect(snap.media_url).toBeNull();
    expect(snap.asset_paths).toEqual([own("a.jpg")]);
    expect(snap.body).toBe("Hello");
  });
});

describe("client approval", () => {
  const shown = { body: "Spring is here." };

  it("approves a draft that still says what the client saw", () => {
    expect(approvalVerdict({ status: "draft", body: "Spring is here.\r\n" }, shown)).toBe(
      "approve",
    );
    expect(approvalVerdict({ status: "pending", body: "Spring is here." }, shown)).toBe("approve");
  });

  it("refuses when the words changed after sharing", () => {
    expect(approvalVerdict({ status: "draft", body: "Summer is here." }, shown)).toBe("changed");
  });

  it("never moves a post backwards", () => {
    for (const status of ["approved", "scheduled", "publishing", "published"]) {
      expect(approvalVerdict({ status, body: "Something else" }, shown)).toBe("already");
    }
  });

  it("reports a deleted post", () => {
    expect(approvalVerdict(null, shown)).toBe("missing");
  });
});
