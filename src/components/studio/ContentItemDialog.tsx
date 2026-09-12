"use client";

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import { Check, Copy, Trash } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { addAppEventListener, emitAppEvent, removeAppEventListener } from "@/lib/app-events";
import { deleteContentItem, updateContentItem } from "@/lib/content.functions";
import { LEGACY_KINDS } from "@/lib/studio/formats";

type Item = {
  id: string;
  title: string | null;
  body: string | null;
  kind: string;
  channel: string | null;
  status: string;
  media_url: string | null;
};

/**
 * Review for content that didn't come from a Studio job: legacy formats (SEO
 * briefs, emails, landing pages) and drafts created from chat. Read-only apart
 * from the approval decision.
 */
export function ContentItemDialog() {
  const [id, setId] = useState<string | null>(null);
  const [item, setItem] = useState<Item | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const on: Parameters<typeof addAppEventListener<"open:content-item">>[1] = (e) => {
      if (e.detail?.id) setId(e.detail.id);
    };
    addAppEventListener("open:content-item", on);
    return () => removeAppEventListener("open:content-item", on);
  }, []);

  useEffect(() => {
    if (!id) return setItem(null);
    let alive = true;
    void supabase
      .from("content_items")
      .select("id, title, body, kind, channel, status, media_url")
      .eq("id", id)
      .maybeSingle()
      .then(({ data }) => {
        if (alive) setItem((data as Item | null) ?? null);
      });
    return () => {
      alive = false;
    };
  }, [id]);

  const decide = async (status: "approved" | "rejected") => {
    if (!item) return;
    setBusy(true);
    try {
      await updateContentItem({ data: { id: item.id, patch: { status } } });
      emitAppEvent("content:changed");
      toast.success(status === "approved" ? "Approved" : "Discarded");
      setId(null);
    } catch (e) {
      toast.error("Couldn't update", { description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!item || !window.confirm("Delete this item permanently?")) return;
    setBusy(true);
    try {
      await deleteContentItem({ data: { id: item.id } });
      emitAppEvent("content:changed");
      toast("Deleted");
      setId(null);
    } catch (e) {
      toast.error("Couldn't delete", { description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(false);
    }
  };

  const legacyLabel = item ? LEGACY_KINDS[item.kind] : undefined;
  const decidable = item && (item.status === "pending" || item.status === "draft");

  return (
    <Dialog open={!!id} onOpenChange={(v) => !v && setId(null)}>
      <DialogContent className="flex max-h-[88vh] max-w-2xl flex-col gap-0 p-0">
        <div className="border-b border-border px-5 py-4">
          <DialogTitle className="text-base font-semibold">{item?.title || "Untitled"}</DialogTitle>
          <DialogDescription className="mt-1 text-xs">
            {legacyLabel
              ? `${legacyLabel} · a format Studio no longer creates. You can still approve, discard, or copy it.`
              : `${item?.channel ?? "Content"} · ${item?.status ?? ""}`}
          </DialogDescription>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {!item ? (
            <div className="space-y-2" aria-busy>
              <div className="h-3 w-3/4 animate-pulse rounded bg-surface-2" />
              <div className="h-3 w-2/3 animate-pulse rounded bg-surface-2" />
            </div>
          ) : (
            <div className="prose prose-sm max-w-none dark:prose-invert">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {item.body || "_No content_"}
              </ReactMarkdown>
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-border px-5 py-3">
          <Button size="sm" variant="ghost" onClick={() => void remove()} disabled={!item || busy}>
            <Trash />
            Delete
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              item?.body &&
              navigator.clipboard.writeText(item.body).then(() => toast.success("Copied"))
            }
            disabled={!item?.body}
          >
            <Copy />
            Copy
          </Button>
          {decidable ? (
            <div className="ml-auto flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => void decide("rejected")}
                disabled={busy}
              >
                Discard
              </Button>
              <Button size="sm" onClick={() => void decide("approved")} disabled={busy}>
                <Check />
                Approve
              </Button>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
