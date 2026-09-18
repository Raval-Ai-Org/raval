import { MelloxLoader } from "@/components/ui/page-loader";

// Shown while an /app route segment loads, so navigation never flashes a blank
// screen (proposal E: loading states on every primary surface).
export default function AppLoading() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading workspace"
      className="mx-page-loader flex min-h-dvh w-full bg-background"
    >
      <div className="hidden w-64 shrink-0 border-r border-border/60 p-4 md:block">
        <div className="mx-skel h-8 w-32 rounded-lg" />
        <div className="mt-6 space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="mx-skel h-7 rounded-lg"
              style={{ ["--mx-skel-delay" as string]: `${i * 0.08}s` }}
            />
          ))}
        </div>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-5 p-6">
        <MelloxLoader />
        <span className="mx-loader__label text-[14px] font-medium">Loading…</span>
      </div>
    </div>
  );
}
