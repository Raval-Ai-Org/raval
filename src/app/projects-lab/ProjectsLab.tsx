"use client";

import { Logo } from "@/components/brand/Logo";
import { useReducedMotionSafe } from "@/hooks/use-reduced-motion-safe";
import { AppFrame } from "@/components/app/shell/AppFrame";
import {
  PasteLinkBar,
  ProjectCard,
  ProjectsFoot,
  ProjectsHero,
  ProjectsStage,
  UnfinishedSetups,
} from "@/app/projects/ProjectsPage";
import type { WorkspaceSummary } from "@/hooks/use-workspaces";

const now = Date.now();
const sample = (
  n: number,
  name: string,
  domain: string,
  patch: Partial<WorkspaceSummary> = {},
): WorkspaceSummary => ({
  id: `00000000-0000-4000-8000-00000000000${n}`,
  name,
  websiteUrl: `https://${domain}`,
  domain,
  industry: null,
  clientStatus: "active",
  plan: "free",
  role: "owner",
  isOwner: true,
  duplicateOf: null,
  onboarded: true,
  createdAt: new Date(now - 30 * 86_400_000).toISOString(),
  logoUrl: null,
  pendingApprovals: 0,
  draftCount: 0,
  scheduledCount: 0,
  publishedCount: 0,
  failedCount: 0,
  connectedSocialAccounts: 0,
  geoScore: null,
  geoScannedAt: null,
  lastActivityAt: new Date(now - n * 3_600_000).toISOString(),
  health: "healthy",
  ...patch,
});

const SAMPLES: WorkspaceSummary[] = [
  sample(1, "Northwind", "northwind.example", { scheduledCount: 6, geoScore: 82 }),
  sample(2, "Acme Studio", "acme.example", { pendingApprovals: 3, health: "attention" }),
  sample(3, "Lumen", "lumen.example", { geoScore: 64 }),
];

/** Setups started but not finished: their own row, never brand cards. */
const UNFINISHED: WorkspaceSummary[] = [
  sample(4, "New brand", "", { onboarded: false, websiteUrl: null, domain: null }),
  sample(5, "Harbour Bakery", "harbour.example", { onboarded: false }),
];

export function ProjectsLab() {
  const reduce = useReducedMotionSafe();
  return (
    <AppFrame>
      <div
        className="group/projects relative flex min-h-0 flex-1 flex-col overflow-y-auto text-foreground"
        // The bar is clear over the colour wash and only frosts once the page moves.
        onScroll={(e) =>
          e.currentTarget.toggleAttribute("data-scrolled", e.currentTarget.scrollTop > 8)
        }
      >
        <ProjectsStage>
          <header className="sticky top-0 z-20 flex h-16 border-b border-transparent transition-[background-color,border-color,backdrop-filter] duration-300 group-data-[scrolled]/projects:border-[var(--ds-card-border)] group-data-[scrolled]/projects:bg-[var(--ds-frame-bg)]/80 group-data-[scrolled]/projects:backdrop-blur-xl items-center px-5">
            <Logo height={30} />
          </header>

          <ProjectsHero
            reduce={reduce}
            eyebrow="Your brands"
            title="Which brand today, Sam?"
            subtitle="Open your brand or add another one you run."
          >
            <PasteLinkBar existing={SAMPLES} onCreated={() => {}} onOpenAdvanced={() => {}} />
          </ProjectsHero>
          <UnfinishedSetups
            items={UNFINISHED}
            reduce={reduce}
            onContinue={() => {}}
            onDiscard={() => {}}
          />
        </ProjectsStage>

        <section className="relative z-10 mx-auto w-full max-w-6xl px-5 pb-12 pt-8">
          <div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {SAMPLES.map((w, i) => (
                <ProjectCard
                  key={w.id}
                  workspace={w}
                  index={i}
                  lastOpened={i === 0}
                  onOpen={() => {}}
                  onRename={() => {}}
                  onStatusChange={() => {}}
                />
              ))}
            </div>
          </div>
        </section>

        <ProjectsFoot />
      </div>
    </AppFrame>
  );
}
