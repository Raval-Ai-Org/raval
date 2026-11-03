"use client";

import { useEffect, useId, useState } from "react";
import "./theme-toggle.css";

const KEY = "mx-theme";
const RAYS = Array.from({ length: 8 }, (_, i) => (i * Math.PI) / 4);

function systemTheme(): "light" | "dark" {
  return matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function hasChoice(): boolean {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark";
  } catch {
    return false;
  }
}

function current(): "light" | "dark" {
  return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
}

/**
 * Animated day / night switch (sun turns into a moon). The page starts from the visitor's saved choice, else their system
 * setting (THEME_SCRIPT in layout.tsx, before first paint). Flipping the switch saves an explicit choice; flipping it
 * back to the same theme as the system clears the saved choice, so the page follows the system again. Every visual state
 * is drawn by theme-toggle.css from <html data-theme>.
 */
export default function ThemeToggle({ className = "" }: { className?: string }) {
  const id = useId();
  const [dark, setDark] = useState(true);

  useEffect(() => {
    setDark(current() === "dark");
    const mq = matchMedia("(prefers-color-scheme: light)");
    const onSystem = () => {
      if (hasChoice()) return;
      document.documentElement.setAttribute("data-theme", systemTheme());
      setDark(current() === "dark");
    };
    mq.addEventListener("change", onSystem);
    return () => mq.removeEventListener("change", onSystem);
  }, []);

  function flip() {
    const next = current() === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try {
      if (next === systemTheme()) localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, next);
    } catch {}
    setDark(next === "dark");
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={dark}
      aria-label="Dark mode"
      title={dark ? "Switch to light mode" : "Switch to dark mode"}
      onClick={flip}
      className={`tt ${className}`}
    >
      <span className="tt-stars" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </span>
      <span className="tt-clouds" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span className="tt-knob" aria-hidden="true">
        <svg viewBox="0 0 28 28">
          <defs>
            <mask id={`${id}-moon`}>
              <rect width="28" height="28" fill="#fff" />
              <circle className="tt-bite" cx="20" cy="8.5" r="7" fill="#000" />
            </mask>
          </defs>
          <g className="tt-rays">
            {RAYS.map((a) => (
              <line
                key={a}
                x1={14 + Math.cos(a) * 11.5}
                y1={14 + Math.sin(a) * 11.5}
                x2={14 + Math.cos(a) * 13.5}
                y2={14 + Math.sin(a) * 13.5}
              />
            ))}
          </g>
          <g mask={`url(#${id}-moon)`}>
            <circle className="tt-disc" cx="14" cy="14" r="9" />
            <circle className="tt-crater" cx="10.5" cy="17" r="1.5" />
            <circle className="tt-crater" cx="15" cy="20" r="1" />
          </g>
        </svg>
      </span>
    </button>
  );
}
