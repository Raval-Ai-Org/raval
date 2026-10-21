"use client";

// Abuse signals — candidates worth a look, found by fixed rules over stored
// rows. The page only lists them and states each rule; it never acts. An admin
// who agrees opens the user or workspace and acts there, with a reason.

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { SurfacePage, GroupLabel, Stat } from "@/components/app/surface/SurfaceLayout";
import { Skeleton } from "@/components/ui/skeleton";
import { ShieldCheck } from "@/components/icons";
import { shortId } from "@/lib/admin/permissions";
import type { AdminAbuseSignals } from "@/lib/admin/types";
import { adminApi } from "./api";
import { LoadError } from "./LoadError";
import { ago, fmtNumber, fmtUsd } from "./format";
import { TableFrame, rowClass, td, th } from "./parts";

function Section({
  title,
  rule,
  empty,
  children,
  count,
}: {
  title: string;
  rule: string;
  empty: string;
  children: React.ReactNode;
  count: number;
}) {
  return (
    <>
      <GroupLabel>{title}</GroupLabel>
      <p className="mb-2 text-[12.5px] text-muted-foreground">{rule}</p>
      {count === 0 ? <p className="text-[13px] text-muted-foreground">{empty}</p> : children}
    </>
  );
}

const userLink = (id: string) => (
  <Link
    href={`/admin/users/${id}`}
    className="font-mono text-[12.5px] text-primary hover:underline"
  >
    {shortId(id)}
  </Link>
);

const workspaceLink = (id: string, name: string | null) => (
  <Link href={`/admin/workspaces/${id}`} className="text-primary hover:underline">
    {name ?? shortId(id)}
  </Link>
);

export function AbuseScreen() {
  const signals = useQuery({
    queryKey: ["admin", "abuse"],
    queryFn: () => adminApi<AdminAbuseSignals>("/api/admin/abuse"),
    refetchInterval: 120_000,
  });
  const data = signals.data;
  const total = data
    ? data.signupBursts.length +
      data.costSpikes.length +
      data.failingUsers.length +
      data.heavyUsers.length +
      data.failingWorkspaces.length
    : 0;

  return (
    <SurfacePage
      title="Abuse signals"
      subtitle={
        data
          ? `Updated ${ago(data.generatedAt)} · candidates only, nothing is blocked automatically`
          : "Unusual activity worth a look"
      }
    >
      {signals.isLoading && <Skeleton className="h-64 rounded-2xl" />}
      {signals.error && <LoadError error={signals.error} onRetry={() => void signals.refetch()} />}
      {data && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat
              label="Signals right now"
              value={total}
              icon={ShieldCheck}
              tone={total > 0 ? "warning" : "success"}
              hint="A signal is a reason to look, not proof"
            />
          </div>

          <Section
            title="Signup bursts"
            rule="Five or more accounts from the same company email domain within one hour, in the last 7 days. Free mailbox providers are skipped."
            empty="No bursts."
            count={data.signupBursts.length}
          >
            <TableFrame label="Signup bursts">
              <thead>
                <tr>
                  <th className={th}>Email domain</th>
                  <th className={th}>Hour</th>
                  <th className={`${th} text-right`}>Accounts</th>
                </tr>
              </thead>
              <tbody>
                {data.signupBursts.map((row, i) => (
                  <tr key={i} className={rowClass}>
                    <td className={`${td} font-medium`}>{row.domain}</td>
                    <td className={td}>{ago(row.hour)}</td>
                    <td className={`${td} text-right tabular-nums`}>{fmtNumber(row.accounts)}</td>
                  </tr>
                ))}
              </tbody>
            </TableFrame>
          </Section>

          <Section
            title="AI cost spikes"
            rule="A workspace whose last 24 hours cost over $5 and more than five times its daily average of the week before (estimates)."
            empty="No spikes."
            count={data.costSpikes.length}
          >
            <TableFrame label="Cost spikes">
              <thead>
                <tr>
                  <th className={th}>Workspace</th>
                  <th className={`${th} text-right`}>Last 24 h</th>
                  <th className={`${th} text-right`}>Daily average before</th>
                </tr>
              </thead>
              <tbody>
                {data.costSpikes.map((row) => (
                  <tr key={row.workspaceId} className={rowClass}>
                    <td className={`${td} font-medium`}>
                      {workspaceLink(row.workspaceId, row.name)}
                    </td>
                    <td className={`${td} text-right tabular-nums`}>{fmtUsd(row.cost24hUsd)}</td>
                    <td className={`${td} text-right tabular-nums`}>{fmtUsd(row.avgDaily7dUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </TableFrame>
          </Section>

          <Section
            title="Mostly failing AI calls"
            rule="A person with 50 or more AI calls in 24 hours where at least half failed or were blocked: a loop, or probing."
            empty="None."
            count={data.failingUsers.length}
          >
            <TableFrame label="Failing users">
              <thead>
                <tr>
                  <th className={th}>User</th>
                  <th className={`${th} text-right`}>Calls</th>
                  <th className={`${th} text-right`}>Failed or blocked</th>
                </tr>
              </thead>
              <tbody>
                {data.failingUsers.map((row) => (
                  <tr key={row.userId} className={rowClass}>
                    <td className={td}>{userLink(row.userId)}</td>
                    <td className={`${td} text-right tabular-nums`}>{fmtNumber(row.calls)}</td>
                    <td className={`${td} text-right tabular-nums`}>{fmtNumber(row.badCalls)}</td>
                  </tr>
                ))}
              </tbody>
            </TableFrame>
          </Section>

          <Section
            title="Very heavy hours"
            rule="A person who made 300 or more AI calls in a single hour, in the last 24 hours."
            empty="None."
            count={data.heavyUsers.length}
          >
            <TableFrame label="Heavy users">
              <thead>
                <tr>
                  <th className={th}>User</th>
                  <th className={th}>Hour</th>
                  <th className={`${th} text-right`}>Calls</th>
                </tr>
              </thead>
              <tbody>
                {data.heavyUsers.map((row, i) => (
                  <tr key={i} className={rowClass}>
                    <td className={td}>{userLink(row.userId)}</td>
                    <td className={td}>{ago(row.hour)}</td>
                    <td className={`${td} text-right tabular-nums`}>{fmtNumber(row.calls)}</td>
                  </tr>
                ))}
              </tbody>
            </TableFrame>
          </Section>

          <Section
            title="Many failed Studio jobs"
            rule="A workspace with 10 or more failed Studio jobs in 24 hours."
            empty="None."
            count={data.failingWorkspaces.length}
          >
            <TableFrame label="Failing workspaces">
              <thead>
                <tr>
                  <th className={th}>Workspace</th>
                  <th className={`${th} text-right`}>Failed jobs</th>
                </tr>
              </thead>
              <tbody>
                {data.failingWorkspaces.map((row) => (
                  <tr key={row.workspaceId} className={rowClass}>
                    <td className={`${td} font-medium`}>
                      {workspaceLink(row.workspaceId, row.name)}
                    </td>
                    <td className={`${td} text-right tabular-nums`}>{fmtNumber(row.failed)}</td>
                  </tr>
                ))}
              </tbody>
            </TableFrame>
          </Section>
        </>
      )}
    </SurfacePage>
  );
}
