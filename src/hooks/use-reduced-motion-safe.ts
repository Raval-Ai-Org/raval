"use client";

import { useEffect, useState } from "react";
import { useReducedMotion } from "framer-motion";

/**
 * `useReducedMotion` returns null on the server and a boolean on the client,
 * so reading it during render causes a hydration mismatch. This starts at
 * false to match the server render and updates after mount.
 */
export function useReducedMotionSafe(): boolean {
  const prefersReduced = useReducedMotion();
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    setReduce(!!prefersReduced);
  }, [prefersReduced]);
  return reduce;
}
