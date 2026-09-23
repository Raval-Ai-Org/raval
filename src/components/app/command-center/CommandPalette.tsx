"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Search } from "@/components/icons";
import { cn } from "@/lib/utils";

export type PaletteEntry = {
  key: string;
  group: string;
  label: string;
  hint?: string;
  icon: ReactNode;
  /** Only listed once the user types (keeps the idle list short). */
  searchOnly?: boolean;
  run: () => void;
};

export function CommandPalette({
  open,
  onClose,
  entries,
}: {
  open: boolean;
  onClose: () => void;
  entries: PaletteEntry[];
}) {
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setQ("");
      setActive(0);
    }
  }, [open]);

  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (!n) return entries.filter((e) => !e.searchOnly);
    const words = n.split(/\s+/);
    return entries.filter((e) => {
      const hay = `${e.label} ${e.hint ?? ""} ${e.group}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [entries, q]);

  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const groups = useMemo(() => {
    const out: { group: string; items: (PaletteEntry & { index: number })[] }[] = [];
    filtered.forEach((e, index) => {
      let g = out.find((x) => x.group === e.group);
      if (!g) out.push((g = { group: e.group, items: [] }));
      g.items.push({ ...e, index });
    });
    return out;
  }, [filtered]);

  const run = (e: PaletteEntry | undefined) => {
    if (!e) return;
    onClose();
    e.run();
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[100] flex items-start justify-center bg-black/40 p-4 pt-[12vh] backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            role="dialog"
            aria-label="Search"
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="ds-window w-full max-w-xl overflow-hidden border border-border/70"
          >
            <div className="flex items-center gap-3 border-b border-border/60 px-4 py-3.5">
              <Search className="h-4 w-4 text-muted-foreground" />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") onClose();
                  else if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setActive((a) => Math.min(filtered.length - 1, a + 1));
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setActive((a) => Math.max(0, a - 1));
                  } else if (e.key === "Enter") {
                    e.preventDefault();
                    run(filtered[active]);
                  }
                }}
                placeholder="Search clients, actions…"
                className="w-full bg-transparent text-[15px] outline-none placeholder:text-muted-foreground"
              />
              <kbd className="hidden h-5 items-center rounded-md border border-border/60 px-1.5 text-[10.5px] font-semibold text-muted-foreground sm:inline-flex">
                Esc
              </kbd>
            </div>
            <div ref={listRef} className="max-h-[55vh] overflow-y-auto p-2">
              {groups.length === 0 ? (
                <div className="px-3 py-8 text-center text-[13px] text-muted-foreground">
                  No matches
                </div>
              ) : (
                groups.map((g) => (
                  <div key={g.group} className="mb-1">
                    <div className="px-3 pb-1 pt-2 text-[11px] font-semibold text-muted-foreground">
                      {g.group}
                    </div>
                    {g.items.map((e) => (
                      <button
                        key={e.key}
                        data-index={e.index}
                        onMouseMove={() => setActive(e.index)}
                        onClick={() => run(e)}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-[13.5px] transition-colors",
                          active === e.index ? "bg-[var(--ds-well-bg-hover)]" : "",
                        )}
                      >
                        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[var(--ds-well-bg)] text-muted-foreground">
                          {e.icon}
                        </span>
                        <span className="flex-1 truncate">{e.label}</span>
                        {e.hint && (
                          <span className="max-w-[40%] truncate text-[11.5px] text-muted-foreground">
                            {e.hint}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                ))
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
