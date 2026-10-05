"use client";

// The audience section of an editor: score a saved piece, see why, improve it,
// ask a simulated panel, and compare versions. Used by the Studio editor and
// the calendar's entry editor.
//
// It never changes the piece. "Improve" and "Use this version" hand text back
// to the editor that owns it, so the normal save and approval rules apply.
import { useCallback, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { Sparkles, Users, Wand2 } from "@/components/icons";
import { Skeleton } from "@/components/ui/skeleton";
import { dsGhostBtn, dsPrimaryBtn } from "@/components/app/surface/buttons";
import { addAppEventListener, emitAppEvent, removeAppEventListener } from "@/lib/app-events";
import type { PredictionView, RunView } from "@/lib/audience/contracts";
import { CREDIT_ACTIONS } from "@/lib/billing/catalog";
import { PredictionDetail, Ranking, RunProgress, runIsActive, ScoreChip } from "./audience-ui";
import { audienceKeys, useAudienceActions, useContentAudience, useRunFinished } from "./hooks";

const credits = (action: "audience_pulse" | "audience_tournament") =>
  `${CREDIT_ACTIONS[action].credits} credits`;

/** What Studio's rewrite is asked to do, from the score's own findings. */
export function improveInstruction(prediction: PredictionView): string {
  const changes = [
    ...prediction.fixes,
    ...prediction.notes.filter((n) => n.level === "warn").map((n) => n.text),
    ...(prediction.pulse?.objections ?? []).map((o) => `Answer this doubt: ${o}`),
  ].slice(0, 5);
  return [
    "Rewrite this so the people it is for care more about it.",
    changes.length ? `Make these changes:\n${changes.map((c) => `- ${c}`).join("\n")}` : "",
    "Keep every fact, number, name, link, @mention and #hashtag. Do not add new claims.",
  ]
    .filter(Boolean)
    .join("\n");
}

/** The score beside a piece's title or version. Nothing when there is no current score. */
export function AudienceScoreChip({
  workspaceId,
  contentItemId,
  className,
}: {
  workspaceId: string | null;
  contentItemId: string | null;
  className?: string;
}) {
  const { data } = useContentAudience(workspaceId, contentItemId);
  if (!data?.prediction) return null;
  return <ScoreChip overall={data.prediction.overall} className={className} />;
}

export function AudienceInspector({
  workspaceId,
  contentItemId,
  dirty,
  locked,
  onImprove,
  onUseVersion,
}: {
  workspaceId: string;
  contentItemId: string | null;
  /** Unsaved edits: the score would be for text nobody has saved. */
  dirty?: boolean;
  /** Already scheduled or sent: show the score, offer no changes. */
  locked?: boolean;
  /** Start the editor's own rewrite with this instruction. */
  onImprove?: (instruction: string) => void;
  /** Put this text into the editor as an unsaved edit. */
  onUseVersion?: (body: string) => void;
}) {
  const client = useQueryClient();
  const query = useContentAudience(workspaceId, contentItemId);
  const actions = useAudienceActions(workspaceId);
  const data = query.data;
  const run = data?.run ?? null;

  // A finished check changes the score everywhere it is shown.
  const onDone = useCallback(
    (_finished: RunView) => {
      void client.invalidateQueries({ queryKey: audienceKeys.all(workspaceId) });
      // Charged on success, released otherwise: the balance moved either way.
      emitAppEvent("billing:changed");
    },
    [client, workspaceId],
  );
  useRunFinished(run, onDone);

  // A saved edit means the old score no longer describes this piece.
  useEffect(() => {
    const on = () =>
      void client.invalidateQueries({ queryKey: audienceKeys.content(workspaceId, contentItemId) });
    addAppEventListener("content:changed", on);
    return () => removeAppEventListener("content:changed", on);
  }, [client, workspaceId, contentItemId]);

  if (!contentItemId) {
    return <p className="text-xs text-muted-foreground">Save this piece to check it.</p>;
  }
  if (query.isLoading) return <Skeleton className="h-16 w-full rounded-xl" />;
  if (!data) {
    return (
      <p className="text-xs text-muted-foreground">The audience check isn't available right now.</p>
    );
  }
  if (!data.canCheck) {
    return (
      <p className="text-xs text-muted-foreground">
        There's no audience check for this kind of piece yet.
      </p>
    );
  }

  const prediction = data.prediction;
  const active = runIsActive(run) ? run : null;
  const starting =
    actions.predict.isPending || actions.check.isPending || actions.compare.isPending;
  const disabled = !!dirty || starting || !!active;
  const small = "h-8 px-3 text-[12.5px]";

  return (
    <div className="space-y-4">
      {dirty && (
        <p className="text-xs text-muted-foreground">Save your edits to check the new text.</p>
      )}

      {active ? (
        <RunProgress run={active} onCancel={() => actions.cancel.mutate(active.id)} />
      ) : prediction ? (
        <PredictionDetail prediction={prediction} compact />
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="min-w-0 flex-1 text-[13px] leading-snug text-muted-foreground">
            See how your audience is likely to react before you post.
          </p>
          <button
            type="button"
            disabled={disabled}
            onClick={() => actions.predict.mutate(contentItemId)}
            className={cn(dsPrimaryBtn, small)}
          >
            <Sparkles className="h-3.5 w-3.5" />
            {actions.predict.isPending ? "Scoring…" : "Predict"}
          </button>
        </div>
      )}

      {run?.status === "failed" && !active && (
        <p className="text-xs text-danger">{run.error} Nothing was charged.</p>
      )}

      {prediction && !active && (
        <div className="flex flex-wrap gap-1.5">
          {!locked && onImprove && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => onImprove(improveInstruction(prediction))}
              className={cn(dsPrimaryBtn, small)}
            >
              <Wand2 className="h-3.5 w-3.5" />
              Improve
            </button>
          )}
          {prediction.depth === "score" && (
            <button
              type="button"
              disabled={disabled}
              title="A simulated panel of your audience reacts to this post"
              onClick={() => actions.check.mutate(contentItemId)}
              className={cn(dsGhostBtn, small)}
            >
              <Users className="h-3.5 w-3.5" />
              Ask your audience · {credits("audience_pulse")}
            </button>
          )}
          {!locked && data.canCompare && onUseVersion && (
            <button
              type="button"
              disabled={disabled}
              title="Mellox writes other versions and your audience ranks them"
              onClick={() => actions.compare.mutate(contentItemId)}
              className={cn(dsGhostBtn, small)}
            >
              Compare versions · {credits("audience_tournament")}
            </button>
          )}
        </div>
      )}

      {run?.tournament && !active && (
        <div>
          <p className="ui-eyebrow mb-2">Versions</p>
          <Ranking
            tournament={run.tournament}
            busy={!!dirty}
            onUse={
              !locked && onUseVersion
                ? (index) => {
                    const version = run.tournament?.variants.find((v) => v.index === index);
                    if (version) onUseVersion(version.body);
                  }
                : undefined
            }
          />
        </div>
      )}
    </div>
  );
}
