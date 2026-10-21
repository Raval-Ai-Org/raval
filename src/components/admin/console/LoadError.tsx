"use client";

// LoadError — what a screen shows when its data could not be read. A refusal
// for the admin's role is said plainly, with no retry (trying again cannot
// help); anything else gets the usual message and a retry.

import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { Shield } from "@/components/icons";
import { AdminApiError, errorMessage } from "./api";

export function LoadError({
  error,
  onRetry,
  title,
}: {
  error: unknown;
  onRetry: () => void;
  title?: string;
}) {
  if (error instanceof AdminApiError && error.code === "forbidden") {
    return (
      <EmptyState
        icon={Shield}
        title="Not available for your role"
        description="Your admin role doesn't include this. Ask a super admin if you need it."
      />
    );
  }
  return (
    <ErrorState
      title={title}
      description={errorMessage(error, "Try again in a moment.")}
      onRetry={onRetry}
    />
  );
}
