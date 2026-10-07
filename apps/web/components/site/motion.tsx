"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";

export function typed(text: string, t: number, start: number, msPerChar: number) {
  return text.slice(0, Math.max(0, Math.floor((t - start) / msPerChar)));
}

export function between(t: number, a: number, b: number) {
  return t >= a && t < b;
}

export function Caret() {
  return <span aria-hidden className="ml-px inline-block h-[1.1em] w-px translate-y-[2px] animate-pulse bg-foreground" />;
}

function subscribeMotion(cb: () => void) {
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

export function useReducedMotion() {
  return useSyncExternalStore(
    subscribeMotion,
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );
}

export function useInView<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.25 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return { ref, visible };
}

export function useClock<T extends HTMLElement>() {
  const reduced = useReducedMotion();
  const { ref, visible } = useInView<T>();
  const [t, setT] = useState(0);

  useEffect(() => {
    if (!visible || reduced) return;
    let last = performance.now();
    let id = requestAnimationFrame(function tick(now) {
      setT((v) => v + Math.min(100, Math.max(0, now - last)));
      last = now;
      id = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(id);
  }, [visible, reduced]);

  return { ref, t: reduced ? Infinity : t };
}

export function cycle(t: number, start: number, period: number) {
  return Number.isFinite(t) && t >= start ? (t - start) % period : -1;
}

export function Reserve({ full, children, className }: { full: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("grid", className)}>
      <span aria-hidden className="invisible col-start-1 row-start-1">
        {full}
      </span>
      <span className="col-start-1 row-start-1">{children}</span>
    </span>
  );
}
