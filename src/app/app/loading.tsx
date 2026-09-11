// Shown while an /app route segment loads, so navigation never flashes a blank
// screen (proposal E: loading states on every primary surface).
export default function AppLoading() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading workspace"
      className="flex min-h-dvh w-full bg-background"
    >
      <div className="hidden w-64 shrink-0 border-r border-border/60 p-4 md:block">
        <div className="h-8 w-32 animate-pulse rounded-lg bg-secondary/70" />
        <div className="mt-6 space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-7 animate-pulse rounded-lg bg-secondary/50" />
          ))}
        </div>
      </div>
      <div className="flex flex-1 flex-col items-center justify-end gap-4 p-6">
        <div className="w-full max-w-2xl space-y-3">
          <div className="h-4 w-2/3 animate-pulse rounded bg-secondary/60" />
          <div className="h-4 w-1/2 animate-pulse rounded bg-secondary/50" />
        </div>
        <div className="h-14 w-full max-w-2xl animate-pulse rounded-2xl bg-secondary/60" />
        <span className="sr-only">Loading…</span>
      </div>
    </div>
  );
}
