import type { Metadata } from "next";
import Link from "next/link";
export const metadata: Metadata = {
  title: "Notion connection · Mellox AI",
  robots: "noindex,nofollow",
  referrer: "no-referrer",
};
export default async function NotionResult({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  return (
    <main className="grid min-h-dvh place-items-center bg-background p-4">
      <section className="ds-window max-w-md p-8 text-center">
        <h1 className="ds-page-title">
          {status === "cancelled" ? "Notion connection cancelled" : "Could not connect Notion"}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Return to your Mellox workspace and try again.
        </p>
        <Link
          className="mt-5 inline-flex rounded-full bg-primary px-5 py-2 text-sm text-primary-foreground"
          href="/projects"
        >
          Your workspaces
        </Link>
      </section>
    </main>
  );
}
