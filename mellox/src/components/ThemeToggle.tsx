"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

type Preference = "system" | "light" | "dark";

const ORDER: Preference[] = ["system", "light", "dark"];
const LABEL: Record<Preference, string> = { system: "System", light: "Light", dark: "Dark" };
const KEY = "mx-theme";

function stored(): Preference {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

function apply(pref: Preference) {
  const resolved = pref === "system" ? (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark") : pref;
  document.documentElement.setAttribute("data-theme", resolved);
}

/**
 * Theme switch with three choices: follow the system, always light, always dark. The theme starts from a saved choice,
 * else the visitor's system setting (see THEME_SCRIPT in layout.tsx, which runs before first paint). While "System" is
 * selected the page follows the system if it changes. Clicking cycles System, Light, Dark.
 */
export default function ThemeToggle({ className = "" }: { className?: string }) {
  const [pref, setPref] = useState<Preference | null>(null);

  useEffect(() => {
    setPref(stored());
    const mq = matchMedia("(prefers-color-scheme: light)");
    const onSystem = () => {
      if (stored() === "system") apply("system");
    };
    mq.addEventListener("change", onSystem);
    return () => mq.removeEventListener("change", onSystem);
  }, []);

  function cycle() {
    const next = ORDER[(ORDER.indexOf(pref ?? "system") + 1) % ORDER.length];
    try {
      if (next === "system") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, next);
    } catch {}
    apply(next);
    setPref(next);
  }

  const current = pref ?? "system";
  const next = ORDER[(ORDER.indexOf(current) + 1) % ORDER.length];
  const Icon = current === "light" ? Sun : current === "dark" ? Moon : Monitor;
  return (
    <button
      type="button"
      onClick={cycle}
      aria-label={`Theme: ${LABEL[current]}. Switch to ${LABEL[next]}`}
      title={`Theme: ${LABEL[current]}`}
      className={`glass glass-interactive flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white ${className}`}
    >
      {pref === null ? null : <Icon size={18} aria-hidden="true" />}
    </button>
  );
}
