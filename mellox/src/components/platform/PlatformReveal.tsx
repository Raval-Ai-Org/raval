"use client";

import { useEffect } from "react";

/** Fades in `[data-reveal]` elements of the platform sections as they scroll into view. */
export default function PlatformReveal() {
  useEffect(() => {
    const targets = document.querySelectorAll<HTMLElement>(".pf [data-reveal], .pf-sec [data-reveal]");
    const io = new IntersectionObserver(
      (entries) =>
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("is-in");
            io.unobserve(e.target);
          }
        }),
      { threshold: 0, rootMargin: "0px 0px -8% 0px" },
    );
    targets.forEach((t) => io.observe(t));
    return () => io.disconnect();
  }, []);
  return null;
}
