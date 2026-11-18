import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { preferPrimaryAccounts } = await import("@/lib/postforme/handlers");

const pfm = { provider: "postforme", platform: "instagram", platformUsername: "beanco" };
const backupSame = { provider: "composio", platform: "instagram", platformUsername: "@BeanCo" };
const backupOther = { provider: "composio", platform: "instagram", platformUsername: "beanco.shop" };

describe("preferPrimaryAccounts", () => {
  it("sends the same account once, through the primary connection", () => {
    expect(preferPrimaryAccounts([pfm, backupSame], { type: "all" })).toEqual([pfm]);
  });
  it("keeps a different account on the same network", () => {
    expect(preferPrimaryAccounts([pfm, backupOther], { type: "all" })).toEqual([pfm, backupOther]);
  });
  it("uses an account a person picked by id as is", () => {
    expect(preferPrimaryAccounts([pfm, backupSame], { type: "account" })).toEqual([pfm, backupSame]);
  });
});
