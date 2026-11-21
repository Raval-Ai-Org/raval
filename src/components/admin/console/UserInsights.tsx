"use client";

// One person's activity, errors and gifts on their admin page. Activity and
// errors are this person's slice of the free pulse (stored rows only); the
// gifts are the audited routes /api/admin/users/gift-credits and gift-plan,
// each needing a written reason and a fresh second factor.

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { GroupLabel, Tile } from "@/components/app/surface/SurfaceLayout";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/lib/toast";
import { AdminApiError, adminApi, errorMessage } from "./api";
import { MfaPanel } from "./MfaPanel";
import { ago, fmtDate } from "./format";
import { Chip, Fact, Field, fieldClass, textareaClass } from "./parts";
import { CreditBar, credits, minutes, pulseKey, usePulse } from "./pulse-ui";

const CREDIT_MAX = 1000;
const MONTHS_MAX = 12;
const PLANS = [
  { id: "starter", label: "Starter" },
  { id: "growth", label: "Growth" },
  { id: "agency", label: "Agency" },
] as const;
const QUICK_CREDITS = [10, 25, 50, 100];

const ACCESS = [
  { id: "trial", label: "Trial tier (free features)" },
  { id: "starter", label: "Starter" },
  { id: "growth", label: "Growth" },
  { id: "agency", label: "Agency" },
] as const;
const ACCESS_DAYS_MAX = 90;
const QUICK_DAYS = [1, 3, 5, 7, 14, 30];
const digits = (value: string) => value.replace(/[^0-9]/g, "");

type Gift =
  | {
      kind: "credits";
      amount: string;
      /** Empty: the credits last. */
      expires: string;
      reason: string;
      operationId: string;
    }
  | {
      kind: "access";
      tier: (typeof ACCESS)[number]["id"];
      days: string;
      amount: string;
      reason: string;
      operationId: string;
    }
  | { kind: "end"; reason: string; operationId: string }
  | {
      kind: "plan";
      plan: (typeof PLANS)[number]["id"];
      months: string;
      reason: string;
      operationId: string;
    };

const newId = () => crypto.randomUUID();

export function UserActivity({ userId }: { userId: string }) {
  const pulse = usePulse();
  if (pulse.isLoading) return <Skeleton className="h-40 rounded-2xl" />;
  if (!pulse.data) return null;
  const person = pulse.data.customers.find((c) => c.userId === userId);
  const errors = pulse.data.errors.filter((e) => e.userId === userId).slice(0, 12);

  return (
    <>
      <GroupLabel>Activity (last 7 days)</GroupLabel>
      {person ? (
        <Tile className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <Chip tone="primary">{person.planLabel}</Chip>
            <Chip tone={person.status === "active" ? "success" : "warning"}>
              {person.status.replace("_", " ")}
            </Chip>
            {person.errors7d > 0 && (
              <Chip tone="danger">
                {person.errors7d} error{person.errors7d === 1 ? "" : "s"}
              </Chip>
            )}
          </div>
          <CreditBar left={person.creditsLeft} allowance={person.creditsAllowance} />
          <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
            <Fact label="Credits left">
              {credits(person.creditsLeft)} of {credits(person.creditsAllowance)}
            </Fact>
            <Fact label="Active time">
              {minutes(person.activeMinutes7d)}
              <span className="text-muted-foreground">
                {" "}
                · {minutes(person.activeMinutes14d)} in 14 days
              </span>
            </Fact>
            <Fact label="Actions">{person.actions7d.toLocaleString()}</Fact>
            <Fact label="Pieces made">{person.pieces7d.toLocaleString()}</Fact>
            <Fact label="Last active">
              {person.lastActiveAt ? ago(person.lastActiveAt) : "Not this week"}
            </Fact>
            <Fact label="Last doing">{person.lastDoing ?? "—"}</Fact>
            <Fact label="Workspaces">{person.workspaces}</Fact>
            <Fact label="Joined">{fmtDate(person.joinedAt)}</Fact>
          </dl>
          <p className="text-[12px] text-muted-foreground">
            Active time is estimated from the times of their actions.
          </p>
        </Tile>
      ) : (
        <p className="text-[13px] text-muted-foreground">No activity recorded this week.</p>
      )}

      <GroupLabel>Recent errors</GroupLabel>
      {errors.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">No errors this week.</p>
      ) : (
        <Tile className="p-0">
          <ul className="divide-y divide-border/60">
            {errors.map((error) => (
              <li key={error.id} className="space-y-1 px-4 py-3">
                <div className="flex flex-wrap items-center gap-2 text-[13px]">
                  <span className="font-medium">{error.what}</span>
                  <Chip tone="neutral">{error.source === "studio" ? "Studio" : "AI"}</Chip>
                  {error.workspaceName && (
                    <span className="text-muted-foreground">in {error.workspaceName}</span>
                  )}
                  <span className="ml-auto text-[12px] text-muted-foreground">{ago(error.at)}</span>
                </div>
                <p className="break-words text-[12.5px] text-muted-foreground">{error.message}</p>
                {error.detail && (
                  <p className="truncate font-mono text-[11.5px] text-muted-foreground/80">
                    {error.detail}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </Tile>
      )}
    </>
  );
}

export function UserGifts({
  userId,
  canCredits,
  canPlan,
  onDone,
}: {
  userId: string;
  canCredits: boolean;
  canPlan: boolean;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const [gift, setGift] = useState<Gift | null>(null);
  const [stepUp, setStepUp] = useState(false);

  const send = useMutation({
    mutationFn: (value: Gift): Promise<{ replayed?: boolean; ended?: boolean }> =>
      value.kind === "credits"
        ? adminApi<{ replayed: boolean }>("/api/admin/users/gift-credits", {
            method: "POST",
            body: {
              userId,
              credits: Number(value.amount),
              expiresInDays: value.expires ? Number(value.expires) : null,
              reason: value.reason.trim(),
              operationId: value.operationId,
            },
          })
        : value.kind === "access"
          ? adminApi<{ replayed: boolean }>("/api/admin/users/access-pass", {
              method: "POST",
              body: {
                userId,
                tier: value.tier,
                days: Number(value.days),
                credits: Number(value.amount || 0),
                reason: value.reason.trim(),
                operationId: value.operationId,
              },
            })
          : value.kind === "end"
            ? adminApi<{ ended: boolean }>("/api/admin/users/access-pass", {
                method: "DELETE",
                body: { userId, reason: value.reason.trim() },
              })
            : adminApi<{ replayed: boolean; activeUntil: string }>("/api/admin/users/gift-plan", {
                method: "POST",
                body: {
                  userId,
                  plan: value.plan,
                  months: Number(value.months),
                  reason: value.reason.trim(),
                  operationId: value.operationId,
                },
              }),
    onSuccess: (result, value) => {
      toast.success(
        result.replayed
          ? "Already applied."
          : value.kind === "credits"
            ? `${value.amount} credits added to their wallet.`
            : value.kind === "access"
              ? `Access given for ${value.days} day${value.days === "1" ? "" : "s"}.`
              : value.kind === "end"
                ? result.ended
                  ? "Staff access ended."
                  : "They had no staff access running."
                : `Plan given for ${value.months} month${value.months === "1" ? "" : "s"}.`,
      );
      setGift(null);
      setStepUp(false);
      void queryClient.invalidateQueries({ queryKey: pulseKey });
      onDone();
    },
    onError: (error) => {
      if (error instanceof AdminApiError && error.code === "reauth_required") {
        setStepUp(true);
        return;
      }
      toast.error(errorMessage(error));
    },
  });

  if (!canCredits && !canPlan) return null;

  const amount = gift?.kind === "credits" || gift?.kind === "access" ? Number(gift.amount || 0) : 0;
  const months = gift?.kind === "plan" ? Number(gift.months) : 0;
  const days = gift?.kind === "access" ? Number(gift.days) : 0;
  const expires = gift?.kind === "credits" && gift.expires ? Number(gift.expires) : null;
  const valid =
    gift !== null &&
    gift.reason.trim().length >= 10 &&
    (gift.kind === "credits"
      ? Number.isInteger(amount) &&
        amount >= 1 &&
        amount <= CREDIT_MAX &&
        (expires === null || (expires >= 1 && expires <= 365))
      : gift.kind === "access"
        ? Number.isInteger(days) &&
          days >= 1 &&
          days <= ACCESS_DAYS_MAX &&
          amount >= 0 &&
          amount <= CREDIT_MAX
        : gift.kind === "end"
          ? true
          : Number.isInteger(months) && months >= 1 && months <= MONTHS_MAX);

  return (
    <>
      <GroupLabel>Gifts</GroupLabel>
      <Tile className="space-y-4">
        {!gift ? (
          <div className="flex flex-wrap gap-2">
            {canCredits && (
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setGift({
                    kind: "credits",
                    amount: "25",
                    expires: "",
                    reason: "",
                    operationId: newId(),
                  })
                }
              >
                Give credits
              </Button>
            )}
            {canPlan && (
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setGift({
                    kind: "access",
                    tier: "trial",
                    days: "5",
                    amount: "15",
                    reason: "",
                    operationId: newId(),
                  })
                }
              >
                Give access for days
              </Button>
            )}
            {canPlan && (
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setGift({
                    kind: "plan",
                    plan: "growth",
                    months: "1",
                    reason: "",
                    operationId: newId(),
                  })
                }
              >
                Give a plan for months
              </Button>
            )}
            {canPlan && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setGift({ kind: "end", reason: "", operationId: newId() })}
              >
                End staff access
              </Button>
            )}
            <p className="w-full text-[12px] text-muted-foreground">
              Credits go to their own wallet for AI work, and can end after some days. Access for
              days needs no card: the trial tier opens posts, carousels, Stories and publishing for
              one brand (no video); a plan opens that plan. Its credits end with it and nothing
              renews. A plan for months adds that plan&apos;s monthly credits.
            </p>
          </div>
        ) : stepUp ? (
          <MfaPanel
            mode="reauth"
            onVerified={() => {
              setStepUp(false);
              send.mutate(gift);
            }}
          />
        ) : (
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (valid) send.mutate(gift);
            }}
          >
            {gift.kind === "end" ? (
              <p className="text-[13px] text-muted-foreground">
                Ends a plan or trial tier given from this page, now. Their own paid plan, if any, is
                not touched.
              </p>
            ) : gift.kind === "access" ? (
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Access">
                  <select
                    className={fieldClass}
                    value={gift.tier}
                    onChange={(event) =>
                      setGift({ ...gift, tier: event.target.value as typeof gift.tier })
                    }
                  >
                    {ACCESS.map((tier) => (
                      <option key={tier.id} value={tier.id}>
                        {tier.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Days" hint={`1 to ${ACCESS_DAYS_MAX}`}>
                  <input
                    className={fieldClass}
                    inputMode="numeric"
                    value={gift.days}
                    onChange={(event) => setGift({ ...gift, days: digits(event.target.value) })}
                  />
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {QUICK_DAYS.map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setGift({ ...gift, days: String(n) })}
                        className="h-7 rounded-full border border-border px-2.5 text-[12px] transition-colors hover:bg-muted"
                      >
                        {n}d
                      </button>
                    ))}
                  </div>
                </Field>
                <Field label="Credits" hint="They end with the access">
                  <input
                    className={fieldClass}
                    inputMode="numeric"
                    value={gift.amount}
                    onChange={(event) => setGift({ ...gift, amount: digits(event.target.value) })}
                  />
                </Field>
              </div>
            ) : gift.kind === "credits" ? (
              <Field label="Credits" hint={`1 credit = 1 image post. Up to ${CREDIT_MAX} at once.`}>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    className={`${fieldClass} w-28`}
                    inputMode="numeric"
                    value={gift.amount}
                    onChange={(event) =>
                      setGift({ ...gift, amount: event.target.value.replace(/\D/g, "") })
                    }
                  />
                  {QUICK_CREDITS.map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setGift({ ...gift, amount: String(n) })}
                      className="h-8 rounded-full border border-border px-3 text-[12.5px] transition-colors hover:bg-muted"
                    >
                      {n}
                    </button>
                  ))}
                </div>
                <label className="mt-3 flex items-center gap-2 text-[12.5px]">
                  Ends after
                  <input
                    className={`${fieldClass} w-20`}
                    inputMode="numeric"
                    placeholder="never"
                    value={gift.expires}
                    onChange={(event) => setGift({ ...gift, expires: digits(event.target.value) })}
                  />
                  days
                </label>
              </Field>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Plan">
                  <select
                    className={fieldClass}
                    value={gift.plan}
                    onChange={(event) =>
                      setGift({ ...gift, plan: event.target.value as typeof gift.plan })
                    }
                  >
                    {PLANS.map((plan) => (
                      <option key={plan.id} value={plan.id}>
                        {plan.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field
                  label="Months"
                  hint={`1 to ${MONTHS_MAX}. A card subscription is changed in its own billing.`}
                >
                  <input
                    className={fieldClass}
                    inputMode="numeric"
                    value={gift.months}
                    onChange={(event) =>
                      setGift({ ...gift, months: event.target.value.replace(/\D/g, "") })
                    }
                  />
                </Field>
              </div>
            )}
            <Field label="Reason" hint="At least 10 characters, saved in the audit log">
              <textarea
                className={textareaClass}
                value={gift.reason}
                maxLength={300}
                placeholder="For example: launch week thank-you, or making up for a failed render."
                onChange={(event) => setGift({ ...gift, reason: event.target.value })}
              />
            </Field>
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={!valid || send.isPending}>
                {send.isPending
                  ? "Applying…"
                  : gift.kind === "credits"
                    ? "Give credits"
                    : gift.kind === "access"
                      ? "Give access"
                      : gift.kind === "end"
                        ? "End access now"
                        : "Give plan"}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setGift(null)}>
                Cancel
              </Button>
            </div>
          </form>
        )}
      </Tile>
    </>
  );
}
