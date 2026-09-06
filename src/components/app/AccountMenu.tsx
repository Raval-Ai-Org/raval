"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { useNavigate } from "@/lib/navigation";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sun, Moon, Settings, ChevronDown } from "@/components/brand/icons";
import { LogOut, HelpCircle, Sparkles } from "@/components/ui/gemini-icons";
import { supabase } from "@/integrations/supabase/client";
import { useTheme } from "@/hooks/use-theme";
import { signOutAndRedirect } from "@/lib/auth";
import { BASE_URL } from "@/lib/seo";
import { cn } from "@/lib/utils";

type UserInfo = { email: string; name: string; avatar: string | null };

function useCurrentUser() {
  const [u, setU] = useState<UserInfo | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const { data } = await supabase.auth.getUser();
      const user = data.user;
      if (cancelled || !user) return;
      const meta = (user.user_metadata || {}) as Record<string, any>;
      const name =
        meta.full_name ||
        meta.name ||
        meta.display_name ||
        (user.email ? user.email.split("@")[0] : "You");
      const avatar = meta.avatar_url || meta.picture || null;
      setU({ email: user.email || "", name, avatar });
    };
    load();
    const { data: sub } = supabase.auth.onAuthStateChange(() => load());
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);
  return u;
}

function initialsFrom(name: string, email: string) {
  const src = (name || email || "?").trim();
  const parts = src.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}

export function AccountMenu({
  onOpenSettings,
  onClose,
}: {
  onOpenSettings?: () => void;
  onClose?: () => void;
}) {
  const user = useCurrentUser();
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();

  const name = user?.name || "Loading…";
  const email = user?.email || "";
  const initials = initialsFrom(name, email);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Account menu"
          className={cn(
            "group flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left",
            "transition-colors hover:bg-secondary/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
          )}
        >
          <span className="relative grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-[hsl(var(--brand-blue))] to-[hsl(var(--brand-green))] text-[11px] font-semibold text-white ring-1 ring-border/60">
            {user?.avatar ? (
              <Image
                src={user.avatar}
                alt=""
                className="h-full w-full object-cover"
                referrerPolicy="no-referrer"
                fill
                sizes="32px"
              />
            ) : (
              <span>{initials}</span>
            )}
          </span>
          <span className="flex min-w-0 flex-1 flex-col leading-tight">
            <span className="truncate text-[13px] font-medium text-foreground">{name}</span>
            <span className="truncate text-[11.5px] text-muted-foreground">
              {email || "Signed in"}
            </span>
          </span>
          <ChevronDown
            className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70 transition-colors group-hover:text-foreground"
            aria-hidden
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" sideOffset={8} className="w-64 p-1.5">
        <DropdownMenuLabel className="flex items-center gap-2.5 px-2 py-2">
          <span className="relative grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-[hsl(var(--brand-blue))] to-[hsl(var(--brand-green))] text-[12px] font-semibold text-white">
            {user?.avatar ? (
              <Image
                src={user.avatar}
                alt=""
                className="h-full w-full object-cover"
                referrerPolicy="no-referrer"
                fill
                sizes="36px"
              />
            ) : (
              <span>{initials}</span>
            )}
          </span>
          <span className="flex min-w-0 flex-1 flex-col leading-tight">
            <span className="truncate text-[13px] font-semibold text-foreground">{name}</span>
            <span className="truncate text-[11.5px] font-normal text-muted-foreground">
              {email}
            </span>
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => {
            onOpenSettings?.();
            onClose?.();
          }}
          className="gap-2 rounded-lg px-2 py-1.5 text-[13px]"
        >
          <Settings className="h-4 w-4 text-muted-foreground" />
          Settings
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault();
            toggle();
          }}
          className="gap-2 rounded-lg px-2 py-1.5 text-[13px]"
        >
          {theme === "dark" ? (
            <Sun className="h-4 w-4 text-muted-foreground" />
          ) : (
            <Moon className="h-4 w-4 text-muted-foreground" />
          )}
          {theme === "dark" ? "Light mode" : "Dark mode"}
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            window.dispatchEvent(new CustomEvent("open:upgrade"));
            onClose?.();
          }}
          className="gap-2 rounded-lg px-2 py-1.5 text-[13px]"
        >
          <Sparkles className="h-4 w-4 text-[hsl(var(--brand-blue))]" />
          Upgrade plan
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            window.open(`${BASE_URL}/#help`, "_blank", "noopener,noreferrer");
          }}
          className="gap-2 rounded-lg px-2 py-1.5 text-[13px]"
        >
          <HelpCircle className="h-4 w-4 text-muted-foreground" />
          Help & FAQ
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={async () => {
            await signOutAndRedirect();
            navigate({ to: "/login" });
          }}
          className="gap-2 rounded-lg px-2 py-1.5 text-[13px] text-destructive focus:text-destructive"
        >
          <LogOut className="h-4 w-4" />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AccountMenuCompact({ onOpenSettings }: { onOpenSettings?: () => void }) {
  const user = useCurrentUser();
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();
  const name = user?.name || "Account";
  const email = user?.email || "";
  const initials = initialsFrom(name, email);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Account — ${name}`}
          title={name}
          className="relative grid h-7 w-7 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-[hsl(var(--brand-blue))] to-[hsl(var(--brand-green))] text-[10px] font-semibold text-white ring-1 ring-border/60 transition hover:ring-2 hover:ring-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          {user?.avatar ? (
            <Image
              src={user.avatar}
              alt=""
              className="h-full w-full object-cover"
              referrerPolicy="no-referrer"
              fill
              sizes="28px"
            />
          ) : (
            <span>{initials}</span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="right" sideOffset={10} className="w-64 p-1.5">
        <DropdownMenuLabel className="flex items-center gap-2.5 px-2 py-2">
          <span className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-[hsl(var(--brand-blue))] to-[hsl(var(--brand-green))] text-[12px] font-semibold text-white">
            {user?.avatar ? (
              <img
                src={user.avatar}
                alt=""
                className="h-full w-full object-cover"
                referrerPolicy="no-referrer"
              />
            ) : (
              <span>{initials}</span>
            )}
          </span>
          <span className="flex min-w-0 flex-1 flex-col leading-tight">
            <span className="truncate text-[13px] font-semibold text-foreground">{name}</span>
            <span className="truncate text-[11.5px] font-normal text-muted-foreground">
              {email}
            </span>
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => onOpenSettings?.()}
          className="gap-2 rounded-lg px-2 py-1.5 text-[13px]"
        >
          <Settings className="h-4 w-4 text-muted-foreground" /> Settings
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault();
            toggle();
          }}
          className="gap-2 rounded-lg px-2 py-1.5 text-[13px]"
        >
          {theme === "dark" ? (
            <Sun className="h-4 w-4 text-muted-foreground" />
          ) : (
            <Moon className="h-4 w-4 text-muted-foreground" />
          )}
          {theme === "dark" ? "Light mode" : "Dark mode"}
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => window.dispatchEvent(new CustomEvent("open:upgrade"))}
          className="gap-2 rounded-lg px-2 py-1.5 text-[13px]"
        >
          <Sparkles className="h-4 w-4 text-[hsl(var(--brand-blue))]" /> Upgrade plan
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => window.open(`${BASE_URL}/#help`, "_blank", "noopener,noreferrer")}
          className="gap-2 rounded-lg px-2 py-1.5 text-[13px]"
        >
          <HelpCircle className="h-4 w-4 text-muted-foreground" /> Help & FAQ
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={async () => {
            await signOutAndRedirect();
            navigate({ to: "/login" });
          }}
          className="gap-2 rounded-lg px-2 py-1.5 text-[13px] text-destructive focus:text-destructive"
        >
          <LogOut className="h-4 w-4" /> Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
