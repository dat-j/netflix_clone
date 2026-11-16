"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

export function useMediaQuery(query: string, serverValue = false) {
  return useSyncExternalStore(
    (cb) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", cb);
      return () => mql.removeEventListener("change", cb);
    },
    () => window.matchMedia(query).matches,
    () => serverValue,
  );
}

/** Desktop pointer that can hover — enables hover previews; touch gets tap → detail sheet. */
export const useCanHover = () => useMediaQuery("(hover: hover) and (pointer: fine)", true);

const noopSubscribe = () => () => {};
/** false during SSR/hydration, true on the client afterwards (portals, cookies…) */
export const useIsClient = () => useSyncExternalStore(noopSubscribe, () => true, () => false);

export const useReducedMotion = () => useMediaQuery("(prefers-reduced-motion: reduce)", false);

/** True once the element has come within `rootMargin` of the viewport (sticky). */
export function useNearViewport<T extends Element>(rootMargin = "300px 0px") {
  const ref = useRef<T>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || near) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true);
          io.disconnect();
        }
      },
      { rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [near, rootMargin]);
  return [ref, near] as const;
}

/** Live visibility ratio tracking (billboard pauses when mostly scrolled away). */
export function useInView<T extends Element>(threshold = 0.35) {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { threshold });
    io.observe(el);
    return () => io.disconnect();
  }, [threshold]);
  return [ref, inView] as const;
}

export function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
