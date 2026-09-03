"use client";

// Next.js-backed replacements for the small slice of the TanStack Router API
// this app used (`Link`, `useNavigate`, `useRouterState`, `redirect`). Keeping
// the same call signatures means route/component code did not have to change
// when the app moved to the Next App Router.
import NextLink from "next/link";
import { usePathname, useRouter, useSearchParams, redirect as nextRedirect } from "next/navigation";
import { forwardRef, useCallback, useMemo } from "react";
import type { ComponentPropsWithoutRef } from "react";

export type SearchInput = Record<string, unknown> | undefined;

/** Serialise a search object into a `?a=1&b=2` suffix (empty string when none). */
export function buildSearch(search: SearchInput): string {
  if (!search) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

/** Build a full href from the `{ to, search, hash }` shape the app already uses. */
export function buildHref(to: string, search?: SearchInput, hash?: string): string {
  const suffix = buildSearch(search);
  const fragment = hash ? (hash.startsWith("#") ? hash : `#${hash}`) : "";
  return `${to}${suffix}${fragment}`;
}

type LinkProps = Omit<ComponentPropsWithoutRef<typeof NextLink>, "href"> & {
  to: string;
  search?: SearchInput;
  hash?: string;
  /** Accepted for source compatibility; Next prefetches on viewport/hover already. */
  preload?: unknown;
  activeProps?: unknown;
  inactiveProps?: unknown;
};

/**
 * `<Link to="/app" />` — same prop name the app used under TanStack Router,
 * rendered by `next/link`.
 */
export const Link = forwardRef<HTMLAnchorElement, LinkProps>(function Link(
  { to, search, hash, preload, activeProps, inactiveProps, ...rest },
  ref,
) {
  return <NextLink ref={ref} href={buildHref(to, search, hash)} {...rest} />;
});

export type NavigateOptions = {
  to: string;
  search?: SearchInput;
  hash?: string;
  replace?: boolean;
};

/** `navigate({ to, search, replace })` on top of the Next router. */
export function useNavigate() {
  const router = useRouter();
  return useCallback(
    (options: NavigateOptions) => {
      const href = buildHref(options.to, options.search, options.hash);
      if (options.replace) router.replace(href);
      else router.push(href);
    },
    [router],
  );
}

export type RouterState = {
  location: { pathname: string; search: Record<string, string>; href: string };
  isLoading: boolean;
  isTransitioning: boolean;
};

/**
 * `useRouterState({ select })` — exposes pathname/search. Next drives its own
 * pending UI through Suspense, so the loading flags stay false here and the
 * top-of-page progress bar is fed by `useLinkStatus` instead (see RouteProgress).
 */
export function useRouterState<T = RouterState>(opts?: { select?: (s: RouterState) => T }): T {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const state = useMemo<RouterState>(() => {
    const search: Record<string, string> = {};
    searchParams?.forEach((value, key) => {
      search[key] = value;
    });
    const qs = searchParams?.toString() ?? "";
    return {
      location: { pathname, search, href: qs ? `${pathname}?${qs}` : pathname },
      isLoading: false,
      isTransitioning: false,
    };
  }, [pathname, searchParams]);
  return (opts?.select ? opts.select(state) : (state as unknown as T)) as T;
}

/** `redirect({ to, search })` — throws, exactly like the previous router helper. */
export function redirect(options: { to: string; search?: SearchInput; hash?: string }): never {
  return nextRedirect(buildHref(options.to, options.search, options.hash));
}

export { useRouter, usePathname, useSearchParams };
