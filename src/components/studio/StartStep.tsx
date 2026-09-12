"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { duration, ease } from "@/lib/motion";
import { STUDIO_FORMATS, STUDIO_GROUPS, type StudioType } from "@/lib/studio/formats";
import type { StudioIdea } from "@/lib/studio/ideas";
import { IdeasPanel } from "./IdeasPanel";
import { TypeGlyph } from "./studio-ui";

/**
 * The first screen of Studio: what to make, with Mellox's suggestions right
 * beside it — so starting from an idea is as easy as starting from a format.
 */
export function StartStep({
  workspaceId,
  lastType,
  onPickType,
  onPickIdea,
  fixtureIdeas,
}: {
  workspaceId: string;
  lastType?: StudioType | null;
  onPickType: (type: StudioType) => void;
  onPickIdea: (idea: StudioIdea) => void;
  fixtureIdeas?: StudioIdea[];
}) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto grid max-w-6xl gap-8 p-5 md:p-8 xl:grid-cols-[minmax(0,1fr)_minmax(340px,420px)] xl:gap-10">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-foreground md:text-2xl">
            What are we making?
          </h2>
          <p className="mt-1 max-w-prose text-sm text-muted-foreground">
            Pick a format, or start from one of the ideas Mellox found for your brand. Everything
            lands in Needs Approval first.
          </p>

          <div className="mt-6 space-y-6">
            {STUDIO_GROUPS.map((group, gi) => (
              <section data-no-rhythm key={group.id} aria-labelledby={`start-group-${group.id}`}>
                <h3 id={`start-group-${group.id}`} className="ui-eyebrow mb-2 px-0.5">
                  {group.label}
                </h3>
                <ul className="grid gap-2 sm:grid-cols-2">
                  {group.types.map((type, ti) => {
                    const f = STUDIO_FORMATS[type];
                    return (
                      <motion.li
                        key={type}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{
                          delay: (gi * 2 + ti) * 0.03,
                          duration: duration.medium,
                          ease: ease.emphasized,
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => onPickType(type)}
                          className={cn(
                            "group relative flex h-full w-full items-start gap-3 rounded-xl border bg-surface-3 p-3.5 text-left",
                            "transition-[border-color,box-shadow,transform] duration-[--motion-duration-fast]",
                            "hover:-translate-y-px hover:border-border-strong hover:shadow-2",
                            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/55",
                            lastType === type ? "border-primary-border" : "border-border",
                          )}
                        >
                          <TypeGlyph
                            type={type}
                            size="lg"
                            className="transition-colors group-hover:bg-primary-surface group-hover:ring-primary-border"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-2">
                              <span className="text-sm font-semibold text-foreground">
                                {f.label}
                              </span>
                              {lastType === type ? (
                                <span className="rounded-full bg-primary-surface px-1.5 py-0.5 text-[10px] font-medium text-foreground ring-1 ring-primary-border">
                                  Last used
                                </span>
                              ) : null}
                            </span>
                            <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
                              {f.description}
                            </span>
                            <span className="mt-2 block text-[11px] text-muted-foreground/80">
                              {f.estimate}
                            </span>
                          </span>
                        </button>
                      </motion.li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        </div>

        <aside className="xl:border-l xl:border-border xl:pl-10">
          <IdeasPanel
            workspaceId={workspaceId}
            onPick={onPickIdea}
            limit={5}
            fixtureIdeas={fixtureIdeas}
          />
        </aside>
      </div>
    </div>
  );
}
