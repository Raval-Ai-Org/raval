"use client";
// Buying placements, start to finish.
//
// One question per screen, in a single centred column, so nobody is asked to
// parse a form. Nothing spends money until the last button, and the screen
// before it shows the total, the balance after, and what happens next — because
// that is the moment the decision is actually made.
import { useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

import { AlertCircle, ArrowLeft, Check, Search, Sparkles, Spinner } from "@/components/icons";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import {
  btnGhost,
  btnPrimary,
  btnQuiet,
  EASE,
  Field,
  inputBase,
  ListSkeleton,
  Money,
} from "./links-ui";
import { PlacementCard } from "./PlacementCard";
import { useConfirmOrder, useFindPlacements, useSaveSelection, useWriteBrief } from "./hooks";
import type { OpportunityView } from "@/server/fns/links";

const STEPS = ["Page", "Sites", "Article", "Confirm"] as const;

/** Small enough that one publisher cycle buys the whole order. */
const MAX_SELECTED = 20;

export function CampaignFlow({
  workspaceId,
  siteHost,
  balanceUsd,
  onDone,
  onCancel,
  onTopUp,
}: {
  workspaceId: string;
  siteHost: string | null;
  balanceUsd: number;
  onDone: (orderId: string) => void;
  onCancel: () => void;
  onTopUp: () => void;
}) {
  const reduced = useReducedMotion();
  const [step, setStep] = useState(0);

  const [targetUrl, setTargetUrl] = useState(siteHost ? `https://${siteHost}` : "");
  const [keyword, setKeyword] = useState("");
  const [guidance, setGuidance] = useState("");
  const [brief, setBrief] = useState("");
  const [results, setResults] = useState<OpportunityView[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [quoted, setQuoted] = useState<{ credits: number; usd: number } | null>(null);

  const find = useFindPlacements(workspaceId);
  const write = useWriteBrief(workspaceId);
  const save = useSaveSelection(workspaceId);
  const confirm = useConfirmOrder(workspaceId);

  const chosen = useMemo(
    () => results.filter((item) => selected.includes(item.donorId)),
    [results, selected],
  );
  const runningTotal = useMemo(
    () => Math.round(chosen.reduce((sum, item) => sum + item.usd, 0) * 100) / 100,
    [chosen],
  );

  const total = quoted?.usd ?? runningTotal;
  const canAfford = balanceUsd + 0.004 >= total;
  const shortfall = Math.max(0, Math.round((total - balanceUsd) * 100) / 100);

  const suggestions = siteHost
    ? [`https://${siteHost}`, `https://${siteHost}/pricing`, `https://${siteHost}/blog`]
    : [];

  function toggle(donorId: number) {
    setSelected((current) =>
      current.includes(donorId)
        ? current.filter((id) => id !== donorId)
        : current.length >= MAX_SELECTED
          ? current
          : [...current, donorId],
    );
  }

  async function runSearch() {
    const found = await find.mutateAsync({ targetUrl, keyword, limit: 12 });
    setResults(found.placements);
    setSelected([]);
    setStep(1);
  }

  async function generateBrief() {
    const result = await write.mutateAsync({ targetUrl, keyword, guidance: guidance || null });
    setBrief(result.brief);
  }

  async function review() {
    const result = await save.mutateAsync({
      targetUrl,
      keyword,
      donorIds: selected,
      recommendations: brief || null,
    });
    setOrderId(result.orderId);
    setQuoted({ credits: result.credits, usd: result.usd });
    setStep(3);
  }

  async function placeOrder() {
    if (!orderId || !quoted) return;
    const result = await confirm.mutateAsync({
      orderId,
      expectedCredits: quoted.credits,
    });
    onDone(result.orderId);
  }

  const busy = find.isPending || save.isPending || confirm.isPending;

  return (
    <div className="mx-auto w-full max-w-2xl pb-28">
      {/* A slim rail rather than numbered circles: it reports progress without
          competing with the question being asked. */}
      <div className="mb-8 flex items-center gap-2">
        {STEPS.map((label, i) => (
          <div key={label} className="flex flex-1 flex-col gap-1.5">
            <span
              className={cn(
                "h-1 rounded-full transition-colors duration-500",
                i <= step ? "bg-primary" : "bg-border",
              )}
            />
            <span
              className={cn(
                "text-[11.5px] transition-colors",
                i === step ? "font-medium text-foreground" : "text-muted-foreground",
              )}
            >
              {label}
            </span>
          </div>
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={reduced ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduced ? undefined : { opacity: 0, y: -6 }}
          transition={{ duration: 0.24, ease: EASE }}
        >
          {step === 0 && (
            <div className="space-y-7">
              <header>
                <h1 className="text-[26px] font-semibold tracking-tight text-foreground">
                  Which page should get the links?
                </h1>
                <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">
                  Every article we buy will link to this page, using the words you choose.
                </p>
              </header>

              <Field label="Page address" id="target">
                <input
                  id="target"
                  value={targetUrl}
                  onChange={(event) => setTargetUrl(event.target.value)}
                  placeholder="https://yoursite.com/pricing"
                  className={inputBase}
                  autoComplete="off"
                />
                {suggestions.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {suggestions.map((url) => (
                      <button
                        key={url}
                        type="button"
                        onClick={() => setTargetUrl(url)}
                        className={btnQuiet}
                      >
                        {url.replace(/^https?:\/\//, "")}
                      </button>
                    ))}
                  </div>
                )}
              </Field>

              <Field
                label="Link text"
                id="keyword"
                hint="The words the link will use. Write them as they'd read in a sentence."
              >
                <input
                  id="keyword"
                  value={keyword}
                  onChange={(event) => setKeyword(event.target.value)}
                  placeholder="project management software"
                  className={inputBase}
                  autoComplete="off"
                />
              </Field>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-6">
              <header className="flex items-end justify-between gap-4">
                <div>
                  <h1 className="text-[26px] font-semibold tracking-tight text-foreground">
                    Where should it appear?
                  </h1>
                  <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">
                    Ranked on each site&rsquo;s real figures. The description is what Mellox found
                    when it read the site.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void runSearch()}
                  disabled={find.isPending}
                  className={cn(btnGhost, "shrink-0")}
                >
                  {find.isPending ? (
                    <Spinner className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  ) : (
                    <Search className="h-3.5 w-3.5" aria-hidden />
                  )}
                  Refresh
                </button>
              </header>

              {find.isPending ? (
                <ListSkeleton rows={4} />
              ) : results.length === 0 ? (
                <EmptyState
                  size="sm"
                  icon={Search}
                  title="Nothing matched"
                  description="Try broader link text, or search again in a moment."
                />
              ) : (
                <div className="space-y-3">
                  {results.map((placement, index) => (
                    <PlacementCard
                      key={placement.donorId}
                      placement={placement}
                      index={index}
                      selected={selected.includes(placement.donorId)}
                      disabled={selected.length >= MAX_SELECTED}
                      onToggle={() => toggle(placement.donorId)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {step === 2 && (
            <div className="space-y-7">
              <header>
                <h1 className="text-[26px] font-semibold tracking-tight text-foreground">
                  What should the article say?
                </h1>
                <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">
                  Mellox writes the brief from your Brand DNA. The publisher writes the article from
                  it. You can skip this and let them write from your page alone.
                </p>
              </header>

              <Field
                label="Anything the writer should know?"
                id="guidance"
                hint="Optional. A sentence is plenty."
              >
                <input
                  id="guidance"
                  value={guidance}
                  onChange={(event) => setGuidance(event.target.value)}
                  placeholder="We're aimed at small teams, not enterprises"
                  className={inputBase}
                  autoComplete="off"
                />
              </Field>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <label htmlFor="brief" className="text-[13.5px] font-medium text-foreground">
                    The brief
                  </label>
                  <button
                    type="button"
                    onClick={() => void generateBrief()}
                    disabled={write.isPending}
                    className={btnGhost}
                  >
                    {write.isPending ? (
                      <Spinner className="h-3.5 w-3.5 animate-spin" aria-hidden />
                    ) : (
                      <Sparkles className="h-3.5 w-3.5" aria-hidden />
                    )}
                    {brief ? "Rewrite" : "Write it for me"}
                  </button>
                </div>
                <textarea
                  id="brief"
                  rows={9}
                  value={brief}
                  onChange={(event) => setBrief(event.target.value)}
                  placeholder="Write the brief yourself, or let Mellox draft it."
                  className={cn(inputBase, "resize-y text-[14.5px] leading-relaxed")}
                />
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-7">
              <header>
                <h1 className="text-[26px] font-semibold tracking-tight text-foreground">
                  Ready to buy
                </h1>
                <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">
                  This is the point money is spent.
                </p>
              </header>

              <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-1">
                <ul className="divide-y divide-border">
                  {chosen.map((item) => (
                    <li
                      key={item.donorId}
                      className="flex items-center justify-between gap-4 px-5 py-3.5"
                    >
                      <span className="min-w-0 truncate text-[14px] text-foreground">
                        {item.domain}
                      </span>
                      <Money
                        usd={item.usd}
                        className="shrink-0 text-[14px] text-muted-foreground"
                      />
                    </li>
                  ))}
                </ul>

                <dl className="space-y-2.5 border-t border-border bg-secondary/40 px-5 py-4">
                  <div className="flex items-baseline justify-between">
                    <dt className="text-[14px] text-muted-foreground">
                      {chosen.length} placement{chosen.length === 1 ? "" : "s"}
                    </dt>
                    <dd>
                      <Money
                        usd={total}
                        className="text-[22px] font-semibold tracking-tight text-foreground"
                      />
                    </dd>
                  </div>
                  <div className="flex items-baseline justify-between">
                    <dt className="text-[13px] text-muted-foreground">Balance afterwards</dt>
                    <dd
                      className={cn(
                        "text-[13px] tabular-nums",
                        canAfford ? "text-muted-foreground" : "text-destructive",
                      )}
                    >
                      <Money usd={Math.max(0, balanceUsd - total)} cents />
                    </dd>
                  </div>
                </dl>
              </div>

              {!canAfford && (
                <div className="flex items-start gap-3 rounded-2xl border border-warning-border bg-warning-surface p-4">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] text-foreground">
                      You need <Money usd={shortfall} cents className="font-medium" /> more.
                    </p>
                    <button
                      type="button"
                      onClick={onTopUp}
                      className="mt-1 text-[14px] font-medium text-primary underline-offset-4 hover:underline"
                    >
                      Add balance
                    </button>
                  </div>
                </div>
              )}

              <div className="rounded-2xl border border-border bg-card p-5">
                <h2 className="text-[14px] font-semibold text-foreground">What happens next</h2>
                <ol className="mt-3 space-y-2.5">
                  {[
                    "We reserve the amount above — nothing more.",
                    "The publisher writes and schedules each article.",
                    "Links usually appear within a day.",
                    "Mellox opens each published page and checks your link is really there.",
                    "If a placement never appears, we refund it.",
                  ].map((line) => (
                    <li key={line} className="flex gap-2.5 text-[13.5px] leading-relaxed">
                      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
                      <span className="text-muted-foreground">{line}</span>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      {/* A pinned action bar: the running total stays visible while choosing,
          and the primary action never scrolls out of reach. */}
      <div className="sticky bottom-0 -mx-4 mt-8 border-t border-border bg-background/90 px-4 py-3.5 backdrop-blur-md sm:-mx-6 sm:px-6">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-4">
          <button
            type="button"
            onClick={() => (step === 0 ? onCancel() : setStep(step - 1))}
            disabled={confirm.isPending}
            className={btnQuiet}
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            {step === 0 ? "Cancel" : "Back"}
          </button>

          <div className="flex items-center gap-4">
            {step === 1 && selected.length > 0 && (
              <Money usd={runningTotal} className="text-[15px] font-medium text-foreground" />
            )}

            {step === 0 && (
              <button
                type="button"
                onClick={() => void runSearch()}
                disabled={targetUrl.trim().length < 8 || keyword.trim().length < 2 || busy}
                className={btnPrimary}
              >
                {find.isPending ? (
                  <>
                    <Spinner className="h-4 w-4 animate-spin" aria-hidden />
                    Finding sites
                  </>
                ) : (
                  "Find sites"
                )}
              </button>
            )}

            {step === 1 && (
              <button
                type="button"
                onClick={() => setStep(2)}
                disabled={selected.length === 0}
                className={btnPrimary}
              >
                {selected.length === 0 ? "Pick at least one" : `Continue with ${selected.length}`}
              </button>
            )}

            {step === 2 && (
              <button
                type="button"
                onClick={() => void review()}
                disabled={save.isPending}
                className={btnPrimary}
              >
                {save.isPending ? (
                  <>
                    <Spinner className="h-4 w-4 animate-spin" aria-hidden />
                    Saving
                  </>
                ) : (
                  "Review order"
                )}
              </button>
            )}

            {step === 3 && (
              <button
                type="button"
                onClick={() => void placeOrder()}
                disabled={!canAfford || confirm.isPending || total <= 0}
                className={btnPrimary}
              >
                {confirm.isPending ? (
                  <>
                    <Spinner className="h-4 w-4 animate-spin" aria-hidden />
                    Placing order
                  </>
                ) : (
                  <>
                    Buy for <Money usd={total} />
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
