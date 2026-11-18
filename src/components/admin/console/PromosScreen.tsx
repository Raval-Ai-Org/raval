"use client";

// Trial codes — the only way into Mellox without paying first (no Free plan,
// ADR-0050). A code gives a few days on the trial tier (posts, carousels,
// Stories and publishing for one brand; no video) with a few credits. A card
// is still needed and the chosen plan is charged when the trial ends. One
// trial per account and per card, enforced in the database.

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GroupLabel, SurfacePage, Tile } from "@/components/app/surface/SurfaceLayout";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/lib/toast";
import { PROMO_LIMITS, TRIAL_FEATURES, promoLine } from "@/lib/billing/promo";
import { FEATURES } from "@/lib/billing/catalog";
import { adminApi, errorMessage, useAdminMe } from "./api";
import { ago, fmtDate } from "./format";
import { Chip, Field, TableFrame, fieldClass, rowClass, td, th } from "./parts";
import { hasPermission } from "@/lib/admin/permissions";

type PromoRow = {
  id: string;
  code: string;
  label: string;
  trial_days: number;
  credits: number;
  max_redemptions: number | null;
  redeemed_count: number;
  expires_at: string | null;
  active: boolean;
  note: string;
  created_at: string;
  state: "live" | "paused" | "scheduled" | "expired" | "used_up";
  converted: number;
};

type Redemption = {
  id: string;
  userId: string | null;
  name: string | null;
  status: string;
  trialEndsAt: string | null;
  createdAt: string;
};

const KEY = ["admin", "promos"] as const;

const STATE: Record<PromoRow["state"], { label: string; tone: "success" | "neutral" | "warning" }> =
  {
    live: { label: "Live", tone: "success" },
    paused: { label: "Paused", tone: "neutral" },
    scheduled: { label: "Starts later", tone: "neutral" },
    expired: { label: "Ended", tone: "warning" },
    used_up: { label: "Used up", tone: "warning" },
  };

const PRESETS = [
  { days: 1, credits: 10 },
  { days: 2, credits: 15 },
  { days: 3, credits: 25 },
];

function randomCode(days: number) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return `MOX${days}-${Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("")}`;
}

export function PromosScreen() {
  const me = useAdminMe();
  const canEdit = Boolean(me.data && hasPermission(me.data.permissions, "entitlements.override"));
  const queryClient = useQueryClient();
  const list = useQuery({
    queryKey: KEY,
    queryFn: () => adminApi<{ codes: PromoRow[] }>("/api/admin/promos"),
  });
  const [openId, setOpenId] = useState<string | null>(null);

  const toggle = useMutation({
    mutationFn: (row: PromoRow) =>
      adminApi("/api/admin/promos", {
        method: "PATCH",
        body: {
          id: row.id,
          active: !row.active,
          reason: row.active
            ? "Paused from the trial codes page"
            : "Turned back on from the trial codes page",
        },
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: KEY }),
    onError: (error) => toast.error(errorMessage(error)),
  });

  const codes = list.data?.codes ?? [];
  const trials = codes.reduce((sum, row) => sum + row.redeemed_count, 0);
  const paid = codes.reduce((sum, row) => sum + row.converted, 0);

  return (
    <SurfacePage
      title="Trial codes"
      subtitle="Give someone a few days to try Mellox. They still add a card; the plan they pick starts when the trial ends."
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Tile className="space-y-1">
          <p className="text-[12px] text-muted-foreground">Live codes</p>
          <p className="text-[22px] font-semibold tabular-nums">
            {codes.filter((row) => row.state === "live").length}
          </p>
        </Tile>
        <Tile className="space-y-1">
          <p className="text-[12px] text-muted-foreground">Trials started</p>
          <p className="text-[22px] font-semibold tabular-nums">{trials}</p>
        </Tile>
        <Tile className="space-y-1">
          <p className="text-[12px] text-muted-foreground">Became paying</p>
          <p className="text-[22px] font-semibold tabular-nums">
            {paid}
            {trials > 0 && (
              <span className="ml-1.5 text-[13px] font-normal text-muted-foreground">
                {Math.round((paid / trials) * 100)}%
              </span>
            )}
          </p>
        </Tile>
      </div>

      <Tile className="space-y-2">
        <p className="text-[13px] font-semibold">What a trial includes</p>
        <p className="text-[12.5px] text-muted-foreground">
          {TRIAL_FEATURES.map((key) => FEATURES[key].label).join(", ")}, for one brand and one seat,
          with the code's credits. No video, Autopilot, competitors or AI visibility until they pay.
          One trial per account and per card.
        </p>
      </Tile>

      {canEdit && (
        <CreatePromo onDone={() => void queryClient.invalidateQueries({ queryKey: KEY })} />
      )}

      <GroupLabel>Codes</GroupLabel>
      {list.isLoading ? (
        <Skeleton className="h-48 rounded-2xl" />
      ) : list.error ? (
        <ErrorState
          title="Couldn't load codes"
          description={errorMessage(list.error)}
          onRetry={() => void list.refetch()}
        />
      ) : codes.length === 0 ? (
        <EmptyState
          title="No codes yet"
          description="Make one above and share it with the person."
        />
      ) : (
        <TableFrame label="Trial codes">
          <thead>
            <tr>
              <th className={th}>Code</th>
              <th className={th}>Gives</th>
              <th className={th}>Used</th>
              <th className={th}>Paid after</th>
              <th className={th}>State</th>
              <th className={th}>Ends</th>
              <th className={th} />
            </tr>
          </thead>
          <tbody>
            {codes.map((row) => (
              <tr key={row.id} className={rowClass}>
                <td className={td}>
                  <button
                    type="button"
                    onClick={() => setOpenId(openId === row.id ? null : row.id)}
                    className="text-left"
                  >
                    <span className="font-mono text-[13px] font-semibold">{row.code}</span>
                    {row.label && (
                      <span className="block text-[12px] text-muted-foreground">{row.label}</span>
                    )}
                  </button>
                </td>
                <td className={td}>{promoLine({ days: row.trial_days, credits: row.credits })}</td>
                <td className={`${td} tabular-nums`}>
                  {row.redeemed_count}
                  {row.max_redemptions !== null && ` / ${row.max_redemptions}`}
                </td>
                <td className={`${td} tabular-nums`}>{row.converted}</td>
                <td className={td}>
                  <Chip tone={STATE[row.state].tone}>{STATE[row.state].label}</Chip>
                </td>
                <td className={td}>{row.expires_at ? fmtDate(row.expires_at) : "No end"}</td>
                <td className={`${td} text-right`}>
                  <div className="flex justify-end gap-1.5">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        void navigator.clipboard?.writeText(row.code);
                        toast.success("Code copied");
                      }}
                    >
                      Copy
                    </Button>
                    {canEdit && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={toggle.isPending}
                        onClick={() => toggle.mutate(row)}
                      >
                        {row.active ? "Pause" : "Turn on"}
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </TableFrame>
      )}
      {openId && <Redemptions id={openId} code={codes.find((c) => c.id === openId)?.code ?? ""} />}
    </SurfacePage>
  );
}

function Redemptions({ id, code }: { id: string; code: string }) {
  const query = useQuery({
    queryKey: [...KEY, "redemptions", id],
    queryFn: () =>
      adminApi<{ redemptions: Redemption[] }>(`/api/admin/promos?redemptionsFor=${id}`),
  });
  const rows = query.data?.redemptions ?? [];
  return (
    <>
      <GroupLabel>Who used {code}</GroupLabel>
      {query.isLoading ? (
        <Skeleton className="h-24 rounded-2xl" />
      ) : rows.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">Nobody has started a trial with it yet.</p>
      ) : (
        <TableFrame label={`Trials from ${code}`}>
          <thead>
            <tr>
              <th className={th}>Person</th>
              <th className={th}>Started</th>
              <th className={th}>Trial ends</th>
              <th className={th}>Now</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className={rowClass}>
                <td className={td}>
                  {row.userId ? (
                    <a
                      className="underline-offset-2 hover:underline"
                      href={`/admin/users/${row.userId}`}
                    >
                      {row.name ?? row.userId.slice(0, 8)}
                    </a>
                  ) : (
                    "Deleted account"
                  )}
                </td>
                <td className={td}>{ago(row.createdAt)}</td>
                <td className={td}>{row.trialEndsAt ? fmtDate(row.trialEndsAt) : "—"}</td>
                <td className={td}>
                  <Chip
                    tone={
                      row.status === "converted"
                        ? "success"
                        : row.status === "trialing"
                          ? "primary"
                          : "neutral"
                    }
                  >
                    {row.status === "converted"
                      ? "Paying"
                      : row.status === "trialing"
                        ? "On trial"
                        : "Ended"}
                  </Chip>
                </td>
              </tr>
            ))}
          </tbody>
        </TableFrame>
      )}
    </>
  );
}

function CreatePromo({ onDone }: { onDone: () => void }) {
  const [days, setDays] = useState("3");
  const [credits, setCredits] = useState("25");
  const [code, setCode] = useState(() => randomCode(3));
  const [label, setLabel] = useState("");
  const [uses, setUses] = useState("100");
  const [ends, setEnds] = useState("");
  const [reason, setReason] = useState("");

  const create = useMutation({
    mutationFn: () =>
      adminApi("/api/admin/promos", {
        method: "POST",
        body: {
          code,
          label: label || `${days}-day trial`,
          days: Number(days),
          credits: Number(credits),
          maxUses: uses ? Number(uses) : null,
          expiresAt: ends ? new Date(`${ends}T23:59:59`).toISOString() : null,
          note: "",
          reason: reason.trim(),
        },
      }),
    onSuccess: () => {
      toast.success(`Code ${code} is live`);
      setCode(randomCode(Number(days) || 1));
      setReason("");
      setLabel("");
      onDone();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const d = Number(days);
  const c = Number(credits);
  const valid =
    Number.isInteger(d) &&
    d >= PROMO_LIMITS.days.min &&
    d <= PROMO_LIMITS.days.max &&
    Number.isInteger(c) &&
    c >= PROMO_LIMITS.credits.min &&
    c <= PROMO_LIMITS.credits.max &&
    /^[A-Z0-9][A-Z0-9-]{3,31}$/.test(code) &&
    reason.trim().length >= 10;

  return (
    <Tile className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[14px] font-semibold">New trial code</p>
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((preset) => (
            <button
              key={preset.days}
              type="button"
              onClick={() => {
                setDays(String(preset.days));
                setCredits(String(preset.credits));
                setCode(randomCode(preset.days));
              }}
              className="h-8 rounded-full border border-border px-3 text-[12.5px] transition-colors hover:bg-muted"
            >
              {promoLine(preset)}
            </button>
          ))}
        </div>
      </div>
      <form
        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (valid) create.mutate();
        }}
      >
        <Field label="Code" hint="Letters, numbers and dashes">
          <div className="flex gap-1.5">
            <input
              className={`${fieldClass} font-mono`}
              value={code}
              maxLength={32}
              onChange={(event) =>
                setCode(event.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ""))
              }
            />
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setCode(randomCode(d || 1))}
            >
              New
            </Button>
          </div>
        </Field>
        <Field label="Free days" hint={`${PROMO_LIMITS.days.min} to ${PROMO_LIMITS.days.max}`}>
          <input
            className={fieldClass}
            inputMode="numeric"
            value={days}
            onChange={(event) => setDays(event.target.value.replace(/\D/g, ""))}
          />
        </Field>
        <Field label="Credits" hint="1 credit = 1 image post">
          <input
            className={fieldClass}
            inputMode="numeric"
            value={credits}
            onChange={(event) => setCredits(event.target.value.replace(/\D/g, ""))}
          />
        </Field>
        <Field label="Uses" hint="Empty for no cap">
          <input
            className={fieldClass}
            inputMode="numeric"
            value={uses}
            onChange={(event) => setUses(event.target.value.replace(/\D/g, ""))}
          />
        </Field>
        <Field label="Name (optional)">
          <input
            className={fieldClass}
            value={label}
            maxLength={80}
            placeholder={`${days || "?"}-day trial`}
            onChange={(event) => setLabel(event.target.value)}
          />
        </Field>
        <Field label="Stops working after (optional)">
          <input
            type="date"
            className={fieldClass}
            value={ends}
            onChange={(event) => setEnds(event.target.value)}
          />
        </Field>
        <Field label="Reason" hint="At least 10 characters, saved in the audit log">
          <input
            className={fieldClass}
            value={reason}
            maxLength={300}
            placeholder="For example: agency partners, launch week"
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
        <div className="flex items-end">
          <Button type="submit" disabled={!valid || create.isPending}>
            {create.isPending ? "Saving…" : "Create code"}
          </Button>
        </div>
      </form>
    </Tile>
  );
}
