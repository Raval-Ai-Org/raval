import { useId } from "react";
import { cn } from "@/lib/utils";

export function CanvaMark({ className }: { className?: string }) {
  const id = useId();
  return (
    <svg aria-hidden="true" viewBox="0 0 32 32" className={cn("size-7 shrink-0", className)}>
      <defs>
        <linearGradient id={id} x1="4" y1="28" x2="28" y2="4" gradientUnits="userSpaceOnUse">
          <stop stopColor="#7D2AE7" />
          <stop offset="1" stopColor="#00C4CC" />
        </linearGradient>
      </defs>
      <circle cx="16" cy="16" r="14" fill={`url(#${id})`} />
      <path
        fill="none"
        stroke="#fff"
        strokeWidth="2.6"
        strokeLinecap="round"
        d="M20.6 12.4a5.4 5.4 0 1 0 0 7.2"
      />
    </svg>
  );
}
