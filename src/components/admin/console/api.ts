"use client";

// Client for /api/admin/*. Errors carry the HTTP status and the server's
// machine-readable code ("mfa_required", "reauth_required", "forbidden") so the
// console can react to them instead of showing a generic failure.

import { useQuery } from "@tanstack/react-query";
import { authedFetch } from "@/lib/authed-fetch";
import type { AdminMe } from "@/lib/admin/types";

export class AdminApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "AdminApiError";
  }
}

export async function adminApi<T>(
  path: string,
  init?: { method?: "GET" | "POST"; body?: unknown },
): Promise<T> {
  const response = await authedFetch(path, {
    method: init?.method ?? "GET",
    ...(init?.body !== undefined
      ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(init.body) }
      : {}),
    // Admin work is never attributed to a customer workspace.
    workspaceId: null,
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new AdminApiError(
      String(payload.error ?? payload.message ?? "Request failed."),
      response.status,
      typeof payload.code === "string" ? payload.code : undefined,
    );
  }
  return payload as T;
}

export function query(params: Record<string, string | number | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

export const adminKeys = {
  me: ["admin", "me"] as const,
  all: ["admin"] as const,
};

export function useAdminMe() {
  return useQuery({
    queryKey: adminKeys.me,
    queryFn: () => adminApi<AdminMe>("/api/admin/me"),
    retry: false,
    staleTime: 60_000,
  });
}

export function errorMessage(error: unknown, fallback = "Something went wrong."): string {
  return error instanceof Error ? error.message : fallback;
}
