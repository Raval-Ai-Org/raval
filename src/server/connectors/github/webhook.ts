// webhook.ts — GitHub App webhook verification and event handling.
//
// Unauthenticated endpoint by design: the X-Hub-Signature-256 HMAC over the
// raw body IS the authentication. Deliveries are deduplicated on
// X-GitHub-Delivery. Handling is state-only — Mellox never acts on a
// repository because a webhook arrived.
import { createHmac, timingSafeEqual } from "node:crypto";

export const MAX_WEBHOOK_BYTES = 1_000_000;

/** Constant-time check of `sha256=<hex>` against the raw body. */
export function verifyGitHubSignature(
  rawBody: string,
  header: string | null,
  secret: string,
): boolean {
  if (!secret || !header || !header.startsWith("sha256=")) return false;
  const expected = Buffer.from(
    `sha256=${createHmac("sha256", secret).update(rawBody, "utf8").digest("hex")}`,
  );
  const provided = Buffer.from(header.trim());
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}

export type WebhookConnection = { id: string; workspaceId: string; status: string };

export type WebhookDeps = {
  secret: string;
  /** Record the delivery; false when this delivery id was already processed. */
  claimDelivery: (receipt: WebhookReceipt) => Promise<boolean>;
  recordRejection: (receipt: WebhookReceipt) => void;
  findConnections: (installationId: string) => Promise<WebhookConnection[]>;
  updateConnections: (
    installationId: string,
    patch: {
      status?: "active" | "suspended" | "revoked";
      revoked_at?: string | null;
      revoked_reason?: string | null;
      repository_selection?: string;
      permissions?: Record<string, string>;
      last_verified_at?: string;
      last_error?: string | null;
    },
  ) => Promise<void>;
  markSourcesAccessLost: (
    installationId: string,
    repositoryIds: string[] | "all",
  ) => Promise<number>;
  restoreSources: (installationId: string, repositoryIds: string[]) => Promise<number>;
  audit: (
    connection: WebhookConnection,
    action: string,
    payload: Record<string, unknown>,
  ) => Promise<void>;
  forgetToken: (installationId: string) => void;
  now?: () => Date;
};

export type WebhookReceipt = {
  event: string;
  deliveryId: string | null;
  outcome: "verified" | "rejected" | "malformed" | "unknown";
  reason: string;
  workspaceId: string | null;
};

export type WebhookResult = { status: number; body: Record<string, unknown> };

type InstallationPayload = {
  action?: string;
  installation?: {
    id?: number;
    repository_selection?: string;
    permissions?: Record<string, string>;
  };
  repositories_removed?: { id: number }[];
  repositories_added?: { id: number }[];
  repository_selection?: string;
};

export async function handleGitHubWebhook(
  input: {
    rawBody: string;
    signature: string | null;
    event: string | null;
    deliveryId: string | null;
  },
  deps: WebhookDeps,
): Promise<WebhookResult> {
  const event = (input.event ?? "").slice(0, 60) || "unknown";
  const deliveryId =
    input.deliveryId && /^[0-9a-f-]{8,64}$/i.test(input.deliveryId) ? input.deliveryId : null;
  const reject = (
    status: number,
    outcome: WebhookReceipt["outcome"],
    reason: string,
  ): WebhookResult => {
    deps.recordRejection({ event, deliveryId: null, outcome, reason, workspaceId: null });
    return { status, body: { ok: false, error: reason } };
  };

  if (!deps.secret) return reject(503, "rejected", "Webhook secret not configured");
  if (Buffer.byteLength(input.rawBody, "utf8") > MAX_WEBHOOK_BYTES) {
    return reject(413, "rejected", "Payload too large");
  }
  if (!verifyGitHubSignature(input.rawBody, input.signature, deps.secret)) {
    return reject(401, "rejected", "Invalid signature");
  }
  if (!deliveryId) return reject(400, "malformed", "Missing delivery id");

  let payload: InstallationPayload;
  try {
    payload = JSON.parse(input.rawBody) as InstallationPayload;
  } catch {
    return reject(400, "malformed", "Body is not JSON");
  }
  if (event === "ping") return { status: 200, body: { ok: true, pong: true } };

  const installationId = payload.installation?.id ? String(payload.installation.id) : null;
  if (!installationId) return { status: 200, body: { ok: true, ignored: "no installation" } };

  const connections = await deps.findConnections(installationId);
  const workspaceId = connections[0]?.workspaceId ?? null;
  const fresh = await deps.claimDelivery({
    event: `${event}.${payload.action ?? ""}`,
    deliveryId,
    outcome: "verified",
    reason: "",
    workspaceId,
  });
  if (!fresh) return { status: 200, body: { ok: true, duplicate: true } };
  // Installs are linked to a workspace by the signed-in install flow, never by webhook.
  if (!connections.length)
    return { status: 200, body: { ok: true, ignored: "installation not linked" } };

  const now = (deps.now?.() ?? new Date()).toISOString();
  const action = payload.action ?? "";
  const audit = (name: string, detail: Record<string, unknown> = {}) =>
    Promise.all(
      connections.map((c) => deps.audit(c, name, { installationId, deliveryId, ...detail })),
    );

  if (event === "installation") {
    if (action === "deleted") {
      deps.forgetToken(installationId);
      await deps.updateConnections(installationId, {
        status: "revoked",
        revoked_at: now,
        revoked_reason: "uninstalled_on_github",
      });
      await deps.markSourcesAccessLost(installationId, "all");
      await audit("connector.github.uninstalled");
    } else if (action === "suspend") {
      deps.forgetToken(installationId);
      await deps.updateConnections(installationId, {
        status: "suspended",
        last_error: "Suspended on GitHub",
      });
      await audit("connector.github.suspended");
    } else if (action === "unsuspend") {
      await deps.updateConnections(installationId, {
        status: "active",
        last_error: null,
        last_verified_at: now,
      });
      await audit("connector.github.unsuspended");
    } else if (action === "new_permissions_accepted" && payload.installation?.permissions) {
      deps.forgetToken(installationId);
      await deps.updateConnections(installationId, {
        permissions: payload.installation.permissions,
      });
      await audit("connector.github.permissions_updated", {
        permissions: payload.installation.permissions,
      });
    } else {
      return { status: 200, body: { ok: true, ignored: `installation.${action}` } };
    }
    return { status: 200, body: { ok: true, handled: `installation.${action}` } };
  }

  if (event === "installation_repositories") {
    const removed = (payload.repositories_removed ?? []).map((r) => String(r.id));
    const added = (payload.repositories_added ?? []).map((r) => String(r.id));
    const selection = payload.repository_selection ?? payload.installation?.repository_selection;
    if (selection)
      await deps.updateConnections(installationId, { repository_selection: selection });
    const lost = removed.length ? await deps.markSourcesAccessLost(installationId, removed) : 0;
    const restored = added.length ? await deps.restoreSources(installationId, added) : 0;
    deps.forgetToken(installationId);
    await audit("connector.github.repositories_changed", {
      removed: removed.length,
      added: added.length,
      lost,
      restored,
    });
    return {
      status: 200,
      body: { ok: true, handled: `installation_repositories.${action}`, lost, restored },
    };
  }

  return { status: 200, body: { ok: true, ignored: event } };
}
