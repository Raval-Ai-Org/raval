import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  columnReady: vi.fn(),
  insert: vi.fn(),
  single: vi.fn(),
}));

vi.mock("@/server/billing/schema.server", () => ({ ugcBillingColumnReady: mocked.columnReady }));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: () => ({ insert: mocked.insert }),
  },
}));

import { RENDER_COLS, supabaseUgcStore } from "./store.supabase.server";
import type { NewRenderRow } from "./store";

const render = {
  id: "render-1",
  workspace_id: "workspace-1",
  project_id: "project-1",
  created_by: "user-1",
  idempotency_key: "click-1",
  billing_ready: false,
  model_key: "standard",
  provider: "kie",
  provider_model: "model",
  provider_variant: null,
  generation_type: "image-to-video",
  duration_sec: 6,
  aspect_ratio: "16:9",
  resolution: "720p",
  audio: false,
  reference_asset_ids: [],
  script: {},
  settings: {},
  prompt: "Create a video",
  reservation_id: "reservation-1",
  est_cost_usd: 1,
} satisfies NewRenderRow;

beforeEach(() => {
  vi.clearAllMocks();
  mocked.insert.mockReturnValue({ select: () => ({ single: mocked.single }) });
  mocked.single.mockResolvedValue({ data: render, error: null });
});

describe("UGC render schema compatibility", () => {
  it("omits the billing gate on a database that predates account billing", async () => {
    mocked.columnReady.mockResolvedValue(false);
    await supabaseUgcStore.insertRender(render);
    expect(RENDER_COLS).not.toContain("billing_ready");
    expect(mocked.insert).toHaveBeenCalledWith(
      expect.not.objectContaining({ billing_ready: expect.anything() }),
    );
  });

  it("writes the worker gate when its column is installed", async () => {
    mocked.columnReady.mockResolvedValue(true);
    await supabaseUgcStore.insertRender(render);
    expect(mocked.insert).toHaveBeenCalledWith(expect.objectContaining({ billing_ready: false }));
  });
});
