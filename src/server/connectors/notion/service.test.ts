import { afterEach, describe, expect, it, vi } from "vitest";
import { encryptWithKey } from "@/server/crypto/secret-box.server";
import { calendarFit, listNotionDestinations, notionStatus } from "./service.server";

const { from, notionRequest } = vi.hoisted(() => ({ from: vi.fn(), notionRequest: vi.fn() }));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from },
}));
vi.mock("./client.server", () => ({
  exchangeNotionCode: vi.fn(),
  notionPages: vi.fn(),
  notionRequest,
}));

function query(result: unknown) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    neq: () => chain,
    order: () => chain,
    limit: () => chain,
    maybeSingle: async () => result,
  };
  return chain;
}

describe("Notion connection status", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    from.mockReset();
    notionRequest.mockReset();
  });

  it("responds from stored credentials without waiting on the Notion API", async () => {
    const key = Buffer.alloc(32, 3);
    vi.stubEnv("NOTION_CLIENT_ID", "client-id");
    vi.stubEnv("NOTION_CLIENT_SECRET", "client-secret");
    vi.stubEnv("NOTION_TOKEN_ENCRYPTION_KEY", key.toString("base64"));
    vi.stubEnv("APP_URL", "https://mellox.ai");
    vi.stubEnv("NOTION_REDIRECT_URI", "https://mellox.ai/api/integrations/notion/callback");
    from.mockImplementation((table: string) =>
      table === "workspace_connections"
        ? query({
            data: { id: "connection-id", status: "active", account_login: "Workspace" },
            error: null,
          })
        : query({
            data: {
              access_token_enc: encryptWithKey("notion-token", key),
              selected_destination_name: null,
              selected_destination_url: null,
              selected_data_source_id: null,
              last_sync_at: null,
            },
            error: null,
          }),
    );
    notionRequest.mockImplementation(() => new Promise(() => {}));

    await expect(notionStatus("workspace-id")).resolves.toMatchObject({
      configured: true,
      status: "active",
    });
    expect(notionRequest).not.toHaveBeenCalled();

    vi.stubEnv("NOTION_TOKEN_ENCRYPTION_KEY", Buffer.alloc(32, 4).toString("base64"));
    await expect(notionStatus("workspace-id")).resolves.toMatchObject({ status: "error" });
    await expect(listNotionDestinations("workspace-id")).rejects.toMatchObject({ status: 409 });
    expect(notionRequest).not.toHaveBeenCalled();
  });
});

describe("which Notion databases can hold the calendar", () => {
  const ready = {
    Name: { type: "title" },
    Content: { type: "rich_text" },
    "Mellox ID": { type: "rich_text" },
    "Mellox Workspace ID": { type: "rich_text" },
  };
  it("is ready only with all four columns of the right type", () => {
    expect(calendarFit(ready)).toBe("ready");
  });
  it("offers to add columns when they are simply missing", () => {
    expect(calendarFit({ Name: { type: "title" }, About: { type: "rich_text" } })).toBe("addable");
  });
  it("never offers to change a column a person already made", () => {
    expect(calendarFit({ ...ready, Content: { type: "select" } })).toBe("unfit");
    expect(calendarFit({ Title: { type: "title" } })).toBe("unfit");
    expect(calendarFit(null)).toBe("unfit");
  });
});
