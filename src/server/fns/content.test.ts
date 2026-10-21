import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  deleteContentItem,
  regenerateContentForConnector,
  rescheduleContentItem,
  reviewContentFromConnector,
  setContentItemStatus,
  setContentPlanDate,
  updateContentItem,
  updateImportedContentItem,
  type ContentItem,
} from "./content";

const mocks = vi.hoisted(() => ({
  db: undefined as unknown,
  role: vi.fn(),
  generate: vi.fn(),
  meter: vi.fn(),
}));
vi.mock("@/server/middleware", () => ({
  runMiddleware: async () => ({ supabase: mocks.db, userId: "user", claims: {} }),
}));
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));
vi.mock("@/server/rate-limit", () => ({ rateLimitFor: () => ({}) }));
vi.mock("@/server/workspace-access.server", () => ({ requireWorkspaceRole: mocks.role }));
vi.mock("@/lib/ai", () => ({
  runJsonPrompt: vi.fn(),
  runStructuredPrompt: mocks.generate,
  AiOutputError: class extends Error {},
}));
vi.mock("@/lib/ai/prompts", () => ({
  contentBatchPrompt: vi.fn(),
  nextPostPrompt: vi.fn(),
  regeneratePrompt: () => ({ system: "Rewrite", user: "Original" }),
}));
vi.mock("@/server/assets/storage.server", () => ({ signStoragePaths: vi.fn() }));
vi.mock("@/server/studio/context.server", () => ({
  loadStudioContext: async () => ({ brandText: "Brand", recent: [] }),
  invalidateStudioContext: vi.fn(),
}));
vi.mock("@/server/brand-look/resolve.server", () => ({ lookTextFor: async () => "" }));
vi.mock("@/server/billing/metered.server", () => ({ runMetered: mocks.meter }));

const id = "11111111-1111-4111-8111-111111111111";
const workspace = "22222222-2222-4222-8222-222222222222";
const firstRevision = "2026-10-14T10:00:00.000Z";
const nextRevision = "2026-10-14T10:00:01.000Z";

function database(status = "draft") {
  const state = {
    row: {
      id,
      workspace_id: workspace,
      agent: "spark",
      kind: "post",
      channel: "linkedin",
      title: "Original",
      body: "Old body",
      hashtags: [],
      media_url: null,
      status,
      scheduled_at: null,
      metrics: {},
      meta: { retained: true },
      created_by: "user",
      created_at: firstRevision,
      updated_at: firstRevision,
    } as ContentItem,
    onRead: undefined as (() => void) | undefined,
    updates: [] as Record<string, unknown>[],
    deleted: false,
  };
  const from = vi.fn(() => {
    let patch: Record<string, unknown> | undefined;
    let deleting = false;
    const filters = new Map<string, unknown>();
    const finish = (many: boolean) => {
      if (!patch && !deleting) {
        const snapshot = structuredClone(state.row);
        const hook = state.onRead;
        state.onRead = undefined;
        hook?.();
        return Promise.resolve({ data: snapshot, error: null });
      }
      const matches = [...filters].every(
        ([key, value]) => (state.row as unknown as Record<string, unknown>)[key] === value,
      );
      if (!matches)
        return Promise.resolve({
          data: many ? [] : null,
          error: many ? null : { code: "PGRST116", message: "No matching row" },
        });
      if (deleting) {
        state.deleted = true;
        return Promise.resolve({ data: [{ id }], error: null });
      }
      if (!patch) throw new Error("Missing update patch");
      state.updates.push(patch);
      state.row = { ...state.row, ...patch, updated_at: nextRevision } as ContentItem;
      return Promise.resolve({
        data: many ? [structuredClone(state.row)] : structuredClone(state.row),
        error: null,
      });
    };
    const query = {
      select: (_columns: string) => query,
      update: (value: Record<string, unknown>) => {
        patch = value;
        return query;
      },
      delete: () => {
        deleting = true;
        return query;
      },
      eq: (key: string, value: unknown) => {
        filters.set(key, value);
        return query;
      },
      single: () => finish(false),
      maybeSingle: () => finish(false),
      then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) =>
        finish(true).then(resolve, reject),
    };
    return query;
  });
  return { from, state };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.role.mockResolvedValue("editor");
  mocks.meter.mockImplementation(async (_options, execute) => ({ result: await execute() }));
  mocks.generate.mockResolvedValue({
    title: "A new angle",
    body: "A practical guide to selecting fresh coffee beans and controlling extraction for a balanced brew.",
    hashtags: [],
  });
});

describe("editorial content writes", () => {
  it.each(["scheduled", "publishing"])(
    "does not delete %s posts while provider delivery is active",
    async (status) => {
      const db = database(status);
      mocks.db = db;
      await expect(deleteContentItem.invoke({ id })).rejects.toMatchObject({ status: 409 });
      expect(db.state.deleted).toBe(false);
    },
  );

  it("does not delete a post that changes while the delete request runs", async () => {
    const db = database();
    mocks.db = db;
    db.state.onRead = () => {
      db.state.row.updated_at = nextRevision;
      db.state.row.status = "scheduled";
    };
    await expect(deleteContentItem.invoke({ id })).rejects.toMatchObject({ status: 409 });
    expect(db.state.deleted).toBe(false);
  });

  it("still allows removal of an editable draft", async () => {
    const db = database();
    mocks.db = db;
    expect(await deleteContentItem.invoke({ id })).toEqual({ ok: true });
    expect(db.state.deleted).toBe(true);
  });
  it("preserves metadata and invalidates approval when copy changes", async () => {
    const db = database("approved");
    mocks.db = db;
    const result = await updateContentItem.invoke({
      id,
      patch: { body: "New copy", meta: { added: true } },
    });
    expect(result.status).toBe("draft");
    expect(result.meta).toMatchObject({
      retained: true,
      added: true,
      original_content: "Old body",
      edited_by: "user",
    });
    expect(mocks.role).toHaveBeenCalledWith(expect.anything(), workspace, "editor");
  });

  it.each(["scheduled", "publishing"])(
    "refuses changes to a %s post without touching storage",
    async (status) => {
      const db = database(status);
      mocks.db = db;
      await expect(
        updateContentItem.invoke({ id, patch: { body: "Edited" } }),
      ).rejects.toMatchObject({ status: 409 });
      await expect(setContentItemStatus.invoke({ id, status: "draft" })).rejects.toMatchObject({
        status: 409,
      });
      expect(db.state.updates).toEqual([]);
    },
  );

  it("requires a posted item to return to draft before changing it", async () => {
    const db = database("published");
    mocks.db = db;
    await expect(updateContentItem.invoke({ id, patch: { body: "Edited" } })).rejects.toMatchObject(
      { status: 409 },
    );
    expect(
      (await updateContentItem.invoke({ id, patch: { status: "draft", body: "New revision" } }))
        .status,
    ).toBe("draft");
  });

  it.each(["scheduled", "publishing", "published", "failed"])(
    "does not manufacture provider state through editorial setters: %s",
    async (status) => {
      const db = database("approved");
      mocks.db = db;
      await expect(updateContentItem.invoke({ id, patch: { status } })).rejects.toHaveProperty(
        "issues",
      );
      await expect(setContentItemStatus.invoke({ id, status })).rejects.toHaveProperty("issues");
      expect(db.from).not.toHaveBeenCalled();
    },
  );

  it("returns a conflict when another editor changes the row during approval", async () => {
    const db = database();
    mocks.db = db;
    db.state.onRead = () => {
      db.state.row.body = "Someone else's edit";
      db.state.row.updated_at = nextRevision;
    };
    await expect(setContentItemStatus.invoke({ id, status: "approved" })).rejects.toMatchObject({
      status: 409,
    });
    expect(db.state.row.body).toBe("Someone else's edit");
    expect(db.state.row.status).toBe("draft");
    expect(db.state.updates).toEqual([]);
  });

  it("does not overwrite publishing metadata when a calendar move races scheduling", async () => {
    const db = database("approved");
    mocks.db = db;
    db.state.onRead = () => {
      db.state.row.status = "scheduled";
      db.state.row.meta = { provider_post: "accepted" };
      db.state.row.updated_at = nextRevision;
    };
    await expect(setContentPlanDate.invoke({ id, date: "2026-10-20" })).rejects.toMatchObject({
      status: 409,
    });
    expect(db.state.row.meta).toEqual({ provider_post: "accepted" });
  });

  it("keeps approved planning changes approved", async () => {
    const db = database("approved");
    mocks.db = db;
    const result = await setContentPlanDate.invoke({ id, date: "2026-10-20", time: "09:30" });
    expect(result.status).toBe("approved");
    expect(result.meta).toMatchObject({
      retained: true,
      calendar_date: "2026-10-20",
      calendar_time: "09:30",
    });
  });

  it("rejects the old rescheduling shortcut instead of pretending a provider accepted it", async () => {
    const db = database("approved");
    mocks.db = db;
    await expect(
      rescheduleContentItem.invoke({ id, scheduled_at: "2026-10-20T10:00:00.000Z" }),
    ).rejects.toMatchObject({ status: 409 });
    expect(db.from).not.toHaveBeenCalled();
  });

  it("does not overwrite a concurrent edit through an imported Notion update", async () => {
    const db = database();
    db.state.onRead = () => {
      db.state.row.body = "Later edit";
      db.state.row.updated_at = nextRevision;
    };
    await expect(
      updateImportedContentItem(db as never, workspace, id, {
        title: "Imported",
        body: "Import",
        channel: "linkedin",
        kind: "post",
        media_url: null,
        scheduled_at: null,
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(db.state.row.body).toBe("Later edit");
  });

  it("does not approve a changed pending post through a connector review", async () => {
    const db = database("pending");
    db.state.onRead = () => {
      db.state.row.body = "Later edit";
      db.state.row.updated_at = nextRevision;
    };
    await expect(
      reviewContentFromConnector(db as never, workspace, id, "approve"),
    ).rejects.toMatchObject({ status: 409 });
    expect(db.state.row.status).toBe("pending");
  });

  it("refuses edits before storage writes when the user lacks an editor role", async () => {
    const db = database();
    mocks.db = db;
    mocks.role.mockRejectedValue(Object.assign(new Error("Forbidden"), { status: 403 }));
    await expect(updateContentItem.invoke({ id, patch: { body: "Edited" } })).rejects.toMatchObject(
      { status: 403 },
    );
    expect(db.state.updates).toEqual([]);
  });
});

describe("AI rewrites", () => {
  it("does not overwrite manual edits made while generation runs", async () => {
    const db = database();
    mocks.generate.mockImplementation(async () => {
      db.state.row.body = "Manual edit while the rewrite was running";
      db.state.row.updated_at = nextRevision;
      return {
        body: "An original explanation of how roast temperature changes flavor and aroma over time.",
      };
    });
    await expect(
      regenerateContentForConnector({
        db: db as never,
        workspaceId: workspace,
        itemId: id,
        userId: "user",
        role: "editor",
        idempotencyKey: "rewrite",
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(db.state.row.body).toBe("Manual edit while the rewrite was running");
    expect(db.state.updates).toEqual([]);
  });

  it.each(["scheduled", "publishing", "published"])(
    "does not spend on a rewrite of a %s post",
    async (status) => {
      const db = database(status);
      await expect(
        regenerateContentForConnector({
          db: db as never,
          workspaceId: workspace,
          itemId: id,
          userId: "user",
          role: "editor",
          idempotencyKey: "rewrite",
        }),
      ).rejects.toMatchObject({ status: 409 });
      expect(mocks.meter).not.toHaveBeenCalled();
      expect(mocks.generate).not.toHaveBeenCalled();
    },
  );
});
