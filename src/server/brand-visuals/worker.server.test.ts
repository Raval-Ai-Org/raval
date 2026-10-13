import { beforeEach, expect, it, vi } from "vitest";
import sharp from "sharp";
const mock = vi.hoisted(() => ({ sources: vi.fn(), download: vi.fn(), chat: vi.fn() }));
vi.mock("./service.server", () => ({ readSources: mock.sources }));
vi.mock("@/server/assets/storage.server", () => ({ downloadAssetObject: mock.download }));
vi.mock("@/lib/ai-gateway.server", () => ({ chatCompletion: mock.chat }));
vi.mock("@/server/assets/persist.server", () => ({ persistAsset: vi.fn() }));
vi.mock("@/server/billing/metered.server", () => ({ runMetered: vi.fn() }));
vi.mock("./capture.server", () => ({ captureVisualPage: vi.fn() }));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: () => ({
      select() {
        return this;
      },
      eq() {
        return this;
      },
      maybeSingle: async () => ({
        data: { warnings: ["Mobile page was unavailable."] },
        error: null,
      }),
    }),
  },
}));
import { analyzeVisualEvidence } from "./worker.server";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
beforeEach(() => {
  vi.clearAllMocks();
  mock.sources.mockResolvedValue([
    {
      id: id(1),
      purpose: "style",
      kind: "website",
      status: "candidate",
      capture_job_id: id(9),
      source_url: "https://brand.test/",
      region: { type: "section", top: 0, page: 0 },
      asset: { mime_type: "image/png", storage_path: "owned/crop.png" },
    },
    {
      id: id(2),
      purpose: "style",
      kind: "website",
      status: "candidate",
      capture_job_id: id(9),
      source_url: "https://brand.test/",
      region: { type: "full", tokens: { heading: "Georgia" } },
      asset: { mime_type: "image/png", storage_path: "owned/full.png" },
    },
  ]);
});
it("retains uncertainty, filters invented evidence and does not infer video motion", async () => {
  const bytes = await sharp({
    create: { width: 100, height: 100, channels: 3, background: "#455d49" },
  })
    .png()
    .toBuffer();
  mock.download.mockResolvedValue({ data: new Blob([new Uint8Array(bytes)]), error: null });
  mock.chat.mockResolvedValue({
    choices: [
      {
        message: {
          content: JSON.stringify({
            selected: 2,
            observations: [
              {
                category: "typography",
                description: "Measured serif heading",
                origin: "observed",
                confidence: 0.9,
                sourceIds: [id(2)],
              },
              {
                category: "mood",
                description: "Unsupported invented treatment",
                origin: "user",
                confidence: 0.95,
                sourceIds: [id(99)],
              },
              {
                category: "motion",
                description: "Motion inferred from a still",
                origin: "inferred",
                confidence: 0.9,
                sourceIds: [id(1)],
              },
            ],
            directions: [
              {
                name: "Editorial",
                summary: "Cream and navy",
                visual: {},
                sourceIds: [id(1), id(2), id(99)],
                video: { notes: "Invented motion" },
                composed: true,
                lockTheme: true,
              },
            ],
            warnings: ["Customer examples need confirmation."],
          }),
        },
      },
    ],
  });
  const profile = await analyzeVisualEvidence(id(8), id(9));
  expect(profile.selected).toBe(0);
  expect(profile.directions[0].sourceIds).toEqual([id(1)]);
  expect(profile.directions[0].video).toBeUndefined();
  expect(profile.directions[0].composed).toBe(false);
  expect(profile.directions[0].lockTheme).toBe(false);
  expect(profile.observations.some((o) => o.category === "motion")).toBe(false);
  expect(profile.observations[0].sourceIds).toEqual([id(2)]);
  expect(profile.observations[1]).toMatchObject({
    origin: "inferred",
    confidence: 0.4,
    sourceIds: [],
  });
  expect(profile.warnings).toContain("Customer examples need confirmation.");
  expect(profile.warnings).toContain("Mobile page was unavailable.");
  const content = mock.chat.mock.calls[0][0].messages[0].content;
  expect(content.filter((p: { type: string }) => p.type === "image_url")).toHaveLength(1);
});
it("does not spend on visual analysis when every image is unavailable", async () => {
  mock.download.mockResolvedValue({ data: null, error: { message: "Gone" } });
  await expect(analyzeVisualEvidence(id(8), id(9))).rejects.toThrow(
    /references could not be opened/,
  );
  expect(mock.chat).not.toHaveBeenCalled();
});
