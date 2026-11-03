"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

type Theme = "light" | "dark";

/**
 * Light/dark switch. The theme starts from the visitor's system setting (see THEME_SCRIPT in layout.tsx);
 * clicking this stores an explicit choice, which then wins over the system.
 */
export default function ThemeToggle({ className = "" }: { className?: string }) {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    const read = () => setTheme(document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark");
    read();
    const mq = matchMedia("(prefers-color-scheme: light)");
    const onSystem = () => {
      try {
        if (localStorage.getItem("mx-theme")) return;
      } catch {}
      document.documentElement.setAttribute("data-theme", mq.matches ? "light" : "dark");
      read();
    };
    mq.addEventListener("change", onSystem);
    return () => mq.removeEventListener("change", onSystem);
  }, []);

  function toggle() {
    const next: Theme = theme === "light" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("mx-theme", next);
    } catch {}
    setTheme(next);
  }

  const isLight = theme === "light";
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isLight ? "Switch to dark mode" : "Switch to light mode"}
      className={`glass glass-interactive flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white ${className}`}
    >
      {theme === null ? null : isLight ? <Moon size={18} aria-hidden="true" /> : <Sun size={18} aria-hidden="true" />}
    </button>
  );
}
