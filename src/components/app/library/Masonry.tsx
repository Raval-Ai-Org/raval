"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { columnsFor, masonry } from "@/lib/library-grid";

/**
 * Columns of tiles at their true shapes. Each item goes into the shortest
 * column, so reading left to right keeps the newest first. The column count
 * follows the container's own width.
 */
export function Masonry<T>({
  items,
  keyOf,
  ratioOf,
  render,
  testId,
}: {
  items: readonly T[];
  keyOf: (item: T) => string;
  ratioOf: (item: T) => number;
  render: (item: T) => ReactNode;
  testId?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(3);
  const reduce = useReducedMotion();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setColumns(columnsFor(el.clientWidth));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const cols = useMemo(() => masonry(items, columns, ratioOf), [items, columns, ratioOf]);
  const order = useMemo(() => new Map(items.map((item, i) => [keyOf(item), i])), [items, keyOf]);

  return (
    <div ref={ref} data-testid={testId} data-columns={columns} className="flex items-start gap-3">
      {cols.map((col, c) => (
        <div key={c} className="flex min-w-0 flex-1 flex-col gap-3">
          {col.map((item) => {
            const key = keyOf(item);
            return (
              <motion.div
                key={key}
                layout={reduce ? false : "position"}
                initial={reduce ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.985 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{
                  delay: Math.min(order.get(key) ?? 0, 14) * 0.025,
                  duration: 0.35,
                  ease: [0.2, 0.8, 0.2, 1],
                }}
              >
                {render(item)}
              </motion.div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
