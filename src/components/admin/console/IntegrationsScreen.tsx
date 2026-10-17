"use client";

// Integrations — how many social accounts and website connections there are in
// each state, and the ones that need attention. State only: no token or key
// is ever read, and fixing a connection is the customer's job (or support's,
// from the workspace).

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { SurfacePage, GroupLabel, Stat } from "@/components/app/surface/SurfaceLayout";
import { Skeleton } from "@/components/ui/skeleton";
import { Plug } from "@/components/icons";
import type { AdminIntegrations } from "@/lib/admin/types";
import { adminApi } from "./api";
import { LoadError } from "./LoadError";
import { ago, fmtNumber } from "./format";
import { Chip, TableFrame, rowClass, td, th } from "./parts";

const tone = (status: string) =>
  status === "active" || status === "connected" ? "success" : "warning";

export function IntegrationsScreen() {
  const integrations = useQuery({
    queryKey: ["admin", "integrations"],
    queryFn: () => adminApi<AdminIntegrations>("/api/admin/integrations"),
  });
  const data = integrations.data;
  const social = data?.social.reduce((sum, row) => sum + row.accounts, 0) ?? 0;
  const connections = data?.connections.reduce((sum, row) => sum + row.connections, 0) ?? 0;

  return (
    <SurfacePage
      title="Integrations"
      subtitle={data ? `Updated ${ago(data.generatedAt)} · state only` : "Connected accounts"}
    >
      {integrations.isLoading && <Skeleton className="h-64 rounded-2xl" />}
      {integrations.error && (
        <LoadError error={integrations.error} onRetry={() => void integrations.refetch()} />
      )}
      {data && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="Social accounts" value={fmtNumber(social)} icon={Plug} />
            <Stat label="Website connections" value={fmtNumber(connections)} />
            <Stat
              label="Needing attention"
              value={fmtNumber(data.problems.length)}
              tone={data.problems.length > 0 ? "warning" : "success"}
            />
          </div>

          <GroupLabel>Social accounts</GroupLabel>
          {data.social.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">None connected.</p>
          ) : (
            <TableFrame label="Social accounts">
              <thead>
                <tr>
                  <th className={th}>Platform</th>
                  <th className={th}>Status</th>
                  <th className={`${th} text-right`}>Accounts</th>
                </tr>
              </thead>
              <tbody>
                {data.social.map((row) => (
                  <tr key={`${row.platform}:${row.status}`} className={rowClass}>
                    <td className={`${td} font-medium`}>{row.platform}</td>
                    <td className={td}>
                      <Chip tone={tone(row.status)}>{row.status}</Chip>
                    </td>
                    <td className={`${td} text-right tabular-nums`}>{fmtNumber(row.accounts)}</td>
                  </tr>
                ))}
              </tbody>
            </TableFrame>
          )}

          <GroupLabel>Website connections</GroupLabel>
          {data.connections.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">None connected.</p>
          ) : (
            <TableFrame label="Website connections">
              <thead>
                <tr>
                  <th className={th}>Provider</th>
                  <th className={th}>Status</th>
                  <th className={`${th} text-right`}>Connections</th>
                </tr>
              </thead>
              <tbody>
                {data.connections.map((row) => (
                  <tr key={`${row.provider}:${row.status}`} className={rowClass}>
                    <td className={`${td} font-medium`}>{row.provider}</td>
                    <td className={td}>
                      <Chip tone={tone(row.status)}>{row.status}</Chip>
                    </td>
                    <td className={`${td} text-right tabular-nums`}>
                      {fmtNumber(row.connections)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableFrame>
          )}

          <GroupLabel>Needing attention</GroupLabel>
          {data.problems.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">Nothing needs attention.</p>
          ) : (
            <TableFrame label="Problems">
              <thead>
                <tr>
                  <th className={th}>Provider</th>
                  <th className={th}>Status</th>
                  <th className={th}>Message</th>
                  <th className={th}>When</th>
                  <th className={th}>Workspace</th>
                </tr>
              </thead>
              <tbody>
                {data.problems.map((row, i) => (
                  <tr key={i} className={rowClass}>
                    <td className={`${td} font-medium`}>{row.provider}</td>
                    <td className={td}>
                      <Chip tone="warning">{row.status}</Chip>
                    </td>
                    <td className={`${td} max-w-[280px] truncate text-muted-foreground`}>
                      {row.message || "—"}
                    </td>
                    <td className={td}>{ago(row.at)}</td>
                    <td className={td}>
                      <Link
                        href={`/admin/workspaces/${row.workspaceId}`}
                        className="text-primary hover:underline"
                      >
                        Open
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableFrame>
          )}
        </>
      )}
    </SurfacePage>
  );
}
