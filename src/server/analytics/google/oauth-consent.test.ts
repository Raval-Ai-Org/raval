import { beforeEach, describe, expect, it, vi } from "vitest";
import { GOOGLE_DISCLOSURE_VERSION } from "@/marketing/lib/google-disclosure";
import { encryptWithKey } from "@/server/crypto/secret-box.server";
const fixture = vi.hoisted(() => ({ row: null as any }));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: () => {
      const query = {
        select: () => query,
        eq: () => query,
        maybeSingle: async () => ({ data: fixture.row, error: null }),
      };
      return query;
    },
  },
}));
import { readAuthState } from "./oauth.server";
const key = Buffer.alloc(32, 7);
const state = "a".repeat(43);
const verifier = "b".repeat(64);
beforeEach(() => {
  vi.stubEnv("GOOGLE_TOKEN_ENCRYPTION_KEY", key.toString("base64"));
  fixture.row = {
    id: "state",
    workspace_id: "workspace",
    user_id: "user",
    expires_at: new Date(Date.now() + 60000).toISOString(),
    created_at: new Date().toISOString(),
    consumed_at: null,
    return_path: "/app/analytics",
    pkce_verifier_enc: encryptWithKey(
      JSON.stringify({ verifier, disclosureVersion: GOOGLE_DISCLOSURE_VERSION }),
      key,
    ),
  };
});
describe("OAuth disclosure binding", () => {
  it("accepts the current disclosure encrypted into the user's state", async () => {
    await expect(readAuthState(state, "user")).resolves.toMatchObject({
      verifier,
      workspaceId: "workspace",
    });
  });
  it("rejects an older pending flow instead of inventing AI consent", async () => {
    fixture.row.pkce_verifier_enc = encryptWithKey(verifier, key);
    await expect(readAuthState(state, "user")).rejects.toThrow("updated Google data disclosure");
  });
  it("rejects an obsolete disclosure version", async () => {
    fixture.row.pkce_verifier_enc = encryptWithKey(
      JSON.stringify({ verifier, disclosureVersion: "obsolete" }),
      key,
    );
    await expect(readAuthState(state, "user")).rejects.toThrow("updated Google data disclosure");
  });
  it("rejects another user and an expired state", async () => {
    await expect(readAuthState(state, "other-user")).rejects.toThrow("different Mellox user");
    fixture.row.expires_at = new Date(0).toISOString();
    await expect(readAuthState(state, "user")).rejects.toThrow("expired");
  });
});
