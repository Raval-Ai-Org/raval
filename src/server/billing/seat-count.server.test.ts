import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { accountBillableSeatCount } from "./seat-count.server";

describe("accountBillableSeatCount", () => {
  it("uses the database RPC when it is available", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 3, error: null });
    const client = { rpc } as unknown as SupabaseClient;

    expect(await accountBillableSeatCount(client, "account", "owner", [])).toBe(3);
    expect(rpc).toHaveBeenCalledWith("account_billable_seat_count", { p_account: "account" });
  });

  it("counts distinct paid members when an older database lacks the RPC", async () => {
    const range = vi.fn().mockResolvedValue({
      data: [{ user_id: "member-a" }, { user_id: "member-a" }, { user_id: "member-b" }],
      error: null,
    });
    const order = vi.fn();
    order.mockReturnValue({ order, range });
    const neq = vi.fn().mockReturnValue({ order });
    const roleIn = vi.fn().mockReturnValue({ neq });
    const workspaceIn = vi.fn().mockReturnValue({ in: roleIn });
    const select = vi.fn().mockReturnValue({ in: workspaceIn });
    const client = {
      rpc: vi.fn().mockResolvedValue({ data: null, error: { code: "PGRST202" } }),
      from: vi.fn().mockReturnValue({ select }),
    } as unknown as SupabaseClient;

    expect(await accountBillableSeatCount(client, "account", "owner", ["w1", "w2"])).toBe(3);
    expect(workspaceIn).toHaveBeenCalledWith("workspace_id", ["w1", "w2"]);
    expect(roleIn).toHaveBeenCalledWith("role", ["owner", "admin", "editor"]);
    expect(neq).toHaveBeenCalledWith("user_id", "owner");
    expect(order).toHaveBeenCalledWith("workspace_id");
    expect(order).toHaveBeenCalledWith("user_id");
  });

  it("does not hide other database errors", async () => {
    const client = {
      rpc: vi.fn().mockResolvedValue({ data: null, error: { code: "42501" } }),
    } as unknown as SupabaseClient;

    await expect(accountBillableSeatCount(client, "account", "owner", [])).rejects.toMatchObject({
      status: 503,
    });
  });
});
