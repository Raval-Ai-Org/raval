"use client";

import { useState } from "react";

/**
 * A website's own icon, from the public favicon service. Decorative: it never
 * carries meaning on its own, and a failure quietly leaves a monogram.
 */
export function SiteIcon({ domain, size = 32 }: { domain: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  const letter =
    domain
      .replace(/^www\./, "")
      .charAt(0)
      .toUpperCase() || "?";
  return (
    <span
      className="grid shrink-0 place-items-center overflow-hidden rounded-[30%] bg-muted text-[13px] font-semibold text-muted-foreground ring-1 ring-border/60 dark:bg-white/[0.08] dark:ring-white/[0.06]"
      style={{ height: size, width: size }}
    >
      {failed ? (
        letter
      ) : (
        /* A third-party favicon, not an app asset: no next/image optimisation. */
        <img
          src={`https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(domain)}`}
          alt=""
          aria-hidden
          width={size}
          height={size}
          loading="lazy"
          onError={() => setFailed(true)}
          className="h-full w-full object-contain p-[12%]"
        />
      )}
    </span>
  );
}
