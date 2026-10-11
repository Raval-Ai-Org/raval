"use client";

import { Logo } from "@/components/brand/Logo";
import { SecondaryBrandSymbols } from "@/components/brand/SecondaryBrandSymbols";
import {
  PasteLinkBar,
  ProjectCard,
  ProjectsFoot,
  ProjectsStage,
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
  sample(3, "Lumen", "lumen.example", { onboarded: false }),
];

export function ProjectsLab() {
  return (
    <div
      data-mellox-app
      className="relative flex min-h-[100dvh] flex-col overflow-hidden bg-background text-foreground"
    >
      <ProjectsStage>
        <header className="relative z-10 flex h-14 items-center px-5">
          <Logo height={30} />
        </header>

        <section className="relative z-10 mx-auto w-full max-w-5xl px-5 pb-16 pt-10 text-center sm:pb-20 sm:pt-12">
          <SecondaryBrandSymbols size="lg" className="mx-auto mb-8 justify-center gap-3 sm:gap-5" />
          <h1 className="font-display mt-4 text-[40px] leading-[1.05] tracking-tight sm:text-[52px]">
            Which brand today?
          </h1>
          <p className="mt-2 text-[14px] text-muted-foreground">
            Open your brand or add another one you run.
          </p>
          <div className="mx-auto mt-8 w-full max-w-xl">
            <PasteLinkBar existing={SAMPLES} onCreated={() => {}} onOpenAdvanced={() => {}} />
          </div>
        </section>
      </ProjectsStage>

      <section className="relative z-10 mx-auto w-full max-w-6xl px-5 pb-12 pt-8">
        <div className="rounded-3xl border border-border/70 bg-card/70 p-5 backdrop-blur-xl sm:p-7">
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
  );
}
