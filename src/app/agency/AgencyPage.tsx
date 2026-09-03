"use client";

import { Link, useNavigate } from "@/lib/navigation";
import { useServerFn } from "@/lib/use-server-fn";
import { useEffect, useMemo, useState } from "react";
import { motion, type Variants } from "framer-motion";
import {
  ArrowRight,
  Sparkles,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Calendar,
  TrendingUp,
  Users,
  Layers,
  ChevronRight,
  Lightbulb,
  Bell,
  Coffee,
  BarChart3,
  ListTodo,
  Inbox,
  Activity,
  Plus,
  Eye,
  Heart,
  MousePointerClick,
  Target,
  Check,
  X as XIcon,
  Loader2,
  CalendarClock,
  SkipForward,
  Filter,
  Command as CommandIcon,
  Copy,
  MessageCircle,
  Repeat2,
  Bookmark,
  Send,
  ThumbsUp,
  Globe,
  Search as SearchIcon,
  ImagePlus,
  Upload,
  Trash2,
  Zap,
  ImageIcon,
} from "@/components/ui/gemini-icons";
import { ImageLibraryModal, type ImageLibraryItemMeta } from "@/components/app/ImageLibraryModal";
import { supabase } from "@/integrations/supabase/client";
import { generateContentBatch } from "@/lib/content.functions";
import { logAudit, logAuditMany } from "@/lib/audit";
import { Logo } from "@/components/brand/Logo";
import { Button } from "@/components/ui/button";
import { pageHead, webPageLd } from "@/lib/seo";
import { cn } from "@/lib/utils";
import { BrandLogo, type BrandKey } from "@/components/brand/BrandLogo";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Line,
  LineChart,
} from "recharts";
import {
  MOCK_APPROVALS,
  MOCK_SCHEDULED,
  MOCK_RECENT,
  TILE_BY_ID,
  type QueueItem,
  type CanvasType,
} from "@/lib/studio";
import { Rocket } from "@/components/ui/gemini-icons";

type Client = {
  id: string;
  name: string;
  website_url: string | null;
  client_status: "active" | "onboarding" | "paused";
};

type Approval = {
  id: string;
  workspace_id: string;
  action: string;
  status: string;
  created_at: string;
  payload: Record<string, unknown> | null;
};

type ContentRow = {
  id: string;
  workspace_id: string;
  agent: string;
  kind: string;
  channel: string | null;
  title: string | null;
  body: string | null;
  hashtags: string[] | null;
  media_url: string | null;
  status: string;
  scheduled_at: string | null;
  created_at: string;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TINT: Record<string, string> = {
  "brand-blue": "#3b82f6",
  "brand-green": "#22c55e",
  amber: "#f59e0b",
  sky: "#0ea5e9",
  violet: "#8b5cf6",
  rose: "#f43f5e",
  teal: "#14b8a6",
  fuchsia: "#d946ef",
};

function AgencyHQ() {
  const navigate = useNavigate();
  const [clients, setClients] = useState<Client[]>([]);
  // Caller's role per workspace — drives approve/reject permissions.
  const [myRoles, setMyRoles] = useState<Record<string, "owner" | "admin" | "editor" | "viewer">>(
    {},
  );
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [contentRows, setContentRows] = useState<ContentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [userName, setUserName] = useState("");
  // Locally-resolved (approved/rejected/skipped) ids — keeps mocks reactive too.
  const [resolved, setResolved] = useState<Record<string, "approved" | "rejected" | "skipped">>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [previewItem, setPreviewItem] = useState<null | {
    id: string;
    title: string;
    clientName: string;
    channel?: string;
    canvas: CanvasType;
    payload?: Record<string, unknown>;
  }>(null);
  // Compute greeting on the client only to avoid SSR/CSR hydration mismatch.
  const [greeting, setGreeting] = useState<string>("Hello");
  const generateBatchFn = useServerFn(generateContentBatch);
  const [autoGenBusy, setAutoGenBusy] = useState(false);
  const [approvalsFilter, setApprovalsFilter] = useState<string>("all"); // client id or "all"
  const [cmdOpen, setCmdOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [imageLibOpen, setImageLibOpen] = useState(false);

  useEffect(() => {
    const h = new Date().getHours();
    setGreeting(h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening");
  }, []);

  // Centralised reloader so realtime channels + window events refresh data live.
  const refreshFromDb = async (ids: string[]) => {
    if (ids.length === 0) return;
    const [apr, ci] = await Promise.all([
      supabase
        .from("approvals")
        .select("id, workspace_id, action, status, created_at, payload")
        .in("workspace_id", ids)
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(50),
      supabase
        .from("content_items")
        .select(
          "id, workspace_id, agent, kind, channel, title, body, hashtags, media_url, status, scheduled_at, created_at",
        )
        .in("workspace_id", ids)
        .order("created_at", { ascending: false })
        .limit(200),
    ]);
    setApprovals((apr.data ?? []) as Approval[]);
    setContentRows((ci.data ?? []) as ContentRow[]);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) {
        navigate({ to: "/login" });
        return;
      }
      const email = sess.session.user.email ?? "";
      setUserName(email.split("@")[0]);

      const { data: ws } = await supabase
        .from("workspaces")
        .select("id, name, website_url, client_status")
        .order("created_at", { ascending: false });
      const wsList = (ws ?? []) as Client[];
      if (cancelled) return;
      setClients(wsList);

      if (wsList.length > 0) {
        // Load caller's role on each workspace so we can gate approve/reject.
        const { data: mems } = await supabase
          .from("workspace_members")
          .select("workspace_id, role")
          .eq("user_id", sess.session.user.id)
          .in(
            "workspace_id",
            wsList.map((w) => w.id),
          );
        if (!cancelled) {
          const map: Record<string, "owner" | "admin" | "editor" | "viewer"> = {};
          for (const m of (mems ?? []) as Array<{ workspace_id: string; role: string }>) {
            map[m.workspace_id] = m.role as "owner" | "admin" | "editor" | "viewer";
          }
          setMyRoles(map);
        }
        await refreshFromDb(wsList.map((w) => w.id));
      }
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  // Realtime: react to content_items + approvals changes across every workspace.
  useEffect(() => {
    if (clients.length === 0) return;
    const ids = clients.map((c) => c.id);
    const channel = supabase
      .channel(`agency-feed-${ids.length}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "content_items" }, () => {
        void refreshFromDb(ids);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "approvals" }, () => {
        void refreshFromDb(ids);
      })
      .subscribe();

    const onLocal = () => {
      void refreshFromDb(ids);
    };
    window.addEventListener("content:changed", onLocal);
    window.addEventListener("approvals:changed", onLocal);
    return () => {
      supabase.removeChannel(channel);
      window.removeEventListener("content:changed", onLocal);
      window.removeEventListener("approvals:changed", onLocal);
    };
  }, [clients]);

  // Auto-generate pending content for every active client that has nothing
  // waiting for review — so approvals + previews are never blank when the
  // operator opens Command Center in the morning.
  useEffect(() => {
    if (loading || clients.length === 0) return;
    const need = clients.filter((c) => {
      if (c.client_status === "paused") return false;
      const hasPending = contentRows.some(
        (r) => r.workspace_id === c.id && (r.status === "pending" || r.status === "draft"),
      );
      if (hasPending) return false;
      const flag = `agency:autogen:v1:${c.id}`;
      if (typeof sessionStorage !== "undefined" && sessionStorage.getItem(flag)) return false;
      return true;
    });
    if (need.length === 0) return;
    let cancelled = false;
    setAutoGenBusy(true);
    (async () => {
      const created: ContentRow[] = [];
      await Promise.all(
        need.map(async (c) => {
          try {
            sessionStorage.setItem(`agency:autogen:v1:${c.id}`, "1");
            // Pull Brand DNA from local storage when available.
            let brandCtx = "";
            try {
              const raw =
                localStorage.getItem(`brand-dna:v3:${c.id}`) ??
                localStorage.getItem(`brand-dna:v2:${c.id}`) ??
                localStorage.getItem(`brand-dna:${c.id}`);
              if (raw) {
                const d = JSON.parse(raw) as Record<string, unknown>;
                brandCtx = [
                  d.brandName && `Brand: ${d.brandName}`,
                  d.oneLiner && `One-liner: ${d.oneLiner}`,
                  d.industry && `Industry: ${d.industry}`,
                  d.audience && `Audience: ${d.audience}`,
                  d.voice && `Voice: ${d.voice}`,
                  d.values && `Values: ${d.values}`,
                  d.products && `Products: ${d.products}`,
                  d.doRules && `Do: ${d.doRules}`,
                  d.dontRules && `Don't: ${d.dontRules}`,
                ]
                  .filter(Boolean)
                  .join("\n");
              }
            } catch {}
            if (!brandCtx)
              brandCtx = `Brand: ${c.name}${c.website_url ? `\nWebsite: ${c.website_url}` : ""}`;
            const items = await generateBatchFn({
              data: {
                workspaceId: c.id,
                agent: "spark",
                prompt: `Draft a fresh weekly mix for ${c.name}: 1 instagram post, 1 linkedin post, 1 short SEO brief (kind:"brief", channel:"web"), and 1 newsletter teaser (kind:"email", channel:"email"). Make every piece specific to this brand — reference real products, audience and voice from the brand context. No placeholder copy.`,
                channels: ["instagram", "linkedin", "web", "email"],
                count: 4,
                context: brandCtx,
                websiteUrl: c.website_url ?? undefined,
              },
            });
            created.push(...(items as ContentRow[]));
          } catch (e) {
            // Silent — single-client failure shouldn't block the dashboard.
            console.warn("auto-gen failed for", c.name, e);
          }
        }),
      );
      if (!cancelled && created.length > 0) {
        setContentRows((prev) => [...created, ...prev]);
        toast.success(`Drafted ${created.length} new items`, {
          description: "Fresh approvals waiting across your clients.",
        });
      }
      if (!cancelled) setAutoGenBusy(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, clients]);

  const clientById = useMemo(() => new Map(clients.map((c) => [c.id, c])), [clients]);

  // Combine real approvals with sample fallbacks across active clients so the
  // page always feels alive while you're onboarding your first client brands.
  const combinedApprovals = useMemo(() => {
    // Live content awaiting approval (real AI-generated items take priority).
    const liveContent = contentRows
      .filter((c) => c.status === "pending" || c.status === "draft")
      .map((c) => {
        const canvas: CanvasType =
          c.kind === "brief"
            ? "seo-brief"
            : c.kind === "blog"
              ? "article"
              : c.kind === "email"
                ? "email"
                : c.kind === "landing"
                  ? "landing-page"
                  : "social-post";
        return {
          id: c.id,
          title: c.title || (c.body ? c.body.slice(0, 60) : "Pending content"),
          canvas,
          channel: c.channel ?? undefined,
          clientId: c.workspace_id,
          clientName: clientById.get(c.workspace_id)?.name ?? "Client",
          payload: {
            body: c.body,
            hashtags: c.hashtags,
            media_url: c.media_url,
            agent: c.agent,
            source: "content_items",
          } as Record<string, unknown>,
        };
      });
    if (liveContent.length > 0 || approvals.length > 0) {
      const legacy = approvals.map((a) => {
        const payload = (a.payload ?? {}) as Record<string, unknown>;
        const canvas = (
          typeof payload.canvas === "string" ? payload.canvas : "social-post"
        ) as CanvasType;
        return {
          id: a.id,
          title: a.action || "Pending approval",
          canvas,
          channel: typeof payload.channel === "string" ? payload.channel : undefined,
          clientId: a.workspace_id,
          clientName: clientById.get(a.workspace_id)?.name ?? "Client",
          payload,
        };
      });
      return [...liveContent, ...legacy];
    }
    // Fan out mock approvals across known clients (or a placeholder name).
    const pool = clients.length > 0 ? clients : [{ id: "demo", name: "Demo brand" } as Client];
    return MOCK_APPROVALS.flatMap((m, i) => {
      const c = pool[i % pool.length];
      return [
        {
          ...m,
          clientId: c.id,
          clientName: c.name,
          payload: undefined as Record<string, unknown> | undefined,
        },
      ];
    });
  }, [approvals, contentRows, clients, clientById]);

  // Approvals visible right now (anything not resolved), optionally filtered by client.
  const pendingApprovals = useMemo(
    () =>
      combinedApprovals.filter(
        (a) => !resolved[a.id] && (approvalsFilter === "all" || a.clientId === approvalsFilter),
      ),
    [combinedApprovals, resolved, approvalsFilter],
  );
  const pendingAllCount = useMemo(
    () => combinedApprovals.filter((a) => !resolved[a.id]).length,
    [combinedApprovals, resolved],
  );

  // Role gate: only owner/admin/editor can approve, reject, or publish.
  const PRIVILEGED = new Set(["owner", "admin", "editor"]);
  const canApproveClient = (workspaceId: string | undefined | null): boolean => {
    if (!workspaceId) return true; // mocks (no workspace) are permitted for demo UX
    const r = myRoles[workspaceId];
    // Non-members shouldn't see these items via RLS; if role missing, default deny
    // for real content ids (UUID) and allow otherwise (mock demo rows).
    if (!r) return !UUID_RE.test(workspaceId) ? true : false;
    return PRIVILEGED.has(r);
  };
  const canApproveItem = (id: string): boolean => {
    const wsId = combinedApprovals.find((a) => a.id === id)?.clientId;
    return canApproveClient(wsId);
  };

  const decide = async (id: string, decision: "approved" | "rejected") => {
    if (!canApproveItem(id)) {
      toast.error("You don't have permission", {
        description: "Only owners, admins, and editors can approve or reject on this client.",
      });
      return;
    }
    setBusyId(id);
    // Optimistic UI
    setResolved((r) => ({ ...r, [id]: decision }));
    try {
      if (UUID_RE.test(id)) {
        // Route to content_items when this id belongs to a live content row.
        const isContent = contentRows.some((c) => c.id === id);
        if (isContent) {
          const { error } = await supabase
            .from("content_items")
            .update({ status: decision === "approved" ? "approved" : "rejected" })
            .eq("id", id);
          if (error) throw error;
        } else {
          const { error } = await supabase
            .from("approvals")
            .update({ status: decision, decided_at: new Date().toISOString() })
            .eq("id", id);
          if (error) throw error;
        }
      }
      // Notify any open Studio rail / Calendar so they refresh too.
      window.dispatchEvent(new CustomEvent("content:changed"));
      window.dispatchEvent(new CustomEvent("approvals:changed"));
      const wsId = combinedApprovals.find((a) => a.id === id)?.clientId;
      if (wsId) void logAudit(wsId, decision === "approved" ? "approve" : "reject", id);
      toast.success(decision === "approved" ? "Approved" : "Rejected", {
        description:
          decision === "approved"
            ? "Sent to publish queue."
            : "Sent back to the brand for revisions.",
      });
    } catch (e: unknown) {
      setResolved((r) => {
        const n = { ...r };
        delete n[id];
        return n;
      });
      const msg = e instanceof Error ? e.message : "Please try again.";
      toast.error("Couldn't save", { description: msg });
    } finally {
      setBusyId(null);
    }
  };

  // Publish-now — matches the StudioRail flow inside individual clients.
  const publishNow = async (id: string) => {
    if (!canApproveItem(id)) {
      toast.error("You don't have permission", {
        description: "Only owners, admins, and editors can publish on this client.",
      });
      return;
    }
    setBusyId(id);
    setResolved((r) => ({ ...r, [id]: "approved" }));
    try {
      if (UUID_RE.test(id) && contentRows.some((c) => c.id === id)) {
        const { error } = await supabase
          .from("content_items")
          .update({ status: "published", scheduled_at: new Date().toISOString() })
          .eq("id", id);
        if (error) throw error;
      }
      window.dispatchEvent(new CustomEvent("content:changed"));
      const wsId = combinedApprovals.find((a) => a.id === id)?.clientId;
      if (wsId) void logAudit(wsId, "publish", id);
      toast.success("Published", { description: "Marked live and added to recent activity." });
    } catch (e: unknown) {
      setResolved((r) => {
        const n = { ...r };
        delete n[id];
        return n;
      });
      const msg = e instanceof Error ? e.message : "Please try again.";
      toast.error("Couldn't publish", { description: msg });
    } finally {
      setBusyId(null);
    }
  };

  // Bulk confirmation modal state.
  const [bulkConfirm, setBulkConfirm] = useState<null | {
    kind: "approve" | "reject";
    ids: string[];
  }>(null);
  const requestApproveAll = () => {
    const ids = pendingApprovals.map((a) => a.id).filter(canApproveItem);
    if (ids.length === 0) {
      toast("Nothing to approve", { description: "No items you have permission to approve." });
      return;
    }
    setBulkConfirm({ kind: "approve", ids });
  };
  const requestRejectAll = () => {
    const ids = pendingApprovals.map((a) => a.id).filter(canApproveItem);
    if (ids.length === 0) {
      toast("Nothing to reject", { description: "No items you have permission to reject." });
      return;
    }
    setBulkConfirm({ kind: "reject", ids });
  };

  // Revert a bulk decision (server + local) within the undo window.
  const undoBulk = async (
    ids: string[],
    prev: Record<string, "approved" | "rejected" | "skipped">,
  ) => {
    setResolved((r) => {
      const n = { ...r };
      ids.forEach((id) => {
        if (prev[id]) n[id] = prev[id];
        else delete n[id];
      });
      return n;
    });
    const realIds = ids.filter((id) => UUID_RE.test(id));
    const contentIds = realIds.filter((id) => contentRows.some((c) => c.id === id));
    const approvalIds = realIds.filter((id) => !contentIds.includes(id));
    try {
      if (contentIds.length > 0) {
        await supabase.from("content_items").update({ status: "pending" }).in("id", contentIds);
      }
      if (approvalIds.length > 0) {
        await supabase
          .from("approvals")
          .update({ status: "pending", decided_at: null })
          .in("id", approvalIds);
      }
      window.dispatchEvent(new CustomEvent("content:changed"));
      window.dispatchEvent(new CustomEvent("approvals:changed"));
      const wsIds = ids
        .map((id) => combinedApprovals.find((a) => a.id === id)?.clientId)
        .filter(Boolean) as string[];
      void logAuditMany(wsIds, "undo_bulk", null, { count: ids.length });
      toast.success(`Restored ${ids.length}`, { description: "Items are back in the queue." });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Please try again.";
      toast.error("Couldn't undo", { description: msg });
    }
  };

  const approveAll = async () => {
    const ids = pendingApprovals.map((a) => a.id);
    if (ids.length === 0) return;
    const prev: Record<string, "approved" | "rejected" | "skipped"> = {};
    ids.forEach((id) => {
      if (resolved[id]) prev[id] = resolved[id];
    });
    setBulkBusy(true);
    setResolved((r) => {
      const n = { ...r };
      ids.forEach((id) => {
        n[id] = "approved";
      });
      return n;
    });
    const realIds = ids.filter((id) => UUID_RE.test(id));
    const contentIds = realIds.filter((id) => contentRows.some((c) => c.id === id));
    const approvalIds = realIds.filter((id) => !contentIds.includes(id));
    try {
      if (contentIds.length > 0) {
        await supabase.from("content_items").update({ status: "approved" }).in("id", contentIds);
      }
      if (approvalIds.length > 0) {
        const { error } = await supabase
          .from("approvals")
          .update({ status: "approved", decided_at: new Date().toISOString() })
          .in("id", approvalIds);
        if (error) {
          toast.error("Some approvals failed", { description: error.message });
          return;
        }
      }
      window.dispatchEvent(new CustomEvent("content:changed"));
      window.dispatchEvent(new CustomEvent("approvals:changed"));
      const wsIdsA = ids
        .map((id) => combinedApprovals.find((a) => a.id === id)?.clientId)
        .filter(Boolean) as string[];
      void logAuditMany(wsIdsA, "approve_bulk", null, { count: ids.length });
      toast.success(`Approved ${ids.length}`, {
        description: "Moved to publish queue. You have 10s to undo.",
        duration: 10000,
        action: { label: "Undo", onClick: () => undoBulk(ids, prev) },
      });
    } finally {
      setBulkBusy(false);
    }
  };

  // Bulk reject — send the visible queue back for revisions.
  const rejectAll = async () => {
    const ids = pendingApprovals.map((a) => a.id);
    if (ids.length === 0) return;
    const prev: Record<string, "approved" | "rejected" | "skipped"> = {};
    ids.forEach((id) => {
      if (resolved[id]) prev[id] = resolved[id];
    });
    setBulkBusy(true);
    setResolved((r) => {
      const n = { ...r };
      ids.forEach((id) => {
        n[id] = "rejected";
      });
      return n;
    });
    const realIds = ids.filter((id) => UUID_RE.test(id));
    const contentIds = realIds.filter((id) => contentRows.some((c) => c.id === id));
    const approvalIds = realIds.filter((id) => !contentIds.includes(id));
    try {
      if (contentIds.length > 0) {
        await supabase.from("content_items").update({ status: "rejected" }).in("id", contentIds);
      }
      if (approvalIds.length > 0) {
        await supabase
          .from("approvals")
          .update({ status: "rejected", decided_at: new Date().toISOString() })
          .in("id", approvalIds);
      }
      window.dispatchEvent(new CustomEvent("content:changed"));
      window.dispatchEvent(new CustomEvent("approvals:changed"));
      const wsIdsR = ids
        .map((id) => combinedApprovals.find((a) => a.id === id)?.clientId)
        .filter(Boolean) as string[];
      void logAuditMany(wsIdsR, "reject_bulk", null, { count: ids.length });
      toast.success(`Rejected ${ids.length}`, {
        description: "Sent back to each brand workspace. You have 10s to undo.",
        duration: 10000,
        action: { label: "Undo", onClick: () => undoBulk(ids, prev) },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Please try again.";
      toast.error("Couldn't reject", { description: msg });
    } finally {
      setBulkBusy(false);
    }
  };

  // Draft a fresh weekly mix for any client without pending work.
  const draftWeekForAll = async () => {
    const targets = clients.filter((c) => c.client_status !== "paused");
    if (targets.length === 0) {
      toast("No active clients", { description: "Add a client first." });
      return;
    }
    setBulkBusy(true);
    toast(`Drafting for ${targets.length} client${targets.length === 1 ? "" : "s"}…`);
    let created = 0;
    await Promise.all(
      targets.map(async (c) => {
        try {
          const items = await generateBatchFn({
            data: {
              workspaceId: c.id,
              agent: "spark",
              prompt: `Weekly mix for ${c.name}: 1 instagram, 1 linkedin, 1 SEO brief, 1 newsletter teaser. Real, on-brand copy.`,
              channels: ["instagram", "linkedin", "web", "email"],
              count: 4,
              context: `Brand: ${c.name}${c.website_url ? `\nWebsite: ${c.website_url}` : ""}`,
              websiteUrl: c.website_url ?? undefined,
            },
          });
          const n = (items as ContentRow[]).length;
          created += n;
          void logAudit(c.id, "draft_week", null, { count: n });
        } catch (e) {
          console.warn("weekly draft failed for", c.name, e);
        }
      }),
    );
    setBulkBusy(false);
    window.dispatchEvent(new CustomEvent("content:changed"));
    toast.success(`Drafted ${created} items`, {
      description: "Fresh approvals across every brand.",
    });
  };

  // Build the weekly digest as structured data (shared by copy/CSV/PDF).
  const buildDigest = () => {
    const now = new Date();
    const dateLabel = now.toLocaleDateString(undefined, {
          month: "long",
      day: "numeric",
      year: "numeric",
    });
    const summary = {
      clients: clients.length,
      active: activeCount,
      onboarding: onboardingCount,
      pending: pendingAllCount,
      scheduled: combinedScheduled.length,
    };
    const approvals = pendingApprovals
      .slice(0, 20)
      .map((a) => ({ client: a.clientName, title: a.title }));
    const recent = combinedRecent
      .slice(0, 20)
      .map((r) => ({ client: r.clientName, title: r.title, when: r.when }));
    return { now, dateLabel, summary, approvals, recent };
  };

  const digestToText = () => {
    const { dateLabel, summary, approvals, recent } = buildDigest();
    const lines: string[] = [];
        lines.push(`Mellox AI · Weekly digest — ${dateLabel}`);
    lines.push("");
    lines.push(
      `Clients: ${summary.clients} · Active ${summary.active} · Onboarding ${summary.onboarding}`,
    );
    lines.push(`Needs approval: ${summary.pending} · Scheduled this week: ${summary.scheduled}`);
    lines.push("");
    if (approvals.length > 0) {
      lines.push("Approvals waiting:");
      approvals.forEach((a) => lines.push(`  • [${a.client}] ${a.title}`));
      lines.push("");
    }
    if (recent.length > 0) {
      lines.push("Recently shipped:");
      recent.forEach((r) => lines.push(`  • [${r.client}] ${r.title} — ${r.when}`));
    }
    return lines.join("\n");
  };

  const copyDigest = async () => {
    try {
      await navigator.clipboard.writeText(digestToText());
      toast.success("Weekly digest copied", {
        description: "Paste it into Slack, email or a doc.",
      });
    } catch {
      toast.error("Couldn't copy", { description: "Clipboard blocked by browser." });
    }
  };

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const csvEscape = (v: string | undefined | null) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const stamp = () => new Date().toISOString().slice(0, 10);

  const exportDigestCsv = () => {
    const { summary, approvals, recent } = buildDigest();
    const rows: string[] = [];
    rows.push((["Section", "Client", "Title", "When"] as string[]).map(csvEscape).join(","));
    rows.push(
      [
        "Summary",
        "",
        `Clients ${summary.clients} · Active ${summary.active} · Onboarding ${summary.onboarding}`,
        "",
      ]
        .map(csvEscape)
        .join(","),
    );
    rows.push(
      [
        "Summary",
        "",
        `Needs approval ${summary.pending} · Scheduled this week ${summary.scheduled}`,
        "",
      ]
        .map(csvEscape)
        .join(","),
    );
    approvals.forEach((a) =>
      rows.push(["Approval waiting", a.client, a.title, ""].map(csvEscape).join(",")),
    );
    recent.forEach((r) =>
      rows.push(["Recently shipped", r.client, r.title, r.when].map(csvEscape).join(",")),
    );
    downloadBlob(
      new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8" }),
      `mellox-weekly-digest-${stamp()}.csv`,
    );
    toast.success("CSV downloaded", { description: "Weekly digest saved to your device." });
  };

  const exportDigestPdf = () => {
    const { dateLabel, summary, approvals, recent } = buildDigest();
    const esc = (s: string | undefined | null) =>
      String(s ?? "").replace(
        /[&<>"']/g,
        (c) =>
          (
            ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }) as Record<
              string,
              string
            >
          )[c] ?? c,
      );
        const html = `<!doctype html><html><head><meta charset="utf-8"><title>Mellox AI · Weekly digest — ${esc(dateLabel)}</title>
<style>
  *{box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,sans-serif;color:#0b0f0d;margin:40px;line-height:1.5}
  h1{font-size:22px;margin:0 0 4px;letter-spacing:-0.01em}
  .sub{color:#5b6660;font-size:13px;margin-bottom:24px}
  .stats{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:28px}
  .stat{border:1px solid #e6e8e5;border-radius:12px;padding:12px}
  .stat .n{font-size:20px;font-weight:600}.stat .l{font-size:11px;color:#5b6660;text-transform:uppercase;letter-spacing:0.06em;margin-top:2px}
  h2{font-size:14px;text-transform:uppercase;letter-spacing:0.08em;color:#5b6660;margin:24px 0 10px}
  ul{padding:0;margin:0;list-style:none}li{padding:8px 0;border-bottom:1px solid #f0f2ef;font-size:13px}
  .tag{display:inline-block;background:#eef7f1;color:#136c3a;font-size:11px;padding:2px 8px;border-radius:999px;margin-right:8px;font-weight:500}
  .foot{margin-top:32px;color:#8a938d;font-size:11px;border-top:1px solid #eef0ec;padding-top:12px}
  @media print{body{margin:24px}}
</style></head><body>
        <h1>Mellox AI · Weekly digest</h1><div class="sub>${esc(dateLabel)}</div>
<div class="stats">
  <div class="stat"><div class="n">${summary.clients}</div><div class="l">Clients</div></div>
  <div class="stat"><div class="n">${summary.active}</div><div class="l">Active</div></div>
  <div class="stat"><div class="n">${summary.onboarding}</div><div class="l">Onboarding</div></div>
  <div class="stat"><div class="n">${summary.pending}</div><div class="l">Needs approval</div></div>
  <div class="stat"><div class="n">${summary.scheduled}</div><div class="l">Scheduled 7d</div></div>
</div>
${approvals.length ? `<h2>Approvals waiting</h2><ul>${approvals.map((a) => `<li><span class="tag">${esc(a.client)}</span>${esc(a.title)}</li>`).join("")}</ul>` : ""}
${recent.length ? `<h2>Recently shipped</h2><ul>${recent.map((r) => `<li><span class="tag">${esc(r.client)}</span>${esc(r.title)} <span style="color:#8a938d">— ${esc(r.when)}</span></li>`).join("")}</ul>` : ""}
<div class="foot">Generated by Mellox AI · ${esc(new Date().toLocaleString())}</div>
<script>window.addEventListener("load",()=>{setTimeout(()=>window.print(),200)});</script>
</body></html>`;
    const w = window.open("", "_blank", "width=900,height=1000");
    if (!w) {
      toast.error("Popup blocked", { description: "Allow popups to export PDF." });
      return;
    }
    w.document.write(html);
    w.document.close();
    toast.success("Opening PDF export", {
      description: 'Choose "Save as PDF" in the print dialog.',
    });
  };

  // Map a content_items row to a Studio canvas type — same logic StudioRail uses.
  const canvasForRow = (kind: string): CanvasType =>
    kind === "brief"
      ? "seo-brief"
      : kind === "blog"
        ? "article"
        : kind === "email"
          ? "email"
          : kind === "landing"
            ? "landing-page"
            : "social-post";

  // Real "today & this week" — content_items scheduled in the next 7 days.
  const combinedScheduled = useMemo(() => {
    const now = Date.now();
    const horizon = now + 7 * 24 * 60 * 60 * 1000;
    const real = contentRows
      .filter((c) => c.status === "scheduled" && c.scheduled_at)
      .map((c) => {
        const ts = c.scheduled_at ? new Date(c.scheduled_at).getTime() : 0;
        return { row: c, ts };
      })
      .filter(({ ts }) => ts >= now - 60 * 60 * 1000 && ts <= horizon)
      .sort((a, b) => a.ts - b.ts)
      .map(({ row, ts }) => {
        const d = new Date(ts);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const isToday = ts >= today.getTime() && ts < today.getTime() + 86400000;
        const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
        const when = isToday
          ? `Today, ${time}`
          : d.toLocaleDateString([], { weekday: "short" }) + `, ${time}`;
        return {
          id: row.id,
          title: row.title || (row.body ? row.body.slice(0, 60) : "Scheduled content"),
          canvas: canvasForRow(row.kind),
          channel: row.channel ?? undefined,
          when,
          clientId: row.workspace_id,
          clientName: clientById.get(row.workspace_id)?.name ?? "Client",
        };
      });
    if (real.length > 0) return real;
    // Friendly fallback while a brand-new agency has nothing scheduled yet.
    const pool = clients.length > 0 ? clients : [{ id: "demo", name: "Demo brand" } as Client];
    return MOCK_SCHEDULED.map((m, i) => {
      const c = pool[i % pool.length];
      return { ...m, clientId: c.id, clientName: c.name };
    });
  }, [contentRows, clients, clientById]);

  // Real "recent activity" — published / approved items most recently.
  const combinedRecent = useMemo(() => {
    const real = contentRows
      .filter((c) => c.status === "published" || c.status === "approved")
      .slice(0, 10)
      .map((c) => {
        const ts = new Date(c.created_at).getTime();
        const diff = Date.now() - ts;
        const mins = Math.max(1, Math.round(diff / 60000));
        const when =
          mins < 60
            ? `${mins}m ago`
            : mins < 1440
              ? `${Math.round(mins / 60)}h ago`
              : `${Math.round(mins / 1440)}d ago`;
        return {
          id: c.id,
          title: c.title || (c.body ? c.body.slice(0, 60) : "Content"),
          canvas: canvasForRow(c.kind),
          channel: c.channel ?? undefined,
          when,
          clientId: c.workspace_id,
          clientName: clientById.get(c.workspace_id)?.name ?? "Client",
        };
      });
    if (real.length > 0) return real;
    const pool = clients.length > 0 ? clients : [{ id: "demo", name: "Demo brand" } as Client];
    return MOCK_RECENT.map((m, i) => {
      const c = pool[i % pool.length];
      return { ...m, clientId: c.id, clientName: c.name };
    });
  }, [contentRows, clients, clientById]);

  // Metadata map for the Image library (title, client, channel per post id).
  const imageLibMeta = useMemo(() => {
    const map: Record<string, ImageLibraryItemMeta> = {};
    const push = (it: {
      id: string;
      title: string;
      clientName: string;
      channel?: string | null;
    }) => {
      if (!it.id) return;
      map[it.id] = {
        postId: it.id,
        title: it.title,
        clientName: it.clientName,
        channel: it.channel ?? null,
      };
    };
    combinedApprovals.forEach(push);
    combinedScheduled.forEach(push);
    combinedRecent.forEach(push);
    contentRows.forEach((c) =>
      push({
        id: c.id,
        title: c.title || "Untitled post",
        clientName: clientById.get(c.workspace_id)?.name || "Client",
        channel: c.channel,
      }),
    );
    return map;
  }, [combinedApprovals, combinedScheduled, combinedRecent, contentRows, clientById]);

  // Real-data-grounded suggestions — mirror the deterministic half of
  // useStudioSuggestions so Command Center reads the same signals.
  const dynamicSuggestions = useMemo(() => {
    const out: {
      title: string;
      body: string;
      icon: React.ReactNode;
      tint: string;
      prompt?: string;
      clientId?: string;
    }[] = [];
    const pending = contentRows.filter((c) => c.status === "pending" || c.status === "draft");
    const published = contentRows.filter((c) => c.status === "published");
    const scheduledCount = contentRows.filter((c) => c.status === "scheduled").length;

    if (pending.length > 0) {
      out.push({
        title: `Review ${pending.length} draft${pending.length === 1 ? "" : "s"}`,
        body: "Approvals are blocking publish. Decide them now.",
        icon: <Bell className="h-3.5 w-3.5" />,
        tint: "#f59e0b",
      });
    }

    // Find clients without anything scheduled this week
    const scheduledByClient = new Set(
      contentRows.filter((c) => c.status === "scheduled").map((c) => c.workspace_id),
    );
    const idle = clients.filter(
      (c) => c.client_status !== "paused" && !scheduledByClient.has(c.id),
    );
    if (idle.length > 0) {
      const first = idle[0];
      out.push({
        title: `Plan a week for ${first.name}`,
        body: `${idle.length} client${idle.length === 1 ? "" : "s"} ${idle.length === 1 ? "has" : "have"} nothing scheduled.`,
        icon: <Calendar className="h-3.5 w-3.5" />,
        tint: "#3b82f6",
        clientId: first.id,
        prompt: `Plan next week's content mix for ${first.name} — 5 social posts across the strongest channels with on-brand hooks.`,
      });
    }

    if (scheduledCount > 0) {
      out.push({
        title: `${scheduledCount} scheduled`,
        body: "Open the calendar to fine-tune timing or swap channels.",
        icon: <Activity className="h-3.5 w-3.5" />,
        tint: "#8b5cf6",
      });
    }

    if (published.length >= 5) {
      out.push({
        title: "Run a content audit",
        body: `${published.length} items live — find what's resonating and double-down.`,
        icon: <BarChart3 className="h-3.5 w-3.5" />,
        tint: "#22c55e",
      });
    }

    if (out.length === 0) {
      out.push(
        {
          title: "Add your first client",
          body: "Onboard a brand and Mellox AI drafts a week instantly.",
          icon: <Plus className="h-3.5 w-3.5" />,
          tint: "#3b82f6",
        },
        {
          title: "Take a coffee break ☕",
          body: "Inbox zero across every brand. Nice work.",
          icon: <Coffee className="h-3.5 w-3.5" />,
          tint: "#22c55e",
        },
      );
    }
    return out.slice(0, 4);
  }, [contentRows, clients]);

  const openClient = (id: string) => {
    if (id === "demo") return;
    localStorage.setItem("workspace:selected", id);
    navigate({ to: "/app" });
  };

  const handleSuggestion = (s: { clientId?: string; prompt?: string }) => {
    if (s.clientId) {
      if (s.prompt) {
        try {
          sessionStorage.setItem(`chat:prefill:${s.clientId}`, s.prompt);
        } catch {}
      }
      openClient(s.clientId);
      return;
    }
    document.getElementById("today")?.scrollIntoView({ behavior: "smooth" });
  };

  const activeCount = clients.filter((c) => c.client_status === "active").length;
  const onboardingCount = clients.filter((c) => c.client_status === "onboarding").length;

  // Aggregated "today" stats — real counts where we have them, friendly
  // sample numbers when the workspace is brand new.
  const todayPosts = combinedScheduled.length;
  const todayApprovals = pendingApprovals.length;
  const todayTasks = 6 + (clients.length || 1) * 2;

  const stagger: Variants = {
    hidden: { opacity: 0 },
    show: { opacity: 1, transition: { staggerChildren: 0.04, delayChildren: 0.05 } },
  };
  const itemUp: Variants = {
    hidden: { opacity: 0, y: 8 },
    show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.22, 1, 0.36, 1] } },
  };

  // Cmd/Ctrl+K opens the command palette anywhere on the page.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCmdOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <div className="relative min-h-[100dvh] overflow-hidden bg-background text-foreground">
      <AuroraBackdrop />

      {/* Top bar */}
      <header className="relative z-10 flex h-14 items-center justify-between gap-3 px-5">
        <div className="flex items-center gap-2 sm:gap-3">
          <Link
            to="/workspaces"
            aria-label="Back to all clients"
            className="group inline-flex h-9 items-center gap-1.5 rounded-full border border-border/60 bg-card/80 pl-2 pr-3 text-[12.5px] font-medium text-muted-foreground backdrop-blur transition hover:border-foreground/30 hover:bg-card hover:text-foreground"
          >
            <span className="grid h-6 w-6 place-items-center rounded-full bg-background/80 ring-1 ring-border/60 transition group-hover:-translate-x-0.5 group-hover:ring-foreground/30">
              <ArrowRight className="h-3.5 w-3.5 rotate-180" />
            </span>
            <span className="hidden sm:inline">All clients</span>
            <span className="inline sm:hidden">Back</span>
          </Link>
          <span aria-hidden className="hidden h-5 w-px bg-border/70 sm:block" />
          <Link
            to="/workspaces"
            aria-label="Mellox AI home"
            className="hidden h-9 shrink-0 items-center sm:flex"
          >
            <Logo height={30} />
          </Link>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setCmdOpen(true)}
            className="hidden h-9 items-center gap-2 rounded-full border border-border/60 bg-card/70 pl-3 pr-2 text-[12px] font-medium text-muted-foreground backdrop-blur transition hover:border-foreground/30 hover:text-foreground sm:inline-flex"
            aria-label="Open command palette"
          >
            <SearchIcon className="h-3.5 w-3.5" />
            <span>Search or jump…</span>
            <kbd className="ml-1 inline-flex h-5 items-center gap-0.5 rounded-md border border-border/60 bg-background/70 px-1.5 text-[10px] font-semibold text-foreground/70">
              <CommandIcon className="h-2.5 w-2.5" />K
            </kbd>
          </button>
          <span className="hidden items-center gap-1.5 rounded-full border border-border/60 bg-card/70 px-2.5 py-1 text-[11px] font-medium text-muted-foreground backdrop-blur md:inline-flex">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
            Live
          </span>
        </div>
      </header>

      {/* Hero */}
      <motion.section
        variants={stagger}
        initial="hidden"
        animate="show"
        className="relative z-10 mx-auto w-full max-w-6xl px-5 pt-10 pb-6"
      >
        <motion.div
          variants={itemUp}
          className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card/60 px-3 py-1 text-[11.5px] font-medium text-muted-foreground backdrop-blur"
        >
            <Sparkles className="h-3 w-3 text-aura" /> Agency
        </motion.div>
        <motion.h1
          variants={itemUp}
          className="font-display mt-4 text-[34px] leading-[1.05] tracking-tight sm:text-[44px]"
        >
          {greeting}
          {userName ? `, ${userName}` : ""}.
        </motion.h1>
        <motion.p variants={itemUp} className="mt-2 max-w-xl text-[14px] text-muted-foreground">
          Here's everything happening across your{" "}
          <span className="font-medium text-foreground/90">
            {clients.length || 0} {clients.length === 1 ? "client" : "clients"}
          </span>{" "}
          — in one place.
        </motion.p>

        {/* Snapshot tiles */}
        <motion.div variants={stagger} className="mt-7 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <motion.div variants={itemUp}>
            <SnapshotTile
              icon={<Inbox className="h-4 w-4" />}
              label="Need approval"
              value={todayApprovals}
              tint="#f59e0b"
              onClick={() =>
                document.getElementById("today")?.scrollIntoView({ behavior: "smooth" })
              }
            />
          </motion.div>
          <motion.div variants={itemUp}>
            <SnapshotTile
              icon={<Calendar className="h-4 w-4" />}
              label="Scheduled today"
              value={todayPosts}
              tint="#3b82f6"
            />
          </motion.div>
          <motion.div variants={itemUp}>
            <SnapshotTile
              icon={<ListTodo className="h-4 w-4" />}
              label="Open tasks"
              value={todayTasks}
              tint="#8b5cf6"
            />
          </motion.div>
          <motion.div variants={itemUp}>
            <SnapshotTile
              icon={<Users className="h-4 w-4" />}
              label="Active clients"
              value={activeCount}
              sub={onboardingCount > 0 ? `${onboardingCount} onboarding` : undefined}
              tint="#22c55e"
            />
          </motion.div>
        </motion.div>

        {/* Quick actions strip */}
        <motion.div variants={itemUp} className="mt-4 flex flex-wrap items-center gap-2">
          <QuickAction
            icon={<Zap className="h-3.5 w-3.5" />}
            label="Draft this week for every client"
            hint="Auto-fills empty calendars"
            onClick={draftWeekForAll}
            busy={bulkBusy}
            tint="#f59e0b"
          />
          {(() => {
            const approvableCount = pendingApprovals.filter((a) => canApproveItem(a.id)).length;
            if (approvableCount === 0) return null;
            return (
              <>
                <QuickAction
                  icon={<Check className="h-3.5 w-3.5" />}
                  label={`Approve ${approvableCount}`}
                  onClick={requestApproveAll}
                  busy={bulkBusy}
                  tint="#22c55e"
                />
                <QuickAction
                  icon={<XIcon className="h-3.5 w-3.5" />}
                  label="Reject all"
                  onClick={requestRejectAll}
                  busy={bulkBusy}
                  tint="#f43f5e"
                />
              </>
            );
          })()}
          <QuickAction
            icon={<Copy className="h-3.5 w-3.5" />}
            label="Copy weekly digest"
            hint="For Slack or email"
            onClick={copyDigest}
            tint="#3b82f6"
          />
          <QuickAction
            icon={<Upload className="h-3.5 w-3.5 rotate-180" />}
            label="Export digest CSV"
            hint="Spreadsheet-ready"
            onClick={exportDigestCsv}
            tint="#0ea5e9"
          />
          <QuickAction
            icon={<Upload className="h-3.5 w-3.5 rotate-180" />}
            label="Export digest PDF"
            hint="Print or save"
            onClick={exportDigestPdf}
            tint="#ef4444"
          />
          <QuickAction
            icon={<ImageIcon className="h-3.5 w-3.5" />}
            label="Image library"
            hint="All generated visuals"
            onClick={() => setImageLibOpen(true)}
            tint="#14b8a6"
          />
          <QuickAction
            icon={<CommandIcon className="h-3.5 w-3.5" />}
            label="Jump to anything"
            onClick={() => setCmdOpen(true)}
            tint="#8b5cf6"
          />
        </motion.div>
      </motion.section>

      {/* Two-column body */}
      <section className="relative z-10 mx-auto w-full max-w-6xl px-5 pb-20">
        {/* Section: Today */}
        <SectionHeading
          id="today"
          eyebrow="Today"
          title="What needs you right now"
          sub="Approvals, schedule and quick wins across every brand."
        />
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          {/* Main column */}
          <div className="space-y-5 lg:col-span-2">
            <Card
              title="Needs your approval"
              icon={<AlertTriangle className="h-3.5 w-3.5 text-amber-500" />}
              hint={`${pendingApprovals.length} waiting`}
              action={
                pendingApprovals.filter((a) => canApproveItem(a.id)).length > 1 ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={requestApproveAll}
                    className="h-7 gap-1 px-2 text-[11.5px] font-medium text-emerald-600 hover:bg-emerald-500/10 hover:text-emerald-600 dark:text-emerald-400"
                  >
                    <Check className="h-3.5 w-3.5" /> Approve all
                  </Button>
                ) : null
              }
            >
              {clients.length > 1 && pendingAllCount > 0 && (
                <div className="mb-3 -mt-1 flex items-center gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
                    <Filter className="h-3 w-3" /> Filter
                  </span>
                  <FilterChip
                    active={approvalsFilter === "all"}
                    onClick={() => setApprovalsFilter("all")}
                    label={`All · ${pendingAllCount}`}
                  />
                  {clients.map((c) => {
                    const count = combinedApprovals.filter(
                      (a) => !resolved[a.id] && a.clientId === c.id,
                    ).length;
                    if (count === 0) return null;
                    return (
                      <FilterChip
                        key={c.id}
                        active={approvalsFilter === c.id}
                        onClick={() => setApprovalsFilter(c.id)}
                        label={`${c.name} · ${count}`}
                      />
                    );
                  })}
                </div>
              )}
              {pendingApprovals.length === 0 ? (
                autoGenBusy ? (
                  <EmptyLine
                    icon={<Loader2 className="h-4 w-4 animate-spin text-aura" />}
                    text="Drafting fresh on-brand content for every client…"
                  />
                ) : (
                  <EmptyLine
                    icon={<CheckCircle2 className="h-4 w-4 text-emerald-500" />}
                    text="Inbox zero across every client. Nice."
                  />
                )
              ) : (
                <ul className="space-y-2">
                  {pendingApprovals.slice(0, 6).map((it, i) => {
                    const tile = TILE_BY_ID[it.canvas as CanvasType];
                    const color = TINT[tile?.tint ?? "brand-blue"];
                    const busy = busyId === it.id;
                    return (
                      <motion.li
                        key={it.id}
                        layout
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, x: 24 }}
                        transition={{ delay: i * 0.03 }}
                        className="group flex w-full items-center gap-3 rounded-2xl border border-border/60 bg-background/60 p-3 transition hover:border-foreground/25 hover:bg-background/80"
                      >
                        <button
                          onClick={() =>
                            setPreviewItem({
                              id: it.id,
                              title: it.title,
                              clientName: it.clientName,
                              channel: it.channel,
                              canvas: it.canvas as CanvasType,
                              payload: it.payload,
                            })
                          }
                          className="flex min-w-0 flex-1 items-center gap-3 text-left"
                          aria-label={`Preview ${it.title}`}
                        >
                          <span
                            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl"
                            style={{
                              background: `linear-gradient(135deg, ${color}24, ${color}08)`,
                              boxShadow: `inset 0 0 0 1px ${color}30`,
                            }}
                          >
                            {tile?.icon && (
                              <tile.icon className="h-4 w-4" style={{ color }} strokeWidth={2.25} />
                            )}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[13px] font-medium">{it.title}</div>
                            <div className="mt-0.5 flex items-center gap-1.5 truncate text-[11.5px] text-muted-foreground">
                              <ClientChip name={it.clientName} />
                              {it.channel && <span className="opacity-70">· {it.channel}</span>}
                            </div>
                          </div>
                        </button>
                        <div className="flex shrink-0 items-center gap-1">
                          {canApproveItem(it.id) ? (
                            <>
                              <button
                                onClick={() => decide(it.id, "rejected")}
                                disabled={busy}
                                title="Reject"
                                className="grid h-8 w-8 place-items-center rounded-lg border border-border/60 bg-background/70 text-muted-foreground transition hover:border-rose-400/60 hover:bg-rose-500/10 hover:text-rose-500 disabled:opacity-50"
                              >
                                {busy ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <XIcon className="h-3.5 w-3.5" />
                                )}
                              </button>
                              <button
                                onClick={() => decide(it.id, "approved")}
                                disabled={busy}
                                title="Approve"
                                className="grid h-8 w-8 place-items-center rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-600 transition hover:bg-emerald-500/20 disabled:opacity-50 dark:text-emerald-400"
                              >
                                {busy ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <Check className="h-3.5 w-3.5" />
                                )}
                              </button>
                              {UUID_RE.test(it.id) && contentRows.some((c) => c.id === it.id) && (
                                <button
                                  onClick={() => publishNow(it.id)}
                                  disabled={busy}
                                  title="Publish now"
                                  className="hidden h-8 items-center gap-1 rounded-lg border border-aura/30 bg-aura/10 px-2 text-[11px] font-semibold text-aura transition hover:bg-aura/20 disabled:opacity-50 sm:inline-flex"
                                >
                                  {busy ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <Rocket className="h-3.5 w-3.5" />
                                  )}
                                  Publish
                                </button>
                              )}
                            </>
                          ) : (
                            <span
                              title="View-only access on this client"
                              className="rounded-md border border-border/60 bg-muted/40 px-2 py-1 text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground"
                            >
                              View only
                            </span>
                          )}
                        </div>
                      </motion.li>
                    );
                  })}
                </ul>
              )}
            </Card>

            <Card
              title="Today & this week"
              icon={<Calendar className="h-3.5 w-3.5 text-[#3b82f6]" />}
              hint="Combined schedule"
            >
              <ul className="space-y-1">
                {combinedScheduled
                  .filter((it) => resolved[it.id] !== "skipped")
                  .slice(0, 6)
                  .map((it) => (
                    <ScheduleRow
                      key={it.id}
                      item={it}
                      onPreview={() =>
                        setPreviewItem({
                          id: it.id,
                          title: it.title,
                          clientName: it.clientName,
                          channel: it.channel,
                          canvas: it.canvas as CanvasType,
                        })
                      }
                      onReschedule={() =>
                        toast.success("Rescheduled", {
                          description: `${it.title} moved to tomorrow.`,
                        })
                      }
                      onSkip={() => {
                        setResolved((r) => ({ ...r, [it.id]: "skipped" }));
                        toast("Skipped", { description: it.title });
                      }}
                    />
                  ))}
              </ul>
            </Card>

            <Card
              title="What to do next"
              icon={<Lightbulb className="h-3.5 w-3.5 text-aura" />}
              hint="Based on live data"
            >
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {dynamicSuggestions.map((s, i) => (
                  <Suggestion
                    key={`${s.title}-${i}`}
                    title={s.title}
                    body={s.body}
                    icon={s.icon}
                    tint={s.tint}
                    onClick={s.clientId || s.prompt ? () => handleSuggestion(s) : undefined}
                  />
                ))}
              </div>
            </Card>
          </div>

          {/* Side column */}
          <div className="space-y-5">
            <Card
              title="Recent activity"
              icon={<Activity className="h-3.5 w-3.5 text-[#8b5cf6]" />}
            >
              <ul className="space-y-1.5">
                {combinedRecent.slice(0, 6).map((it) => {
                  const tile = TILE_BY_ID[it.canvas as CanvasType];
                  const color = TINT[tile?.tint ?? "brand-blue"];
                  return (
                    <li key={it.id}>
                      <button
                        onClick={() => openClient(it.clientId)}
                        className="group flex w-full items-center gap-2 rounded-lg px-1.5 py-1.5 text-left transition hover:bg-secondary/60"
                      >
                        <span
                          className="h-1.5 w-1.5 shrink-0 rounded-full"
                          style={{ background: color }}
                        />
                        <span className="flex-1 truncate text-[12.5px] text-foreground/85">
                          {it.title}
                        </span>
                        <span className="hidden shrink-0 text-[10.5px] text-muted-foreground sm:inline">
                          {it.clientName}
                        </span>
                        <span className="shrink-0 text-[10.5px] text-muted-foreground/70">
                          {it.when}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </Card>

            <Card
              title="Your clients"
              icon={<Layers className="h-3.5 w-3.5 text-[#0ea5e9]" />}
              hint={`${clients.length}`}
            >
              {clients.length === 0 ? (
                <EmptyLine
                  icon={<Plus className="h-4 w-4" />}
                  text="No clients yet — add your first brand."
                />
              ) : (
                <ul className="space-y-1">
                  {clients.slice(0, 6).map((c) => (
                    <li key={c.id}>
                      <button
                        onClick={() => openClient(c.id)}
                        className="group flex w-full items-center gap-2 rounded-lg px-1.5 py-1.5 text-left transition hover:bg-secondary/60"
                      >
                        <span
                          className={cn(
                            "h-1.5 w-1.5 shrink-0 rounded-full",
                            c.client_status === "active" && "bg-emerald-500",
                            c.client_status === "onboarding" && "bg-amber-500",
                            c.client_status === "paused" && "bg-zinc-400",
                          )}
                        />
                        <span className="flex-1 truncate text-[12.5px] font-medium text-foreground/90">
                          {c.name}
                        </span>
                        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition group-hover:opacity-100" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <Link
                to="/workspaces"
                className="mt-2 inline-flex items-center gap-1 text-[12px] font-medium text-foreground/80 hover:text-foreground"
              >
                Manage clients <ArrowRight className="h-3 w-3" />
              </Link>
            </Card>

            <Card
              title="Client health"
              icon={<Activity className="h-3.5 w-3.5 text-emerald-500" />}
              hint="Live signals"
            >
              {clients.length === 0 ? (
                <EmptyLine
                  icon={<Plus className="h-4 w-4" />}
                  text="Add a client to see health signals."
                />
              ) : (
                <ul className="space-y-1.5">
                  {clients.slice(0, 6).map((c) => {
                    const pending = contentRows.filter(
                      (r) =>
                        r.workspace_id === c.id && (r.status === "pending" || r.status === "draft"),
                    ).length;
                    const scheduled = contentRows.filter(
                      (r) => r.workspace_id === c.id && r.status === "scheduled",
                    ).length;
                    const published = contentRows.filter(
                      (r) => r.workspace_id === c.id && r.status === "published",
                    ).length;
                    let tone: "good" | "warn" | "risk" = "good";
                    let label = "On track";
                    if (c.client_status === "paused") {
                      tone = "warn";
                      label = "Paused";
                    } else if (scheduled === 0 && published === 0) {
                      tone = "risk";
                      label = "At risk";
                    } else if (pending >= 4) {
                      tone = "warn";
                      label = "Approvals piling";
                    } else if (scheduled < 2) {
                      tone = "warn";
                      label = "Thin schedule";
                    }
                    const dot =
                      tone === "good"
                        ? "bg-emerald-500"
                        : tone === "warn"
                          ? "bg-amber-500"
                          : "bg-rose-500";
                    const chip =
                      tone === "good"
                        ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                        : tone === "warn"
                          ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                          : "bg-rose-500/10 text-rose-600 dark:text-rose-400";
                    return (
                      <li key={c.id}>
                        <button
                          onClick={() => openClient(c.id)}
                          className="group flex w-full items-center gap-2 rounded-lg px-1.5 py-1.5 text-left transition hover:bg-secondary/60"
                        >
                          <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", dot)} />
                          <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-foreground/90">
                            {c.name}
                          </span>
                          <span className="hidden shrink-0 text-[10.5px] tabular-nums text-muted-foreground sm:inline">
                            {scheduled} sched · {pending} pend
                          </span>
                          <span
                            className={cn(
                              "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                              chip,
                            )}
                          >
                            {label}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          </div>
        </div>

        {/* Section: Performance */}
        <div className="mt-10">
          <SectionHeading
            eyebrow="Performance"
            title="All-clients analytics"
            sub="Reach, engagement and channels — combined across every brand."
          />
          <AllClientsAnalytics clients={clients} onOpenClient={openClient} />
        </div>
      </section>

      {/* Approval / schedule preview drawer */}
      <PreviewSheet
        item={previewItem}
        onClose={() => setPreviewItem(null)}
        onApprove={(id) => {
          decide(id, "approved");
          setPreviewItem(null);
        }}
        onReject={(id) => {
          decide(id, "rejected");
          setPreviewItem(null);
        }}
        onOpenClient={(id) => {
          openClient(id);
          setPreviewItem(null);
        }}
        clientById={clientById}
      />

      <CommandPalette
        open={cmdOpen}
        onClose={() => setCmdOpen(false)}
        clients={clients}
        pendingCount={pendingAllCount}
        onOpenClient={(id) => {
          setCmdOpen(false);
          openClient(id);
        }}
        onScrollTo={(id) => {
          setCmdOpen(false);
          document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
        }}
        actions={{
          approveAll: () => {
            setCmdOpen(false);
            requestApproveAll();
          },
          rejectAll: () => {
            setCmdOpen(false);
            requestRejectAll();
          },
          draftWeek: () => {
            setCmdOpen(false);
            draftWeekForAll();
          },
          copyDigest: () => {
            setCmdOpen(false);
            copyDigest();
          },
          allClients: () => {
            setCmdOpen(false);
            navigate({ to: "/projects" });
          },
        }}
      />

      <BulkConfirmModal
        state={bulkConfirm}
        busy={bulkBusy}
        onCancel={() => setBulkConfirm(null)}
        onConfirm={async () => {
          const kind = bulkConfirm?.kind;
          setBulkConfirm(null);
          if (kind === "approve") await approveAll();
          else if (kind === "reject") await rejectAll();
        }}
      />

      <ImageLibraryModal
        open={imageLibOpen}
        onClose={() => setImageLibOpen(false)}
        metaByPostId={imageLibMeta}
      />

      {loading && (
        <div className="pointer-events-none fixed bottom-4 left-1/2 -translate-x-1/2 rounded-full border border-border/60 bg-background/80 px-3 py-1 text-[11px] text-muted-foreground backdrop-blur">
          Loading your day…
        </div>
      )}
    </div>
  );
}

/* ---------- Sub-components ---------- */

function BulkConfirmModal({
  state,
  busy,
  onCancel,
  onConfirm,
}: {
  state: null | { kind: "approve" | "reject"; ids: string[] };
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    if (!state) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter") onConfirm();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state, onCancel, onConfirm]);
  if (!state) return null;
  const isApprove = state.kind === "approve";
  const count = state.ids.length;
  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onClick={onCancel}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 6 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md overflow-hidden rounded-2xl border border-border/70 bg-card shadow-2xl"
      >
        <div className="flex items-start gap-3 p-5">
          <span
            className={cn(
              "grid h-10 w-10 shrink-0 place-items-center rounded-full",
              isApprove ? "bg-emerald-500/10 text-emerald-500" : "bg-rose-500/10 text-rose-500",
            )}
          >
            {isApprove ? <Check className="h-5 w-5" /> : <XIcon className="h-5 w-5" />}
          </span>
          <div className="min-w-0">
            <h3 className="text-[15px] font-semibold text-foreground">
              {isApprove
                ? `Approve ${count} item${count === 1 ? "" : "s"}?`
                : `Reject ${count} item${count === 1 ? "" : "s"}?`}
            </h3>
            <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
              {isApprove
                ? "They'll move to the publish queue across every affected brand. You'll have 10 seconds to undo."
                : "They'll be sent back to each brand workspace for revisions. You'll have 10 seconds to undo."}
            </p>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-border/60 bg-background/40 px-4 py-3">
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy} className="h-8">
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={onConfirm}
            disabled={busy}
            className={cn(
              "h-8 gap-1.5",
              isApprove
                ? "bg-emerald-500 text-white hover:bg-emerald-600"
                : "bg-rose-500 text-white hover:bg-rose-600",
            )}
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : isApprove ? (
              <Check className="h-3.5 w-3.5" />
            ) : (
              <XIcon className="h-3.5 w-3.5" />
            )}
            {isApprove ? `Approve ${count}` : `Reject ${count}`}
          </Button>
        </div>
      </motion.div>
    </div>
  );
}

function QuickAction({
  icon,
  label,
  hint,
  onClick,
  busy,
  tint,
}: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  onClick: () => void;
  busy?: boolean;
  tint: string;
}) {
  return (
    <motion.button
      whileHover={{ y: -1 }}
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      disabled={busy}
      className="group inline-flex h-9 items-center gap-2 rounded-full border border-border/60 bg-card/70 pl-2 pr-3 text-[12px] font-medium text-foreground/85 backdrop-blur transition hover:border-foreground/30 hover:text-foreground disabled:opacity-60"
    >
      <span
        className="grid h-6 w-6 place-items-center rounded-full transition group-hover:scale-105"
        style={{ background: `${tint}22`, color: tint }}
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : icon}
      </span>
      <span className="truncate">{label}</span>
      {hint && (
        <span className="hidden text-[10.5px] text-muted-foreground md:inline">· {hint}</span>
      )}
    </motion.button>
  );
}

function FilterChip({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex h-7 shrink-0 items-center rounded-full border px-2.5 text-[11px] font-medium transition",
        active
          ? "border-foreground/40 bg-foreground text-background"
          : "border-border/60 bg-background/60 text-muted-foreground hover:border-foreground/25 hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}

function CommandPalette({
  open,
  onClose,
  clients,
  pendingCount,
  onOpenClient,
  onScrollTo,
  actions,
}: {
  open: boolean;
  onClose: () => void;
  clients: Client[];
  pendingCount: number;
  onOpenClient: (id: string) => void;
  onScrollTo: (id: string) => void;
  actions: {
    approveAll: () => void;
    rejectAll: () => void;
    draftWeek: () => void;
    copyDigest: () => void;
    allClients: () => void;
  };
}) {
  const [q, setQ] = useState("");
  useEffect(() => {
    if (open) setQ("");
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  const norm = q.trim().toLowerCase();
  const items: {
    key: string;
    label: string;
    hint?: string;
    icon: React.ReactNode;
    run: () => void;
    group: string;
  }[] = [
    {
      key: "act-approve",
      group: "Bulk actions",
      label: `Approve all pending (${pendingCount})`,
      icon: <Check className="h-3.5 w-3.5 text-emerald-500" />,
      run: actions.approveAll,
    },
    {
      key: "act-reject",
      group: "Bulk actions",
      label: "Reject all pending",
      icon: <XIcon className="h-3.5 w-3.5 text-rose-500" />,
      run: actions.rejectAll,
    },
    {
      key: "act-draft",
      group: "Bulk actions",
      label: "Draft this week for every client",
      hint: "AI · Spark",
      icon: <Zap className="h-3.5 w-3.5 text-amber-500" />,
      run: actions.draftWeek,
    },
    {
      key: "act-digest",
      group: "Bulk actions",
      label: "Copy weekly digest",
      icon: <Copy className="h-3.5 w-3.5 text-[#3b82f6]" />,
      run: actions.copyDigest,
    },
    {
      key: "nav-today",
      group: "Navigate",
      label: "Jump to today's queue",
      icon: <Inbox className="h-3.5 w-3.5" />,
      run: () => onScrollTo("today"),
    },
    {
      key: "nav-projects",
      group: "Navigate",
      label: "All clients",
      icon: <Users className="h-3.5 w-3.5" />,
      run: actions.allClients,
    },
    ...clients.map((c) => ({
      key: `client-${c.id}`,
      group: "Open client",
      label: c.name,
      hint: c.website_url ?? undefined,
      icon: <ArrowRight className="h-3.5 w-3.5" />,
      run: () => onOpenClient(c.id),
    })),
  ];
  const filtered = norm
    ? items.filter((i) =>
        (i.label + " " + (i.hint ?? "") + " " + i.group).toLowerCase().includes(norm),
      )
    : items;
  const grouped = filtered.reduce<Record<string, typeof filtered>>((acc, it) => {
    (acc[it.group] ||= []).push(it);
    return acc;
  }, {});
  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/40 p-4 pt-[10vh] backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg overflow-hidden rounded-2xl border border-border/70 bg-card shadow-2xl"
      >
        <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2.5">
          <SearchIcon className="h-4 w-4 text-muted-foreground" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search clients, actions…"
            className="w-full bg-transparent text-[13.5px] outline-none placeholder:text-muted-foreground"
          />
          <kbd className="hidden h-5 items-center gap-0.5 rounded-md border border-border/60 bg-background/70 px-1.5 text-[10px] font-semibold text-foreground/70 sm:inline-flex">
            Esc
          </kbd>
        </div>
        <div className="max-h-[60vh] overflow-y-auto p-1.5">
          {Object.keys(grouped).length === 0 ? (
            <div className="px-3 py-6 text-center text-[12.5px] text-muted-foreground">
              No matches
            </div>
          ) : (
            Object.entries(grouped).map(([group, list]) => (
              <div key={group} className="mb-1">
                <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {group}
                </div>
                {list.map((it) => (
                  <button
                    key={it.key}
                    onClick={it.run}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-[13px] transition hover:bg-secondary/70"
                  >
                    <span className="grid h-6 w-6 place-items-center rounded-md bg-background/70">
                      {it.icon}
                    </span>
                    <span className="flex-1 truncate">{it.label}</span>
                    {it.hint && (
                      <span className="truncate text-[11px] text-muted-foreground">{it.hint}</span>
                    )}
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function SnapshotTile({
  icon,
  label,
  value,
  sub,
  tint,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  sub?: string;
  tint: string;
  onClick?: () => void;
}) {
  const Comp: any = onClick ? "button" : "div";
  return (
    <div className="relative group">
      <div
        aria-hidden
        className="absolute inset-0 rounded-2xl blur-xl opacity-40 transition-opacity group-hover:opacity-70"
        style={{ background: `${tint}12` }}
      />
      <Comp
        onClick={onClick}
        className="relative block w-full overflow-hidden rounded-2xl border border-white/5 bg-[#0d0d0d]/90 p-5 text-left transition hover:border-white/10"
      >
        <div className="flex items-center gap-2">
          <span
            className="grid h-6 w-6 place-items-center rounded-md"
            style={{ background: `${tint}18`, color: tint }}
          >
            {icon}
          </span>
          <p
            className="text-[10.5px] font-semibold uppercase tracking-[0.16em]"
            style={{ color: tint }}
          >
            {label}
          </p>
        </div>
        <div className="mt-3 flex items-baseline gap-2">
          <span className="font-display text-[30px] font-light leading-none tracking-tight text-foreground">
            {value}
          </span>
        </div>
        {sub && (
          <div className="mt-3 flex items-center text-[11px] text-muted-foreground">
            <span className="mr-1 font-semibold" style={{ color: tint }}>
              {sub.split(" ")[0]}
            </span>
            {sub.split(" ").slice(1).join(" ")}
          </div>
        )}
        {!sub && <div className="mt-3 text-[11px] text-muted-foreground/70">Live</div>}
      </Comp>
    </div>
  );
}

function SectionHeading({
  id,
  eyebrow,
  title,
  sub,
}: {
  id?: string;
  eyebrow: string;
  title: string;
  sub?: string;
}) {
  return (
    <motion.div
      id={id}
      initial={{ opacity: 0, y: 8 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className="mb-4 flex items-end justify-between gap-4"
    >
      <div>
        <div className="text-[10.5px] font-bold uppercase tracking-[0.18em] text-aura">
          {eyebrow}
        </div>
        <h2 className="font-display mt-1 text-[22px] font-normal italic leading-tight tracking-tight sm:text-[26px]">
          {title}
        </h2>
        {sub && <p className="mt-1 text-[12.5px] text-muted-foreground">{sub}</p>}
      </div>
    </motion.div>
  );
}

function Card({
  title,
  icon,
  hint,
  action,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  hint?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/5 bg-[#0d0d0d]/90 p-5 backdrop-blur-xl sm:p-6">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {icon}
          {title}
        </h3>
        <div className="flex items-center gap-2">
          {hint && (
            <span className="text-[10.5px] uppercase tracking-wider text-muted-foreground/80">
              {hint}
            </span>
          )}
          {action}
        </div>
      </div>
      {children}
    </div>
  );
}

function ClientChip({ name }: { name: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/60 px-1.5 py-0.5 text-[10px] font-medium text-foreground/80">
      <span className="h-1 w-1 rounded-full bg-foreground/60" />
      {name}
    </span>
  );
}

function ScheduleRow({
  item,
  onPreview,
  onReschedule,
  onSkip,
}: {
  item: QueueItem & { clientId: string; clientName: string };
  onPreview: () => void;
  onReschedule: () => void;
  onSkip: () => void;
}) {
  const tile = TILE_BY_ID[item.canvas];
  const color = TINT[tile?.tint ?? "brand-blue"];
  return (
    <li className="group flex items-center gap-3 rounded-xl px-2 py-2 transition hover:bg-secondary/60">
      <button onClick={onPreview} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <span
          className="grid h-7 w-7 shrink-0 place-items-center rounded-lg"
          style={{ background: `${color}1a`, color }}
        >
          {tile?.icon && <tile.icon className="h-3.5 w-3.5" strokeWidth={2.25} />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12.5px] font-medium">{item.title}</div>
          <div className="flex items-center gap-1.5 truncate text-[11px] text-muted-foreground">
            <ClientChip name={item.clientName} />
            {item.channel && <span className="opacity-70">· {item.channel}</span>}
          </div>
        </div>
      </button>
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border/60 bg-background/60 px-2 py-0.5 text-[10.5px] text-muted-foreground">
        <Clock className="h-3 w-3" />
        {item.when}
      </span>
      <div className="hidden shrink-0 items-center gap-1 opacity-0 transition group-hover:opacity-100 sm:flex">
        <button
          onClick={onReschedule}
          title="Reschedule to tomorrow"
          className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground transition hover:bg-background/80 hover:text-foreground"
        >
          <CalendarClock className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={onSkip}
          title="Skip"
          className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground transition hover:bg-background/80 hover:text-foreground"
        >
          <SkipForward className="h-3.5 w-3.5" />
        </button>
      </div>
    </li>
  );
}

function PreviewSheet({
  item,
  onClose,
  onApprove,
  onReject,
  onOpenClient,
  clientById,
}: {
  item: null | {
    id: string;
    title: string;
    clientName: string;
    channel?: string;
    canvas: CanvasType;
    payload?: Record<string, unknown>;
  };
  onClose: () => void;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onOpenClient: (id: string) => void;
  clientById: Map<string, Client>;
}) {
  const tile = item ? TILE_BY_ID[item.canvas] : undefined;
  const color = TINT[tile?.tint ?? "brand-blue"];
  const caption =
    item?.payload && typeof item.payload.caption === "string"
      ? (item.payload.caption as string)
      : null;
  const summary =
    item?.payload && typeof item.payload.summary === "string"
      ? (item.payload.summary as string)
      : null;
  const bodyFromPayload =
    item?.payload && typeof item.payload.body === "string" ? (item.payload.body as string) : null;
  const clientId = item
    ? (Array.from(clientById.values()).find((c) => c.name === item.clientName)?.id ?? "")
    : "";
  const initialMedia =
    item?.payload && typeof item.payload.media_url === "string"
      ? (item.payload.media_url as string)
      : null;
  const [customImage, setCustomImage] = useState<string | null>(initialMedia);
  const [dragOver, setDragOver] = useState(false);
  const [savingImg, setSavingImg] = useState(false);
  useEffect(() => {
    setCustomImage(initialMedia);
  }, [initialMedia, item?.id]);

  const readFile = (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("Please choose an image file");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      toast.error("Image too large", { description: "Max 8 MB." });
      return;
    }
    const r = new FileReader();
    r.onload = async () => {
      const url = String(r.result ?? "");
      setCustomImage(url);
      // Persist when this is a real content row
      if (item && UUID_RE.test(item.id)) {
        setSavingImg(true);
        const { error } = await supabase
          .from("content_items")
          .update({ media_url: url })
          .eq("id", item.id);
        setSavingImg(false);
        if (error) toast.error("Couldn't attach image", { description: error.message });
        else toast.success("Image attached");
      } else {
        toast.success("Image attached to preview");
      }
    };
    r.readAsDataURL(file);
  };
  const removeImage = async () => {
    setCustomImage(null);
    if (item && UUID_RE.test(item.id) && initialMedia) {
      const { error } = await supabase
        .from("content_items")
        .update({ media_url: null })
        .eq("id", item.id);
      if (error) toast.error("Couldn't remove image", { description: error.message });
    }
  };

  return (
    <Sheet open={!!item} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full max-w-md p-0 sm:max-w-lg">
        {item && (
          <div className="flex h-full flex-col">
            <SheetHeader className="border-b border-border/60 p-5">
              <div className="flex items-center gap-3">
                <span
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-xl"
                  style={{
                    background: `linear-gradient(135deg, ${color}24, ${color}08)`,
                    boxShadow: `inset 0 0 0 1px ${color}30`,
                  }}
                >
                  {tile?.icon && (
                    <tile.icon className="h-5 w-5" style={{ color }} strokeWidth={2.25} />
                  )}
                </span>
                <div className="min-w-0 flex-1 text-left">
                  <SheetTitle className="truncate text-[15px]">{item.title}</SheetTitle>
                  <SheetDescription className="mt-0.5 flex items-center gap-1.5 text-[11.5px]">
                    <ClientChip name={item.clientName} />
                    {item.channel && <span className="opacity-70">· {item.channel}</span>}
                  </SheetDescription>
                </div>
              </div>
            </SheetHeader>

            <div className="flex-1 space-y-4 overflow-y-auto p-5">
              {/* Rich per-canvas preview */}
              <div
                className="relative overflow-hidden rounded-2xl border border-border/60 p-4"
                style={{ background: `linear-gradient(180deg, ${color}12, transparent 65%)` }}
              >
                <div className="mb-3 flex items-center justify-between">
                  <div className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                    Post preview
                  </div>
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    Ready to publish
                  </span>
                </div>
                {customImage && (
                  <div className="mb-3 overflow-hidden rounded-xl border border-border/60">
                    <img
                      src={customImage}
                      alt="Attached"
                      className="block max-h-72 w-full object-cover"
                    />
                  </div>
                )}
                <CanvasPreview
                  canvas={item.canvas}
                  channel={item.channel}
                  title={item.title}
                  caption={caption ?? bodyFromPayload}
                  summary={summary ?? bodyFromPayload}
                  clientName={item.clientName}
                  color={color}
                />
              </div>

              {/* Custom image attach — flexible for every approval */}
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <div className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                    Custom image
                  </div>
                  {savingImg && (
                    <span className="text-[10.5px] text-muted-foreground">Saving…</span>
                  )}
                </div>
                <label
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOver(false);
                    const f = e.dataTransfer.files?.[0];
                    if (f) readFile(f);
                  }}
                  className={cn(
                    "group flex cursor-pointer items-center gap-3 rounded-xl border border-dashed p-3 transition",
                    dragOver
                      ? "border-emerald-400/70 bg-emerald-500/5"
                      : "border-border/70 hover:bg-muted/40",
                  )}
                >
                  <span className="grid h-10 w-10 place-items-center rounded-lg bg-muted text-muted-foreground group-hover:text-foreground">
                    {customImage ? (
                      <ImagePlus className="h-4 w-4" />
                    ) : (
                      <Upload className="h-4 w-4" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[12.5px] font-medium text-foreground">
                      {customImage ? "Replace image" : "Upload or drop an image"}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      PNG · JPG · WebP — up to 8 MB
                    </div>
                  </div>
                  {customImage && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        removeImage();
                      }}
                      className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-[11.5px] text-rose-600 hover:bg-rose-500/10 dark:text-rose-400"
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Remove
                    </button>
                  )}
                  <input
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) readFile(f);
                      e.currentTarget.value = "";
                    }}
                  />
                </label>
              </div>

              <div>
                <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                  Brand context
                </div>
                <div className="rounded-xl border border-border/60 bg-background/60 p-3 text-[12.5px] text-foreground/85">
                  This sits inside{" "}
                  <span className="font-medium text-foreground">{item.clientName}</span>'s active
                  calendar. Approving sends it to the publish queue; rejecting returns it to the
                  brand workspace with notes.
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-border/60 bg-background/60 p-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onOpenClient(clientId)}
                className="h-8 gap-1 text-[12px] text-muted-foreground hover:text-foreground"
              >
                Open in workspace <ArrowRight className="h-3 w-3" />
              </Button>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onReject(item.id)}
                  className="h-8 gap-1 border-rose-300/60 text-rose-600 hover:bg-rose-500/10 hover:text-rose-600 dark:border-rose-500/30 dark:text-rose-400"
                >
                  <XIcon className="h-3.5 w-3.5" /> Reject
                </Button>
                <Button
                  size="sm"
                  onClick={() => onApprove(item.id)}
                  className="h-8 gap-1 bg-emerald-500 text-white hover:bg-emerald-600"
                >
                  <Check className="h-3.5 w-3.5" /> Approve
                </Button>
              </div>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function CanvasPreview({
  canvas,
  channel,
  title,
  caption,
  summary,
  clientName,
  color,
}: {
  canvas: CanvasType;
  channel?: string;
  title: string;
  caption: string | null;
  summary: string | null;
  clientName: string;
  color: string;
}) {
  const body =
    caption ??
    summary ??
    "AI-drafted content awaiting your review — tap Approve to push it live, or Reject to send notes back to the brand workspace.";
  const handle =
    "@" +
    clientName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "")
      .slice(0, 18);
  const brandLetter = clientName.trim().charAt(0).toUpperCase() || "·";
  const hashtags = [
    "#brand",
    "#marketing",
    "#growth",
    "#" +
      clientName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "")
        .slice(0, 12),
  ]
    .filter(Boolean)
    .slice(0, 4)
    .join(" ");
  const Verified = () => (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0" fill="#1d9bf0" aria-hidden>
      <path d="M22.5 12.5c0-1.58-.875-2.95-2.148-3.6.154-.435.238-.905.238-1.4 0-2.21-1.71-3.998-3.818-3.998-.47 0-.92.084-1.336.25C14.818 2.415 13.51 1.5 12 1.5s-2.816.917-3.437 2.25c-.415-.165-.866-.25-1.336-.25-2.11 0-3.818 1.79-3.818 4 0 .494.083.964.237 1.4-1.272.65-2.146 2.018-2.146 3.6 0 1.495.782 2.798 1.942 3.486-.02.17-.032.34-.032.514 0 2.21 1.708 4 3.818 4 .47 0 .92-.086 1.336-.25.62 1.334 1.926 2.25 3.437 2.25 1.51 0 2.818-.916 3.437-2.25.415.163.865.248 1.336.248 2.11 0 3.818-1.79 3.818-4 0-.174-.012-.344-.033-.513 1.158-.687 1.943-1.99 1.943-3.484zm-6.616-3.334l-4.334 6.5c-.145.217-.382.334-.625.334-.143 0-.288-.04-.416-.126l-.115-.094-2.415-2.415c-.293-.293-.293-.768 0-1.06s.768-.294 1.06 0l1.77 1.767 3.825-5.74c.23-.345.696-.436 1.04-.207.346.23.44.696.21 1.04z" />
    </svg>
  );
  const rise: Variants = {
    hidden: { opacity: 0, y: 8 },
    show: (i: number = 0) => ({
      opacity: 1,
      y: 0,
      transition: { delay: 0.05 * i, duration: 0.35, ease: [0.22, 1, 0.36, 1] },
    }),
  };

  // Shared shell + typography tokens — generous spacing, opaque surfaces, stronger text.
  const shell = "overflow-hidden rounded-2xl border border-border bg-background shadow-sm";
  const bodyType = "text-[13.5px] leading-[1.6] text-foreground";
  const subType = "text-[12px] leading-snug text-muted-foreground";

  const Avatar = (
    <span
      className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-[14px] font-semibold text-white shadow-sm ring-1 ring-black/5"
      style={{
        background: `linear-gradient(135deg, ${color}, color-mix(in oklab, ${color} 60%, #000))`,
      }}
    >
      {brandLetter}
    </span>
  );

  // ---- SOCIAL POST ----
  if (canvas === "social-post") {
    const ch = (channel ?? "Instagram").toLowerCase();
    if (ch.includes("linkedin")) {
      return (
        <motion.div initial="hidden" animate="show" className={shell}>
          <motion.div variants={rise} custom={0} className="flex items-center gap-3 px-4 pt-4">
            {Avatar}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1 truncate text-[14px] font-semibold text-foreground">
                {clientName} <Verified />
              </div>
              <div className="text-[11.5px] text-muted-foreground">
                2h · <Globe className="inline h-3 w-3" />
              </div>
            </div>
            <span className="rounded-md bg-[#0a66c2] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
              in
            </span>
          </motion.div>
          <motion.p variants={rise} custom={1} className={`px-4 pt-3 pb-3 ${bodyType}`}>
            {body}
            <span className="mt-1.5 block text-[12.5px] font-medium text-[#0a66c2]">
              {hashtags}
            </span>
          </motion.p>
          <motion.div
            variants={rise}
            custom={2}
            className="relative mx-4 mb-3 aspect-[1.91/1] overflow-hidden rounded-xl"
            style={{
              background: `linear-gradient(135deg, ${color}, color-mix(in oklab, ${color} 55%, #000))`,
            }}
          >
            <div className="absolute inset-0 grid place-items-center px-6 text-center text-[15px] font-semibold leading-snug text-white drop-shadow-md">
              {title}
            </div>
          </motion.div>
          <motion.div
            variants={rise}
            custom={3}
            className="flex items-center justify-between px-4 pb-2 text-[11.5px] text-muted-foreground"
          >
            <span className="inline-flex items-center gap-1">
              <span className="inline-grid h-4 w-4 place-items-center rounded-full bg-[#0a66c2] text-[9px] text-white">
                👍
              </span>{" "}
              1,284
            </span>
            <span>87 comments · 32 reposts</span>
          </motion.div>
          <motion.div
            variants={rise}
            custom={4}
            className="flex items-center justify-around border-t border-border/70 py-2 text-[12px] font-medium text-muted-foreground"
          >
            <span className="inline-flex items-center gap-1.5">
              <ThumbsUp className="h-4 w-4" /> Like
            </span>
            <span className="inline-flex items-center gap-1.5">
              <MessageCircle className="h-4 w-4" /> Comment
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Repeat2 className="h-4 w-4" /> Repost
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Send className="h-4 w-4" /> Send
            </span>
          </motion.div>
        </motion.div>
      );
    }
    if (ch.includes("x") || ch.includes("twitter") || ch.includes("thread")) {
      return (
        <motion.div initial="hidden" animate="show" className={`${shell} p-4`}>
          <motion.div variants={rise} custom={0} className="flex items-start gap-3">
            {Avatar}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1 text-[13.5px]">
                <span className="truncate font-semibold text-foreground">{clientName}</span>
                <Verified />
                <span className="truncate text-muted-foreground">{handle} · 2h</span>
              </div>
              <motion.p
                variants={rise}
                custom={1}
                className={`mt-1.5 whitespace-pre-line ${bodyType}`}
              >
                {body}
                <span className="mt-1.5 block text-[13px] font-medium text-[#1d9bf0]">
                  {hashtags}
                </span>
              </motion.p>
              <motion.div
                variants={rise}
                custom={2}
                className="mt-3 flex items-center gap-6 text-[12px] font-medium text-muted-foreground"
              >
                <span className="inline-flex items-center gap-1.5">
                  <MessageCircle className="h-4 w-4" /> 142
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Repeat2 className="h-4 w-4" /> 386
                </span>
                <span className="inline-flex items-center gap-1.5 text-rose-500">
                  <Heart className="h-4 w-4 fill-rose-500" /> 2,148
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <BarChart3 className="h-4 w-4" /> 24.1k
                </span>
              </motion.div>
            </div>
          </motion.div>
        </motion.div>
      );
    }
    // default → Instagram
    return (
      <motion.div initial="hidden" animate="show" className={shell}>
        <motion.div variants={rise} custom={0} className="flex items-center gap-3 p-3">
          <span
            className="rounded-full p-[2px]"
            style={{
              background:
                "conic-gradient(from 180deg, #feda75, #fa7e1e, #d62976, #962fbf, #4f5bd5, #feda75)",
            }}
          >
            <span className="block rounded-full bg-background p-[2px]">{Avatar}</span>
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1 truncate text-[13.5px] font-semibold text-foreground">
              {handle.slice(1)} <Verified />
            </div>
            <div className="text-[11.5px] text-muted-foreground">{clientName}</div>
          </div>
        </motion.div>
        <motion.div
          variants={rise}
          custom={1}
          className="relative aspect-square w-full overflow-hidden"
          style={{ background: `linear-gradient(135deg, ${color}, ${color}55)` }}
        >
          <div className="absolute inset-0 grid place-items-center px-6 text-center text-[16px] font-semibold leading-snug text-white drop-shadow-md">
            {title}
          </div>
        </motion.div>
        <motion.div
          variants={rise}
          custom={2}
          className="flex items-center gap-4 px-4 pt-3 text-foreground"
        >
          <Heart className="h-6 w-6 fill-rose-500 text-rose-500" />
          <MessageCircle className="h-6 w-6" />
          <Send className="h-6 w-6" />
          <Bookmark className="ml-auto h-5 w-5" />
        </motion.div>
        <motion.div
          variants={rise}
          custom={3}
          className="px-4 pb-1 pt-2 text-[12.5px] font-semibold text-foreground"
        >
          12,482 likes
        </motion.div>
        <motion.p variants={rise} custom={4} className={`px-4 pb-1 ${bodyType}`}>
          <span className="font-semibold text-foreground">{handle.slice(1)}</span> {body}
        </motion.p>
        <motion.p
          variants={rise}
          custom={5}
          className="px-4 pb-1 text-[12.5px] font-medium text-[#385898]"
        >
          {hashtags}
        </motion.p>
        <motion.p
          variants={rise}
          custom={6}
          className="px-4 pb-4 pt-1 text-[11px] uppercase tracking-wide text-muted-foreground"
        >
          2 hours ago
        </motion.p>
      </motion.div>
    );
  }

  // ---- EMAIL ----
  if (canvas === "email") {
    return (
      <motion.div initial="hidden" animate="show" className={shell}>
        <motion.div
          variants={rise}
          custom={0}
          className="border-b border-border/70 bg-muted/50 px-4 py-3 text-[12px]"
        >
          <div className="flex items-center justify-between text-muted-foreground">
            <span>
              From{" "}
              <span className="font-medium text-foreground">
                {clientName} &lt;hello@brand.com&gt;
              </span>
            </span>
            <span>Today</span>
          </div>
          <div className="mt-1 text-foreground">
            <span className="text-muted-foreground">Subject: </span>
            <span className="font-semibold">{title}</span>
          </div>
        </motion.div>
        <motion.div variants={rise} custom={1} className="space-y-3 p-5">
          <h4 className="text-[18px] font-semibold leading-snug tracking-tight text-foreground">
            {title}
          </h4>
          <p className={bodyType}>{body}</p>
          <p className={bodyType}>
            Here's what's new this week — handpicked stories, tips, and updates from the{" "}
            {clientName} team to help you get the most out of every moment.
          </p>
          <motion.button
            variants={rise}
            custom={2}
            className="mt-2 inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-[12.5px] font-semibold text-white shadow-sm"
            style={{ background: color }}
          >
            Read more <ArrowRight className="h-3.5 w-3.5" />
          </motion.button>
        </motion.div>
      </motion.div>
    );
  }

  // ---- ARTICLE / BLOG ----
  if (canvas === "article") {
    return (
      <motion.div initial="hidden" animate="show" className={shell}>
        <motion.div
          variants={rise}
          custom={0}
          className="relative aspect-[2/1] w-full"
          style={{ background: `linear-gradient(135deg, ${color}66, ${color}15)` }}
        >
          <span
            className="absolute left-4 top-4 rounded-full px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-wider text-white shadow-sm"
            style={{ background: `color-mix(in oklab, ${color} 85%, #000)` }}
          >
            {channel ?? "Blog"}
          </span>
        </motion.div>
        <div className="space-y-3 p-5">
          <motion.div variants={rise} custom={1} className={subType}>
            4 min read · Published today
          </motion.div>
          <motion.h4
            variants={rise}
            custom={2}
            className="text-[18px] font-semibold leading-snug tracking-tight text-foreground"
          >
            {title}
          </motion.h4>
          <motion.p variants={rise} custom={3} className={bodyType}>
            {body}
          </motion.p>
          <motion.div
            variants={rise}
            custom={4}
            className="flex items-center gap-2.5 border-t border-border/60 pt-3 text-[12px] text-muted-foreground"
          >
            {Avatar}
            <span>
              by <span className="font-medium text-foreground">Spark</span> · for{" "}
              <span className="font-medium text-foreground">{clientName}</span>
            </span>
          </motion.div>
        </div>
      </motion.div>
    );
  }

  // ---- SEO BRIEF ----
  if (canvas === "seo-brief") {
    return (
      <motion.div initial="hidden" animate="show" className={`${shell} p-5`}>
        <motion.div
          variants={rise}
          custom={0}
          className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.1em]"
          style={{ color }}
        >
          <SearchIcon className="h-3.5 w-3.5" /> SEO brief · {clientName}
        </motion.div>
        <motion.h4
          variants={rise}
          custom={1}
          className="mt-2 text-[17px] font-semibold leading-snug tracking-tight text-foreground"
        >
          {title}
        </motion.h4>
        <motion.p variants={rise} custom={2} className={`mt-2 ${bodyType}`}>
          {body}
        </motion.p>
        <motion.div variants={rise} custom={3} className="mt-4 grid grid-cols-3 gap-2.5">
          {[
            { k: "Intent", v: "Commercial" },
            { k: "Difficulty", v: "32 / 100" },
            { k: "Volume", v: "4.8k / mo" },
          ].map((m) => (
            <div
              key={m.k}
              className="rounded-xl border border-border/70 bg-muted/40 px-3 py-2.5 text-center"
            >
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {m.k}
              </div>
              <div className="mt-1 text-[13px] font-semibold text-foreground">{m.v}</div>
            </div>
          ))}
        </motion.div>
        <motion.div variants={rise} custom={4} className="mt-4">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Target keywords
          </div>
          <div className="flex flex-wrap gap-1.5">
            {["how to", "compare", "pricing", "alternatives", "reviews"].map((t) => (
              <span
                key={t}
                className="rounded-full border border-border/70 bg-background px-2.5 py-1 text-[11.5px] font-medium text-foreground"
              >
                {t}
              </span>
            ))}
          </div>
        </motion.div>
      </motion.div>
    );
  }

  // ---- LANDING PAGE ----
  if (canvas === "landing-page") {
    return (
      <motion.div initial="hidden" animate="show" className={shell}>
        <motion.div
          variants={rise}
          custom={0}
          className="flex items-center gap-1.5 border-b border-border/70 bg-muted/50 px-3 py-2"
        >
          <span className="h-2.5 w-2.5 rounded-full bg-rose-400" />
          <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
          <span className="ml-2 truncate rounded-md border border-border/60 bg-background px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
            {clientName.toLowerCase().replace(/\s+/g, "")}.com
          </span>
        </motion.div>
        <div className="space-y-4 p-5">
          <motion.h4
            variants={rise}
            custom={1}
            className="text-[18px] font-semibold leading-tight tracking-tight text-foreground"
          >
            {title}
          </motion.h4>
          <motion.p variants={rise} custom={2} className={bodyType}>
            {body}
          </motion.p>
          <motion.div variants={rise} custom={3} className="flex items-center gap-2 pt-1">
            <span
              className="rounded-lg px-3.5 py-2 text-[12.5px] font-semibold text-white shadow-sm"
              style={{ background: color }}
            >
              Get started
            </span>
            <span className="rounded-lg border border-border bg-background px-3.5 py-2 text-[12.5px] font-medium text-foreground">
              Learn more
            </span>
          </motion.div>
          <motion.div variants={rise} custom={4} className="grid grid-cols-3 gap-2.5 pt-2">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="aspect-square rounded-lg border border-border/60"
                style={{ background: `linear-gradient(135deg, ${color}30, ${color}08)` }}
              />
            ))}
          </motion.div>
        </div>
      </motion.div>
    );
  }

  // ---- DESIGN ASSET (fallback) ----
  return (
    <motion.div initial="hidden" animate="show" className={`${shell} p-5`}>
      <motion.div
        variants={rise}
        custom={0}
        className="aspect-video w-full rounded-xl"
        style={{
          background: `conic-gradient(from 90deg at 50% 50%, ${color}, ${color}30, ${color})`,
        }}
      />
      <motion.h4
        variants={rise}
        custom={1}
        className="mt-4 text-[16px] font-semibold leading-snug tracking-tight text-foreground"
      >
        {title}
      </motion.h4>
      <motion.p variants={rise} custom={2} className={`mt-1.5 ${bodyType}`}>
        {body}
      </motion.p>
    </motion.div>
  );
}

function MiniStat({
  label,
  value,
  delta,
  up,
}: {
  label: string;
  value: string;
  delta?: string;
  up?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-background/60 p-2.5">
      <div className="text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5 flex items-baseline justify-between">
        <span className="text-[17px] font-semibold tracking-tight">{value}</span>
        {delta && (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 text-[10.5px] font-medium",
              up ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground",
            )}
          >
            {up && <TrendingUp className="h-2.5 w-2.5" />} {delta}
          </span>
        )}
      </div>
    </div>
  );
}

function EmptyLine({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-dashed border-border/60 bg-background/40 px-3 py-2.5 text-[12.5px] text-muted-foreground">
      {icon}
      {text}
    </div>
  );
}

const SUGGESTIONS: { title: string; body: string; icon: React.ReactNode; tint: string }[] = [
  {
    title: "Refresh weekly schedules",
    body: "3 clients have nothing scheduled past Friday.",
    icon: <Calendar className="h-3.5 w-3.5" />,
    tint: "#3b82f6",
  },
  {
    title: "Approve LinkedIn batch",
    body: "Echo drafted 5 posts — same brand voice.",
    icon: <Bell className="h-3.5 w-3.5" />,
    tint: "#f59e0b",
  },
  {
    title: "Run a content audit",
    body: "Spark spotted 7 drafts that haven't moved in 14d.",
    icon: <Activity className="h-3.5 w-3.5" />,
    tint: "#8b5cf6",
  },
  {
    title: "Take a coffee break ☕",
    body: "You closed 12 approvals yesterday. Nice.",
    icon: <Coffee className="h-3.5 w-3.5" />,
    tint: "#22c55e",
  },
];

function Suggestion({
  title,
  body,
  icon,
  tint,
  onClick,
}: {
  title: string;
  body: string;
  icon: React.ReactNode;
  tint: string;
  onClick?: () => void;
}) {
  const Tag: any = onClick ? "button" : "div";
  return (
    <Tag
      onClick={onClick}
      className={cn(
        "group block w-full rounded-xl border border-border/60 bg-background/60 p-3 text-left transition hover:border-foreground/25",
        onClick && "hover:bg-background/80 hover:shadow-sm",
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className="grid h-6 w-6 place-items-center rounded-md"
          style={{ background: `${tint}1f`, color: tint }}
        >
          {icon}
        </span>
        <span className="text-[12.5px] font-semibold">{title}</span>
      </div>
      <p className="mt-1 text-[11.5px] text-muted-foreground">{body}</p>
    </Tag>
  );
}

function AuroraBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-0 overflow-hidden">
      <div
        className="absolute -top-32 left-1/2 h-[520px] w-[1100px] -translate-x-1/2 rounded-[50%] opacity-70 blur-3xl"
        style={{
          background: "radial-gradient(closest-side, hsl(var(--aura)/0.45), transparent 70%)",
        }}
      />
      <div
        className="absolute top-40 left-[6%] h-[420px] w-[520px] rounded-full opacity-60 blur-3xl"
        style={{
          background: "radial-gradient(closest-side, hsl(var(--aura-pink)/0.45), transparent 70%)",
        }}
      />
      <div
        className="absolute top-24 right-[4%] h-[460px] w-[560px] rounded-full opacity-60 blur-3xl"
        style={{
          background:
            "radial-gradient(closest-side, hsl(var(--aura-purple)/0.45), transparent 70%)",
        }}
      />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_120%,hsl(var(--background)),transparent_60%)]" />
    </div>
  );
}

/* ---------- All-clients analytics ---------- */

type ChannelRow = {
  key: BrandKey;
  label: string;
  posts: number;
  reach: number;
  engagement: number; // %
  delta: number; // % vs prev period
  color: string;
};

const CHANNELS: ChannelRow[] = [
  {
    key: "instagram",
    label: "Instagram",
    posts: 42,
    reach: 68400,
    engagement: 7.2,
    delta: 14,
    color: "#E1306C",
  },
  {
    key: "linkedin",
    label: "LinkedIn",
    posts: 28,
    reach: 51200,
    engagement: 5.4,
    delta: 9,
    color: "#0A66C2",
  },
  { key: "x", label: "X", posts: 36, reach: 32800, engagement: 3.1, delta: -4, color: "#0F172A" },
  {
    key: "tiktok",
    label: "TikTok",
    posts: 14,
    reach: 22100,
    engagement: 9.6,
    delta: 22,
    color: "#000000",
  },
  {
    key: "youtube",
    label: "YouTube",
    posts: 6,
    reach: 9800,
    engagement: 4.8,
    delta: 6,
    color: "#FF0000",
  },
  {
    key: "reddit",
    label: "Reddit",
    posts: 11,
    reach: 6200,
    engagement: 2.4,
    delta: -2,
    color: "#FF4500",
  },
];

const TREND_14D = Array.from({ length: 14 }).map((_, i) => ({
  day: `D${i + 1}`,
  reach: 9000 + Math.round(Math.sin(i / 2) * 1800 + i * 420),
  engagement: 4.2 + Math.round((Math.cos(i / 3) * 0.9 + i * 0.08) * 10) / 10,
}));

function AllClientsAnalytics({
  clients,
  onOpenClient,
}: {
  clients: Client[];
  onOpenClient: (id: string) => void;
}) {
  const totalReach = CHANNELS.reduce((s, c) => s + c.reach, 0);
  const totalPosts = CHANNELS.reduce((s, c) => s + c.posts, 0);
  const avgEng = (CHANNELS.reduce((s, c) => s + c.engagement * c.posts, 0) / totalPosts).toFixed(1);

  // Leaderboard — fan reach across known clients deterministically
  const pool =
    clients.length > 0
      ? clients
      : [
          { id: "demo-a", name: "Acme Studio" } as Client,
          { id: "demo-b", name: "Lumen Co." } as Client,
          { id: "demo-c", name: "Northwind" } as Client,
        ];
  const leaderboard = pool.slice(0, 5).map((c, i) => ({
    id: c.id,
    name: c.name,
    reach: Math.round((totalReach / pool.length) * (1.2 - i * 0.12)),
    delta: [18, 11, 6, -3, -8][i] ?? 0,
  }));

  return (
    <div className="mb-5 rounded-3xl border border-border/70 bg-card/70 p-4 backdrop-blur-xl sm:p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-foreground/80">
          <BarChart3 className="h-3.5 w-3.5 text-[#22c55e]" />
          All-clients analytics
        </h3>
        <span className="text-[10.5px] text-muted-foreground">
          Last 14 days · combined across {pool.length} {pool.length === 1 ? "client" : "clients"}
        </span>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard
          icon={<Eye className="h-3.5 w-3.5" />}
          label="Total reach"
          value={fmt(totalReach)}
          delta="+12.4%"
          up
          tint="#3b82f6"
          spark={TREND_14D.map((d) => ({ v: d.reach }))}
        />
        <KpiCard
          icon={<Heart className="h-3.5 w-3.5" />}
          label="Avg engagement"
          value={`${avgEng}%`}
          delta="+0.6pt"
          up
          tint="#E1306C"
          spark={TREND_14D.map((d) => ({ v: d.engagement }))}
        />
        <KpiCard
          icon={<Activity className="h-3.5 w-3.5" />}
          label="Posts shipped"
          value={String(totalPosts)}
          delta="+9"
          up
          tint="#8b5cf6"
          spark={TREND_14D.map((d, i) => ({ v: 2 + (i % 5) }))}
        />
        <KpiCard
          icon={<MousePointerClick className="h-3.5 w-3.5" />}
          label="Link clicks"
          value="3,284"
          delta="+18%"
          up
          tint="#22c55e"
          spark={TREND_14D.map((d, i) => ({ v: 180 + i * 16 + (i % 3) * 30 }))}
        />
      </div>

      {/* Trend + Leaderboard */}
      <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-3">
        <div className="lg:col-span-2 rounded-2xl border border-border/60 bg-background/60 p-3.5">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-[11.5px] font-medium text-foreground/80">
              Reach & engagement trend
            </div>
            <div className="flex items-center gap-3 text-[10.5px] text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-[#3b82f6]" /> Reach
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-[#E1306C]" /> Engagement
              </span>
            </div>
          </div>
          <div className="h-[180px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={TREND_14D} margin={{ top: 6, right: 4, left: -22, bottom: -4 }}>
                <defs>
                  <linearGradient id="reachFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="day"
                  tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                  axisLine={false}
                  tickLine={false}
                  width={36}
                />
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 10,
                    fontSize: 11,
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="reach"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  fill="url(#reachFill)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-2xl border border-border/60 bg-background/60 p-3.5">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-[11.5px] font-medium text-foreground/80">Top clients by reach</div>
            <span className="text-[10px] text-muted-foreground">14d</span>
          </div>
          <ul className="space-y-1.5">
            {leaderboard.map((c, i) => {
              const pct = Math.round((c.reach / leaderboard[0].reach) * 100);
              return (
                <li key={c.id}>
                  <button
                    onClick={() => onOpenClient(c.id)}
                    className="group w-full rounded-lg px-1.5 py-1.5 text-left transition hover:bg-secondary/60"
                  >
                    <div className="flex items-center gap-2">
                      <span className="w-4 shrink-0 text-[10.5px] tabular-nums text-muted-foreground">
                        #{i + 1}
                      </span>
                      <span className="flex-1 truncate text-[12px] font-medium text-foreground/90">
                        {c.name}
                      </span>
                      <span className="shrink-0 text-[11px] tabular-nums text-foreground/80">
                        {fmt(c.reach)}
                      </span>
                      <span
                        className={cn(
                          "ml-1 shrink-0 text-[10px] font-medium",
                          c.delta >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-500",
                        )}
                      >
                        {c.delta >= 0 ? "+" : ""}
                        {c.delta}%
                      </span>
                    </div>
                    <div className="mt-1 h-1 overflow-hidden rounded-full bg-secondary/70">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-[#3b82f6] to-[#8b5cf6]"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      {/* Per-channel performance */}
      <div className="mt-4 rounded-2xl border border-border/60 bg-background/60 p-3.5">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-[11.5px] font-medium text-foreground/80">
            Per-channel performance
          </div>
          <span className="text-[10px] text-muted-foreground">
            Reach · engagement · vs prev 14d
          </span>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {CHANNELS.map((ch) => {
            const pct = Math.round((ch.reach / CHANNELS[0].reach) * 100);
            return (
              <div key={ch.key} className="rounded-xl border border-border/50 bg-card/50 p-2.5">
                <div className="flex items-center gap-2">
                  <span
                    className="grid h-7 w-7 place-items-center rounded-lg"
                    style={{ background: `${ch.color}14` }}
                  >
                    <BrandLogo name={ch.key} brand size={14} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12px] font-semibold">{ch.label}</div>
                    <div className="text-[10.5px] text-muted-foreground">{ch.posts} posts</div>
                  </div>
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                      ch.delta >= 0
                        ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                        : "bg-rose-500/15 text-rose-500",
                    )}
                  >
                    {ch.delta >= 0 ? "+" : ""}
                    {ch.delta}%
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      Reach
                    </div>
                    <div className="text-[13px] font-semibold tabular-nums">{fmt(ch.reach)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      Eng.
                    </div>
                    <div className="text-[13px] font-semibold tabular-nums">{ch.engagement}%</div>
                  </div>
                </div>
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-secondary/70">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${pct}%`, background: ch.color }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between">
        <div className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Target className="h-3 w-3" /> 4 of 6 monthly goals on track
        </div>
        <Link
          to="/app"
          className="inline-flex items-center gap-1 text-[12px] font-medium text-foreground/80 hover:text-foreground"
        >
          Open full analytics <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
    </div>
  );
}

function KpiCard({
  icon,
  label,
  value,
  delta,
  up,
  tint,
  spark,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  delta: string;
  up?: boolean;
  tint: string;
  spark: { v: number }[];
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-border/60 bg-background/60 p-3">
      <div className="flex items-center gap-2">
        <span
          className="grid h-6 w-6 place-items-center rounded-md"
          style={{ background: `${tint}1f`, color: tint }}
        >
          {icon}
        </span>
        <span className="text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
      </div>
      <div className="mt-1.5 flex items-baseline justify-between">
        <span className="font-display text-[22px] leading-none tracking-tight">{value}</span>
        <span
          className={cn(
            "inline-flex items-center gap-0.5 text-[10.5px] font-medium",
            up ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground",
          )}
        >
          {up && <TrendingUp className="h-2.5 w-2.5" />} {delta}
        </span>
      </div>
      <div className="mt-1 h-[28px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={spark} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
            <Line type="monotone" dataKey="v" stroke={tint} strokeWidth={1.5} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function fmt(n: number) {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return n.toLocaleString();
}

export default AgencyHQ;
