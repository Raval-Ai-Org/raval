import { afterEach, describe, expect, it, vi } from "vitest";
import { encryptWithKey } from "@/server/crypto/secret-box.server";
import { canvaStatus } from "./service.server";

const { from } = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from },
}));

const workspaceId = "11111111-1111-4111-8111-111111111111";
const connectionId = "22222222-2222-4222-8222-222222222222";

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

describe("Canva saved connection", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    from.mockReset();
  });

  it("offers reconnect when a deployed encryption key cannot read the saved grant", async () => {
    const oldKey = Buffer.alloc(32, 1);
    vi.stubEnv("CANVA_CLIENT_ID", "client-id");
    vi.stubEnv("CANVA_CLIENT_SECRET", "client-secret");
    vi.stubEnv("CANVA_TOKEN_ENCRYPTION_KEY", oldKey.toString("base64"));
    vi.stubEnv("APP_URL", "https://mellox.ai");
    from.mockImplementation((table: string) =>
      table === "workspace_connections"
        ? query({
            data: { id: connectionId, status: "active", account_login: "Canva" },
            error: null,
          })
        : query({
            data: {
              access_token_enc: encryptWithKey("old-access", oldKey),
              refresh_token_enc: encryptWithKey("old-refresh", oldKey),
            },
            error: null,
          }),
    );

    await expect(canvaStatus(workspaceId)).resolves.toMatchObject({
      configured: true,
      status: "active",
    });
    vi.stubEnv("CANVA_TOKEN_ENCRYPTION_KEY", Buffer.alloc(32, 2).toString("base64"));
    await expect(canvaStatus(workspaceId)).resolves.toMatchObject({
      configured: true,
      status: "error",
    });
  });
});
