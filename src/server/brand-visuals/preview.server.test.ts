import { beforeEach, it, expect, vi } from "vitest";
import sharp from "sharp";
const mock = vi.hoisted(() => ({
  upload: vi.fn(),
  query: { update: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), error: null },
}));
vi.mock("@/server/assets/storage.server", () => ({ uploadAssetObject: mock.upload }));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: () => mock.query },
}));
import { createVisualPreview } from "./preview.server";
const workspace = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
const path = (ws: string) =>
  `workspace/${ws}/assets/r2/00000000-0000-4000-8000-000000000003/original.png`;
beforeEach(() => vi.clearAllMocks());
it("retains the complete source while uploading a light owned gallery preview", async () => {
  const original = await sharp({
    create: { width: 1000, height: 4000, channels: 3, background: "#f3efe5" },
  })
    .png()
    .toBuffer();
  const before = Buffer.from(original);
  await createVisualPreview(
    workspace,
    { id: "asset", storage_path: path(workspace) },
    original,
    true,
  );
  const preview = mock.upload.mock.calls[0][1] as Buffer;
  expect(mock.upload.mock.calls[0][0]).toBe(path(workspace).replace("original.png", "preview.jpg"));
  const image = await sharp(preview).metadata();
  expect(image.width).toBe(480);
  expect(image.height).toBe(360);
  expect(preview.length).toBeLessThan(50000);
  expect(original.equals(before)).toBe(true);
  expect(mock.query.eq).toHaveBeenCalledWith("workspace_id", workspace);
});
it("never writes a preview for another workspace's asset", async () => {
  await createVisualPreview(
    workspace,
    { id: "asset", storage_path: path(other) },
    Buffer.from("invalid"),
  );
  expect(mock.upload).not.toHaveBeenCalled();
  expect(mock.query.update).not.toHaveBeenCalled();
});
