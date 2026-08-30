import * as React from "react";

const MOBILE_BREAKPOINT = 768;
const COMPACT_BREAKPOINT = 1024;

function useBreakpoint(max: number) {
  const [hit, setHit] = React.useState<boolean | undefined>(undefined);
  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${max - 1}px)`);
    const onChange = () => setHit(window.innerWidth < max);
    mql.addEventListener("change", onChange);
    setHit(window.innerWidth < max);
    return () => mql.removeEventListener("change", onChange);
  }, [max]);
  return !!hit;
}

export function useIsMobile() {
  return useBreakpoint(MOBILE_BREAKPOINT);
}

/** True below 1024px — treat as "compact" (phones + most tablets). */
export function useIsCompact() {
  return useBreakpoint(COMPACT_BREAKPOINT);
}
