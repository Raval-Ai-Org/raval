"use client";

import { useState } from "react";
import { ExternalLink, Mail } from "@/components/icons";
import { dsGhostBtn, dsPrimaryBtn } from "@/components/app/surface/buttons";
import { useConnectedApps } from "@/components/app/connectors/use-connected-apps";
import { listMailchimpAudiences, saveEmailDraft } from "@/lib/integrations.functions";
import { ServerFnError } from "@/lib/rpc-client";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

type Audience = { id: string; name: string };

const message = (error: unknown, fallback: string) =>
  error instanceof ServerFnError ? error.message : fallback;

/**
 * "Save as an email draft" under a finished post (ADR-0042, Phase 4). The
 * post's words and picture become a draft campaign in the brand's connected
 * Mailchimp; the person checks and sends it there. Nothing is sent from Mellox,
 * and nothing shows when Mailchimp isn't connected.
 */
export function EmailDraft({
  workspaceId,
  contentItemId,
  disabled,
}: {
  workspaceId: string;
  contentItemId: string;
  disabled: boolean;
}) {
  const apps = useConnectedApps(workspaceId);
  const [audiences, setAudiences] = useState<Audience[] | null>(null);
  const [listId, setListId] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<{ url: string | null; audience: string } | null>(null);

  if (!apps.has("mailchimp")) return null;

  const save = async (list: string) => {
    setBusy(true);
    try {
      const result = await saveEmailDraft({
        data: { workspaceId, contentItemId, listId: list || undefined },
      });
      setSaved({ url: result.url, audience: result.audience });
      setAudiences(null);
      toast.success("Saved as a Mailchimp draft", {
        description: `For ${result.audience}. Check it and send it from Mailchimp.`,
      });
    } catch (error) {
      toast.error(message(error, "Couldn't save the draft."));
    } finally {
      setBusy(false);
    }
  };

  // One audience: save straight away. Several: let the person pick first.
  const start = async () => {
    setBusy(true);
    try {
      const lists = await listMailchimpAudiences({ data: { workspaceId } });
      if (!lists.length) {
        toast.error("Make an audience in Mailchimp first.");
        return;
      }
      if (lists.length === 1) {
        setBusy(false);
        await save(lists[0].id);
        return;
      }
      setAudiences(lists);
      setListId(lists[0].id);
    } catch (error) {
      toast.error(message(error, "Couldn't reach Mailchimp."));
    } finally {
      setBusy(false);
    }
  };

  if (saved) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <span className="text-muted-foreground">Draft saved for {saved.audience}.</span>
        {saved.url ? (
          <a
            href={saved.url}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(dsGhostBtn, "h-8 px-3 text-[12.5px]")}
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Open in Mailchimp
          </a>
        ) : null}
      </div>
    );
  }

  if (audiences) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor={`email-audience-${contentItemId}`}>
          Mailchimp audience
        </label>
        <select
          id={`email-audience-${contentItemId}`}
          value={listId}
          onChange={(e) => setListId(e.target.value)}
          className="h-8 min-w-0 flex-1 rounded-full border border-border bg-background px-3 text-[13px]"
        >
          {audiences.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={busy || disabled}
          onClick={() => void save(listId)}
          className={cn(dsPrimaryBtn, "h-8 px-3 text-[12.5px]")}
        >
          {busy ? "Saving…" : "Save draft"}
        </button>
        <button
          type="button"
          onClick={() => setAudiences(null)}
          className={cn(dsGhostBtn, "h-8 px-3 text-[12.5px]")}
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <button
        type="button"
        disabled={busy || disabled}
        onClick={() => void start()}
        className={cn(dsGhostBtn, "h-8 px-3 text-[12.5px]")}
      >
        <Mail className="h-3.5 w-3.5" />
        {busy ? "Saving…" : "Save as a Mailchimp draft"}
      </button>
      <p className="text-[12px] text-muted-foreground">
        It's saved as a draft. You check it and send it from Mailchimp.
      </p>
    </div>
  );
}
