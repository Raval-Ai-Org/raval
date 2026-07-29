import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Slot } from "@radix-ui/react-slot";
import { AppModalShell } from "@/components/app/AppModalShell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Rocket, Check, Loader2, Globe, ExternalLink, ShieldCheck,
  Clock, GitCommit, CircleDot, Sparkles, Copy,
} from "@/components/ui/gemini-icons";

interface Approval {
  id: string;
  action: string;
  status: string;
  payload: any;
  created_at: string;
}

interface Props {
  workspaceId: string | null;
  children: React.ReactNode;
}

type Phase = "idle";

export function PublishDialog({ workspaceId, children }: Props) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<Approval[]>([]);
  const [loading, setLoading] = useState(false);
  const [phase] = useState<Phase>("idle");
  const [publishedUrl, setPublishedUrl] = useState<string>("");

  useEffect(() => {
    const h = () => setOpen(true);
    window.addEventListener("open:publish", h);
    return () => window.removeEventListener("open:publish", h);
  }, []);

  // Load pending approvals
  useEffect(() => {
    if (!open || !workspaceId) return;
    setLoading(true);
    supabase
      .from("approvals")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(20)
      .then(({ data }) => {
        setPending((data as Approval[]) ?? []);
        setLoading(false);
      });
  }, [open, workspaceId]);

  // Set published URL from current origin
  useEffect(() => {
    if (typeof window !== "undefined") {
      const host = window.location.hostname.replace("id-preview--", "");
      setPublishedUrl(`https://${host.replace(/-dev\./, ".")}`);
    }
  }, []);

  const pendingCount = useMemo(
    () => pending.filter((p) => p.status === "pending").length,
    [pending]
  );

  const approveOne = async (id: string) => {
    setPending((prev) =>
      prev.map((p) => (p.id === id ? { ...p, status: "approved" } : p))
    );
    await supabase
      .from("approvals")
      .update({ status: "approved", decided_at: new Date().toISOString() })
      .eq("id", id);
  };

  const approveAll = async () => {
    const ids = pending.filter((p) => p.status === "pending").map((p) => p.id);
    if (!ids.length) return;
    setPending((prev) => prev.map((p) => ({ ...p, status: "approved" })));
    await supabase
      .from("approvals")
      .update({ status: "approved", decided_at: new Date().toISOString() })
      .in("id", ids);
    toast.success(`${ids.length} change${ids.length > 1 ? "s" : ""} approved`);
  };

  const reset = () => { /* no-op */ };

  return (
    <>
      <Slot onClick={() => setOpen(true)}>{children as any}</Slot>
      <AppModalShell
        open={open}
        onOpenChange={(v) => {
          setOpen(v);
          if (!v) setTimeout(reset, 200);
        }}
        size="sm"
        Icon={Rocket}
        eyebrow="Deploy"
        title="Publish your app"
        description="Review pending changes and push them to your live deployment."
        srDescription="Publish workspace to live"
        bodyClassName="px-6 py-5"
      >

          <AnimatePresence mode="wait">
            {phase === "idle" ? (
              <motion.div
                key="review"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.25 }}
                className="space-y-4"
              >
                {/* Domain row */}
                <div className="flex items-center justify-between rounded-xl border border-border/60 bg-surface/50 px-3.5 py-2.5">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <Globe className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-medium">
                        {publishedUrl.replace("https://", "")}
                      </div>
                      <div className="text-[11px] text-muted-foreground">Production · edge network</div>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(publishedUrl);
                      toast("URL copied");
                    }}
                    className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-surface hover:text-foreground"
                    aria-label="Copy URL"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                </div>

                {/* Pending changes */}
                <div className="rounded-xl border border-border/60">
                  <div className="flex items-center justify-between border-b border-border/60 px-3.5 py-2.5">
                    <div className="flex items-center gap-2">
                      <GitCommit className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-[12.5px] font-medium">Pending changes</span>
                      {pendingCount > 0 && (
                        <Badge variant="secondary" className="h-5 rounded-full px-2 text-[10px]">
                          {pendingCount}
                        </Badge>
                      )}
                    </div>
                    {pendingCount > 0 && (
                      <button
                        onClick={approveAll}
                        className="text-[11.5px] font-medium text-foreground/80 hover:text-foreground"
                      >
                        Approve all
                      </button>
                    )}
                  </div>

                  <div className="max-h-[220px] overflow-auto">
                    {loading ? (
                      <div className="flex items-center gap-2 px-3.5 py-6 text-[12px] text-muted-foreground">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading changes…
                      </div>
                    ) : pending.length === 0 ? (
                      <div className="flex flex-col items-center gap-1.5 px-4 py-7 text-center">
                        <Sparkles className="h-4 w-4 text-muted-foreground" />
                        <p className="text-[12.5px] font-medium">Everything's up to date</p>
                        <p className="text-[11.5px] text-muted-foreground">
                          No pending agent actions waiting on approval.
                        </p>
                      </div>
                    ) : (
                      <ul className="divide-y divide-border/60">
                        {pending.map((p) => (
                          <li key={p.id} className="flex items-start gap-2.5 px-3.5 py-2.5">
                            <CircleDot
                              className="mt-0.5 h-3.5 w-3.5 shrink-0"
                              style={{
                                color:
                                  p.status === "approved"
                                    ? "hsl(var(--success))"
                                    : "hsl(var(--aura-purple))",
                              }}
                            />
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-[12.5px] font-medium">{p.action}</div>
                              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                                <Clock className="h-3 w-3" />
                                {new Date(p.created_at).toLocaleString()}
                              </div>
                            </div>
                            {p.status === "pending" ? (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 rounded-md px-2.5 text-[11px]"
                                onClick={() => approveOne(p.id)}
                              >
                                Approve
                              </Button>
                            ) : (
                              <span className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-medium text-[hsl(var(--success))]">
                                <Check className="h-3 w-3" /> Approved
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>

                <div className="space-y-2 rounded-lg border border-border/60 bg-surface/60 px-3 py-2.5 text-[11.5px] text-muted-foreground">
                  <div className="flex items-start gap-2">
                    <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[hsl(var(--success))]" />
                    <span>
                      Your live URL is always up to date with your latest <b>approved</b> changes — approvals above are the only thing you control here.
                    </span>
                  </div>
                  <div>
                    Want a custom domain or to roll back? Email{" "}
                    <a className="underline" href="mailto:hello@raval.ai">hello@raval.ai</a>.
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-1">
                  <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
                    Close
                  </Button>
                  <Button
                    size="sm"
                    className="btn-aura h-9 gap-1.5 rounded-full px-4"
                    onClick={() => window.open(publishedUrl, "_blank")}
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Visit live site
                  </Button>
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>
      </AppModalShell>
    </>
  );
}



