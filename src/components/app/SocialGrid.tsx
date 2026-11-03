"use client";

// Settings → Social accounts, drawn the same way as Connectors: the accounts
// at a glance, one tile per network, and a network's own view with its
// accounts and one Connect button. Presentational: /connections-lab renders
// it with sample data; SocialAccountsSection wires it.
import { AnimatePresence, motion, MotionConfig } from "framer-motion";
import { Plus, Spinner } from "@/components/icons";
import { BrandLogo } from "@/components/brand/BrandLogo";
import { isPlatformAppIconId, PlatformAppIcon } from "@/components/brand/PlatformAppIcon";
import { dsGhostBtn, dsPrimaryBtn } from "@/components/app/surface/buttons";
import { Skeleton } from "@/components/ui/skeleton";
import type { DistributionPlatformMeta } from "@/lib/distribution-platforms";
import type { ConnectedAccount } from "@/lib/sdr.handlers";
import { cn } from "@/lib/utils";
import { ConnectionStatus } from "./connectors/ConnectionCard";
import {
  ConnectHero,
  LogoTile,
  OpenedView,
  slide,
  TileGroup,
  type TileTone,
} from "./connectors/ConnectorParts";

const RECONNECT_COPY: Record<string, string> = {
  all_pages_removed: "Every connected Page was removed.",
  access_revoked: "Access was removed on the network.",
  youtube_account_suspended: "YouTube suspended this channel.",
};

function NetworkIcon({ platform, size }: { platform: DistributionPlatformMeta; size: number }) {
  if (isPlatformAppIconId(platform.id))
    return <PlatformAppIcon platform={platform.id} size={size} />;
  return (
    <span
      className="grid shrink-0 place-items-center rounded-[26%] bg-secondary"
      style={{ width: size, height: size, color: platform.tint }}
    >
      <BrandLogo name={platform.logo} brand size={Math.round(size * 0.5)} />
    </span>
  );
}

const accountName = (a: ConnectedAccount) =>
  a.displayName || a.platformUsername || "Connected account";

export function SocialGrid({
  platforms,
  accounts,
  loading,
  canEdit,
  busy,
  open,
  onOpen,
  onConnect,
  onDisconnect,
}: {
  /** Networks this workspace can connect, plus any it already has. */
  platforms: DistributionPlatformMeta[];
  /** Accounts that aren't disconnected. */
  accounts: ConnectedAccount[];
  loading: boolean;
  canEdit: boolean;
  /** The network or account id being worked on. */
  busy: string | null;
  open: string | null;
  onOpen: (platform: string | null) => void;
  /** Opens the network's sign-in window. Call inside the click. */
  onConnect: (platform: string) => void;
  onDisconnect: (account: ConnectedAccount) => void;
}) {
  const owned = (id: string) => accounts.filter((a) => a.platform === id);
  const toneOf = (id: string): TileTone => {
    const list = owned(id);
    if (!list.length) return "off";
    return list.some((a) => a.status !== "active") ? "attention" : "on";
  };
  const current = platforms.find((p) => p.id === open) ?? null;
  const connected = platforms.filter((p) => owned(p.id).length);

  return (
    <MotionConfig reducedMotion="user">
      <AnimatePresence mode="wait" initial={false}>
        {current ? (
          <motion.div key={current.id} {...slide(1)}>
            <OpenedView backLabel="Social accounts" onBack={() => onOpen(null)}>
              <Network
                platform={current}
                accounts={owned(current.id)}
                tone={toneOf(current.id)}
                canEdit={canEdit}
                busy={busy}
                onConnect={() => onConnect(current.id)}
                onDisconnect={onDisconnect}
              />
            </OpenedView>
          </motion.div>
        ) : (
          <motion.div key="grid" {...slide(-1)} className="ds-enter">
            {loading ? (
              <Skeleton className="h-[140px] rounded-[28px]" />
            ) : (
              <ConnectHero
                title="Where Mellox posts"
                count={accounts.length}
                attention={accounts.filter((a) => a.status !== "active").length}
                marks={connected.map((p) => ({
                  id: p.id,
                  node: <NetworkIcon platform={p} size={44} />,
                }))}
              />
            )}
            <div className="mt-7">
              <TileGroup>
                {loading
                  ? Array.from({ length: 8 }).map((_, i) => (
                      <li key={i}>
                        <Skeleton className="aspect-square w-full rounded-[24px]" />
                      </li>
                    ))
                  : platforms.map((p, i) => {
                      const n = owned(p.id).length;
                      return (
                        <LogoTile
                          key={p.id}
                          index={i}
                          logo={<NetworkIcon platform={p} size={48} />}
                          name={p.label}
                          tone={toneOf(p.id)}
                          badge={n > 1 ? String(n) : undefined}
                          onOpen={() => onOpen(p.id)}
                        />
                      );
                    })}
              </TileGroup>
            </div>
            {!loading && !canEdit && (
              <p className="mt-4 text-center text-[12.5px] text-muted-foreground">
                Only editors can change accounts
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </MotionConfig>
  );
}

function Network({
  platform,
  accounts,
  tone,
  canEdit,
  busy,
  onConnect,
  onDisconnect,
}: {
  platform: DistributionPlatformMeta;
  accounts: ConnectedAccount[];
  tone: TileTone;
  canEdit: boolean;
  busy: string | null;
  onConnect: () => void;
  onDisconnect: (account: ConnectedAccount) => void;
}) {
  const working = busy === platform.id;
  return (
    <div className="ds-tile overflow-hidden">
      <div className="flex items-center gap-4 p-5">
        <NetworkIcon platform={platform} size={52} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[17px] font-semibold tracking-tight text-foreground">
            {platform.label}
          </h3>
          <div className="mt-1">
            <ConnectionStatus
              tone={tone === "on" ? "connected" : tone === "attention" ? "attention" : "off"}
              text={
                tone === "attention"
                  ? "Reconnect needed"
                  : tone === "on"
                    ? "Connected"
                    : "Not connected"
              }
            />
          </div>
        </div>
      </div>

      {accounts.length > 0 && (
        <ul className="divide-y divide-[var(--ds-tile-border)] border-t border-[var(--ds-tile-border)]">
          {accounts.map((account) => {
            const active = account.status === "active";
            const reason = account.reconnectReason
              ? (RECONNECT_COPY[account.reconnectReason] ?? null)
              : null;
            return (
              <li key={account.accountId} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <span className="grid size-8 shrink-0 place-items-center overflow-hidden rounded-full bg-[var(--ds-well-bg)]">
                  {account.avatarUrl ? (
                    <img
                      src={account.avatarUrl}
                      alt=""
                      className="size-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <span className="text-[12px] font-semibold text-muted-foreground">
                      {accountName(account).slice(0, 1)}
                    </span>
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-medium text-foreground">
                    {accountName(account)}
                  </span>
                  {!active && (
                    <span className="block truncate text-[12px] text-warning">
                      {reason ?? "Reconnect needed"}
                    </span>
                  )}
                </span>
                {canEdit && (
                  <span className="flex shrink-0 items-center gap-1.5">
                    {!active && (
                      <button
                        type="button"
                        onClick={onConnect}
                        disabled={busy !== null}
                        className={cn(dsPrimaryBtn, "h-8 px-3 text-[12.5px]")}
                      >
                        Reconnect
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => onDisconnect(account)}
                      disabled={busy !== null}
                      className={cn(dsGhostBtn, "h-8 px-3 text-[12.5px]")}
                    >
                      {busy === account.accountId ? (
                        <Spinner className="size-3.5 animate-spin" aria-hidden />
                      ) : (
                        "Disconnect"
                      )}
                    </button>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {canEdit && (
        <div className="border-t border-[var(--ds-tile-border)] p-5">
          <button
            type="button"
            onClick={onConnect}
            disabled={busy !== null}
            className={cn(
              accounts.length ? dsGhostBtn : dsPrimaryBtn,
              "h-10 w-full justify-center text-[13.5px]",
            )}
          >
            {working ? (
              <Spinner className="size-4 animate-spin" aria-hidden />
            ) : accounts.length ? (
              <>
                <Plus className="size-4" aria-hidden />
                Add another
              </>
            ) : (
              `Connect ${platform.label}`
            )}
          </button>
          {platform.connectNote && (
            <p className="mt-3 text-center text-[12px] leading-5 text-muted-foreground">
              {platform.connectNote}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
