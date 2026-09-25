// report.server.ts — the client-facing experiment report and the workspace's
// report branding (ADR-0024 §5 step 11).
//
// The report is rendered at view time from server-owned experiment rows —
// never from a stored snapshot, because share items are member-writable. The
// public share route calls buildReport only after its token/password checks,
// and buildReport refuses an experiment from another workspace.
import "server-only";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { ChangeType, ExperimentMetric } from "@/lib/experiments/constants";
import type { ExperimentReport, ReportBrandingView, ResultView } from "@/lib/experiments/contracts";
import { unitOf } from "@/lib/experiments/series";
import type { Verdict } from "@/lib/experiments/verdict";
import { isWorkspaceStoragePath, workspaceStoragePrefix } from "@/lib/workspace/storage-path";
import { ExperimentError, type ExperimentCtx, type ExperimentRow } from "./core.server";

const BUCKET = "generated-assets";
const LOGO_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};
const MAX_LOGO_BYTES = 1_000_000;

export async function brandingView(workspaceId: string): Promise<ReportBrandingView> {
  const [{ data: row }, { data: ws }] = await Promise.all([
    supabaseAdmin
      .from("workspace_report_branding")
      .select("display_name, logo_path")
      .eq("workspace_id", workspaceId)
      .maybeSingle(),
    supabaseAdmin.from("workspaces").select("name").eq("id", workspaceId).maybeSingle(),
  ]);
  let logoUrl: string | null = null;
  if (row?.logo_path && isWorkspaceStoragePath(row.logo_path, workspaceId)) {
    const { data } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(row.logo_path, 3600);
    logoUrl = data?.signedUrl ?? null;
  }
  return {
    displayName: row?.display_name ?? null,
    logoUrl,
    fallbackName: ws?.name ?? "Your agency",
  };
}

export async function setBranding(
  ctx: ExperimentCtx,
  input: {
    displayName: string | null;
    logo: { base64: string; contentType: string } | null;
    removeLogo: boolean;
  },
): Promise<ReportBrandingView> {
  if (!ctx.canManage) throw new ExperimentError("Only admins can change report branding.", 403);
  const { data: current } = await supabaseAdmin
    .from("workspace_report_branding")
    .select("logo_path")
    .eq("workspace_id", ctx.workspaceId)
    .maybeSingle();
  let logoPath: string | null = input.removeLogo ? null : (current?.logo_path ?? null);
  if (input.logo) {
    const ext = LOGO_TYPES[input.logo.contentType];
    if (!ext) throw new ExperimentError("Use a PNG, JPEG or WebP image.", 400);
    const bytes = Buffer.from(input.logo.base64, "base64");
    if (!bytes.length || bytes.length > MAX_LOGO_BYTES) {
      throw new ExperimentError("The logo must be under 1 MB.", 400);
    }
    const path = `${workspaceStoragePrefix(ctx.workspaceId)}branding/logo-${Date.now()}.${ext}`;
    const { error } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(path, bytes, { contentType: input.logo.contentType, upsert: false });
    if (error) throw new Error(error.message);
    logoPath = path;
  }
  const name = input.displayName?.trim() || null;
  if (name && name.length > 80)
    throw new ExperimentError("Keep the name under 80 characters.", 400);
  const { error } = await supabaseAdmin.from("workspace_report_branding").upsert(
    {
      workspace_id: ctx.workspaceId,
      display_name: name,
      logo_path: logoPath,
      updated_by: ctx.userId,
    },
    { onConflict: "workspace_id" },
  );
  if (error) throw new Error(error.message);
  if (current?.logo_path && current.logo_path !== logoPath) {
    await supabaseAdmin.storage
      .from(BUCKET)
      .remove([current.logo_path])
      .catch(() => null);
  }
  return brandingView(ctx.workspaceId);
}

export const SHAREABLE: ExperimentRow["status"][] = [
  "concluded",
  "rolling_out",
  "rolling_back",
  "closed",
];

/** The report for a share. Null when it isn't this workspace's or has no result yet. */
export async function buildReport(
  experimentId: string,
  shareWorkspaceId: string,
): Promise<ExperimentReport | null> {
  const { data } = await supabaseAdmin
    .from("experiments")
    .select("*")
    .eq("id", experimentId)
    .maybeSingle();
  const exp = data as ExperimentRow | null;
  if (!exp || exp.workspace_id !== shareWorkspaceId) return null;
  if (!exp.verdict || !SHAREABLE.includes(exp.status)) return null;

  const [{ data: assignments }, { data: changes }, branding] = await Promise.all([
    supabaseAdmin
      .from("experiment_assignments")
      .select("arm, excluded_at")
      .eq("experiment_id", exp.id),
    supabaseAdmin
      .from("experiment_changes")
      .select("path, before, after")
      .eq("experiment_id", exp.id)
      .order("path")
      .limit(50),
    brandingView(exp.workspace_id),
  ]);
  const active = (assignments ?? []).filter((a) => !a.excluded_at);
  const result = (exp.result ?? {}) as Partial<ResultView> & {
    verdictResult?: { postDays: number; daily: ResultView["daily"]; ci95: [number, number] | null };
  };
  const v = result.verdictResult;
  const metric = exp.primary_metric as ExperimentMetric;
  const changeType = exp.change_type as ChangeType;
  return {
    name: exp.name,
    hypothesis: exp.hypothesis,
    siteHost: exp.site_host,
    changeType,
    primaryMetric: metric,
    status: exp.status as ExperimentReport["status"],
    verdict: exp.verdict as Verdict,
    pages: {
      treatment: active.filter((a) => a.arm === "treatment").length,
      control: active.filter((a) => a.arm === "control").length,
    },
    liveConfirmedAt: exp.live_confirmed_at,
    concludedAt: exp.concluded_at,
    daysMeasured: v?.postDays ?? 0,
    lift: exp.lift === null ? null : Number(exp.lift),
    ci95:
      exp.lift_low !== null && exp.lift_high !== null
        ? [Number(exp.lift_low), Number(exp.lift_high)]
        : null,
    extraPerMonth:
      exp.estimated_monthly_units === null ? null : Number(exp.estimated_monthly_units),
    unit: unitOf(metric),
    monthlyValue: exp.estimated_monthly_value === null ? null : Number(exp.estimated_monthly_value),
    currency: exp.value_currency,
    valueNote:
      exp.estimated_monthly_value === null
        ? (exp.revenue_basis as { valuePerUnit?: number | null })?.valuePerUnit === null
          ? `No Google Analytics revenue on these pages, so the result is shown in ${unitOf(metric)}.`
          : null
        : null,
    daily: v?.daily ?? [],
    examples:
      changeType === "faq"
        ? []
        : (changes ?? [])
            .slice(0, 3)
            .map((c) => ({ path: c.path, before: c.before, after: c.after })),
    branding: { name: branding.displayName ?? branding.fallbackName, logoUrl: branding.logoUrl },
    generatedAt: new Date().toISOString(),
  };
}
