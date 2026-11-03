"use client";

// Campaigns, wired: react-query reads (keys carry the workspace id), the RPCs
// behind every button, and uploads through /api/assets/upload. Out of credits
// is shown by the app's own upgrade notice, so a 402 gets no second toast.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { authedFetch } from "@/lib/authed-fetch";
import { emitAppEvent } from "@/lib/app-events";
import {
  deleteCampaign,
  editCampaignPiece,
  endCampaign,
  getCampaign,
  getCampaignsHome,
  pauseCampaign,
  planCampaign,
  saveCampaign,
  setCampaignCount,
  startCampaign,
  writeCampaignBrief,
} from "@/lib/campaigns.functions";
import type { CampaignMedia, CampaignView } from "@/lib/campaigns/contracts";
import { listProducts } from "@/lib/products.functions";
import { ServerFnError } from "@/lib/rpc-client";
import { toast } from "@/lib/toast";
import { useNavigate } from "@/lib/navigation";
import { useOptionalWorkspaceRole } from "@/components/workspace/WorkspaceProvider";
import { ErrorState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { workspacePath } from "@/lib/workspace/paths";
import { CampaignsScreen } from "./CampaignsScreen";
import type { CampaignsHandlers, CampaignsMode, CampaignsTab, CampaignsView } from "./types";

export const campaignKeys = {
  all: (ws: string) => ["campaigns", ws] as const,
  home: (ws: string) => ["campaigns", ws, "home"] as const,
  one: (ws: string, id: string) => ["campaigns", ws, "one", id] as const,
  products: (ws: string) => ["campaigns", ws, "products"] as const,
};

const PHOTO = ["image/jpeg", "image/png", "image/webp"];
const CLIP = ["video/mp4", "video/quicktime", "video/webm"];

function ymdIn(timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function fail(title: string) {
  return (e: unknown) => {
    if (e instanceof ServerFnError && e.status === 402) return;
    toast.error(title, { description: e instanceof Error ? e.message : undefined });
  };
}

export function CampaignsPanel({
  workspaceId,
  mode,
  tab,
  onMode,
  onTab,
}: {
  workspaceId: string;
  mode: CampaignsMode;
  tab: CampaignsTab;
  onMode(mode: CampaignsMode): void;
  onTab(tab: CampaignsTab): void;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const role = useOptionalWorkspaceRole();
  const canEdit = role === "owner" || role === "admin" || role === "editor";
  const timezone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", []);
  const today = ymdIn(timezone);
  const [busy, setBusy] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState<Record<string, string>>({});
  // A suggestion's prefill lives here, not in the URL.
  const [prefill, setPrefill] = useState<Extract<CampaignsMode, { kind: "new" }>["prefill"]>(null);

  const openId =
    mode.kind === "campaign" ? mode.id : mode.kind === "new" ? (mode.editId ?? null) : null;

  const home = useQuery({
    queryKey: campaignKeys.home(workspaceId),
    staleTime: 15_000,
    queryFn: () => getCampaignsHome({ data: { workspaceId } }),
  });

  const one = useQuery({
    queryKey: campaignKeys.one(workspaceId, openId ?? "none"),
    enabled: !!openId,
    staleTime: 5_000,
    queryFn: () => getCampaign({ data: { workspaceId, campaignId: openId! } }),
    // Pieces move by themselves while a campaign runs.
    refetchInterval: (q) => {
      const c = q.state.data;
      if (!c || c.status !== "running") return false;
      return c.pieces.some((p) => p.state === "making") ? 6_000 : 30_000;
    },
  });

  const products = useQuery({
    queryKey: campaignKeys.products(workspaceId),
    staleTime: 60_000,
    enabled: mode.kind === "new",
    queryFn: () => listProducts({ data: { workspaceId } }),
  });

  const put = (view: CampaignView) => {
    qc.setQueryData(campaignKeys.one(workspaceId, view.id), (old: CampaignView | undefined) => ({
      ...view,
      mediaUrls: view.mediaUrls ?? old?.mediaUrls,
    }));
    void qc.invalidateQueries({ queryKey: campaignKeys.home(workspaceId) });
  };

  const run = useMutation({
    mutationFn: async ({ key, fn }: { key: string; fn: () => Promise<CampaignView | null> }) => {
      setBusy(key);
      try {
        return await fn();
      } finally {
        setBusy(null);
      }
    },
    onSuccess: (view) => view && put(view),
  });

  const act = (key: string, title: string, fn: () => Promise<CampaignView | null>, done?: string) =>
    run.mutateAsync({ key, fn }).then(
      (v) => {
        if (done) toast.success(done);
        return v;
      },
      (e) => {
        fail(title)(e);
        return null;
      },
    );

  const handlers: CampaignsHandlers = {
    go: (next) => {
      if (next.kind === "new") setPrefill(next.prefill ?? null);
      onMode(next);
    },
    tab: onTab,
    save: (brief, id) =>
      act("save", "Couldn't save the campaign", () =>
        saveCampaign({
          data: { workspaceId, campaignId: id, brief: brief as Record<string, unknown> },
        }),
      ),
    write: async (args) => {
      try {
        return await writeCampaignBrief({
          data: { workspaceId, ...args, idempotencyKey: crypto.randomUUID() },
        });
      } catch (e) {
        fail("Couldn't write it")(e);
        return null;
      }
    },
    plan: async (id) => {
      await act(
        `plan:${id}`,
        "Couldn't write the plan",
        () =>
          planCampaign({
            data: { workspaceId, campaignId: id, idempotencyKey: crypto.randomUUID() },
          }),
        "Plan written. Check it, then start the campaign.",
      );
    },
    start: (id) =>
      void act(
        `start:${id}`,
        "Couldn't start the campaign",
        () => startCampaign({ data: { workspaceId, campaignId: id } }),
        "Campaign started",
      ),
    pause: (id, paused) =>
      void act(`pause:${id}`, paused ? "Couldn't pause it" : "Couldn't resume it", () =>
        pauseCampaign({ data: { workspaceId, campaignId: id, paused } }),
      ),
    end: (id) =>
      void act(
        `end:${id}`,
        "Couldn't end the campaign",
        () => endCampaign({ data: { workspaceId, campaignId: id } }),
        "Campaign ended",
      ),
    count: (id, count) =>
      void act(`count:${id}`, "Couldn't save your count", () =>
        setCampaignCount({ data: { workspaceId, campaignId: id, count } }),
      ),
    editPiece: (id, pieceId, patch) =>
      void act(`piece:${pieceId}`, "Couldn't change that post", () =>
        editCampaignPiece({ data: { workspaceId, campaignId: id, pieceId, patch } }),
      ),
    remove: (id) => {
      if (!window.confirm("Delete this draft? This can't be undone.")) return;
      void run
        .mutateAsync({
          key: `delete:${id}`,
          fn: async () => {
            await deleteCampaign({ data: { workspaceId, campaignId: id } });
            return null;
          },
        })
        .then(() => {
          qc.removeQueries({ queryKey: campaignKeys.one(workspaceId, id) });
          void qc.invalidateQueries({ queryKey: campaignKeys.home(workspaceId) });
          onMode({ kind: "home" });
        }, fail("Couldn't delete it"));
    },
    upload: async (files) => {
      const added: CampaignMedia[] = [];
      for (const file of files) {
        const video = CLIP.includes(file.type);
        if (!video && !PHOTO.includes(file.type)) {
          toast.error(`${file.name}: use a JPG, PNG or WebP photo, or an MP4, MOV or WebM clip.`);
          continue;
        }
        if (file.size > (video ? 200 : 20) * 1024 * 1024) {
          toast.error(`${file.name} is too big (${video ? "200" : "20"} MB at most).`);
          continue;
        }
        try {
          const params = new URLSearchParams({
            workspaceId,
            requestId: crypto.randomUUID(),
            filename: file.name,
          });
          const response = await authedFetch(`/api/assets/upload?${params}`, {
            method: "POST",
            workspaceId,
            headers: { "Content-Type": file.type },
            body: file,
          });
          const body = await response.json().catch(() => ({}));
          if (!response.ok || !body.asset?.id) throw new Error(body.error || "Upload failed");
          if (body.asset.public_url)
            setUploaded((u) => ({ ...u, [body.asset.id]: body.asset.public_url }));
          added.push({
            assetId: body.asset.id,
            kind: video ? "video" : "image",
            role: "any",
            label: "",
          });
        } catch (e) {
          toast.error(`Couldn't add ${file.name}`, {
            description: e instanceof Error ? e.message : undefined,
          });
        }
      }
      return added;
    },
    openCalendar: () => emitAppEvent("open:content-calendar"),
    openPiece: (id) => emitAppEvent("open:content-item", { id }),
    openAutopilot: () => navigate({ to: workspacePath(workspaceId, "autopilot") }),
  };

  if (home.isError && !home.data) {
    return (
      <ErrorState
        description="Campaigns didn't load."
        detail={home.error instanceof Error ? home.error.message : null}
        onRetry={() => void home.refetch()}
      />
    );
  }
  if (!home.data) return <CampaignsLoading />;

  const selected = openId
    ? (one.data ?? home.data.campaigns.find((c) => c.id === openId) ?? null)
    : null;
  const view: CampaignsView = {
    home: home.data,
    selected,
    today,
    timezone,
    canEdit,
    products: (products.data ?? [])
      .filter((p) => p.status === "active")
      .map((p) => ({ id: p.id, name: p.name, thumb: p.images.find((i) => i.url)?.url ?? null })),
    mediaUrls: { ...(selected?.mediaUrls ?? {}), ...uploaded },
    busy,
  };

  // Editing waits for the full campaign, so the designer starts from it.
  if (mode.kind === "new" && mode.editId && one.data?.id !== mode.editId)
    return <CampaignsLoading />;

  return (
    <CampaignsScreen
      view={view}
      mode={mode.kind === "new" ? { ...mode, prefill: mode.prefill ?? prefill } : mode}
      tab={tab}
      handlers={handlers}
    />
  );
}

export function CampaignsLoading() {
  return (
    <div className="mx-auto w-full max-w-[1120px] space-y-6 px-4 py-8 @3xl:px-8" aria-busy>
      <Skeleton className="h-9 w-48 rounded-full" />
      <Skeleton className="h-4 w-80 max-w-full rounded-full" />
      <div className="grid gap-3 md:grid-cols-2">
        <Skeleton className="h-40 rounded-[20px]" />
        <Skeleton className="h-40 rounded-[20px]" />
      </div>
      <Skeleton className="h-48 rounded-[20px]" />
    </div>
  );
}
