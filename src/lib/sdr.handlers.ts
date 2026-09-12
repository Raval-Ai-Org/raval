// sdr.handlers.ts — pure, testable SDR proxy handlers (US1 connect/manage, US2
// publish). The file routes are thin wrappers around these; the tests exercise
// them directly with the MockSDR. Callers supply the per-workspace token + SDR
// base URL; the publish handler additionally takes an injectable `db`.
import {
  callSdr,
  classifySdrStatus,
  SdrError,
  SDR_PLATFORMS,
  deriveIdempotencyKey,
  targetFingerprint,
  validateContentForPlatform,
  toUtcIso,
  isScheduleWithinWindow,
} from "@/lib/sdr.server";
import { getPublishableAccounts, resolveTargetAccounts } from "@/lib/sdr.targets";
import { canTransitionContent, isContentStatus, type ContentStatus } from "@/lib/content-lifecycle";

export type SdrHandlerDeps = {
  sdrBaseUrl: string;
  token: string;
  callSdrFn?: typeof callSdr;
};

function call(deps: SdrHandlerDeps, opts: Parameters<typeof callSdr>[0]) {
  const fn = deps.callSdrFn ?? callSdr;
  return fn(opts);
}

function sdrErrorResponse(e: unknown) {
  if (e instanceof SdrError) {
    return { status: e.status ?? 503, body: { error: { code: e.code, detail: e.message } } };
  }
  return {
    status: 503,
    body: { error: { code: "SDR_UNREACHABLE", detail: "Unexpected SDR proxy error" } },
  };
}

/** Normalize an SDR response into the consistent { status, body } shape. Non-2xx
 * maps into the RavalAI error envelope (plan taxonomy); 2xx passes the body. */
function normalizeSdrResponse(res: { status: number; data: any }) {
  if (res.status >= 200 && res.status < 300) return { status: res.status, body: res.data };
  const code = classifySdrStatus(res.status);
  const detail = res.data?.detail ?? res.data?.error_code ?? `SDR error (${res.status})`;
  return { status: res.status, body: { error: { code, detail } } };
}

const SUPPORTED_PLATFORMS = ["twitter", "linkedin", "facebook", "instagram"];

// ─── OAuth connect / reconnect (FR-001, FR-004) ─────────────────────────────
export async function oauthStartHandler(platform: string, deps: SdrHandlerDeps) {
  if (!SUPPORTED_PLATFORMS.includes(platform)) {
    return {
      status: 400,
      body: { error: { code: "PLATFORM_VALIDATION", detail: `Unknown platform: ${platform}` } },
    };
  }
  try {
    const res = await call(deps, {
      baseUrl: deps.sdrBaseUrl,
      token: deps.token,
      method: "GET",
      path: `/api/v1/oauth/${platform}/start`,
    });
    if (res.status !== 200) return normalizeSdrResponse(res);
    return {
      status: 200,
      body: {
        authorizationUrl: res.data?.authorization_url,
        stateToken: res.data?.state_token,
        expiresIn: res.data?.expires_in ?? 600,
      },
    };
  } catch (e) {
    return sdrErrorResponse(e);
  }
}

// ─── List connected accounts (FR-002) ───────────────────────────────────────
export type ConnectedAccount = {
  accountId: string;
  platform: string;
  platformUsername: string;
  status: "active" | "expired" | "disconnected";
  tokenExpiresAt: string | null;
};

/** Map a raw SDR AccountResponse into the ConnectedAccount shape (no tokens). */
export function mapAccount(a: any): ConnectedAccount {
  return {
    accountId: a.account_id,
    platform: a.platform,
    platformUsername: a.platform_username,
    status: a.status,
    tokenExpiresAt: a.token_expires_at ?? null,
  };
}

export async function listAccountsHandler(deps: SdrHandlerDeps) {
  try {
    const res = await call(deps, {
      baseUrl: deps.sdrBaseUrl,
      token: deps.token,
      method: "GET",
      path: "/api/v1/accounts",
    });
    if (res.status !== 200) return normalizeSdrResponse(res);
    const accounts = Array.isArray(res.data) ? res.data : [];
    return { status: 200, body: accounts.map(mapAccount) as ConnectedAccount[] };
  } catch (e) {
    return sdrErrorResponse(e);
  }
}

// ─── Disconnect an account (FR-003) ─────────────────────────────────────────
export async function disconnectHandler(accountId: string, deps: SdrHandlerDeps) {
  if (!accountId)
    return {
      status: 400,
      body: { error: { code: "PLATFORM_VALIDATION", detail: "accountId required" } },
    };
  try {
    const res = await call(deps, {
      baseUrl: deps.sdrBaseUrl,
      token: deps.token,
      method: "DELETE",
      path: `/api/v1/accounts/${encodeURIComponent(accountId)}`,
    });
    if (res.status === 204) return { status: 204, body: null };
    if (res.status === 404)
      return { status: 404, body: { error: { code: "NOT_FOUND", detail: "Account not found" } } };
    return normalizeSdrResponse(res);
  } catch (e) {
    return sdrErrorResponse(e);
  }
}

// ─── Publish (US2, FR-005..007, FR-012, FR-019..020, FR-023..024, FR-026..028) ──
export type PublishSelection =
  { type: "account"; accountId: string } | { type: "platform"; platform: string } | { type: "all" };

export type PublishDeps = SdrHandlerDeps & { db: any };

/**
 * Move an item into a state from which `target` is a legal lifecycle
 * transition. An explicit publish/schedule click on a draft (or a previously
 * failed/published item being re-sent) is the user's consent, so those are
 * promoted to `approved` first. Returns an error message when the item cannot
 * be distributed from its current state.
 */
async function prepareForDistribution(
  db: any,
  item: any,
  target: "publishing" | "scheduled",
): Promise<string | null> {
  const from = String(item.status ?? "");
  // Already in flight — re-sending would create a second delivery job.
  if (from === "publishing") return "This content is already being published";
  if (isContentStatus(from) && canTransitionContent(from, target)) return null;
  const path: ContentStatus[] =
    from === "published"
      ? ["draft", "approved"]
      : from === "draft" || from === "failed"
        ? ["approved"]
        : [];
  if (!path.length)
    return `Content in status "${from}" can't be ${target === "publishing" ? "published" : "scheduled"}`;
  for (const status of path) {
    const { error } = await db.from("content_items").update({ status }).eq("id", item.id);
    if (error) return `Couldn't approve content before distribution: ${error.message}`;
    item.status = status;
  }
  return null;
}

async function resolveMediaUrl(db: any, item: any): Promise<string | null> {
  const storagePath =
    item.meta && typeof item.meta === "object" && typeof item.meta.asset_storage_path === "string"
      ? item.meta.asset_storage_path
      : null;
  if (!storagePath) return typeof item.media_url === "string" ? item.media_url : null;
  const { data, error } = await db.storage
    .from("generated-assets")
    .createSignedUrl(storagePath, 3600);
  return error ? null : (data?.signedUrl ?? null);
}

export type PublishOutcome = {
  contentItemId: string;
  status: "publishing" | "already" | "skipped";
  sdrJobId?: string;
  targets?: number;
  reason?: string;
};

export async function publishContentItemsHandler(
  args: { workspaceId: string; contentItemIds: string[]; selection: PublishSelection },
  deps: PublishDeps,
) {
  // 1. Fresh account state from the SDR (active-only targets; FR-004).
  const accountsRes = await call(deps, {
    baseUrl: deps.sdrBaseUrl,
    token: deps.token,
    method: "GET",
    path: "/api/v1/accounts",
  });
  if (accountsRes.status !== 200) return normalizeSdrResponse(accountsRes);
  const accounts: ConnectedAccount[] = Array.isArray(accountsRes.data)
    ? accountsRes.data.map(mapAccount)
    : [];

  const results: PublishOutcome[] = [];

  for (const id of args.contentItemIds) {
    // 2. Load the content item (workspace-scoped).
    const { data: item } = await deps.db
      .from("content_items")
      .select("*")
      .eq("id", id)
      .eq("workspace_id", args.workspaceId)
      .maybeSingle();
    if (!item)
      return {
        status: 404,
        body: { error: { code: "NOT_FOUND", detail: `Content item not found: ${id}` } },
      };

    // 3. Approval gate (FR-024): AI-generated `pending` content must be approved
    //    first (the explicit publish click on a draft/approved item is the consent).
    if (item.status === "pending" || item.status === "rejected" || item.status === "cancelled") {
      return {
        status: 403,
        body: {
          error: {
            code: "PLATFORM_VALIDATION",
            detail: "Content must be approved before publishing",
          },
        },
      };
    }

    // 4. Platform identity (FR-026) — a variant without a deliverable platform is skipped.
    const platform: string | undefined = item.meta?.platform;
    if (!platform || !SDR_PLATFORMS.includes(platform as any)) {
      results.push({
        contentItemId: id,
        status: "skipped",
        reason: `No deliverable platform (${platform ?? "none"})`,
      });
      continue;
    }

    // 5. Resolve target accounts for THIS item's platform (selection-scoped).
    const candidates = getPublishableAccounts(accounts).filter((a) => a.platform === platform);
    const targets = resolveTargetAccounts(candidates, args.selection);
    if (targets.length === 0) {
      results.push({
        contentItemId: id,
        status: "skipped",
        reason: "No active target accounts for this selection",
      });
      continue;
    }

    // 6. Pre-validate content against the platform's authoritative limits (FR-027/FR-012).
    const resolvedMediaUrl = await resolveMediaUrl(deps.db, item);
    const mediaUrls = resolvedMediaUrl ? [resolvedMediaUrl] : [];
    const validationErrors = validateContentForPlatform(platform, { text: item.body, mediaUrls });
    if (validationErrors.length) {
      return {
        status: 422,
        body: { error: { code: "PLATFORM_VALIDATION", detail: validationErrors.join(" ") } },
      };
    }

    // 7. Idempotency key (one job per item × target-set; FR-023). If the item
    //    was already sent to the SDR before (has sdr_job_id), this is a republish
    //    → bump sdr_revision so a previously-failed job never suppresses the new one.
    const priorRevision = (item.meta?.sdr_revision as number | undefined) ?? 0;
    const revision = item.meta?.sdr_job_id ? priorRevision + 1 : priorRevision;
    const fp = targetFingerprint(targets.map((t) => t.accountId));
    const idemKey = deriveIdempotencyKey({
      kind: "publish",
      contentItemId: id,
      platform,
      targetFingerprint: fp,
      revision,
    });
    const sdrBody = {
      idempotency_key: idemKey,
      targets: targets.map((t) => ({
        account_id: t.accountId,
        content: {
          text: item.body ?? undefined,
          media_urls: mediaUrls.length ? mediaUrls : undefined,
        },
      })),
    };

    const notReady = await prepareForDistribution(deps.db, item, "publishing");
    if (notReady) {
      results.push({ contentItemId: id, status: "skipped", reason: notReady });
      continue;
    }

    const res = await call(deps, {
      baseUrl: deps.sdrBaseUrl,
      token: deps.token,
      method: "POST",
      path: "/api/v1/publish",
      body: sdrBody,
    });

    if (res.status === 201) {
      // 8. Upsert content_publications (one per target) + mark item publishing.
      const rows = (res.data?.targets ?? []).map((t: any) => ({
        workspace_id: args.workspaceId,
        content_item_id: id,
        sdr_post_id: res.data.job_id,
        sdr_target_id: t.target_id,
        platform,
        account_id: t.account_id,
        status: "publishing",
        attempt: 0,
      }));
      if (rows.length) {
        await deps.db
          .from("content_publications")
          .upsert(rows, { onConflict: "content_item_id,sdr_target_id" });
      }
      const newMeta = { ...(item.meta ?? {}), sdr_job_id: res.data.job_id, sdr_revision: revision };
      const { error: statusError } = await deps.db
        .from("content_items")
        .update({ status: "publishing", meta: newMeta })
        .eq("id", id);
      if (statusError) {
        console.error(`[sdr] publish accepted but status not recorded for ${id}`, statusError);
      }
      results.push({
        contentItemId: id,
        status: "publishing",
        sdrJobId: res.data.job_id,
        targets: rows.length,
        ...(statusError ? { reason: "Sent — delivery status will update when confirmed" } : {}),
      });
    } else if (res.status === 200 || res.status === 409) {
      // Idempotent resubmission → the existing job is returned (SC-003).
      results.push({ contentItemId: id, status: "already", sdrJobId: res.data?.job_id });
    } else {
      return normalizeSdrResponse(res);
    }
  }

  return { status: 200, body: { results } };
}

// ─── Distribution disabled (US5, FR-015/FR-017) ─────────────────────────────
// When the SDR feature flag is OFF for a workspace, publish/schedule are
// REFUSED with DISTRIBUTION_DISABLED and no state changes. Content is never
// lost (the item stays approved and editable) and nothing claims delivery.
//
// The first version "degraded" to a status flip — items became `published` /
// `scheduled` while nothing was sent anywhere, so the product reported posts
// that never went out. The UI now reads GET /api/sdr/status and offers manual
// export instead of the publish controls.
export const DISTRIBUTION_DISABLED_MESSAGE =
  "Direct publishing isn't enabled for this workspace yet. Nothing was sent — copy the post and publish it manually, or ask an admin to enable distribution.";

export async function handleSdrDisabled(args: {
  workspaceId: string;
  contentItemIds: string[];
  kind: "publish" | "schedule";
}) {
  console.warn(
    `[sdr] ${args.kind} refused — distribution disabled for workspace ${args.workspaceId} (${args.contentItemIds.length} item(s))`,
  );
  return {
    status: 503,
    body: {
      error: { code: "DISTRIBUTION_DISABLED", detail: DISTRIBUTION_DISABLED_MESSAGE },
      results: args.contentItemIds.map((id) => ({ contentItemId: id, status: "not_sent" })),
    },
  };
}

// ─── Schedule (US3, FR-008..009, FR-025) ────────────────────────────────────
export type ScheduleItem = { contentItemId: string; scheduledAt: string };

export type ScheduleOutcome = PublishOutcome & { scheduledAt?: string };

export async function scheduleContentItemsHandler(
  args: { workspaceId: string; items: ScheduleItem[]; selection: PublishSelection },
  deps: PublishDeps,
) {
  const accountsRes = await call(deps, {
    baseUrl: deps.sdrBaseUrl,
    token: deps.token,
    method: "GET",
    path: "/api/v1/accounts",
  });
  if (accountsRes.status !== 200) return normalizeSdrResponse(accountsRes);
  const accounts: ConnectedAccount[] = Array.isArray(accountsRes.data)
    ? accountsRes.data.map(mapAccount)
    : [];

  const results: ScheduleOutcome[] = [];

  for (const { contentItemId: id, scheduledAt } of args.items) {
    // Validate the absolute UTC instant (FR-025) + ≤1yr window (SDR cap).
    const utc = toUtcIso(scheduledAt);
    if (!isScheduleWithinWindow(utc)) {
      results.push({
        contentItemId: id,
        status: "skipped",
        reason: "Scheduled time must be in the future within 1 year",
      });
      continue;
    }

    const { data: item } = await deps.db
      .from("content_items")
      .select("*")
      .eq("id", id)
      .eq("workspace_id", args.workspaceId)
      .maybeSingle();
    if (!item)
      return {
        status: 404,
        body: { error: { code: "NOT_FOUND", detail: `Content item not found: ${id}` } },
      };

    if (item.status === "pending" || item.status === "rejected" || item.status === "cancelled") {
      return {
        status: 403,
        body: {
          error: {
            code: "PLATFORM_VALIDATION",
            detail: "Content must be approved before scheduling",
          },
        },
      };
    }

    const platform: string | undefined = item.meta?.platform;
    if (!platform || !SDR_PLATFORMS.includes(platform as any)) {
      results.push({
        contentItemId: id,
        status: "skipped",
        reason: `No deliverable platform (${platform ?? "none"})`,
      });
      continue;
    }

    const candidates = getPublishableAccounts(accounts).filter((a) => a.platform === platform);
    const targets = resolveTargetAccounts(candidates, args.selection);
    if (targets.length === 0) {
      results.push({
        contentItemId: id,
        status: "skipped",
        reason: "No active target accounts for this selection",
      });
      continue;
    }

    const resolvedMediaUrl = await resolveMediaUrl(deps.db, item);
    const mediaUrls = resolvedMediaUrl ? [resolvedMediaUrl] : [];
    const validationErrors = validateContentForPlatform(platform, { text: item.body, mediaUrls });
    if (validationErrors.length) {
      return {
        status: 422,
        body: { error: { code: "PLATFORM_VALIDATION", detail: validationErrors.join(" ") } },
      };
    }

    const priorRevision = (item.meta?.sdr_revision as number | undefined) ?? 0;
    const revision = item.meta?.sdr_job_id ? priorRevision + 1 : priorRevision;
    const fp = targetFingerprint(targets.map((t) => t.accountId));
    const idemKey = deriveIdempotencyKey({
      kind: "schedule",
      contentItemId: id,
      platform,
      targetFingerprint: fp,
      revision,
    });
    const sdrBody = {
      idempotency_key: idemKey,
      scheduled_at: utc,
      targets: targets.map((t) => ({
        account_id: t.accountId,
        content: {
          text: item.body ?? undefined,
          media_urls: mediaUrls.length ? mediaUrls : undefined,
        },
      })),
    };

    const notReady = await prepareForDistribution(deps.db, item, "scheduled");
    if (notReady) {
      results.push({ contentItemId: id, status: "skipped", reason: notReady });
      continue;
    }

    const res = await call(deps, {
      baseUrl: deps.sdrBaseUrl,
      token: deps.token,
      method: "POST",
      path: "/api/v1/schedule",
      body: sdrBody,
    });

    if (res.status === 201) {
      const rows = (res.data?.targets ?? []).map((t: any) => ({
        workspace_id: args.workspaceId,
        content_item_id: id,
        sdr_post_id: res.data.job_id,
        sdr_target_id: t.target_id,
        platform,
        account_id: t.account_id,
        status: "pending",
        attempt: 0,
      }));
      if (rows.length) {
        await deps.db
          .from("content_publications")
          .upsert(rows, { onConflict: "content_item_id,sdr_target_id" });
      }
      const newMeta = { ...(item.meta ?? {}), sdr_job_id: res.data.job_id, sdr_revision: revision };
      const { error: statusError } = await deps.db
        .from("content_items")
        .update({ status: "scheduled", scheduled_at: utc, meta: newMeta })
        .eq("id", id);
      if (statusError) {
        console.error(`[sdr] schedule accepted but status not recorded for ${id}`, statusError);
      }
      results.push({
        contentItemId: id,
        status: "publishing",
        sdrJobId: res.data.job_id,
        targets: rows.length,
        scheduledAt: utc,
      });
    } else if (res.status === 200 || res.status === 409) {
      results.push({ contentItemId: id, status: "already", sdrJobId: res.data?.job_id });
    } else {
      return normalizeSdrResponse(res);
    }
  }

  return { status: 200, body: { results } };
}

// ─── Cancel a scheduled item (FR-009) ───────────────────────────────────────
export async function cancelScheduledHandler(
  args: { workspaceId: string; contentItemId: string },
  deps: PublishDeps,
) {
  const { data: item } = await deps.db
    .from("content_items")
    .select("*")
    .eq("id", args.contentItemId)
    .eq("workspace_id", args.workspaceId)
    .maybeSingle();
  if (!item)
    return {
      status: 404,
      body: { error: { code: "NOT_FOUND", detail: "Content item not found" } },
    };

  const jobId = item.meta?.sdr_job_id as string | undefined;
  if (!jobId)
    return {
      status: 400,
      body: { error: { code: "PLATFORM_VALIDATION", detail: "Item has no active SDR schedule" } },
    };

  const res = await call(deps, {
    baseUrl: deps.sdrBaseUrl,
    token: deps.token,
    method: "DELETE",
    path: `/api/v1/jobs/${encodeURIComponent(jobId)}`,
  });
  if (res.status === 204) {
    const { error: pubError } = await deps.db
      .from("content_publications")
      .update({ status: "cancelled" })
      .eq("content_item_id", args.contentItemId);
    if (pubError)
      return { status: 500, body: { error: { code: "UNKNOWN", detail: pubError.message } } };
    const newMeta = { ...(item.meta ?? {}) };
    delete newMeta.sdr_job_id;
    await deps.db
      .from("content_items")
      .update({ status: "approved", meta: newMeta })
      .eq("id", args.contentItemId);
    return { status: 204, body: null };
  }
  if (res.status === 400 || res.status === 404) {
    return {
      status: 400,
      body: {
        error: { code: "PLATFORM_VALIDATION", detail: "Schedule already fired; cannot cancel" },
      },
    };
  }
  return normalizeSdrResponse(res);
}
