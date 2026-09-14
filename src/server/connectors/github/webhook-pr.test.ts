import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { handleGitHubWebhook, type WebhookDeps } from "./webhook";

const SECRET = "whsec_pr_test_value_1234567890";
const sign = (body: string) => `sha256=${createHmac("sha256", SECRET).update(body).digest("hex")}`;
let delivery = 0;
const nextDelivery = () => `00000000-0000-4000-8000-${String(++delivery).padStart(12, "0")}`;

function deps(overrides: Partial<WebhookDeps> = {}) {
  const calls = {
    pr: [] as unknown[],
    checks: [] as unknown[],
    lost: [] as string[],
  };
  const d: WebhookDeps = {
    secret: SECRET,
    claimDelivery: async () => true,
    recordRejection: () => undefined,
    findConnections: async (id) =>
      id === "111" ? [{ id: "c1", workspaceId: "w1", status: "active" }] : [],
    updateConnections: async () => undefined,
    markSourcesAccessLost: async () => 0,
    restoreSources: async () => 0,
    audit: async () => undefined,
    forgetToken: () => undefined,
    onPullRequest: async (installationId, pr) => {
      calls.pr.push({ installationId, ...pr });
      return 1;
    },
    onChecksCompleted: async (installationId, repositoryId, headSha) => {
      calls.checks.push({ installationId, repositoryId, headSha });
      return 1;
    },
    onAccessLost: async (id) => {
      calls.lost.push(id);
      return 2;
    },
    ...overrides,
  };
  return { d, calls };
}

const send = (event: string, payload: unknown, d: WebhookDeps) => {
  const body = JSON.stringify(payload);
  return handleGitHubWebhook(
    { rawBody: body, signature: sign(body), event, deliveryId: nextDelivery() },
    d,
  );
};

const sha = "a".repeat(40);

describe("GitHub webhook — fix pull requests", () => {
  it("reports a merged pull request as merged", async () => {
    const { d, calls } = deps();
    const res = await send(
      "pull_request",
      {
        action: "closed",
        installation: { id: 111 },
        repository: { id: 42 },
        pull_request: {
          number: 7,
          state: "closed",
          merged: true,
          merged_at: "2026-09-15T10:00:00Z",
          head: { sha, ref: "mellox/geo-llms-abc123" },
        },
      },
      d,
    );
    expect(res.status).toBe(200);
    expect(calls.pr[0]).toMatchObject({
      installationId: "111",
      repositoryId: "42",
      number: 7,
      state: "merged",
    });
  });

  it("distinguishes closed-without-merge and ignores other actions", async () => {
    const { d, calls } = deps();
    await send(
      "pull_request",
      {
        action: "closed",
        installation: { id: 111 },
        repository: { id: 42 },
        pull_request: {
          number: 8,
          state: "closed",
          merged: false,
          head: { sha, ref: "mellox/geo-x-aaaaaa" },
        },
      },
      d,
    );
    expect(calls.pr[0]).toMatchObject({ state: "closed" });
    const ignored = await send(
      "pull_request",
      {
        action: "labeled",
        installation: { id: 111 },
        repository: { id: 42 },
        pull_request: { number: 8, head: { sha, ref: "x" } },
      },
      d,
    );
    expect(ignored.body).toMatchObject({ ignored: "pull_request.labeled" });
    expect(calls.pr).toHaveLength(1);
  });

  it("refreshes checks only on completion, and never for unlinked installations", async () => {
    const { d, calls } = deps();
    await send(
      "check_suite",
      {
        action: "completed",
        installation: { id: 111 },
        repository: { id: 42 },
        check_suite: { head_sha: sha },
      },
      d,
    );
    await send(
      "check_run",
      {
        action: "created",
        installation: { id: 111 },
        repository: { id: 42 },
        check_run: { head_sha: sha },
      },
      d,
    );
    expect(calls.checks).toEqual([{ installationId: "111", repositoryId: "42", headSha: sha }]);
    const unlinked = await send(
      "pull_request",
      {
        action: "closed",
        installation: { id: 999 },
        repository: { id: 42 },
        pull_request: { number: 1, merged: true, head: { sha, ref: "mellox/geo-x-aaaaaa" } },
      },
      d,
    );
    expect(unlinked.body).toMatchObject({ ignored: "installation not linked" });
    expect(calls.pr).toHaveLength(0);
  });

  it("marks open proposals as access lost when the app is uninstalled", async () => {
    const { d, calls } = deps();
    await send("installation", { action: "deleted", installation: { id: 111 } }, d);
    expect(calls.lost).toEqual(["111"]);
  });

  it("rejects an unsigned pull_request delivery", async () => {
    const { d, calls } = deps();
    const body = JSON.stringify({ action: "closed", installation: { id: 111 } });
    const res = await handleGitHubWebhook(
      { rawBody: body, signature: "sha256=00", event: "pull_request", deliveryId: nextDelivery() },
      d,
    );
    expect(res.status).toBe(401);
    expect(calls.pr).toHaveLength(0);
  });
});
