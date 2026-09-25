"use client";

// SiteConnectionCard — which platform builds this website, how Mellox knows,
// and what it can change there. Shown next to a finding's fix and on the
// AI Visibility overview. Plain words; the proof line comes from the server.

import { AlertTriangle, CheckCircle, Download, Globe, Settings } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { emitAppEvent } from "@/lib/app-events";
import type { SiteBindingView } from "@/lib/geo/fix-contracts";

const NAME = { github: "GitHub", wordpress: "WordPress", webflow: "Webflow" } as const;

function canChange(site: SiteBindingView): string {
  if (site.provider === "github") return "Mellox opens pull requests you review and merge.";
  if (site.provider === "webflow")
    return "Mellox can change page titles, descriptions, social previews and CMS item text, and publish articles to your blog collection.";
  switch (site.seoBackend) {
    case "mellox":
      return "Mellox can change titles, descriptions, canonical links, structured data, robots.txt, llms.txt and page content, and publish articles.";
    case "rankmath":
      return "Mellox can change titles, descriptions, canonical links, indexing and page content (through Rank Math), and publish articles.";
    case "jetpack":
      return "Mellox can change titles, descriptions, indexing and page content (through Jetpack SEO), and publish articles.";
    default:
      return "Mellox can change page content and publish articles. Install the Mellox GEO plugin to also let it fix titles, descriptions and structured data.";
  }
}

export function SiteConnectionCard({
  site,
  canManage,
}: {
  site: SiteBindingView;
  canManage: boolean;
}) {
  const name = NAME[site.provider];
  const needsPlugin =
    site.provider === "wordpress" && (site.seoBackend === "none" || site.seoBackend === "jetpack");
  const needsReconnect = site.provider === "webflow" && site.missingWriteScopes.length > 0;
  return (
    <div className="space-y-2 rounded-xl border border-border/60 bg-background/60 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-secondary">
          <Globe className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium">
            Built with {name}
            <span className="ml-1.5 font-normal text-muted-foreground">
              {site.name.replace(/^https?:\/\//, "")}
            </span>
          </p>
          <p className="flex items-start gap-1 text-[12px] text-muted-foreground">
            {site.verified ? (
              <CheckCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
            ) : (
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
            )}
            {site.proof}
          </p>
        </div>
      </div>
      {site.placeholder && (
        <p className="flex items-start gap-1.5 rounded-md border border-warning/30 bg-warning/5 px-2 py-1.5 text-[12px]">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
          Your site shows visitors a “coming soon” page, so Google and AI engines can’t see your
          content yet. Launch it in {name} so fixes and articles can count.
        </p>
      )}
      {site.verified && <p className="text-[12px] text-foreground/85">{canChange(site)}</p>}
      {site.provider === "wordpress" && site.pluginVersion && (
        <p className="text-[12px] text-muted-foreground">
          Mellox GEO plugin installed (v{site.pluginVersion}).
        </p>
      )}
      {(needsPlugin || needsReconnect || !site.verified) && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {needsPlugin && (
            <Button size="sm" variant="outline" asChild>
              <a href="/downloads/mellox-geo.zip" download>
                <Download className="h-3.5 w-3.5" /> Get the Mellox GEO plugin
              </a>
            </Button>
          )}
          {(needsReconnect || !site.verified) && canManage && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => emitAppEvent("open:settings", { section: "website" })}
            >
              <Settings className="h-3.5 w-3.5" />{" "}
              {needsReconnect ? "Reconnect Webflow" : "Open connections"}
            </Button>
          )}
          {needsPlugin && (
            <span className="text-[11.5px] text-muted-foreground">
              In WordPress: Plugins → Add New → Upload Plugin → choose the file → Activate.
            </span>
          )}
        </div>
      )}
    </div>
  );
}
