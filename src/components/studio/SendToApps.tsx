"use client";

import { useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Plus } from "@/components/icons";
import { AppLogo } from "@/components/brand/AppLogo";
import { dsGhostBtn, dsPrimaryBtn } from "@/components/app/surface/buttons";
import { connectedAppsKey, useConnectedApps } from "@/components/app/connectors/use-connected-apps";
import { useConnectWindow } from "@/components/app/connectors/useConnectWindow";
import { useOptionalWorkspaceRole } from "@/components/workspace/WorkspaceProvider";
import {
  saveGmailDraft,
  savePostToDrive,
  sendAdToGoogleAds,
  startAppConnect,
} from "@/lib/integrations.functions";
import { ServerFnError } from "@/lib/rpc-client";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

const message = (error: unknown, fallback: string) =>
  error instanceof ServerFnError ? error.message : fallback;

type Done = { label: string; url: string };

const APP_NAMES: Record<string, string> = {
  googleads: "Google Ads",
  googledrive: "Google Drive",
  gmail: "Gmail",
};

/** The apps a finished piece can go on to, best fit first. */
export function sendAppsFor(isAd: boolean): string[] {
  return isAd ? ["googleads", "googledrive"] : ["googledrive", "gmail"];
}

/** The app's own mark, small, in place of a generic icon. */
const logo = (app: string) => <AppLogo app={app} name={app} size={16} className="shadow-none" />;

/**
 * One row of "send it on" buttons under a finished post: save to Google
 * Drive, save as a Gmail draft, and for an ad, make it a paused Google Ads
 * campaign. A fitting app that isn't connected yet is a dashed chip that
 * connects it in a sign-in window, so the person never leaves the post.
 * Every one is a person's click; nothing is sent, published or switched on
 * from here.
 */
export function SendToApps({
  workspaceId,
  contentItemId,
  isAd,
  disabled,
}: {
  workspaceId: string;
  contentItemId: string;
  isAd: boolean;
  disabled: boolean;
}) {
  const apps = useConnectedApps(workspaceId);
  const role = useOptionalWorkspaceRole();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, Done>>({});
  const [adsOpen, setAdsOpen] = useState(false);
  const [budget, setBudget] = useState("10");

  const admin = role === "owner" || role === "admin";
  const canAds = isAd && apps.has("googleads") && admin;
  // The apps that fit this piece and aren't connected yet: offered to connect
  // right here (admins connect apps), in a sign-in window, never a new page.
  const offers = sendAppsFor(isAd).filter((id) => admin && apps.canConnect && !apps.has(id));
  const appWindow = useConnectWindow("apps", workspaceId, (result) => {
    setBusy(null);
    if (result?.status === "connected") toast.success("Connected");
    void qc.invalidateQueries({ queryKey: connectedAppsKey(workspaceId) });
  });
  if (!apps.has("googledrive") && !apps.has("gmail") && !canAds && !offers.length) return null;

  const connectApp = async (app: string) => {
    setBusy(`connect-${app}`);
    try {
      await appWindow.connect(
        async () =>
          (
            await startAppConnect({
              data: {
                workspaceId,
                app,
                returnOrigin: window.location.origin,
                returnPath: `${window.location.pathname}${window.location.search}`,
              },
            })
          ).url,
      );
    } catch (error) {
      setBusy(null);
      toast.error(message(error, `Couldn't open ${APP_NAMES[app] ?? "the app"}.`));
    }
  };

  const run = async (key: string, fn: () => Promise<Done>, fallback: string) => {
    setBusy(key);
    try {
      const result = await fn();
      setDone((d) => ({ ...d, [key]: result }));
    } catch (error) {
      toast.error(message(error, fallback));
    } finally {
      setBusy(null);
    }
  };

  const drive = () =>
    run(
      "drive",
      async () => {
        const r = await savePostToDrive({ data: { workspaceId, contentItemId } });
        toast.success("Saved to Google Drive", {
          description: `${r.files} ${r.files === 1 ? "file" : "files"} in your Mellox folder.`,
        });
        return { label: "Open folder", url: r.folderUrl };
      },
      "Couldn't save to Google Drive.",
    );

  const gmail = () =>
    run(
      "gmail",
      async () => {
        const r = await saveGmailDraft({ data: { workspaceId, contentItemId } });
        toast.success("Saved as a Gmail draft", {
          description: "Add who it's for and send it from Gmail.",
        });
        return { label: "Open drafts", url: r.url };
      },
      "Couldn't save the Gmail draft.",
    );

  const ads = () => {
    const daily = Number(budget);
    if (!(daily >= 1 && daily <= 1000)) {
      toast.error("Pick a daily budget between 1 and 1,000.");
      return;
    }
    void run(
      "ads",
      async () => {
        const r = await sendAdToGoogleAds({
          data: { workspaceId, contentItemId, dailyBudget: daily },
        });
        setAdsOpen(false);
        toast.success("Campaign ready in Google Ads", {
          description: r.keywords.length
            ? `${r.keywords.length} keywords from your site added. It's paused: check it, then turn it on there.`
            : "It's paused. Add keywords, then turn it on there. Nothing spends until you do.",
        });
        return { label: "Open in Google Ads", url: r.campaignUrl };
      },
      "Couldn't make the Google Ads campaign.",
    );
  };

  const button = (key: string, icon: ReactNode, label: string, onClick: () => void) => {
    const result = done[key];
    if (result)
      return (
        <a
          key={key}
          href={result.url}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(dsGhostBtn, "h-8 px-3 text-[12.5px]")}
        >
          <ExternalLink className="h-3.5 w-3.5" />
          {result.label}
        </a>
      );
    return (
      <button
        key={key}
        type="button"
        disabled={disabled || busy !== null}
        onClick={onClick}
        className={cn(dsGhostBtn, "h-8 px-3 text-[12.5px]")}
      >
        {icon}
        {busy === key ? "Working…" : label}
      </button>
    );
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {apps.has("googledrive")
          ? button("drive", logo("googledrive"), "Save to Drive", () => void drive())
          : null}
        {apps.has("gmail")
          ? button("gmail", logo("gmail"), "Gmail draft", () => void gmail())
          : null}
        {canAds && !adsOpen
          ? button("ads", logo("googleads"), "Google Ads", () => setAdsOpen(true))
          : null}
        {offers.map((app) => (
          <button
            key={app}
            type="button"
            disabled={busy !== null}
            onClick={() => void connectApp(app)}
            title={`Connect ${APP_NAMES[app]}`}
            className={cn(
              dsGhostBtn,
              "h-8 border-dashed px-3 text-[12.5px] text-muted-foreground hover:text-foreground",
            )}
          >
            {logo(app)}
            {busy === `connect-${app}` ? "Waiting…" : APP_NAMES[app]}
            <Plus className="h-3.5 w-3.5 opacity-70" aria-hidden />
          </button>
        ))}
      </div>
      {canAds && adsOpen && !done.ads ? (
        <div className="space-y-2 rounded-2xl border border-border/70 bg-[var(--ds-tile-bg)] p-3">
          <label
            htmlFor={`ads-budget-${contentItemId}`}
            className="block text-[12.5px] font-medium text-foreground"
          >
            Daily budget
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <input
              id={`ads-budget-${contentItemId}`}
              inputMode="decimal"
              value={budget}
              onChange={(e) => setBudget(e.target.value.replace(/[^\d.]/g, ""))}
              className="h-8 w-24 rounded-full border border-border bg-background px-3 text-[13px] tabular-nums"
            />
            <button
              type="button"
              disabled={disabled || busy !== null}
              onClick={ads}
              className={cn(dsPrimaryBtn, "h-8 px-3 text-[12.5px]")}
            >
              {busy === "ads" ? "Making…" : "Make paused campaign"}
            </button>
            <button
              type="button"
              onClick={() => setAdsOpen(false)}
              className={cn(dsGhostBtn, "h-8 px-3 text-[12.5px]")}
            >
              Cancel
            </button>
          </div>
          <p className="text-[12px] text-muted-foreground">
            In your ad account's currency. Mellox adds the ad, a budget and keywords Google suggests
            for your site. It's made paused: you turn it on in Google Ads, and nothing spends before
            that. Its clicks and spend then show in Analytics.
          </p>
        </div>
      ) : null}
    </div>
  );
}
