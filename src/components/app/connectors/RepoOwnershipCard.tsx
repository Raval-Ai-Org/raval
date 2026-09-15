"use client";

// RepoOwnershipCard — shows whether Mellox has proven that a repository builds
// a website, with the evidence behind the verdict, and runs the check.
// Fixes are refused server-side unless the verdict is "verified" for the host
// being fixed; this card only explains and triggers that check.

import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle, RefreshCw, ShieldCheck, XCircle } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { attestSourceOwnership, verifySourceOwnership } from "@/lib/connectors.functions";
import {
  canAttestOwnership,
  hostsMatch,
  ownershipIsCurrent,
  type OwnershipStatus,
} from "@/lib/connectors/ownership";
import type { SourceView } from "@/lib/connectors/types";
import { cn } from "@/lib/utils";

const STATUS: Record<OwnershipStatus, { label: string; tone: string }> = {
  unchecked: { label: "Not checked", tone: "border-border bg-secondary text-muted-foreground" },
  checking: { label: "Checking…", tone: "border-primary/30 bg-primary/10 text-foreground" },
  verified: { label: "Verified", tone: "border-success/30 bg-success/10 text-success" },
  attested: {
    label: "Confirmed by an admin",
    tone: "border-success/30 bg-success/10 text-success",
  },
  likely: { label: "Probably, not proven", tone: "border-warning/30 bg-warning/10 text-warning" },
  unverified: { label: "Not proven", tone: "border-warning/30 bg-warning/10 text-warning" },
  mismatch: {
    label: "Different website",
    tone: "border-destructive/30 bg-destructive/10 text-destructive",
  },
};

const hostOf = (url: string | null) =>
  url ? url.replace(/^https?:\/\//, "").replace(/\/.*$/, "") : null;

export function RepoOwnershipCard({
  workspaceId,
  source,
  siteHost,
  canVerify,
  canAttest = false,
  onChange,
  compact = false,
}: {
  workspaceId: string;
  source: SourceView;
  /** The website being fixed; defaults to the source's linked site. */
  siteHost?: string | null;
  canVerify: boolean;
  /** Workspace admins may confirm ownership when automatic proof isn't possible. */
  canAttest?: boolean;
  onChange: (source: SourceView) => void;
  compact?: boolean;
}) {
  const [running, setRunning] = useState(false);
  const [attesting, setAttesting] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const host = siteHost ?? hostOf(source.siteUrl);
  const o = source.ownership;
  const forOtherHost = Boolean(o.siteHost && host && !hostsMatch(o.siteHost, host));
  const status: OwnershipStatus = forOtherHost ? "unchecked" : running ? "checking" : o.status;
  const current = ownershipIsCurrent({
    status: o.status,
    checkedHost: o.siteHost,
    checkedAt: o.checkedAt,
    siteHost: host,
  });
  const stale = ["verified", "attested"].includes(o.status) && !current && !forOtherHost;
  const meta = STATUS[status];
  const attestable =
    canAttest && !running && !forOtherHost && host
      ? canAttestOwnership({
          status: o.status,
          checkedHost: o.siteHost,
          siteHost: host,
          evidence: o.evidence,
        }).ok
      : false;

  const attest = async () => {
    if (!host) return;
    setAttesting(true);
    try {
      const updated = await attestSourceOwnership({
        data: { workspaceId, sourceId: source.id, siteHost: host, confirm: true },
      });
      onChange(updated);
      setConfirmed(false);
      toast.success(`Confirmed: ${source.fullName} builds ${host}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't confirm ownership");
    } finally {
      setAttesting(false);
    }
  };

  const run = async () => {
    setRunning(true);
    try {
      const updated = await verifySourceOwnership({
        data: { workspaceId, sourceId: source.id, siteHost: host },
      });
      onChange(updated);
      const s = updated.ownership.status;
      if (s === "verified") toast.success(`${source.fullName} builds ${host}`);
      else if (s === "mismatch")
        toast.error(`${source.fullName} doesn't look like the source of ${host}`);
      else toast.message("Ownership isn't proven yet — see the evidence below.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The ownership check failed");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div
      className={cn(
        "rounded-lg border border-border/60 bg-background/60",
        compact ? "p-2.5" : "p-3",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-muted-foreground" />
        <span className="text-[12.5px] font-medium">
          Does {source.fullName} build {host ?? "this website"}?
        </span>
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
            meta.tone,
          )}
        >
          {status === "verified" || status === "attested" ? (
            <CheckCircle className="h-3 w-3" />
          ) : status === "mismatch" ? (
            <XCircle className="h-3 w-3" />
          ) : status === "checking" ? (
            <RefreshCw className="h-3 w-3 animate-spin" />
          ) : (
            <AlertTriangle className="h-3 w-3" />
          )}
          {meta.label}
          {o.confidence != null &&
            !forOtherHost &&
            status !== "checking" &&
            ` · ${Math.round(o.confidence * 100)}%`}
        </span>
        {canVerify && (
          <Button
            size="sm"
            variant={current ? "ghost" : "outline"}
            className="ml-auto"
            loading={running}
            disabled={!host}
            onClick={() => void run()}
          >
            <RefreshCw className="h-3.5 w-3.5" />{" "}
            {o.checkedAt && !forOtherHost ? "Check again" : "Verify repository"}
          </Button>
        )}
      </div>

      {!host && (
        <p className="mt-1.5 text-[12px] text-muted-foreground">
          Link a website to this repository first.
        </p>
      )}
      {stale && (
        <p className="mt-1.5 text-[12px] text-warning">
          The last check is more than a week old. Check again before Mellox changes code.
        </p>
      )}
      {forOtherHost && (
        <p className="mt-1.5 text-[12px] text-muted-foreground">
          The last check was for {o.siteHost}, not {host}.
        </p>
      )}
      {!canVerify && !current && (
        <p className="mt-1.5 text-[12px] text-muted-foreground">An editor can run this check.</p>
      )}

      {!forOtherHost && o.evidence.length > 0 && (
        <ul className="mt-2 space-y-1">
          {o.evidence.map((e, i) => (
            <li key={`${e.signal}-${i}`} className="flex items-start gap-2 text-[12px]">
              {e.polarity === "positive" ? (
                <CheckCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
              ) : e.polarity === "negative" ? (
                <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
              ) : (
                <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full border border-muted-foreground/50" />
              )}
              <span className="min-w-0 break-words text-foreground/85">
                {e.detail}
                {e.path && <span className="font-mono text-muted-foreground"> · {e.path}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {!forOtherHost && o.checkedAt && o.evidence.length === 0 && (
        <p className="mt-2 text-[12px] text-muted-foreground">
          No evidence linked this repository to the website.
        </p>
      )}
      {!forOtherHost && !current && o.hints.length > 0 && (
        <div className="mt-2 rounded-md border border-border/60 bg-card/60 px-2.5 py-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            What would prove it
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[12px] text-foreground/85">
            {o.hints.map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
        </div>
      )}
      {attestable && (
        <div className="mt-2 space-y-2 rounded-md border border-primary/30 bg-primary/5 px-2.5 py-2">
          <p className="text-[12px] text-foreground/85">
            Some hosts (Lovable, Replit, your own server) don&apos;t tell GitHub where a repository
            is deployed, so Mellox can&apos;t prove it automatically. As a workspace admin you can
            confirm it. Mellox still opens only pull requests you approve.
          </p>
          <label className="flex items-start gap-2 text-[12px]">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            <span>
              I confirm <span className="font-medium">{source.fullName}</span> is the source code
              that builds <span className="font-medium">{host}</span>. This is recorded with my
              name.
            </span>
          </label>
          <Button
            size="sm"
            disabled={!confirmed || attesting}
            loading={attesting}
            onClick={() => void attest()}
          >
            <ShieldCheck className="h-3.5 w-3.5" /> Confirm ownership
          </Button>
        </div>
      )}
      {o.status === "attested" && !forOtherHost && (
        <p className="mt-1.5 text-[11.5px] text-muted-foreground">
          Confirmed by a workspace admin — the automatic evidence alone wasn&apos;t conclusive.
        </p>
      )}
      {o.checkedAt && !forOtherHost && (
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          Checked {new Date(o.checkedAt).toLocaleString()}
          {o.commitSha ? ` at commit ${o.commitSha.slice(0, 7)}` : ""}
        </p>
      )}
    </div>
  );
}
