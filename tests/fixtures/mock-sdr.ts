// MockSDR — an in-process HTTP server that mimics the Social Distribution
// Engine's /api/v1/* contract (see specs/001-sdr-integration/contracts/sdr-proxy.md).
// Zero external dependencies: uses node:http + node:crypto.
//
// Usage:
//   const sdr = new MockSDR();
//   await sdr.start();                 // binds an ephemeral port; sdr.baseUrl set
//   process.env.SDR_BASE_URL = sdr.baseUrl;
//   sdr.addAccount({ id: "test-account-1", platform: "dryrun", status: "active" });
//   ... run tests that call the SDR proxy ...
//   const reqs = sdr.getRequests();    // assert what the client sent
//   await sdr.stop();
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";

export type MockTarget = {
  target_id: string;
  account_id: string;
  platform: string;
  status: string;
  platform_post_id?: string | null;
  platform_post_url?: string | null;
  error_category?: string | null;
  last_error?: string | null;
};

export type MockJob = {
  job_id: string;
  workspace_id: string;
  idempotency_key: string;
  status: string;
  scheduled_at?: string | null;
  targets: MockTarget[];
};

export type MockAccount = {
  account_id: string;
  platform: string;
  platform_username: string;
  status: "active" | "expired" | "disconnected";
  token_expires_at?: string | null;
};

export type MockWebhookEndpoint = { webhook_id: string; url: string; status: "active" | "disabled" };

function readBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
      if (raw.length > 1_000_000) reject(new Error("body > 1MB (MockSDR cap)"));
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function send(res: ServerResponse, status: number, body?: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(body === undefined ? "" : JSON.stringify(body));
}

/** Forceable behavior: exact path → { status, body } (for error-path tests). */
type Forced = { status: number; body?: unknown };

export class MockSDR {
  baseUrl = "";
  private server = createServer((req, res) => void this.handle(req, res));
  private jobs = new Map<string, MockJob>();
  private accounts: MockAccount[] = [];
  private webhooks: MockWebhookEndpoint[] = [];
  private apiKeys: string[] = [];
  private requests: Array<{ method: string; path: string; body: any; headers: Record<string, string> }> = [];
  private forced: Map<string, Forced> = new Map();
  /** If true, no auth token is required (default mirrors SDR: Bearer required). */
  requireAuth = true;

  async start(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.server.listen(0, "127.0.0.1", () => resolve());
      this.server.once("error", reject);
    });
    const { port } = this.server.address() as AddressInfo;
    this.baseUrl = `http://127.0.0.1:${port}`;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  reset() {
    this.jobs.clear();
    this.accounts = [];
    this.webhooks = [];
    this.apiKeys = [];
    this.requests = [];
    this.forced.clear();
    this.requireAuth = true;
  }

  // ── Test control ───────────────────────────────────────────────────────────
  addAccount(a: MockAccount) {
    this.accounts.push(a);
  }
  addJob(j: MockJob) {
    this.jobs.set(j.job_id, j);
  }
  getJob(id: string) {
    return this.jobs.get(id);
  }
  setJobStatus(id: string, status: string) {
    const j = this.jobs.get(id);
    if (j) j.status = status;
  }
  setTargetStatus(jobId: string, targetId: string, patch: Partial<MockTarget>) {
    const j = this.jobs.get(jobId);
    const t = j?.targets.find((t) => t.target_id === targetId);
    if (t) Object.assign(t, patch);
  }
  registerWebhook(url: string): MockWebhookEndpoint {
    const ep = { webhook_id: randomUUID(), url, status: "active" as const };
    this.webhooks.push(ep);
    return ep;
  }
  /** Force a canned response for an exact path (e.g. 503 when SDR is "down"). */
  force(path: string, status: number, body?: unknown) {
    this.forced.set(path, { status, body });
  }
  getRequests() {
    return this.requests;
  }
  getAccounts() {
    return this.accounts;
  }
  setAccountStatus(accountId: string, status: MockAccount["status"]) {
    const a = this.accounts.find((x) => x.account_id === accountId);
    if (a) a.status = status;
  }
  mintApiKey() {
    const k = `mock_key_${randomUUID()}`;
    this.apiKeys.push(k);
    return k;
  }

  // ── Router (mirrors the SDR contract surface) ──────────────────────────────
  private async handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? "/", this.baseUrl || "http://mock");
    const path = url.pathname;
    const method = (req.method ?? "GET").toUpperCase();
    let body: any = undefined;
    if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
      try {
        body = await readBody(req);
      } catch {
        return send(res, 413, { error_code: "REQUEST_TOO_LARGE" });
      }
    }
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers[k] = v;
    this.requests.push({ method, path, body, headers });

    const auth = headers["authorization"];
    if (this.requireAuth && !auth?.startsWith("Bearer ")) {
      return send(res, 401, { error_code: "UNAUTHORIZED", detail: "Missing bearer token" });
    }

    const forced = this.forced.get(path);
    if (forced) return send(res, forced.status, forced.body);

    // POST /api/v1/publish
    if (method === "POST" && path === "/api/v1/publish") {
      return this.onPublish(body, res);
    }
    // POST /api/v1/schedule
    if (method === "POST" && path === "/api/v1/schedule") {
      return this.onSchedule(body, res);
    }
    // GET /api/v1/jobs/{id}
    const jobsMatch = path.match(/^\/api\/v1\/jobs\/([^/]+)$/);
    if (method === "GET" && jobsMatch) {
      const j = this.jobs.get(jobsMatch[1]);
      if (!j) return send(res, 404, { error_code: "NOT_FOUND" });
      return send(res, 200, j);
    }
    // DELETE /api/v1/jobs/{id}
    if (method === "DELETE" && jobsMatch) {
      const j = this.jobs.get(jobsMatch[1]);
      if (!j) return send(res, 404, { error_code: "NOT_FOUND" });
      if (["published", "failed"].includes(j.status)) {
        return send(res, 400, { error_code: "CANCEL_NOT_ALLOWED" });
      }
      j.status = "cancelled";
      j.targets.forEach((t) => (t.status = "cancelled"));
      return send(res, 204);
    }
    // GET /api/v1/accounts
    if (method === "GET" && path === "/api/v1/accounts") {
      return send(res, 200, this.accounts);
    }
    // DELETE /api/v1/accounts/{id}
    const accMatch = path.match(/^\/api\/v1\/accounts\/([^/]+)$/);
    if (method === "DELETE" && accMatch) {
      const a = this.accounts.find((x) => x.account_id === accMatch[1]);
      if (!a) return send(res, 404, { error_code: "NOT_FOUND" });
      a.status = "disconnected";
      return send(res, 204);
    }
    // GET /api/v1/oauth/{platform}/start
    const oauthMatch = path.match(/^\/api\/v1\/oauth\/([a-z]+)\/start$/);
    if (method === "GET" && oauthMatch) {
      const platform = oauthMatch[1];
      if (!["twitter", "linkedin", "facebook", "instagram"].includes(platform)) {
        return send(res, 400, { error_code: "UNKNOWN_PLATFORM" });
      }
      return send(res, 200, {
        authorization_url: `https://mock-oauth/${platform}?state=demo`,
        state_token: `state_${randomUUID().slice(0, 8)}`,
        expires_in: 600,
      });
    }
    // POST /api/v1/admin/api-keys
    if (method === "POST" && path === "/api/v1/admin/api-keys") {
      const key = this.mintApiKey();
      return send(res, 201, {
        api_key: key,
        workspace_id: body?.workspace_id ?? "workspace_001",
        label: body?.label ?? "default",
      });
    }
    // POST /api/v1/webhooks/config
    if (method === "POST" && path === "/api/v1/webhooks/config") {
      const ep = this.registerWebhook(body?.url ?? "https://example.com/hook");
      return send(res, 201, { ...ep, workspace_id: "workspace_001" });
    }
    // GET /healthz
    if (method === "GET" && path === "/healthz") {
      return send(res, 200, { status: "healthy" });
    }
    return send(res, 404, { error_code: "NOT_FOUND", detail: `No mock route ${method} ${path}` });
  }

  private onPublish(body: any, res: ServerResponse) {
    const { idempotency_key, targets = [] } = body ?? {};
    // Idempotency: same idempotency_key → return the existing job (SDR semantics).
    for (const j of this.jobs.values()) {
      if (j.idempotency_key === idempotency_key) return send(res, 200, j);
    }
    const jobId = randomUUID();
    const job: MockJob = {
      job_id: jobId,
      workspace_id: "workspace_001",
      idempotency_key,
      status: "publishing",
      targets: targets.map((t: any) => ({
        target_id: randomUUID(),
        account_id: t.account_id,
        platform: t.platform ?? "dryrun",
        status: "publishing",
      })),
    };
    this.jobs.set(jobId, job);
    return send(res, 201, job);
  }

  private onSchedule(body: any, res: ServerResponse) {
    const { idempotency_key, scheduled_at, targets = [] } = body ?? {};
    const jobId = randomUUID();
    const job: MockJob = {
      job_id: jobId,
      workspace_id: "workspace_001",
      idempotency_key,
      status: "pending",
      scheduled_at: scheduled_at ?? null,
      targets: targets.map((t: any) => ({
        target_id: randomUUID(),
        account_id: t.account_id,
        platform: t.platform ?? "dryrun",
        status: "pending",
      })),
    };
    this.jobs.set(jobId, job);
    return send(res, 201, job);
  }
}
