"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AppModalShell } from "@/components/app/AppModalShell";
import { BrandLogo } from "@/components/brand/BrandLogo";
import { Button } from "@/components/ui/button";
import { CalendarClock, Check, Send, Spinner } from "@/components/icons";
import { DISTRIBUTION_PLATFORMS, type DistributionPlatformId } from "@/lib/distribution-platforms";
import { PLATFORMS, type PlatformId } from "@/lib/social-platforms";
import {
  getConnections,
  getCreatorInfo,
  oauthStart,
  subscribeSocialConnect,
  type CreatorInfo,
} from "@/lib/sdr.functions";
import type { ConnectedAccount, PublishOutcome } from "@/lib/sdr.handlers";

type Destination = { id: string; platform: DistributionPlatformId };
type Result = { results: PublishOutcome[] };

const TIKTOK_AUDIENCE: Record<string, string> = {
  PUBLIC_TO_EVERYONE: "Everyone",
  MUTUAL_FOLLOW_FRIENDS: "Friends",
  FOLLOWER_OF_CREATOR: "Followers",
  SELF_ONLY: "Only me",
};

export function StudioPublishFlow({
  open,
  mode,
  workspaceId,
  destinations,
  needsApproval,
  scheduleAt,
  onScheduleAtChange,
  onClose,
  onSubmit,
  morePlatforms,
  onAddPlatforms,
}: {
  open: boolean;
  mode: "publish" | "schedule";
  workspaceId: string;
  destinations: Destination[];
  needsApproval: boolean;
  scheduleAt: string;
  onScheduleAtChange: (value: string) => void;
  onClose: () => void;
  onSubmit: (ids: string[], privacy: string | null) => Promise<Result>;
  morePlatforms: PlatformId[];
  onAddPlatforms: (platforms: PlatformId[]) => void;
}) {
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [connecting, setConnecting] = useState<DistributionPlatformId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<"choose" | "sending" | "done">("choose");
  const [result, setResult] = useState<Result | null>(null);
  const [creator, setCreator] = useState<CreatorInfo | null>(null);
  const [creatorError, setCreatorError] = useState(false);
  const [creatorRetry, setCreatorRetry] = useState(0);
  const [privacy, setPrivacy] = useState<string | null>(null);
  const [extraPlatforms, setExtraPlatforms] = useState<PlatformId[]>([]);
  const destinationKey = destinations.map((item) => item.id).join(",");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setAccounts(await getConnections(workspaceId));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load your connections.");
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    if (!open) return;
    setSelected(destinations.map((item) => item.id));
    setPhase("choose");
    setResult(null);
    setError(null);
    setPrivacy(null);
    setExtraPlatforms([]);
    void refresh();
    const unsubscribe = subscribeSocialConnect(() => void refresh());
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      unsubscribe();
      window.removeEventListener("focus", onFocus);
    };
    // Reset only when the dialog opens or its generated destinations change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, workspaceId, destinationKey, refresh]);

  const chosen = useMemo(
    () => destinations.filter((destination) => selected.includes(destination.id)),
    [destinations, selected],
  );
  const missing = chosen.filter(
    (destination) =>
      !accounts.some(
        (account) => account.platform === destination.platform && account.status === "active",
      ),
  );
  const tiktokAccounts = chosen.some((destination) => destination.platform === "tiktok")
    ? accounts.filter((account) => account.platform === "tiktok" && account.status === "active")
    : [];
  const tiktokAccountIds = tiktokAccounts.map((account) => account.accountId).join(",");

  useEffect(() => {
    if (!open || !tiktokAccountIds) {
      setCreator(null);
      setCreatorError(false);
      return;
    }
    let mounted = true;
    setCreator(null);
    setCreatorError(false);
    Promise.all(tiktokAccountIds.split(",").map((id) => getCreatorInfo(workspaceId, id)))
      .then((infos) => {
        if (!mounted) return;
        const info: CreatorInfo = {
          canPost: infos.every((item) => item.canPost),
          privacyLevels: infos[0].privacyLevels.filter((level) =>
            infos.every((item) => item.privacyLevels.includes(level)),
          ),
        };
        setCreator(info);
        setPrivacy((current) => (current && info.privacyLevels.includes(current) ? current : null));
      })
      .catch(() => {
        if (mounted) {
          setCreator(null);
          setCreatorError(true);
        }
      });
    return () => {
      mounted = false;
    };
  }, [open, tiktokAccountIds, workspaceId, creatorRetry]);

  const connect = async (platform: DistributionPlatformId) => {
    const popup = window.open("about:blank", "_blank", "width=600,height=760");
    if (!popup) {
      setError("Allow popups for Mellox, then try connecting again.");
      return;
    }
    setConnecting(platform);
    setError(null);
    try {
      const response = await oauthStart(workspaceId, platform);
      if (response.authorizationUrl) {
        popup.location.href = response.authorizationUrl;
        popup.focus();
      } else {
        popup.close();
        await refresh();
      }
    } catch (cause) {
      popup.close();
      setError(cause instanceof Error ? cause.message : "Could not start the connection.");
    } finally {
      setConnecting(null);
    }
  };

  const submit = async () => {
    if (!chosen.length || missing.length || loading || phase !== "choose") return;
    if (tiktokAccounts.length && (!creator?.canPost || !privacy)) return;
    if (mode === "schedule" && (!scheduleAt || Date.parse(scheduleAt) <= Date.now() + 60_000)) {
      setError("Choose a time at least one minute from now.");
      return;
    }
    setPhase("sending");
    setError(null);
    try {
      const response = await onSubmit(
        chosen.map((destination) => destination.id),
        privacy,
      );
      setResult(response);
      setPhase("done");
    } catch (cause) {
      setPhase("choose");
      setError(cause instanceof Error ? cause.message : "Nothing was sent. Please try again.");
    }
  };

  const accepted =
    result?.results.filter((item) => item.status === "publishing" || item.status === "already")
      .length ?? 0;
  const skipped =
    result?.results.filter((item) => item.status === "skipped" || item.status === "failed") ?? [];

  return (
    <AppModalShell
      open={open}
      onOpenChange={(next) => !next && onClose()}
      disableClose={phase === "sending"}
      size="sm"
      Icon={mode === "publish" ? Send : CalendarClock}
      title={mode === "publish" ? "Publish your post" : "Schedule your post"}
      description="All ready versions and all connected accounts on each platform are selected."
      bodyClassName="px-5 pb-5 pt-3 sm:px-6"
    >
      <AnimatePresence mode="wait">
        {phase === "sending" ? (
          <motion.div
            key="sending"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="py-9 text-center"
            role="status"
            aria-live="polite"
          >
            <span className="relative mx-auto grid size-20 place-items-center rounded-full bg-primary-surface text-primary ring-1 ring-primary-border">
              <span className="absolute inset-0 animate-ping rounded-full bg-primary/10" />
              <Spinner className="relative size-8 animate-spin" />
            </span>
            <h3 className="mt-5 text-lg font-semibold">
              {mode === "publish" ? "Sending your post" : "Setting your schedule"}
            </h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Mellox is preparing each selected version and handing it to your connected accounts.
            </p>
          </motion.div>
        ) : phase === "done" ? (
          <motion.div
            key="done"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="py-7 text-center"
            role="status"
            aria-live="polite"
          >
            <span className="mx-auto grid size-16 place-items-center rounded-full bg-success-surface text-success ring-1 ring-success-border">
              <Check className="size-8" />
            </span>
            <h3 className="mt-5 text-lg font-semibold">
              {accepted
                ? mode === "publish"
                  ? "Publishing started"
                  : "Post scheduled"
                : "Nothing was sent"}
            </h3>
            <p className="mt-2 text-sm text-muted-foreground">
              {accepted
                ? `${accepted} version${accepted === 1 ? "" : "s"} accepted. Delivery status will update here as the platforms respond.`
                : (skipped[0]?.reason ?? "Check your connections and try again.")}
            </p>
            {skipped.length && accepted ? (
              <p className="mt-3 rounded-lg bg-warning-surface px-3 py-2 text-sm text-warning">
                {skipped.length} version{skipped.length === 1 ? "" : "s"} need attention:{" "}
                {skipped[0]?.reason}
              </p>
            ) : null}
            <Button className="mt-6 w-full" onClick={onClose}>
              {accepted ? "View delivery" : "Close"}
            </Button>
          </motion.div>
        ) : (
          <motion.div
            key="choose"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="space-y-4"
          >
            {needsApproval ? (
              <p className="rounded-xl bg-primary-surface px-3 py-2 text-xs text-foreground">
                Selected draft versions will be approved when you confirm.
              </p>
            ) : null}
            <div className="space-y-2" aria-label="Platform versions">
              {destinations.map((destination) => {
                const platform = DISTRIBUTION_PLATFORMS[destination.platform];
                const connected = accounts.filter(
                  (account) =>
                    account.platform === destination.platform && account.status === "active",
                );
                const needsReconnect = accounts.some(
                  (account) =>
                    account.platform === destination.platform && account.status !== "active",
                );
                return (
                  <div
                    key={destination.id}
                    className="flex items-start gap-3 rounded-xl border border-border bg-surface-2/40 px-3 py-3"
                  >
                    <input
                      type="checkbox"
                      checked={selected.includes(destination.id)}
                      onChange={() =>
                        setSelected((current) =>
                          current.includes(destination.id)
                            ? current.filter((id) => id !== destination.id)
                            : [...current, destination.id],
                        )
                      }
                      className="mt-1 size-4 accent-primary"
                      aria-label={`Publish ${platform.label} version`}
                    />
                    <span
                      className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-card"
                      style={{ color: platform.tint }}
                    >
                      <BrandLogo name={platform.logo} brand size={18} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold">{platform.label}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {connected.length
                          ? connected
                              .map(
                                (account) =>
                                  account.displayName ||
                                  account.platformUsername ||
                                  account.accountId,
                              )
                              .join(", ")
                          : loading
                            ? "Checking accounts…"
                            : needsReconnect
                              ? "Account needs reconnecting"
                              : "No account connected"}
                      </p>
                    </div>
                    {!connected.length ? (
                      <Button
                        size="sm"
                        variant="outline"
                        loading={connecting === destination.platform}
                        disabled={loading || connecting !== null}
                        onClick={() => void connect(destination.platform)}
                      >
                        {needsReconnect ? "Reconnect" : "Connect"}
                      </Button>
                    ) : (
                      <span className="mt-1 text-[11px] font-medium text-success">Ready</span>
                    )}
                  </div>
                );
              })}
            </div>
            {morePlatforms.length ? (
              <details className="rounded-xl border border-border px-3 py-2">
                <summary className="cursor-pointer text-sm font-medium">
                  Need versions for other platforms?
                </summary>
                <p className="mt-2 text-xs text-muted-foreground">
                  Create more captions from this post and return here to publish them together.
                </p>
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
                  {morePlatforms.map((platform) => (
                    <label
                      key={platform}
                      className="flex cursor-pointer items-center gap-2 text-xs"
                    >
                      <input
                        type="checkbox"
                        className="size-4 accent-primary"
                        checked={extraPlatforms.includes(platform)}
                        onChange={() =>
                          setExtraPlatforms((current) =>
                            current.includes(platform)
                              ? current.filter((item) => item !== platform)
                              : [...current, platform],
                          )
                        }
                      />
                      {PLATFORMS[platform].label}
                    </label>
                  ))}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-3"
                  disabled={!extraPlatforms.length}
                  onClick={() => onAddPlatforms(extraPlatforms)}
                >
                  Generate selected versions
                </Button>
              </details>
            ) : null}
            {missing.length ? (
              <p className="rounded-xl bg-warning-surface px-3 py-2 text-xs text-warning">
                Connect{" "}
                {missing.map((item) => DISTRIBUTION_PLATFORMS[item.platform].label).join(", ")}{" "}
                here, or deselect those versions to continue.
              </p>
            ) : null}
            {tiktokAccounts.length ? (
              <div className="space-y-1.5">
                <label htmlFor="studio-publish-tiktok-privacy" className="text-xs font-semibold">
                  TikTok audience
                </label>
                <select
                  id="studio-publish-tiktok-privacy"
                  value={privacy ?? ""}
                  onChange={(event) => setPrivacy(event.target.value || null)}
                  className="h-10 w-full rounded-xl border border-border bg-surface-2 px-3 text-sm"
                >
                  <option value="">Choose who can watch…</option>
                  {creator?.privacyLevels.map((level) => (
                    <option key={level} value={level}>
                      {TIKTOK_AUDIENCE[level] ?? level}
                    </option>
                  ))}
                </select>
                {creator && !creator.canPost ? (
                  <p className="text-xs text-warning">
                    TikTok is not accepting posts from every selected account right now.
                  </p>
                ) : null}
                {creator?.canPost && !creator.privacyLevels.length ? (
                  <p className="text-xs text-warning">
                    These TikTok accounts have no shared audience option. Deselect TikTok to send
                    the other versions.
                  </p>
                ) : null}
                {creatorError ? (
                  <Button variant="outline" size="sm" onClick={() => setCreatorRetry((n) => n + 1)}>
                    Retry TikTok account check
                  </Button>
                ) : null}
              </div>
            ) : null}
            {mode === "schedule" ? (
              <div className="space-y-1.5">
                <label htmlFor="studio-publish-at" className="text-xs font-semibold">
                  Date and time
                </label>
                <input
                  id="studio-publish-at"
                  type="datetime-local"
                  value={scheduleAt}
                  onChange={(event) => onScheduleAtChange(event.target.value)}
                  className="h-10 w-full rounded-xl border border-border bg-surface-2 px-3 text-sm"
                />
              </div>
            ) : null}
            {error ? (
              <p
                role="alert"
                className="rounded-xl bg-danger-surface px-3 py-2 text-xs text-danger"
              >
                {error}
              </p>
            ) : null}
            <div className="flex gap-2 border-t border-border pt-4">
              <Button variant="outline" onClick={onClose} className="flex-1">
                Cancel
              </Button>
              <Button
                className="studio-cta flex-[2]"
                onClick={() => void submit()}
                disabled={
                  loading ||
                  !chosen.length ||
                  missing.length > 0 ||
                  !!(tiktokAccounts.length && (!creator?.canPost || !privacy))
                }
              >
                {loading
                  ? "Checking accounts…"
                  : mode === "publish"
                    ? `Publish ${chosen.length === destinations.length ? "all" : chosen.length} now`
                    : `Schedule ${chosen.length === destinations.length ? "all" : chosen.length}`}
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </AppModalShell>
  );
}
