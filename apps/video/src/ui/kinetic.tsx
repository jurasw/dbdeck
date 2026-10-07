import { cn } from "../lib/cn";
import { easeIn, easeOut, ramp } from "../lib/motion";

export function Kinetic({
  t,
  dur,
  children,
  className,
  enter = 520,
  exit = 380,
  dist = 320,
  delay = 0,
  hold = false,
}: {
  t: number;
  dur: number;
  children: React.ReactNode;
  className?: string;
  enter?: number;
  exit?: number;
  dist?: number;
  delay?: number;
  hold?: boolean;
}) {
  const local = t - delay;
  const a = ramp(local, 0, enter, easeOut);
  const b = hold ? 0 : ramp(t, dur - exit, exit, easeIn);
  const x = (1 - a) * dist - b * dist * 1.3;
  const v = (a < 1 ? (1 - a) * 2.2 : 0) + b * 2.4;
  const trail = Math.min(1, v);
  const visible = local >= 0 ? 1 : 0;
  const ghosts = [0.55, 0.32, 0.16];
  return (
    <div className={cn("relative", className)} style={{ opacity: visible * Math.min(1, a * 1.6) * (1 - b * b) }}>
      {trail > 0.02 &&
        ghosts.map((o, i) => (
          <div
            key={i}
            aria-hidden
            className="absolute inset-0"
            style={{
              opacity: o * trail,
              transform: `translateX(${x + (i + 1) * 26 * trail * (b > 0 ? -1 : 1)}px) skewX(${-10 * trail}deg)`,
              filter: `blur(${(i + 1) * 3 * trail}px)`,
            }}
          >
            {children}
          </div>
        ))}
      <div style={{ transform: `translateX(${x}px) skewX(${-10 * trail}deg)`, filter: trail > 0.05 ? `blur(${trail * 2}px)` : undefined }}>{children}</div>
    </div>
  );
}

export function Pop({ t, at, children, className, dur = 500 }: { t: number; at: number; children: React.ReactNode; className?: string; dur?: number }) {
  const p = ramp(t, at, dur, easeOut);
  return (
    <div
      className={className}
      style={{ opacity: p, transform: `translateY(${(1 - p) * 28}px) scale(${0.96 + 0.04 * p})`, filter: p < 0.99 ? `blur(${(1 - p) * 10}px)` : undefined }}
    >
      {children}
    </div>
  );
}
