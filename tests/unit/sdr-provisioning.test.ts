// T009 — per-workspace provisioning (spec FR-022, FR-014). Uses mock Supabase +
// mock SDR calls so no network or real Supabase is required.
import { describe, it, expect, vi } from "vitest";
import { ensureWorkspaceSdrProvisioning, decryptSecret } from "@/lib/sdr-provisioning.server";

process.env.SDR_SECRET_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.SDR_BASE_URL = "http://127.0.0.1:0";
process.env.SDR_ADMIN_TOKEN = "test-admin-token";

function makeMockDb(initialRows: any[] = []) {
  const rows = [...initialRows];
  return {
    _rows: rows,
    from: vi.fn().mockImplementation(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: rows[0] ?? null, error: null }),
      upsert: vi.fn().mockImplementation(async (row: unknown) => {
        rows.push(row);
        return { error: null };
      }),
    })),
  };
}

const callSdrMock = vi.fn(async (opts: { path: string; token: string; body?: any }) => {
  if (opts.path === "/api/v1/admin/api-keys") {
    return { status: 201, data: { api_key: "per-workspace-key-1" } };
  }
  if (opts.path === "/api/v1/webhooks/config") {
    return { status: 201, data: { webhook_id: "wh-1" } };
  }
  throw new Error("unexpected SDR path " + opts.path);
});

describe("ensureWorkspaceSdrProvisioning", () => {
  it("mints a per-workspace key and stores it ENCRYPTED (FR-014)", async () => {
    const db = makeMockDb();
    const record = await ensureWorkspaceSdrProvisioning("ws-1", {
      db,
      callSdrFn: callSdrMock,
      webhookBaseUrl: "https://raval.example",
    });

    expect(record.status).toBe("active");
    expect(record.encrypted_api_key).not.toContain("per-workspace-key-1"); // not plaintext
    expect(decryptSecret(record.encrypted_api_key)).toBe("per-workspace-key-1"); // decrypts back
    expect(db._rows).toHaveLength(1);
    expect(db._rows[0].workspace_id).toBe("ws-1");
  });

  it("registers the webhook with the MINTED key, not the admin token (FR-MT-02)", async () => {
    const db = makeMockDb();
    await ensureWorkspaceSdrProvisioning("ws-2", {
      db,
      callSdrFn: callSdrMock,
      webhookBaseUrl: "https://raval.example",
    });

    const adminCall = callSdrMock.mock.calls.find((c) => c[0].path === "/api/v1/admin/api-keys");
    const webhookCall = callSdrMock.mock.calls.find((c) => c[0].path === "/api/v1/webhooks/config");
    expect(adminCall?.[0].token).toBe("test-admin-token");
    expect(webhookCall?.[0].token).toBe("per-workspace-key-1");
    expect(webhookCall?.[0].body.url).toBe("https://raval.example/api/public/hooks/sdr");
  });

  it("is idempotent — an existing active row short-circuits (no SDR calls)", async () => {
    callSdrMock.mockClear();
    const activeRow = {
      id: "row-1",
      workspace_id: "ws-3",
      sdr_workspace_id: "ws-3",
      encrypted_api_key: "already-encrypted",
      webhook_secret: null,
      sdr_base_url: "http://localhost:8000",
      status: "active",
    };
    const db = makeMockDb([activeRow]);
    const record = await ensureWorkspaceSdrProvisioning("ws-3", { db, callSdrFn: callSdrMock });

    expect(record).toEqual(activeRow);
    expect(callSdrMock).not.toHaveBeenCalled();
    expect(db._rows).toHaveLength(1); // no duplicate row
  });

  it("throws when SDR admin env is not configured", async () => {
    const db = makeMockDb();
    await expect(
      ensureWorkspaceSdrProvisioning("ws-4", {
        db,
        callSdrFn: callSdrMock,
        sdrBaseUrl: "",
        adminToken: "",
      }),
    ).rejects.toThrow("not configured");
  });

  it("throws when key mint fails (non-201)", async () => {
    const failingSdr = vi.fn(async () => ({ status: 500, data: { error_code: "INTERNAL" } }));
    const db = makeMockDb();
    await expect(
      ensureWorkspaceSdrProvisioning("ws-5", {
        db,
        callSdrFn: failingSdr as any,
        webhookBaseUrl: "https://raval.example",
      }),
    ).rejects.toThrow("mint failed");
  });
});
