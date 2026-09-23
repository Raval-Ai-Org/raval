"use client";

import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { motion } from "framer-motion";
import { Activity, Calendar, Eye, Users } from "@/components/icons";
import { cn } from "@/lib/utils";
import type { CommandCenter } from "./use-command-center";
import { ChannelMark, ClientMark, StatTile, channelLabel, clientHref } from "./ui";

export function PerformanceView({ cc, onGo }: { cc: CommandCenter; onGo: (href: string) => void }) {
  const s = cc.stats;
  const delta = s.published14 - s.publishedPrev14;
  const maxClient = s.byClient[0]?.posts ?? 1;
  const maxChannel = s.byChannel[0]?.posts ?? 1;
  const scored = cc.clients
    .filter((c) => c.geoScore !== null)
    .sort((a, b) => (b.geoScore ?? 0) - (a.geoScore ?? 0));

  return (
    <div className="ds-enter space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          icon={<Activity className="h-4 w-4" />}
          label="Posted, last 14 days"
          value={s.published14}
          sub={`${delta >= 0 ? "+" : ""}${delta} vs the 14 days before`}
          tone="primary"
        />
        <StatTile
          icon={<Calendar className="h-4 w-4" />}
          label="Scheduled, next 14 days"
          value={s.scheduledNext14}
        />
        <StatTile
          icon={<Users className="h-4 w-4" />}
          label="Clients posting"
          value={s.clientsPosting}
          sub={`of ${cc.clients.length}`}
        />
        <StatTile
          icon={<Eye className="h-4 w-4" />}
          label="Avg AI visibility"
          value={
            scored.length
              ? Math.round(scored.reduce((a, c) => a + (c.geoScore ?? 0), 0) / scored.length)
              : 0
          }
          sub={scored.length ? `${scored.length} scanned` : "No scans yet"}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="ds-tile p-4 lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-[14px] font-semibold">Posts per day</h3>
            <span className="text-[12px] text-muted-foreground">All clients · 14 days</span>
          </div>
          <div className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={s.trend} margin={{ top: 6, right: 6, left: -24, bottom: 0 }}>
                <defs>
                  <linearGradient id="ccPosts" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="day"
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  axisLine={false}
                  tickLine={false}
                  interval="preserveStartEnd"
                  minTickGap={18}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  axisLine={false}
                  tickLine={false}
                  width={30}
                />
                <Tooltip
                  cursor={{ stroke: "hsl(var(--border))" }}
                  contentStyle={{
                    background: "hsl(var(--popover))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 14,
                    fontSize: 12,
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="posts"
                  name="Posts"
                  stroke="hsl(var(--primary))"
                  strokeWidth={2.25}
                  fill="url(#ccPosts)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="ds-tile p-4">
          <h3 className="mb-3 text-[14px] font-semibold">By channel</h3>
          {s.byChannel.length === 0 ? (
            <p className="text-[12.5px] text-muted-foreground">Nothing posted yet.</p>
          ) : (
            <ul className="space-y-2.5">
              {s.byChannel.map((ch, i) => (
                <li key={ch.channel} className="flex items-center gap-2.5">
                  <ChannelMark channel={ch.channel} size={26} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between text-[12.5px]">
                      <span className="truncate font-medium">{channelLabel(ch.channel)}</span>
                      <span className="tabular-nums text-muted-foreground">{ch.posts}</span>
                    </div>
                    <Bar pct={ch.posts / maxChannel} delay={i} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="ds-tile p-4">
          <h3 className="mb-3 text-[14px] font-semibold">Most active clients</h3>
          {s.byClient.length === 0 ? (
            <p className="text-[12.5px] text-muted-foreground">No posts in the last 14 days.</p>
          ) : (
            <ul className="space-y-1">
              {s.byClient.slice(0, 8).map((row, i) => {
                const c = cc.clientMap.get(row.id);
                return (
                  <li key={row.id}>
                    <button
                      onClick={() => c && onGo(clientHref(c, "analytics"))}
                      className="flex w-full items-center gap-3 rounded-2xl px-2 py-2 text-left transition hover:bg-[var(--ds-well-bg)]"
                    >
                      {c && <ClientMark client={c} size={28} />}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between text-[13px]">
                          <span className="truncate font-medium">{row.name}</span>
                          <span className="tabular-nums text-muted-foreground">{row.posts}</span>
                        </div>
                        <Bar pct={row.posts / maxClient} delay={i} />
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="ds-tile p-4">
          <h3 className="mb-3 text-[14px] font-semibold">AI visibility by client</h3>
          {scored.length === 0 ? (
            <p className="text-[12.5px] text-muted-foreground">
              No client has an AI visibility scan yet.
            </p>
          ) : (
            <ul className="space-y-1">
              {scored.map((c, i) => (
                <li key={c.id}>
                  <button
                    onClick={() => onGo(clientHref(c, "visibility"))}
                    className="flex w-full items-center gap-3 rounded-2xl px-2 py-2 text-left transition hover:bg-[var(--ds-well-bg)]"
                  >
                    <ClientMark client={c} size={28} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between text-[13px]">
                        <span className="truncate font-medium">{c.name}</span>
                        <span
                          className={cn(
                            "font-semibold tabular-nums",
                            (c.geoScore ?? 0) < 50 ? "text-warning" : "text-foreground",
                          )}
                        >
                          {c.geoScore}
                        </span>
                      </div>
                      <Bar pct={(c.geoScore ?? 0) / 100} delay={i} />
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <p className="text-[12px] text-muted-foreground">
        Reach and engagement come from each client&apos;s own Analytics once their accounts are
        connected.
      </p>
    </div>
  );
}

function Bar({ pct, delay }: { pct: number; delay: number }) {
  return (
    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--ds-well-bg-hover)]">
      <motion.div
        className="h-full rounded-full bg-primary"
        initial={{ width: 0 }}
        animate={{ width: `${Math.max(4, Math.round(pct * 100))}%` }}
        transition={{ duration: 0.7, delay: 0.05 * delay, ease: [0.16, 1, 0.3, 1] }}
      />
    </div>
  );
}
